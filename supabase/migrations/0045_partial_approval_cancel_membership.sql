-- 0045: (1) قبول جزئي لحقول طلب تعديل البطاقة  (2) إلغاء انخراط مسجَّل بالخطأ  (3) علامة إشعار العضو بالبريد
begin;

-- 3) إشعار العضو: تضبطه دالة الإرسال (service_role) مرة واحدة لكل طلب
alter table public.member_card_requests add column if not exists notified_at timestamptz;

-- 1) قبول جزئي: معامل اختياري p_skip_fields (مفاتيح الفروق: university, promotion, track, public_bio, study_path,
--    socials, extra, profession, show_in_directory, name_latin, fr.track, en.public_bio ...). null = اعتماد الكل.
drop function if exists public.approve_member_card_request(uuid, text, timestamptz);

create or replace function public.approve_member_card_request(p_request_id uuid, p_photo_url text default null, p_expected_updated_at timestamptz default null, p_skip_fields text[] default null)
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
  v_key   text;
  v_newtr jsonb;
  v_l     text;
  v_f     text;
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

  -- قبول جزئي: الحقول المستثناة تحتفظ بقيمتها الحالية على بطاقة العضو (تُدمج قيمتها الحالية في المقترح)
  if p_skip_fields is not null and coalesce(array_length(p_skip_fields, 1), 0) > 0 then
    if array_length(p_skip_fields, 1) > 40 then raise exception 'قائمة الحقول المستثناة غير صالحة'; end if;
    v_newtr := coalesce(v_d -> 'translations', '{}'::jsonb);
    foreach v_key in array p_skip_fields loop
      if v_key = any (array['university', 'promotion', 'track', 'public_bio', 'study_path', 'socials', 'extra', 'profession', 'show_in_directory']) then
        v_d := v_d || jsonb_build_object(v_key, to_jsonb(v_m) -> v_key);
      elsif v_key = 'name_latin' then
        v_newtr := v_newtr - 'name_latin';
        if coalesce(v_m.translations, '{}'::jsonb) ? 'name_latin' then
          v_newtr := v_newtr || jsonb_build_object('name_latin', v_m.translations -> 'name_latin');
        end if;
      elsif v_key ~ '^(fr|en)\.(track|public_bio|study_path|extra)$' then
        v_l := split_part(v_key, '.', 1);
        v_f := split_part(v_key, '.', 2);
        v_lobj := coalesce(v_newtr -> v_l, '{}'::jsonb) - v_f;
        if coalesce(v_m.translations -> v_l, '{}'::jsonb) ? v_f then
          v_lobj := v_lobj || jsonb_build_object(v_f, v_m.translations -> v_l -> v_f);
        end if;
        v_newtr := v_newtr || jsonb_build_object(v_l, v_lobj);
      else
        raise exception 'حقل غير معروف في قائمة الاستثناء: %', left(v_key, 40);
      end if;
    end loop;
    v_d := v_d || jsonb_build_object('translations', v_newtr);
  end if;

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

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), 'ADMIN_APPROVED_MEMBER_CARD_REQUEST', 'members', v_m.id,
          'اعتماد طلب تعديل بطاقة العضو ' || v_m.full_name,
          jsonb_build_object('request_id', v_r.id, 'skipped_fields', coalesce(to_jsonb(p_skip_fields), '[]'::jsonb)));
end;
$$;

revoke all on function public.approve_member_card_request(uuid, text, timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.approve_member_card_request(uuid, text, timestamptz, text[]) to authenticated;

-- 2) إلغاء انخراط: يُلغى الإيراد في الميزانية (voided مع السبب، لا حذف) ويُحذف سجل الانخراط ليمكن تسجيله من جديد.
create or replace function public.cancel_member_membership(p_membership_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mm     public.member_memberships%rowtype;
  v_reason text := left(btrim(coalesce(p_reason, '')), 300);
  v_name   text;
begin
  if auth.uid() is null or not public.can_handle_membership() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'سبب الإلغاء مطلوب (3 أحرف على الأقل)';
  end if;

  select * into v_mm from public.member_memberships where id = p_membership_id for update;
  if not found then raise exception 'سجل الانخراط غير موجود'; end if;

  select full_name into v_name from public.members where id = v_mm.member_id;

  if v_mm.transaction_id is not null then
    -- يمرّ عبر حارس الميزانية: يسجّل voided_at/voided_by ويُدوَّن في سجل التدقيق تلقائيًا
    update public.budget_transactions
       set status = 'voided', void_reason = v_reason
     where id = v_mm.transaction_id and status = 'active';
  end if;

  delete from public.member_memberships where id = v_mm.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), 'ADMIN_CANCELLED_MEMBERSHIP', 'members', v_mm.member_id,
          'إلغاء انخراط ' || coalesce(v_name, '') || ' — موسم ' || v_mm.season,
          jsonb_build_object('season', v_mm.season, 'amount', v_mm.amount,
                             'transaction_id', v_mm.transaction_id, 'reason', v_reason));
end;
$$;

revoke all on function public.cancel_member_membership(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_member_membership(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
