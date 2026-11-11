drop function if exists public.respond_invitation(text, text), public.get_invitation(text),
  public.delete_invitation(uuid), public.set_invitation_revoked(uuid, boolean),
  public.update_invitation(uuid, text, text, text), public.add_invitations(uuid, jsonb),
  public.save_invitation_settings(uuid, jsonb), public.get_activity_invitations(uuid);
drop table if exists public.activity_invitations;
drop table if exists public.activity_invitation_settings;
