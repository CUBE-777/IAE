-- ============================================================
-- 0034_membership_form_apogee_student_card.sql
-- تعديلات استمارة الانخراط المرسلة عبر الواتساب:
--   1) حقلان جديدان: apogee (رقم أبوجي / مسار، اختياري) وmotivation (لماذا تريد الانضمام).
--   2) بطاقة الطالب بدل البطاقة الوطنية: الوجه في id_card_path (id-1..3) والظهر في id_card_back_path (idb-1..3).
--   3) الصورة الشخصية أصبحت اختيارية (كانت إلزامية في 0020/0030).
--   4) «الدفعة» أصبحت «سنة التخرج»: تغيير في العنوان فقط، العمود promotion نفسه (انظر 0002).
-- الحقول الجديدة تُحفظ داخل membership_forms.data ثم member_private.form_data (دالة record_annual_membership لا تتغيّر).
-- يتطلب 0020 و0030.  آمن لإعادة التشغيل (create or replace).
-- ⚠️ ترتيب النشر: (1) نفّذ هذا الملف في SQL Editor، (2) ثم انشر الواجهة الجديدة.
--    الواجهة القديمة تبقى تعمل بعد تنفيذ هذا الملف (الصورة الاختيارية لا تكسرها).
-- ============================================================

do $$
begin
  if to_regclass('public.membership_forms') is null then
    raise exception 'شغّل 0014 و0020 و0030 أولاً';
  end if;
end $$;

-- ---------- 1) مسموح رفعه: يضاف الاسم idb-1..3 (ظهر بطاقة الطالب) ----------
create or replace function public.membership_upload_allowed(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p_name ~ '^[0-9a-f]{64}/(photo|id|idb)-[1-3]\.(webp|jpg|png)$'
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

-- ---------- 2) اطلاع الإدارة على الوثائق: يشمل ظهر البطاقة ----------
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
  where f.data->>'photo_path' = p_path
     or f.data->>'id_card_path' = p_path
     or f.data->>'id_card_back_path' = p_path
  limit 1;

  if v_req is null then
    raise exception 'الملف غير موجود';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_VIEWED_MEMBERSHIP_DOC', 'membership_requests', v_req,
          'اطلاع على وثيقة انخراط (صورة شخصية / بطاقة الطالب)');

  return p_path;
end;
$$;

revoke execute on function public.request_membership_document(text) from public, anon;
grant  execute on function public.request_membership_document(text) to authenticated;

-- ---------- 3) دالة إرسال النموذج (استبدال كامل لنسخة 0030) ----------
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
  v_idback text;
  v_apogee text;
  v_name_ar text;
  v_name_latin text;
  v_consent_dir boolean;
  v_consent_photo boolean;
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

  -- الصورة الشخصية وبطاقة الطالب (الوجه + الظهر): كلها اختيارية.
  -- أي مسار مُرسل يجب أن يكون داخل مجلد هذا الرابط حصراً + الملف موجود فعلاً.
  v_photo  := nullif(btrim(coalesce(p_data->>'photo_path', '')), '');
  v_idcard := nullif(btrim(coalesce(p_data->>'id_card_path', '')), '');
  v_idback := nullif(btrim(coalesce(p_data->>'id_card_back_path', '')), '');
  if (v_photo  is not null and v_photo  !~ ('^' || v_form.token_hash || '/photo-[1-3]\.(webp|jpg|png)$'))
     or (v_idcard is not null and v_idcard !~ ('^' || v_form.token_hash || '/id-[1-3]\.(webp|jpg|png)$'))
     or (v_idback is not null and v_idback !~ ('^' || v_form.token_hash || '/idb-[1-3]\.(webp|jpg|png)$')) then
    raise exception 'مسار ملف غير صالح';
  end if;
  if (v_photo  is not null and not exists (select 1 from storage.objects where bucket_id = 'membership-docs' and name = v_photo))
     or (v_idcard is not null and not exists (select 1 from storage.objects where bucket_id = 'membership-docs' and name = v_idcard))
     or (v_idback is not null and not exists (select 1 from storage.objects where bucket_id = 'membership-docs' and name = v_idback)) then
    raise exception 'لم يكتمل رفع الملفات، أعد المحاولة';
  end if;

  -- رقم أبوجي / مسار (اختياري): حروف وأرقام فقط، بلا مسافات
  v_apogee := nullif(upper(regexp_replace(coalesce(p_data->>'apogee', ''), '\s+', '', 'g')), '');
  if v_apogee is not null and v_apogee !~ '^[A-Z0-9]{4,30}$' then
    raise exception 'رقم أبوجي / مسار غير صالح';
  end if;

  -- الاسم: بالعربية و/أو بالحروف اللاتينية (واحد منهما على الأقل). full_name الأساسي = العربي إن وُجد وإلا اللاتيني.
  v_name_ar    := nullif(left(btrim(coalesce(p_data->>'full_name', '')), 120), '');
  v_name_latin := nullif(left(btrim(coalesce(p_data->>'name_latin', '')), 120), '');

  -- الموافقتان اختياريتان ولا تُفترضان: نشر الاسم/المعلومات في صفحة الأعضاء، ونشر الصورة (لا نشر للصورة دون الأولى)
  v_consent_dir   := coalesce(p_data->>'consent_directory', '') = 'true';
  v_consent_photo := v_consent_dir and coalesce(p_data->>'consent_photo', '') = 'true';

  v_clean := jsonb_strip_nulls(jsonb_build_object(
    'full_name',          coalesce(v_name_ar, v_name_latin),
    'name_latin',         v_name_latin,
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
    'id_card_back_path',  v_idback,
    'apogee',             v_apogee,
    'motivation',         nullif(left(btrim(coalesce(p_data->>'motivation', '')), 1000), ''),
    'consent_directory',  v_consent_dir,
    'consent_photo',      v_consent_photo,
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
