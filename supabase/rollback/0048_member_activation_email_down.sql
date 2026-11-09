-- رجوع 0048: يحذف الدالتين والأعمدة الجديدة فقط (لا يعيد البريد القديم لأي عضو غيّره؛ التغييرات المنفّذة تبقى في members.email)
begin;
drop function if exists public.set_member_activation_email(text, text);
drop function if exists public.member_activation_email_confirmed(text);
alter table public.member_activation_links
  drop column if exists email_confirmed,
  drop column if exists email_attempts,
  drop column if exists email_state_hash;
notify pgrst, 'reload schema';
commit;
