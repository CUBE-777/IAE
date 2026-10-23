-- ============================================================
-- 0017_internal_files.sql — Fichiers internes du club (administration uniquement)
--
-- Prérequis : 0001 à 0012 (current_admin_role(), is_admin(), audit_logs).
--
-- Principe :
--  * bucket Storage PRIVÉ « internal-files » : aucun lien public, téléchargement par lien signé
--    de courte durée uniquement ;
--  * table `internal_files` : métadonnées (titre, catégorie, description, chemin, type, taille) ;
--  * accès : developer, super_admin, editor, members_manager (PAS treasurer, PAS anon) ;
--  * suppression (logique) : developer et super_admin uniquement ;
--  * AUCUNE modification des métadonnées après envoi (on supprime et on renvoie) ;
--  * audit automatique des envois et suppressions (trigger) et des téléchargements
--    (fonction request_internal_file_download, SECURITY DEFINER, qui vérifie le rôle).
--
-- Idempotente : peut être rejouée sans effet. Aucun droit existant n'est élargi.
-- ============================================================

do $$
begin
  if to_regprocedure('public.current_admin_role()') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regclass('public.audit_logs') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Exécutez d''abord 0001 à 0012 (rôles / audit_logs / profiles manquants)';
  end if;
end $$;

-- ---------- Fonctions de droits (comparaison en texte : pas de dépendance aux nouvelles valeurs d'enum) ----------
create or replace function public.can_access_internal_files()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in ('developer', 'super_admin', 'editor', 'members_manager');
$$;

create or replace function public.can_delete_internal_files()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.current_admin_role()::text in ('developer', 'super_admin');
$$;

revoke execute on function public.can_access_internal_files() from public, anon;
revoke execute on function public.can_delete_internal_files() from public, anon;
grant execute on function public.can_access_internal_files() to authenticated;
grant execute on function public.can_delete_internal_files() to authenticated;

-- ---------- Table ----------
create table if not exists public.internal_files (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  category         text not null default 'other',
  description      text,
  storage_path     text not null,
  file_name        text not null,
  mime_type        text not null,
  size_bytes       bigint not null,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

alter table public.internal_files
  drop constraint if exists internal_files_storage_path_key,
  drop constraint if exists internal_files_title_len_chk,
  drop constraint if exists internal_files_category_chk,
  drop constraint if exists internal_files_description_len_chk,
  drop constraint if exists internal_files_path_format_chk,
  drop constraint if exists internal_files_file_name_len_chk,
  drop constraint if exists internal_files_mime_chk,
  drop constraint if exists internal_files_size_chk;

alter table public.internal_files
  add constraint internal_files_storage_path_key unique (storage_path),
  add constraint internal_files_title_len_chk check (char_length(btrim(title)) between 1 and 200),
  add constraint internal_files_category_chk
    check (category in ('administrative', 'minutes', 'educational', 'templates', 'other')),
  add constraint internal_files_description_len_chk check (description is null or char_length(description) <= 1000),
  add constraint internal_files_path_format_chk
    check (storage_path ~ '^internal/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$'),
  add constraint internal_files_file_name_len_chk check (char_length(file_name) between 1 and 255),
  add constraint internal_files_mime_chk
    check (mime_type in (
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain', 'text/csv',
      'image/jpeg', 'image/png', 'image/webp',
      'application/zip'
    )),
  add constraint internal_files_size_chk check (size_bytes between 1 and 20971520);

create index if not exists idx_internal_files_list
  on public.internal_files (created_at desc)
  where deleted_at is null;

-- ---------- Renseigne l'auteur côté serveur (non falsifiable par le client) ----------
create or replace function public.internal_files_set_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.uploaded_by := auth.uid();
  new.uploaded_by_name := (select full_name from public.profiles where id = auth.uid());
  new.deleted_at := null;
  return new;
end;
$$;

revoke execute on function public.internal_files_set_author() from public, anon, authenticated;

drop trigger if exists trg_internal_files_set_author on public.internal_files;
create trigger trg_internal_files_set_author
  before insert on public.internal_files
  for each row execute function public.internal_files_set_author();

-- ---------- Audit des envois / suppressions ----------
create or replace function public.internal_files_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
    values (auth.uid(), 'ADMIN_INTERNAL_FILE_UPLOADED', 'internal_files', new.id,
            left(format('Envoi du fichier interne : %s', new.title), 500),
            jsonb_build_object('category', new.category, 'size_bytes', new.size_bytes));
  elsif new.deleted_at is not null and old.deleted_at is null then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
    values (auth.uid(), 'ADMIN_INTERNAL_FILE_DELETED', 'internal_files', new.id,
            left(format('Suppression du fichier interne : %s', new.title), 500),
            jsonb_build_object('category', new.category));
  end if;
  return new;
end;
$$;

revoke execute on function public.internal_files_audit() from public, anon, authenticated;

drop trigger if exists trg_internal_files_audit on public.internal_files;
create trigger trg_internal_files_audit
  after insert or update on public.internal_files
  for each row execute function public.internal_files_audit();

-- ---------- RLS + droits de table ----------
alter table public.internal_files enable row level security;

drop policy if exists "internal_files_select" on public.internal_files;
create policy "internal_files_select"
  on public.internal_files for select
  to authenticated
  using (public.can_access_internal_files() and deleted_at is null);

drop policy if exists "internal_files_insert" on public.internal_files;
create policy "internal_files_insert"
  on public.internal_files for insert
  to authenticated
  with check (public.can_access_internal_files());

-- Mise à jour = suppression logique uniquement (seule la colonne deleted_at est modifiable, voir GRANT)
drop policy if exists "internal_files_soft_delete" on public.internal_files;
create policy "internal_files_soft_delete"
  on public.internal_files for update
  to authenticated
  using (public.can_delete_internal_files())
  with check (public.can_delete_internal_files());

revoke all on public.internal_files from anon, authenticated;
grant select on public.internal_files to authenticated;
grant insert (title, category, description, storage_path, file_name, mime_type, size_bytes)
  on public.internal_files to authenticated;
grant update (deleted_at) on public.internal_files to authenticated;

-- ---------- Téléchargement tracé : vérifie le rôle, journalise, renvoie le chemin à signer ----------
create or replace function public.request_internal_file_download(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_path  text;
  v_title text;
begin
  if auth.uid() is null or not public.can_access_internal_files() then
    raise exception 'غير مصرح لك بهذه العملية';
  end if;

  select storage_path, title into v_path, v_title
  from public.internal_files
  where id = p_id and deleted_at is null;

  if v_path is null then
    raise exception 'الملف غير موجود';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description)
  values (auth.uid(), 'ADMIN_INTERNAL_FILE_DOWNLOADED', 'internal_files', p_id,
          left(format('Téléchargement du fichier interne : %s', v_title), 500));

  return v_path;
end;
$$;

revoke execute on function public.request_internal_file_download(uuid) from public, anon;
grant execute on function public.request_internal_file_download(uuid) to authenticated;

-- ---------- Bucket Storage privé ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'internal-files', 'internal-files', false, 20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv',
    'image/jpeg', 'image/png', 'image/webp',
    'application/zip'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Lecture (nécessaire à la création d'un lien signé) et envoi : rôles autorisés uniquement.
-- Aucune politique UPDATE ni DELETE sur les objets : un fichier envoyé ne se modifie pas côté client.
drop policy if exists "internal_files_objects_select" on storage.objects;
create policy "internal_files_objects_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'internal-files' and public.can_access_internal_files());

drop policy if exists "internal_files_objects_insert" on storage.objects;
create policy "internal_files_objects_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'internal-files' and public.can_access_internal_files());

notify pgrst, 'reload schema';
