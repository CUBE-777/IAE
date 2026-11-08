-- 0043: إصلاح "invalid regular expression: invalid repetition count(s)"
-- PostgreSQL يحدّ التكرار في التعبيرات النمطية بـ 255؛ كانت الدوال تستعمل {8,500} و{4,290}
-- فتفشل عند اعتماد طلبات تعديل البطاقة / ملفات المكتب. نستبدلها بـ {n,} مع فحص length() منفصل.
begin;

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
    if (v_url !~* '^https?://[^[:space:]<>"'']{4,}$' or length(v_url) > 300) then
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

  if p_photo_url is not null and (p_photo_url !~ '^https://[^[:space:]]{8,}$' or length(p_photo_url) > 508) then
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

create or replace function public.approve_member_card_request(p_request_id uuid, p_photo_url text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r     public.member_card_requests%rowtype;
  v_m     public.members%rowtype;
  v_d     jsonb;
  v_tr    jsonb;
  v_new   jsonb;
  v_lang  text;
  v_lobj  jsonb;
  v_extra jsonb;
begin
  if auth.uid() is null or not public.can_manage_member_system() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  select * into v_r from public.member_card_requests where id = p_request_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if v_r.status <> 'pending' then raise exception 'لا يوجد طلب قيد المراجعة'; end if;

  select * into v_m from public.members where id = v_r.member_id and deleted_at is null for update;
  if not found then raise exception 'العضو غير موجود'; end if;

  if p_photo_url is not null and (p_photo_url !~ '^https://[^[:space:]]{8,}$' or length(p_photo_url) > 508) then
    raise exception 'رابط الصورة غير صالح';
  end if;

  v_d := v_r.data;

  v_tr  := coalesce(v_m.translations, '{}'::jsonb) - 'name_latin';
  v_new := coalesce(v_d -> 'translations', '{}'::jsonb);
  if v_new ? 'name_latin' then
    v_tr := v_tr || jsonb_build_object('name_latin', v_new -> 'name_latin');
  elsif coalesce(v_m.translations, '{}'::jsonb) ? 'name_latin' then
    v_tr := v_tr || jsonb_build_object('name_latin', v_m.translations -> 'name_latin');  -- لا نمحو ما وضعته الإدارة
  end if;
  foreach v_lang in array array['fr', 'en'] loop
    v_lobj := (coalesce(v_tr -> v_lang, '{}'::jsonb) - 'track' - 'public_bio' - 'study_path' - 'extra')
              || coalesce(v_new -> v_lang, '{}'::jsonb);
    if v_lobj = '{}'::jsonb then v_tr := v_tr - v_lang;
    else v_tr := v_tr || jsonb_build_object(v_lang, v_lobj);
    end if;
  end loop;

  v_extra := coalesce(v_m.extra, '{}'::jsonb) - 'items';
  if jsonb_typeof(v_d #> '{extra,items}') = 'array' and jsonb_array_length(v_d #> '{extra,items}') > 0 then
    v_extra := v_extra || jsonb_build_object('items', v_d #> '{extra,items}');
  end if;

  -- bio (خاصة) وfull_name وemail وphone وcity لا تُلمس هنا إطلاقًا
  update public.members
     set university = v_d ->> 'university',
         promotion  = v_d ->> 'promotion',
         track      = v_d ->> 'track',
         profession = case when v_d ? 'profession' then v_d ->> 'profession' else profession end,
         public_bio = v_d ->> 'public_bio',
         study_path = v_d ->> 'study_path',
         socials    = coalesce(v_d -> 'socials', '{}'::jsonb),
         extra      = v_extra,
         translations = v_tr,
         photo_url  = coalesce(p_photo_url, photo_url),
         show_in_directory = case when v_d ? 'show_in_directory'
                                  then (v_d ->> 'show_in_directory')::boolean else show_in_directory end
   where id = v_m.id;

  update public.member_card_requests
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = null
   where id = v_r.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_APPROVED_MEMBER_CARD_REQUEST', 'members', v_m.id,
          'اعتماد طلب تعديل بطاقة العضو ' || v_m.full_name);
end;
$$;

notify pgrst, 'reload schema';

commit;
