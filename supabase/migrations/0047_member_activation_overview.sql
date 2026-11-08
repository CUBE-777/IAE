-- =====================================================================
-- 0047_member_activation_overview.sql — حالة رابط التفعيل لكل عضو (لقائمة الأعضاء في الإدارة)
-- جدول member_activation_links خاص بلا سياسات، فنكشف ملخصًا للمسؤولين عبر دالة واحدة (لا يُكشف الرمز ولا مجزّؤه).
-- الحالات: sent (رابط صالح لم يُستعمل) | expired (انتهت صلاحيته) | activated (للعضو حساب).
-- من لا يظهر في النتيجة لم يُرسَل له رابط ولا حساب له. آمن لإعادة التشغيل. الرجوع: rollback/0047_member_activation_overview_down.sql
-- =====================================================================
begin;

create or replace function public.member_activation_overview()
returns table (member_id uuid, state text, sent_at timestamptz, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.can_manage_member_system() then
    raise exception 'غير مصرّح لك بهذه العملية';
  end if;

  return query
  select m.id,
         case
           when ma.member_id is not null then 'activated'
           when l.expires_at <= now() then 'expired'
           else 'sent'
         end,
         l.created_at,
         l.expires_at
    from public.members m
    left join public.member_accounts ma on ma.member_id = m.id
    left join public.member_activation_links l on l.member_id = m.id
   where m.deleted_at is null
     and (ma.member_id is not null or l.id is not null);
end;
$$;

revoke all on function public.member_activation_overview() from public, anon;
grant execute on function public.member_activation_overview() to authenticated;

notify pgrst, 'reload schema';

commit;
