-- رجوع 0047
begin;
drop function if exists public.member_activation_overview();
notify pgrst, 'reload schema';
commit;
