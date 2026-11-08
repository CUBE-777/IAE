-- رجوع 0045
begin;
drop function if exists public.cancel_member_membership(uuid, text);
drop function if exists public.approve_member_card_request(uuid, text, timestamptz, text[]);

create or replace function public.approve_member_card_request(p_request_id uuid, p_photo_url text default null, p_expected_updated_at timestamptz default null)
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
  -- سباق المراجعة: إن عدّل العضو طلبه بعد أن فتحه المسؤول، لا نعتمد ما لم يره
  if p_expected_updated_at is not null and v_r.updated_at is distinct from p_expected_updated_at then
    raise exception 'تغيّر الطلب أثناء مراجعتك. تم تحديث القائمة، راجع التعديلات الجديدة ثم اعتمد.';
  end if;

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

revoke all on function public.approve_member_card_request(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.approve_member_card_request(uuid, text, timestamptz) to authenticated;
alter table public.member_card_requests drop column if exists notified_at;
notify pgrst, 'reload schema';
commit;
