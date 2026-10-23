-- ============================================================
-- 0020_membership_documents.sql
-- نموذج الانخراط: رفع صورة شخصية وصورة البطاقة الوطنية + حذف قسم الطوارئ.
--
--  * bucket خاص membership-docs (لا قراءة عامة إطلاقاً).
--  * الزائر (anon) يرفع فقط إلى مجلد اسمه sha256(رمز الرابط)، وما دام الرابط صالحاً وغير مستعمل،
--    وبأسماء ثابتة محدودة (photo-1..3 / id-1..3) فلا يمكن إغراق التخزين.
--  * الاطّلاع على الوثائق لمسؤولي الأعضاء فقط، عبر دالة تسجّل كل اطلاع في سجل العمليات.
--  * submit_membership_form تُستبدل: لا حقول طوارئ، وملفا الصورة/البطاقة إلزاميان.
-- آمن لإعادة التشغيل. يتطلب 0014 (membership_forms) و0019 (الدوال).
-- ============================================================

do $$
begin
  if to_regclass('public.membership_forms') is null then
    raise exception 'شغّل 0014_membership_flow.sql أولاً';
  end if;
end $$;

-- ---------- bucket خاص ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('membership-docs', 'membership-docs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------- من يستطيع الرفع؟ (يُستدعى من سياسة التخزين) ----------
create or replace function public.membership_upload_allowed(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p_name ~ '^[0-9a-f]{64}/(photo|id)-[1-3]\.(webp|jpg|png)$'
     and exists (
       select 1
       from public.membership_forms f
       join public.membership_requests r on r.id = f.request_id
       where f.token_hash = split_part(p_name, '/', 1)
         and f.submitted_at is null
         and f.expires_at > now()
         and r.status = 'pending'
     );
$$;

revoke execute on function public.membership_upload_allowed(text) from public;
grant  execute on function public.membership_upload_allowed(text) to anon, authenticated;

-- ---------- سياسات التخزين ----------
drop policy if exists "membership_docs_anon_insert" on storage.objects;
-- anon + authenticated: مسؤول مسجّل الدخول في المتصفح نفسه يجرّب الرابط سيُرسل طلباته بدور authenticated
create policy "membership_docs_anon_insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'membership-docs' and public.membership_upload_allowed(name));

-- لا سياسة UPDATE/DELETE: الملف المرفوع لا يُعدَّل من العميل.
drop policy if exists "membership_docs_manager_select" on storage.objects;
create policy "membership_docs_manager_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'membership-docs' and public.can_manage_members());

-- ---------- اطلاع مسجَّل على وثيقة ----------
create or replace function public.request_membership_document(p_path text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req uuid;
begin
  if auth.uid() is null or not public.can_manage_members() then
    raise exception 'غير مصرح لك بهذه العملية';
  end if;

  select f.request_id into v_req
  from public.membership_forms f
  where f.data->>'photo_path' = p_path or f.data->>'id_card_path' = p_path
  limit 1;

  if v_req is null then
    raise exception 'الملف غير موجود';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_VIEWED_MEMBERSHIP_DOC', 'membership_requests', v_req,
          'اطلاع على وثيقة انخراط (صورة شخصية / بطاقة وطنية)');

  return p_path;
end;
$$;

revoke execute on function public.request_membership_document(text) from public, anon;
grant  execute on function public.request_membership_document(text) to authenticated;

-- ---------- استبدال دالة إرسال النموذج (بدون طوارئ + مع الملفات) ----------
create or replace function public.submit_membership_form(p_token text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_form  public.membership_forms%rowtype;
  v_req   public.membership_requests%rowtype;
  v_clean jsonb;
  v_birth date;
  v_github text;
  v_linkedin text;
  v_photo text;
  v_idcard text;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'بيانات غير صالحة';
  end if;

  select * into v_form
  from public.membership_forms
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
  for update;

  if not found then raise exception 'الرابط غير صالح'; end if;
  if v_form.submitted_at is not null then raise exception 'تم إرسال هذا النموذج مسبقاً'; end if;
  if v_form.expires_at < now() then raise exception 'انتهت صلاحية الرابط'; end if;

  select * into v_req from public.membership_requests where id = v_form.request_id for update;
  if v_req.status <> 'pending' then raise exception 'هذا الطلب مغلق'; end if;

  -- الموافقة على النظام الداخلي إلزامية
  if coalesce(p_data->>'rules_accepted', '') <> 'true' then
    raise exception 'يجب الموافقة على النظام الداخلي';
  end if;

  -- تاريخ الميلاد
  begin
    v_birth := (p_data->>'birth_date')::date;
  exception when others then
    raise exception 'تاريخ الميلاد غير صالح';
  end;
  if v_birth is null or v_birth < date '1940-01-01' or v_birth > (current_date - interval '10 years')::date then
    raise exception 'تاريخ الميلاد غير صالح';
  end if;

  -- روابط اختيارية: يجب أن تبدأ بـ http(s)
  v_github := nullif(left(btrim(coalesce(p_data->>'github', '')), 200), '');
  v_linkedin := nullif(left(btrim(coalesce(p_data->>'linkedin', '')), 200), '');
  if v_github is not null and v_github !~* '^https?://' then v_github := 'https://' || v_github; end if;
  if v_linkedin is not null and v_linkedin !~* '^https?://' then v_linkedin := 'https://' || v_linkedin; end if;

  -- الصورة الشخصية وصورة البطاقة الوطنية: مسارات داخل مجلد هذا الرابط حصراً + وجود الملف فعلاً
  v_photo  := nullif(btrim(coalesce(p_data->>'photo_path', '')), '');
  v_idcard := nullif(btrim(coalesce(p_data->>'id_card_path', '')), '');
  if v_photo is null or v_idcard is null then
    raise exception 'يرجى رفع الصورة الشخصية وصورة البطاقة الوطنية';
  end if;
  if v_photo !~ ('^' || v_form.token_hash || '/photo-[1-3]\.(webp|jpg|png)$')
     or v_idcard !~ ('^' || v_form.token_hash || '/id-[1-3]\.(webp|jpg|png)$') then
    raise exception 'مسار ملف غير صالح';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'membership-docs' and name = v_photo)
     or not exists (select 1 from storage.objects where bucket_id = 'membership-docs' and name = v_idcard) then
    raise exception 'لم يكتمل رفع الملفات، أعد المحاولة';
  end if;

  v_clean := jsonb_strip_nulls(jsonb_build_object(
    'full_name',          nullif(left(btrim(coalesce(p_data->>'full_name', '')), 120), ''),
    'birth_date',         to_char(v_birth, 'YYYY-MM-DD'),
    'phone',              nullif(left(btrim(coalesce(p_data->>'phone', '')), 30), ''),
    'email',              nullif(left(btrim(coalesce(p_data->>'email', '')), 150), ''),
    'city',               nullif(left(btrim(coalesce(p_data->>'city', '')), 80), ''),
    'university',         nullif(left(btrim(coalesce(p_data->>'university', '')), 150), ''),
    'track',              nullif(left(btrim(coalesce(p_data->>'track', '')), 150), ''),
    'level',              nullif(left(btrim(coalesce(p_data->>'level', '')), 80), ''),
    'promotion',          nullif(left(btrim(coalesce(p_data->>'promotion', '')), 40), ''),
    'profession',         nullif(left(btrim(coalesce(p_data->>'profession', '')), 120), ''),
    'skills',             nullif(left(btrim(coalesce(p_data->>'skills', '')), 600), ''),
    'interests',          nullif(left(btrim(coalesce(p_data->>'interests', '')), 600), ''),
    'github',             v_github,
    'linkedin',           v_linkedin,
    'bio',                nullif(left(btrim(coalesce(p_data->>'bio', '')), 600), ''),
    'photo_path',         v_photo,
    'id_card_path',       v_idcard,
    'rules_accepted',     true
  ));

  -- الحقول الإلزامية
  if (v_clean->>'full_name') is null or char_length(v_clean->>'full_name') < 2
     or (v_clean->>'phone') is null or char_length(v_clean->>'phone') < 6
     or (v_clean->>'city') is null
     or (v_clean->>'university') is null
     or (v_clean->>'track') is null
     or (v_clean->>'level') is null then
    raise exception 'يرجى ملء جميع الحقول الإلزامية';
  end if;

  update public.membership_forms
     set data = v_clean, submitted_at = now()
   where id = v_form.id;

  update public.membership_requests
     set form_status = 'received'
   where id = v_form.request_id;

  return jsonb_build_object('state', 'ok');
end;
$$;

notify pgrst, 'reload schema';
