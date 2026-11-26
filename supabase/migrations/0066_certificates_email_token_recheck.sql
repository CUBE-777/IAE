-- ============================================================
-- 0066_certificates_email_token_recheck.sql
-- Reject a stale worker token after token reissue or secret rotation.
-- The raw token is supplied by the worker for comparison only; it is never stored.
-- ============================================================

begin;

-- Remove the unsafe one-argument API. The worker must provide the token
-- returned by certificate_email_claim_next for this exact send attempt.
drop function if exists public.certificate_email_recheck(uuid);

create or replace function public.certificate_email_recheck(p_queue_id uuid, p_token text)
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if p_queue_id is null or p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return false;
  end if;

  return exists (
    select 1
      from public.certificate_email_queue q
      join public.certificates c on c.id = q.certificate_id
     where q.id = p_queue_id
       and q.status = 'sending'
       and c.status = 'valid'
       and c.token_hash = public.certificate_token_hash(p_token)
  );
end;
$$;

revoke all on function public.certificate_email_recheck(uuid, text) from public, anon, authenticated;
grant execute on function public.certificate_email_recheck(uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
