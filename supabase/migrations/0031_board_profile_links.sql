-- ============================================================
-- 0031_board_profile_links.sql — أعضاء المكتب يملؤون ملفاتهم العامة بأنفسهم عبر رابط شخصي
--
-- الفكرة: المسؤول يُصدر لكل عضو مكتب رابطًا خاصًا (رمز عشوائي يُخزَّن مُجزَّأً فقط، صالح 14 يومًا).
-- العضو يفتح /board-profile/:token بلا حساب ويملأ ملفه. ما يرسله لا يُنشر: يُحفظ كمقترح (status = 'submitted')
-- إلى أن يعتمده مسؤول المحتوى (approve_board_profile) فيُنسخ إلى board_members، أو يعيده للعضو مع ملاحظة.
--
-- إضافة فقط: جدول جديد + دوال جديدة + سياستا تخزين جديدتان. لا يُعدَّل board_members ولا أي سياسة موجودة،
-- ولا يتغير شيء في الموقع العام. نفس نمط 0014 (رمز مجزّأ) و0020 (رفع الصور إلى المجلد الخاص membership-docs).
--
-- يتطلب: 0003 و0011 و0013 و0019 و0020.   آمن لإعادة التشغيل (idempotent).
-- ⚠️ ترتيب النشر: (1) نفّذ هذا الملف في SQL Editor، (2) ثم انشر الواجهة الجديدة.
--    (الواجهة الجديدة تتعطل بهدوء — تُخفي الأزرار فقط — إن نُشرت قبل هذا الملف.)
-- ============================================================

do $$
begin
  if to_regclass('public.board_members') is null then
    raise exception 'شغّل 0002_tables.sql أولاً';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'board_members' and column_name = 'translations') then
    raise exception 'شغّل 0011_board_profile_and_translations.sql أولاً';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'board_members' and column_name = 'promotion') then
    raise exception 'شغّل 0013_board_promotion_track.sql أولاً';
  end if;
  if to_regprocedure('public.can_manage_content()') is null then
    raise exception 'شغّل 0019_new_roles_and_file_delete_fix.sql أولاً';
  end if;
  if not exists (select 1 from storage.buckets where id = 'membership-docs') then
    raise exception 'شغّل 0020_membership_documents.sql أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) الجدول (خاص: لا وصول عام، الكتابة عبر الدوال فقط)
-- ---------------------------------------------------------------------
create table if not exists public.board_profile_links (
  id              uuid primary key default gen_random_uuid(),
  board_member_id uuid not null unique references public.board_members(id) on delete cascade,
  token_hash      text not null unique,                    -- sha256 للرمز؛ الرمز نفسه لا يُخزَّن أبدًا
  expires_at      timestamptz not null,
  status          text not null default 'sent' check (status in ('sent', 'submitted', 'approved')),
  data            jsonb not null default '{}'::jsonb,      -- المقترح بعد التنظيف، بنفس شكل أعمدة board_members
  photo_path      text,                                    -- مسار الصورة المرفوعة في membership-docs (خاص)
  review_note     text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  reviewed_by     uuid references public.profiles(id) on delete set null,
  reviewed_at     timestamptz,
  constraint board_profile_links_data_chk check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 30000),
  constraint board_profile_links_note_chk check (review_note is null or char_length(review_note) <= 500)
);

alter table public.board_profile_links enable row level security;

drop policy if exists "board_profile_links_content_read" on public.board_profile_links;
create policy "board_profile_links_content_read"
  on public.board_profile_links for select
  to authenticated
  using (public.can_manage_content());

revoke all on public.board_profile_links from public, anon, authenticated;
grant select on public.board_profile_links to authenticated;

-- ---------------------------------------------------------------------
-- 2) دوال داخلية للتنظيف (لا تُنفَّذ من العميل مباشرة)
-- ---------------------------------------------------------------------
create or replace function public._bp_text(p jsonb, p_max integer)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text;
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) <> 'string' then raise exception 'بيانات غير صالحة'; end if;
  v := btrim(p #>> '{}');
  v := regexp_replace(v, '[\x01-\x08\x0B\x0C\x0E-\x1F]', '', 'g');   -- أحرف تحكم (نُبقي السطر الجديد والمسافة)
  return nullif(left(v, p_max), '');
end;
$$;

-- يقبل نص الملف العام كما يرسله العميل ويُرجع نسخة منظَّفة بقائمة بيضاء من المفاتيح والأطوال
-- (أطوالها مطابقة لقيود board_members في 0011/0013 حتى لا يفشل الاعتماد لاحقًا).
create or replace function public._bp_clean(p_data jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_out     jsonb := '{}'::jsonb;
  v_socials jsonb := '{}'::jsonb;
  v_items   jsonb := '[]'::jsonb;
  v_extra   jsonb;
  v_tr      jsonb := '{}'::jsonb;
  v_src     jsonb;
  v_lang    text;
  v_lobj    jsonb;
  v_arr     jsonb;
  v_n       integer;
  v_i       integer;
  v_key     text;
  v_val     jsonb;
  v_url     text;
  v_label   text;
  v_value   text;
  v_f       text;
  v_t       text;
  v_name    text;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'بيانات غير صالحة';
  end if;

  -- حقول نصية بسيطة
  v_out := jsonb_strip_nulls(jsonb_build_object(
    'university',  public._bp_text(p_data -> 'university', 200),
    'promotion',   public._bp_text(p_data -> 'promotion', 60),
    'track',       public._bp_text(p_data -> 'track', 200),
    'bio',         public._bp_text(p_data -> 'bio', 400),
    'public_bio',  public._bp_text(p_data -> 'public_bio', 600),
    'study_path',  public._bp_text(p_data -> 'study_path', 800)
  ));

  -- روابط التواصل: منصات معروفة فقط، http/https فقط
  v_src := coalesce(p_data -> 'socials', '{}'::jsonb);
  if jsonb_typeof(v_src) <> 'object' then raise exception 'بيانات غير صالحة'; end if;
  for v_key, v_val in select * from jsonb_each(v_src) loop
    if v_key <> all (array['instagram','facebook','linkedin','tiktok','youtube','x','github','website']) then
      continue;
    end if;
    v_url := public._bp_text(v_val, 300);
    if v_url is null then continue; end if;
    if v_url !~* '^https?://[^[:space:]<>"'']{4,290}$' then
      raise exception 'رابط غير صالح';
    end if;
    v_socials := v_socials || jsonb_build_object(v_key, v_url);
  end loop;
  v_out := v_out || jsonb_build_object('socials', v_socials);

  -- معلومات إضافية (عنوان + قيمة)، 8 كحد أقصى
  v_src := coalesce(p_data #> '{extra,items}', '[]'::jsonb);
  if jsonb_typeof(v_src) <> 'array' then raise exception 'بيانات غير صالحة'; end if;
  for v_i in 0 .. least(jsonb_array_length(v_src), 8) - 1 loop
    if jsonb_typeof(v_src -> v_i) <> 'object' then continue; end if;
    v_label := public._bp_text(v_src -> v_i -> 'label', 40);
    v_value := public._bp_text(v_src -> v_i -> 'value', 200);
    if v_label is not null and v_value is not null then
      v_items := v_items || jsonb_build_array(jsonb_build_object('label', v_label, 'value', v_value));
    end if;
  end loop;
  v_n := jsonb_array_length(v_items);
  v_extra := case when v_n > 0 then jsonb_build_object('items', v_items) else '{}'::jsonb end;
  v_out := v_out || jsonb_build_object('extra', v_extra);

  -- الترجمات: name_latin + (fr, en) لحقول محددة فقط
  v_src := coalesce(p_data -> 'translations', '{}'::jsonb);
  if jsonb_typeof(v_src) <> 'object' then raise exception 'بيانات غير صالحة'; end if;
  v_name := public._bp_text(v_src -> 'name_latin', 120);
  if v_name is not null then v_tr := v_tr || jsonb_build_object('name_latin', v_name); end if;

  foreach v_lang in array array['fr', 'en'] loop
    v_lobj := '{}'::jsonb;
    if jsonb_typeof(v_src -> v_lang) = 'object' then
      v_lobj := jsonb_strip_nulls(jsonb_build_object(
        'track',      public._bp_text(v_src -> v_lang -> 'track', 200),
        'bio',        public._bp_text(v_src -> v_lang -> 'bio', 400),
        'public_bio', public._bp_text(v_src -> v_lang -> 'public_bio', 600),
        'study_path', public._bp_text(v_src -> v_lang -> 'study_path', 800)
      ));
      -- ترجمة المعلومات الإضافية: بنفس ترتيب العناصر العربية المحفوظة
      v_arr := v_src -> v_lang -> 'extra';
      if v_n > 0 and jsonb_typeof(v_arr) = 'array' then
        declare
          v_ex jsonb := '[]'::jsonb;
          v_any boolean := false;
        begin
          for v_i in 0 .. v_n - 1 loop
            v_f := coalesce(public._bp_text(v_arr -> v_i -> 'label', 40), '');
            v_t := coalesce(public._bp_text(v_arr -> v_i -> 'value', 200), '');
            if v_f <> '' or v_t <> '' then v_any := true; end if;
            v_ex := v_ex || jsonb_build_array(jsonb_build_object('label', v_f, 'value', v_t));
          end loop;
          if v_any then v_lobj := v_lobj || jsonb_build_object('extra', v_ex); end if;
        end;
      end if;
    end if;
    if v_lobj <> '{}'::jsonb then v_tr := v_tr || jsonb_build_object(v_lang, v_lobj); end if;
  end loop;
  v_out := v_out || jsonb_build_object('translations', v_tr);

  return v_out;
end;
$$;

revoke execute on function public._bp_text(jsonb, integer) from public, anon, authenticated;
revoke execute on function public._bp_clean(jsonb)         from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) إصدار الرابط (للمسؤول): يُبطل أي رابط سابق لنفس العضو
-- ---------------------------------------------------------------------
create or replace function public.issue_board_profile_link(p_board_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link    public.board_profile_links%rowtype;
  v_token   text;
  v_hash    text;
  v_expires timestamptz := now() + interval '14 days';
  v_name    text;
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  select full_name into v_name from public.board_members where id = p_board_member_id;
  if not found then raise exception 'عضو المكتب غير موجود'; end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_hash  := encode(sha256(convert_to(v_token, 'utf8')), 'hex');

  select * into v_link from public.board_profile_links where board_member_id = p_board_member_id for update;
  if not found then
    insert into public.board_profile_links (board_member_id, token_hash, expires_at, created_by)
    values (p_board_member_id, v_hash, v_expires, auth.uid());
  else
    if v_link.status = 'submitted' then
      raise exception 'يوجد ملف قيد المراجعة لهذا العضو؛ اعتمده أو أعده للتعديل أولاً';
    end if;
    if v_link.status = 'approved' then
      -- جولة جديدة: نبدأ من الصفر
      update public.board_profile_links
         set token_hash = v_hash, expires_at = v_expires, created_by = auth.uid(), created_at = now(),
             status = 'sent', data = '{}'::jsonb, photo_path = null, review_note = null,
             submitted_at = null, reviewed_by = null, reviewed_at = null
       where id = v_link.id;
    else
      update public.board_profile_links
         set token_hash = v_hash, expires_at = v_expires, created_by = auth.uid(), created_at = now()
       where id = v_link.id;
    end if;
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), 'ADMIN_ISSUED_BOARD_PROFILE_LINK', 'board_members', p_board_member_id,
          'إصدار رابط تعبئة الملف الشخصي لعضو المكتب ' || v_name, jsonb_build_object('expires_at', v_expires));

  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end;
$$;

-- ---------------------------------------------------------------------
-- 4) قراءة حالة الرابط (للزائر حامل الرمز): يعيد الاسم والصفة وبيانات الملف الحالية أو المسودة
-- ---------------------------------------------------------------------
create or replace function public.get_board_profile_link(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_link public.board_profile_links%rowtype;
  v_b    public.board_members%rowtype;
begin
  select * into v_link
  from public.board_profile_links
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');

  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;
  if v_link.status = 'approved' then
    return jsonb_build_object('state', 'approved');
  end if;
  if v_link.expires_at < now() then
    return jsonb_build_object('state', 'expired');
  end if;

  select * into v_b from public.board_members where id = v_link.board_member_id;
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  return jsonb_build_object(
    'state', 'ok',
    'status', v_link.status,
    'expires_at', v_link.expires_at,
    'review_note', v_link.review_note,
    'has_draft_photo', v_link.photo_path is not null,
    'member', jsonb_build_object('full_name', v_b.full_name, 'position', v_b.position),
    'current', jsonb_build_object(
      'university',  v_b.university,
      'promotion',   v_b.promotion,
      'track',       v_b.track,
      'bio',         v_b.bio,
      'public_bio',  v_b.public_bio,
      'study_path',  v_b.study_path,
      'socials',     coalesce(v_b.socials, '{}'::jsonb),
      'extra',       coalesce(v_b.extra, '{}'::jsonb),
      'translations', coalesce(v_b.translations, '{}'::jsonb),
      'has_photo',   v_b.photo_url is not null
    ),
    'draft', case when v_link.data <> '{}'::jsonb then v_link.data else null end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 5) إرسال الملف (للزائر حامل الرمز): تحقق + تنظيف + حفظ كمقترح (يمكن إعادة الإرسال قبل الاعتماد)
-- ---------------------------------------------------------------------
create or replace function public.submit_board_profile(p_token text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash  text := encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  v_link  public.board_profile_links%rowtype;
  v_clean jsonb;
  v_photo text;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'بيانات غير صالحة';
  end if;

  select * into v_link from public.board_profile_links where token_hash = v_hash for update;
  if not found then raise exception 'الرابط غير صالح'; end if;
  if v_link.status = 'approved' then raise exception 'تم اعتماد هذا الملف مسبقاً'; end if;
  if v_link.expires_at < now() then raise exception 'انتهت صلاحية الرابط'; end if;

  v_clean := public._bp_clean(p_data);

  v_photo := nullif(btrim(coalesce(p_data ->> 'photo_path', '')), '');
  if v_photo is not null then
    if v_photo !~ ('^' || v_hash || '/board-photo-[1-6]\.(webp|jpg|png)$')
       or not exists (select 1 from storage.objects where bucket_id = 'membership-docs' and name = v_photo) then
      raise exception 'الصورة غير صالحة';
    end if;
  else
    v_photo := v_link.photo_path;   -- لا صورة جديدة: نُبقي ما رُفع سابقًا
  end if;

  update public.board_profile_links
     set data = v_clean, photo_path = v_photo, status = 'submitted',
         submitted_at = now(), review_note = null
   where id = v_link.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 6) المراجعة (للمسؤول): اعتماد ينسخ إلى board_members، أو إعادة للعضو مع ملاحظة
-- ---------------------------------------------------------------------
create or replace function public.approve_board_profile(p_link_id uuid, p_photo_url text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.board_profile_links%rowtype;
  v_b    public.board_members%rowtype;
  v_d    jsonb;
  v_tr   jsonb;
  v_new  jsonb;
  v_lang text;
  v_lobj jsonb;
  v_extra jsonb;
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  select * into v_link from public.board_profile_links where id = p_link_id for update;
  if not found then raise exception 'الرابط غير موجود'; end if;
  if v_link.status <> 'submitted' then raise exception 'لا يوجد ملف قيد المراجعة'; end if;

  select * into v_b from public.board_members where id = v_link.board_member_id for update;
  if not found then raise exception 'عضو المكتب غير موجود'; end if;

  if p_photo_url is not null and p_photo_url !~ '^https://[^[:space:]]{8,500}$' then
    raise exception 'رابط الصورة غير صالح';
  end if;

  v_d := v_link.data;

  -- الترجمات: نستبدل الحقول التي يملؤها العضو فقط ونُبقي ما وضعه المسؤول (مثل ترجمة الصفة)
  v_tr  := coalesce(v_b.translations, '{}'::jsonb) - 'name_latin';
  v_new := coalesce(v_d -> 'translations', '{}'::jsonb);
  if v_new ? 'name_latin' then
    v_tr := v_tr || jsonb_build_object('name_latin', v_new -> 'name_latin');
  end if;
  foreach v_lang in array array['fr', 'en'] loop
    v_lobj := (coalesce(v_tr -> v_lang, '{}'::jsonb) - 'track' - 'bio' - 'public_bio' - 'study_path' - 'extra')
              || coalesce(v_new -> v_lang, '{}'::jsonb);
    if v_lobj = '{}'::jsonb then
      v_tr := v_tr - v_lang;
    else
      v_tr := v_tr || jsonb_build_object(v_lang, v_lobj);
    end if;
  end loop;

  -- extra: نُبقي أي مفاتيح أخرى غير items
  v_extra := coalesce(v_b.extra, '{}'::jsonb) - 'items';
  if jsonb_typeof(v_d #> '{extra,items}') = 'array' and jsonb_array_length(v_d #> '{extra,items}') > 0 then
    v_extra := v_extra || jsonb_build_object('items', v_d #> '{extra,items}');
  end if;

  update public.board_members
     set university = v_d ->> 'university',
         promotion  = v_d ->> 'promotion',
         track      = v_d ->> 'track',
         bio        = v_d ->> 'bio',
         public_bio = v_d ->> 'public_bio',
         study_path = v_d ->> 'study_path',
         socials    = coalesce(v_d -> 'socials', '{}'::jsonb),
         extra      = v_extra,
         translations = v_tr,
         photo_url  = coalesce(p_photo_url, photo_url)
   where id = v_b.id;

  update public.board_profile_links
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = null
   where id = v_link.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_APPROVED_BOARD_PROFILE', 'board_members', v_b.id,
          'اعتماد الملف الشخصي الذي أرسله عضو المكتب ' || v_b.full_name);
end;
$$;

create or replace function public.return_board_profile(p_link_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.board_profile_links%rowtype;
  v_name text;
begin
  if auth.uid() is null or not public.can_manage_content() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  select * into v_link from public.board_profile_links where id = p_link_id for update;
  if not found then raise exception 'الرابط غير موجود'; end if;
  if v_link.status <> 'submitted' then raise exception 'لا يوجد ملف قيد المراجعة'; end if;

  update public.board_profile_links
     set status = 'sent',
         review_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
         expires_at = greatest(expires_at, now() + interval '7 days'),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = v_link.id;

  select full_name into v_name from public.board_members where id = v_link.board_member_id;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_RETURNED_BOARD_PROFILE', 'board_members', v_link.board_member_id,
          'إعادة الملف الشخصي لعضو المكتب ' || coalesce(v_name, '') || ' للتعديل');
end;
$$;

-- ---------------------------------------------------------------------
-- 7) الصلاحيات: الزائر ينفّذ دالتي القراءة والإرسال فقط (والرمز هو المفتاح)، والبقية للمسجَّلين
-- ---------------------------------------------------------------------
revoke execute on function public.issue_board_profile_link(uuid)        from public, anon;
revoke execute on function public.approve_board_profile(uuid, text)     from public, anon;
revoke execute on function public.return_board_profile(uuid, text)      from public, anon;
revoke execute on function public.get_board_profile_link(text)          from public;
revoke execute on function public.submit_board_profile(text, jsonb)     from public;

grant execute on function public.issue_board_profile_link(uuid)         to authenticated;
grant execute on function public.approve_board_profile(uuid, text)      to authenticated;
grant execute on function public.return_board_profile(uuid, text)       to authenticated;
grant execute on function public.get_board_profile_link(text)           to anon, authenticated;
grant execute on function public.submit_board_profile(text, jsonb)      to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8) التخزين: رفع صورة العضو إلى المجلد الخاص membership-docs بمسار مرتبط برمزه فقط
--    (سياسات إضافية؛ لا تمسّ سياسات 0020 لأن الاسم board-photo-N لا يطابق نمطها)
-- ---------------------------------------------------------------------
create or replace function public.board_photo_upload_allowed(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p_name ~ '^[0-9a-f]{64}/board-photo-[1-6]\.(webp|jpg|png)$'
     and exists (
       select 1
       from public.board_profile_links l
       where l.token_hash = split_part(p_name, '/', 1)
         and l.status <> 'approved'
         and l.expires_at > now()
     );
$$;

revoke execute on function public.board_photo_upload_allowed(text) from public;
grant  execute on function public.board_photo_upload_allowed(text) to anon, authenticated;

drop policy if exists "board_photo_anon_insert" on storage.objects;
create policy "board_photo_anon_insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'membership-docs' and public.board_photo_upload_allowed(name));

drop policy if exists "board_photo_content_select" on storage.objects;
create policy "board_photo_content_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'membership-docs'
         and name ~ '^[0-9a-f]{64}/board-photo-[1-6]\.(webp|jpg|png)$'
         and public.can_manage_content());

notify pgrst, 'reload schema';
