-- Fail-closed rollback: removes the new worker RPC so no worker can continue
-- with the obsolete one-argument check. Re-applying 0065 is NOT a safe rollback
-- because it restores the token-reissue race. Reapply 0066 after any rollback.
begin;
drop function if exists public.certificate_email_recheck(uuid, text);
notify pgrst, 'reload schema';
commit;
