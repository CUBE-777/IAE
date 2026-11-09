-- ============================================================
-- 0048_member_activation_email.sql — تصحيح البريد الإلكتروني للمنخرط أثناء التفعيل (بلا SMTP ولا رسالة تحقق)
--
-- الفكرة: عند فتح رابط التفعيل (WhatsApp) يُطلب من المنخرط كتابة بريده الشخصي الصحيح قبل اختيار كلمة المرور.
--   * الحساب في auth.users لا يوجد قبل التفعيل (member-activate ينشئه ببريد members.email عند الإنهاء)،
--     فتغيير members.email هنا ثم إنشاء الحساب به = البريد الجديد هو بريد الدخول والتواصل، دون أي updateUserById للبريد.
--   * profiles لا تُمسّ: هي جدول الإداريين فقط، والمنخرط العادي لا يدخلها (0035/0046).
--   * مسار «استعادة الدخول» (حساب موجود) لا يغيّر البريد إطلاقًا؛ ولا يُقبل أي تغيير بعد استعمال الرابط.
--
-- ما يضيفه (إضافة فقط؛ لا تعديل لأي دالة أو سياسة قائمة):
--   1) member_activation_links: أعمدة email_confirmed / email_attempts / email_state_hash.
--      الحالة مرتبطة بـ token_hash: إعادة إصدار الرابط تُبطل التأكيد وتصفّر العدّاد تلقائيًا.
--   2) set_member_activation_email(token, email) — service_role فقط (من Edge Function member-activate-email).
--   3) member_activation_email_confirmed(token)  — service_role فقط (يفحصها member-activate قبل إنشاء الحساب).
--
-- الأمان: التحقق من الرمز (غير مستعمل/غير منتهٍ) + لا حساب للعضو + صيغة البريد + عدم وجوده في auth.users أو profiles
--   أو لدى عضو آخر غير محذوف + سقف 10 محاولات لكل رابط. الإخفاقات المتوقعة تُعاد كنتيجة (لا استثناء) كي يُحفظ العدّاد.
--
-- يتطلب: 0036 و0037 و0046.   آمن لإعادة التشغيل.   الرجوع: supabase/rollback/0048_member_activation_email_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;`.
-- ⚠️ الترتيب: نفّذ هذا الملف ← انشر member-activate-email ← أعد نشر member-activate ← انشر الواجهة.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.member_activation_links') is null
     or to_regprocedure('public.finalize_member_activation(text, uuid)') is null then
    raise exception 'شغّل 0036 و0037 و0046 أولاً';
  end if;
  if not exists (select 1 from pg_proc where proname = 'prepare_member_activation' and prosrc like '%حساب إداري%') then
    raise exception 'شغّل 0046_dual_accounts_and_board_card.sql أولاً';
  end if;
end $$;

-- 1) الأعمدة (الجدول مغلق على العملاء أصلًا: RLS + بلا صلاحيات)
alter table public.member_activation_links
  add column if not exists email_confirmed   boolean not null default false,
  add column if not exists email_attempts    integer not null default 0,
  add column if not exists email_state_hash  text;

-- 2) تعيين/تصحيح البريد
create or replace function public.set_member_activation_email(p_token text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_hash     text := encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  v_l        public.member_activation_links%rowtype;
  v_m        public.members%rowtype;
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_attempts integer;
  v_old      text;
begin
  select * into v_l from public.member_activation_links where token_hash = v_hash for update;
  if not found or v_l.used_at is not null or v_l.expires_at < now() then
    raise exception 'activation_link_invalid';
  end if;

  select * into v_m from public.members where id = v_l.member_id and deleted_at is null and status = 'active' for update;
  if not found then raise exception 'activation_link_invalid'; end if;

  -- حساب موجود (استعادة دخول أو منخرط مفعّل): لا تغيير للبريد عبر هذا المسار إطلاقًا
  if exists (select 1 from public.member_accounts where member_id = v_m.id) then
    raise exception 'activation_link_invalid';
  end if;

  -- الصيغة (مجموعة جزئية أضيق من members_email_format_chk، بلا تكرار نقاط ولا قيم تتجاوز 255)
  if char_length(v_email) > 150
     or char_length(split_part(v_email, '@', 1)) > 64
     or v_email ~ '\.\.'
     or v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_format');
  end if;

  -- حالة البريد مرتبطة بهذا الرمز بالذات (إعادة الإصدار تصفّرها)
  v_attempts := case when v_l.email_state_hash = v_l.token_hash then v_l.email_attempts else 0 end;
  if v_attempts >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'attempts_exceeded');
  end if;
  update public.member_activation_links
     set email_state_hash = token_hash,
         email_attempts   = v_attempts + 1,
         email_confirmed  = case when v_l.email_state_hash = v_l.token_hash then v_l.email_confirmed else false end
   where id = v_l.id;

  -- عدم الاستعمال مع حساب آخر: حساب Auth، ملف إداري، أو عضو آخر غير محذوف
  if exists (select 1 from auth.users u where lower(btrim(u.email)) = v_email)
     or exists (select 1 from public.profiles p where lower(btrim(p.email)) = v_email)
     or exists (select 1 from public.members o
                 where o.id <> v_m.id and o.deleted_at is null and lower(btrim(coalesce(o.email, ''))) = v_email) then
    return jsonb_build_object('ok', false, 'reason', 'email_taken');
  end if;

  v_old := lower(btrim(coalesce(v_m.email, '')));
  if v_old is distinct from v_email then
    update public.members set email = v_email where id = v_m.id;
  end if;

  update public.member_activation_links set email_confirmed = true where id = v_l.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (null, 'MEMBER_ACTIVATION_EMAIL_SET', 'members', v_m.id,
          'تأكيد البريد الإلكتروني للمنخرط أثناء التفعيل', jsonb_build_object('changed', v_old is distinct from v_email));

  return jsonb_build_object('ok', true, 'email', v_email, 'changed', v_old is distinct from v_email);
end;
$$;

-- 3) هل أكّد صاحب هذا الرمز بريده؟ (للتفعيل الجديد فقط؛ تفحصها Edge Function قبل createUser)
create or replace function public.member_activation_email_confirmed(p_token text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select l.email_confirmed and l.email_state_hash = l.token_hash and l.used_at is null and l.expires_at >= now()
      from public.member_activation_links l
     where l.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
  ), false);
$$;

revoke all on function public.set_member_activation_email(text, text)   from public, anon, authenticated;
revoke all on function public.member_activation_email_confirmed(text)   from public, anon, authenticated;
grant execute on function public.set_member_activation_email(text, text) to service_role;
grant execute on function public.member_activation_email_confirmed(text) to service_role;

notify pgrst, 'reload schema';

commit;
