-- ============================================================
-- 0030_directory_consent_and_latin_name.sql
-- 1) members.show_in_directory: لا يظهر العضو في صفحة الأعضاء العامة إلا بموافقته.
--    * الأعضاء الحاليون يبقون ظاهرين كما هم (القيمة true لهم عند إضافة العمود) — لا تغيير مفاجئ في الموقع.
--    * الأعضاء الجدد (من النموذج) افتراضيًا false حتى يوافقوا صراحةً.
--    * نشر الصورة: لا عمود مستقل؛ photo_url هو مصدر الحقيقة، ولا تُنسخ الصورة إلى الـ bucket العام
--      إلا عند موافقة العضو (تتم من واجهة الإدارة عند القبول، لأن SQL لا ينسخ ملفات التخزين).
-- 2) submit_membership_form: يقبل name_latin وconsent_directory وconsent_photo (اختيارية؛ غيابها = لا موافقة)،
--    فتعمل مع الواجهة القديمة أيضًا. full_name = العربي إن وُجد وإلا اللاتيني.
-- 3) record_annual_membership: ينقل الموافقة إلى members.show_in_directory ويحفظ translations.name_latin.
--
-- يتطلب: 0003 و0007 و0010 و0011 و0014 و0020.   آمن لإعادة التشغيل (idempotent) ولا يمسّ الأعضاء الموجودين عند الإعادة.
-- ⚠️ ترتيب النشر: (1) نفّذ هذا الملف في SQL Editor، (2) ثم انشر الواجهة الجديدة.
-- ============================================================

-- ---------- 1) العمود: true للموجودين ثم الافتراضي false للجدد (بلا UPDATE فلا تعمل triggers) ----------
alter table public.members add column if not exists show_in_directory boolean not null default true;
alter table public.members alter column show_in_directory set default false;

-- ---------- 2) القراءة العامة: الأعضاء الموافقون فقط ----------
drop policy if exists "members_public_read_active" on public.members;
create policy "members_public_read_active"
  on public.members for select
  to anon
  using (status = 'active' and deleted_at is null and show_in_directory = true);

-- العمود نفسه علم غير حساس؛ يُمنح لـ anon ليُقيَّم في السياسة دون أي التباس في الصلاحيات.
grant select (show_in_directory) on public.members to anon;

-- ---------- 3) دالة إرسال النموذج (استبدال كامل لنسخة 0020 مع الحقول الجديدة) ----------
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

  -- الصورة الشخصية وصورة البطاقة الوطنية: مسارات داخل مجلد هذا الرابط حصراً + وجود الملف فعلاً
  v_photo  := nullif(btrim(coalesce(p_data->>'photo_path', '')), '');
  v_idcard := nullif(btrim(coalesce(p_data->>'id_card_path', '')), '');
  if v_photo is null then
    raise exception 'يرجى رفع الصورة الشخصية';
  end if;
  if v_photo !~ ('^' || v_form.token_hash || '/photo-[1-3]\.(webp|jpg|png)$')
     or (v_idcard is not null and v_idcard !~ ('^' || v_form.token_hash || '/id-[1-3]\.(webp|jpg|png)$')) then
    raise exception 'مسار ملف غير صالح';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'membership-docs' and name = v_photo)
     or (v_idcard is not null
         and not exists (select 1 from storage.objects where bucket_id = 'membership-docs' and name = v_idcard)) then
    raise exception 'لم يكتمل رفع الملفات، أعد المحاولة';
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

-- ---------- 4) تسجيل الانخراط السنوي (استبدال كامل لنسخة 0014 مع الموافقة والاسم اللاتيني) ----------
create or replace function public.record_annual_membership(
  p_request_id uuid default null,
  p_member_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fee_text  text;
  v_amount    numeric(12,2);
  v_season    text;
  v_category  uuid;
  v_req       public.membership_requests%rowtype;
  v_form      public.membership_forms%rowtype;
  v_data      jsonb;
  v_member_id uuid;
  v_name      text;
  v_tx_id     uuid;
  v_items     jsonb := '[]'::jsonb;
  v_items_fr  jsonb := '[]'::jsonb;
  v_items_en  jsonb := '[]'::jsonb;
  v_socials   jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or not public.can_handle_membership() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  if (p_request_id is null) = (p_member_id is null) then
    raise exception 'حدّد طلباً أو عضواً (واحداً فقط)';
  end if;

  -- المبلغ والموسم من الإعدادات
  select value into v_fee_text from public.site_settings where key = 'membership_fee';
  begin
    v_amount := nullif(btrim(coalesce(v_fee_text, '')), '')::numeric(12,2);
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or v_amount <= 0 then
    raise exception 'لم يُضبط مبلغ الانخراط السنوي في الإعدادات';
  end if;

  select nullif(btrim(value), '') into v_season from public.site_settings where key = 'current_season';
  if v_season is null then
    raise exception 'لم يُضبط الموسم الجامعي الحالي في الإعدادات';
  end if;

  -- فئة الميزانية «انخراطات»
  select id into v_category from public.budget_categories where name = 'انخراطات' limit 1;
  if v_category is null then
    insert into public.budget_categories (name, kind) values ('انخراطات', 'income') returning id into v_category;
  end if;

  if p_request_id is not null then
    -- ===== طلب جديد =====
    select * into v_req from public.membership_requests where id = p_request_id for update;
    if not found then raise exception 'الطلب غير موجود'; end if;
    if v_req.status <> 'pending' then raise exception 'تمت معالجة هذا الطلب مسبقاً'; end if;

    select * into v_form from public.membership_forms where request_id = p_request_id for update;
    if not found or v_form.submitted_at is null then
      raise exception 'لم يُستلم نموذج الانخراط بعد';
    end if;
    v_data := v_form.data;

    if coalesce(v_data->>'skills', '') <> '' then
      v_items    := v_items    || jsonb_build_array(jsonb_build_object('label', 'المهارات',   'value', v_data->>'skills'));
      v_items_fr := v_items_fr || jsonb_build_array(jsonb_build_object('label', 'Compétences', 'value', v_data->>'skills'));
      v_items_en := v_items_en || jsonb_build_array(jsonb_build_object('label', 'Skills',      'value', v_data->>'skills'));
    end if;
    if coalesce(v_data->>'interests', '') <> '' then
      v_items    := v_items    || jsonb_build_array(jsonb_build_object('label', 'الاهتمامات',    'value', v_data->>'interests'));
      v_items_fr := v_items_fr || jsonb_build_array(jsonb_build_object('label', 'Centres d''intérêt', 'value', v_data->>'interests'));
      v_items_en := v_items_en || jsonb_build_array(jsonb_build_object('label', 'Interests',     'value', v_data->>'interests'));
    end if;
    if coalesce(v_data->>'level', '') <> '' then
      v_items    := v_items    || jsonb_build_array(jsonb_build_object('label', 'المستوى الدراسي', 'value', v_data->>'level'));
      v_items_fr := v_items_fr || jsonb_build_array(jsonb_build_object('label', 'Niveau d''études', 'value', v_data->>'level'));
      v_items_en := v_items_en || jsonb_build_array(jsonb_build_object('label', 'Study level',     'value', v_data->>'level'));
    end if;

    v_socials := jsonb_strip_nulls(jsonb_build_object(
      'github', nullif(v_data->>'github', ''),
      'linkedin', nullif(v_data->>'linkedin', '')
    ));

    insert into public.members (
      full_name, email, phone, promotion, track, university, profession, city,
      public_bio, socials, extra, status, show_in_directory
    ) values (
      coalesce(v_data->>'full_name', v_req.full_name),
      coalesce(v_data->>'email', v_req.email),
      coalesce(v_data->>'phone', v_req.phone),
      coalesce(v_data->>'promotion', v_req.promotion),
      coalesce(v_data->>'track', v_req.track),
      v_data->>'university',
      coalesce(v_data->>'profession', v_req.profession),
      coalesce(v_data->>'city', v_req.city),
      v_data->>'bio',
      v_socials,
      jsonb_build_object('items', v_items),
      'active',
      coalesce(v_data->>'consent_directory', '') = 'true'  -- لا يظهر في الصفحة العامة دون موافقة صريحة
    )
    returning id, full_name into v_member_id, v_name;

    -- ترجمات التسميات (FR/EN) إن كان عمود translations موجوداً (migration 0011)
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'members' and column_name = 'translations') then
      execute 'update public.members set translations = $1 where id = $2'
        using (
          jsonb_build_object(
            'fr', jsonb_build_object('extra', v_items_fr),
            'en', jsonb_build_object('extra', v_items_en)
          )
          -- الاسم بالحروف اللاتينية: يُعرض في الفرنسية والإنجليزية (انظر src/utils/personTranslations.js)
          || case when nullif(btrim(coalesce(v_data->>'name_latin', '')), '') is not null
                  then jsonb_build_object('name_latin', btrim(v_data->>'name_latin'))
                  else '{}'::jsonb end
        ), v_member_id;
    end if;

    insert into public.member_private (
      member_id, birth_date, level, skills, interests,
      emergency_name, emergency_phone, emergency_relation, rules_accepted_at, form_data
    ) values (
      v_member_id, (v_data->>'birth_date')::date, v_data->>'level', v_data->>'skills', v_data->>'interests',
      v_data->>'emergency_name', v_data->>'emergency_phone', v_data->>'emergency_relation', now(), v_data
    );

    update public.membership_requests
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_request_id;
  else
    -- ===== تجديد عضو موجود =====
    select id, full_name into v_member_id, v_name
    from public.members
    where id = p_member_id and deleted_at is null;
    if not found then raise exception 'العضو غير موجود'; end if;
  end if;

  -- منع التكرار في نفس الموسم (قبل إنشاء الإيراد)
  if exists (select 1 from public.member_memberships where member_id = v_member_id and season = v_season) then
    raise exception 'تم تسجيل انخراط هذا العضو في هذا الموسم مسبقاً';
  end if;

  insert into public.budget_transactions (tx_date, kind, amount, category_id, counterparty, description)
  values (current_date, 'income', v_amount, v_category, left(v_name, 120),
          left('انخراط سنوي — موسم ' || v_season, 300))
  returning id into v_tx_id;

  insert into public.member_memberships (member_id, season, amount, transaction_id)
  values (v_member_id, v_season, v_amount, v_tx_id);

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), 'ADMIN_RECORDED_MEMBERSHIP', 'members', v_member_id,
          'تسجيل انخراط سنوي',
          jsonb_build_object('season', v_season, 'amount', v_amount, 'transaction_id', v_tx_id, 'request_id', p_request_id));

  return jsonb_build_object('member_id', v_member_id, 'transaction_id', v_tx_id, 'season', v_season, 'amount', v_amount);
end;
$$;

notify pgrst, 'reload schema';
