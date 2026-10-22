-- ============================================================
-- 0016_projects.sql — Projets du club (vitrine technique)
--
-- Prérequis : 0001 à 0012 (fonctions is_admin(), can_manage_content(),
--             set_updated_at(), table audit_logs). 0015 n'est PAS requise :
--             les traductions de cette table sont dans sa propre colonne.
--
-- Droits :
--  * lecture publique (anon + authenticated) : uniquement les projets publiés
--    et non supprimés ;
--  * lecture complète (brouillons inclus) : is_admin() ;
--  * création / modification : can_manage_content() (developer, super_admin,
--    editor — mêmes rôles que les activités) ;
--  * AUCUNE suppression physique (pas de politique DELETE, droit DELETE retiré) :
--    la suppression est logique (deleted_at), comme pour les activités.
--
-- Audit : trigger SECURITY DEFINER qui écrit dans audit_logs (modèle de 0012) ;
-- la fonction log_admin_action() n'est pas modifiée.
-- Idempotente : peut être rejouée sans effet.
-- ============================================================

do $$
begin
  if to_regprocedure('public.can_manage_content()') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.set_updated_at()') is null
     or to_regclass('public.audit_logs') is null then
    raise exception 'Exécutez d''abord 0001 à 0012 (fonctions de rôles / audit_logs manquantes)';
  end if;
end $$;

-- ---------- Utilitaire : longueur max des éléments d'un tableau de texte ----------
create or replace function public.text_array_max_len(arr text[], max_len int)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(bool_and(char_length(x) between 1 and max_len), true)
  from unnest(coalesce(arr, '{}'::text[])) as x;
$$;

-- ---------- Table ----------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  slug          text not null,
  summary       text,
  description   text,
  status        text not null default 'in_progress',
  technologies  text[] not null default '{}'::text[],
  image_url     text,
  github_url    text,
  demo_url      text,
  sort_order    integer not null default 0,
  is_published  boolean not null default false,
  translations  jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- Contraintes (drop/add pour rester idempotent)
alter table public.projects
  drop constraint if exists projects_slug_key,
  drop constraint if exists projects_slug_format_chk,
  drop constraint if exists projects_title_len_chk,
  drop constraint if exists projects_summary_len_chk,
  drop constraint if exists projects_description_len_chk,
  drop constraint if exists projects_status_chk,
  drop constraint if exists projects_technologies_chk,
  drop constraint if exists projects_image_url_chk,
  drop constraint if exists projects_github_url_chk,
  drop constraint if exists projects_demo_url_chk,
  drop constraint if exists projects_translations_shape_chk;

-- (instruction séparée : l'ajout ne doit pas partager le même ALTER que la suppression du même nom)
alter table public.projects
  add constraint projects_slug_key unique (slug),
  add constraint projects_slug_format_chk
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  add constraint projects_title_len_chk
    check (char_length(btrim(title)) between 1 and 200),
  add constraint projects_summary_len_chk
    check (summary is null or char_length(summary) <= 400),
  add constraint projects_description_len_chk
    check (description is null or char_length(description) <= 10000),
  add constraint projects_status_chk
    check (status in ('in_progress', 'completed')),
  add constraint projects_technologies_chk
    check (cardinality(technologies) <= 20 and public.text_array_max_len(technologies, 40)),
  add constraint projects_image_url_chk
    check (image_url is null or (char_length(image_url) <= 1000 and image_url ~* '^https://')),
  add constraint projects_github_url_chk
    check (github_url is null or (char_length(github_url) <= 500 and github_url ~* '^https://')),
  add constraint projects_demo_url_chk
    check (demo_url is null or (char_length(demo_url) <= 500 and demo_url ~* '^https://')),
  add constraint projects_translations_shape_chk
    check (jsonb_typeof(translations) = 'object' and pg_column_size(translations) <= 32000);

create index if not exists idx_projects_public_list
  on public.projects (sort_order, created_at desc)
  where is_published and deleted_at is null;

-- ---------- updated_at ----------
drop trigger if exists trg_set_updated_at on public.projects;
create trigger trg_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.projects enable row level security;

drop policy if exists "projects_public_read_published" on public.projects;
create policy "projects_public_read_published"
  on public.projects for select
  to anon, authenticated
  using (is_published and deleted_at is null);

drop policy if exists "projects_admin_read_all" on public.projects;
create policy "projects_admin_read_all"
  on public.projects for select
  to authenticated
  using (public.is_admin());

drop policy if exists "projects_insert_editors" on public.projects;
create policy "projects_insert_editors"
  on public.projects for insert
  to authenticated
  with check (public.can_manage_content());

drop policy if exists "projects_update_editors" on public.projects;
create policy "projects_update_editors"
  on public.projects for update
  to authenticated
  using (public.can_manage_content())
  with check (public.can_manage_content());

-- Droits de table : accès retiré par défaut, puis rouvert au strict nécessaire.
revoke all on public.projects from anon, authenticated;
grant select on public.projects to anon, authenticated;
grant insert, update on public.projects to authenticated;

-- ---------- Audit automatique (écrit depuis la base, non falsifiable côté client) ----------
create or replace function public.projects_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
  v_desc   text;
begin
  if tg_op = 'INSERT' then
    v_action := 'ADMIN_PROJECT_CREATED';
    v_desc   := left(format('Ajout du projet : %s', new.title), 500);
  elsif new.deleted_at is not null and old.deleted_at is null then
    v_action := 'ADMIN_PROJECT_DELETED';
    v_desc   := left(format('Suppression du projet : %s', new.title), 500);
  elsif new.is_published and not old.is_published then
    v_action := 'ADMIN_PROJECT_PUBLISHED';
    v_desc   := left(format('Publication du projet : %s', new.title), 500);
  elsif not new.is_published and old.is_published then
    v_action := 'ADMIN_PROJECT_UNPUBLISHED';
    v_desc   := left(format('Retrait de la publication : %s', new.title), 500);
  else
    v_action := 'ADMIN_PROJECT_UPDATED';
    v_desc   := left(format('Modification du projet : %s', new.title), 500);
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), v_action, 'projects', new.id, v_desc,
          jsonb_build_object('slug', new.slug, 'status', new.status, 'is_published', new.is_published));
  return new;
end;
$$;

revoke execute on function public.projects_audit() from public, anon, authenticated;

drop trigger if exists trg_projects_audit on public.projects;
create trigger trg_projects_audit
  after insert or update on public.projects
  for each row execute function public.projects_audit();

notify pgrst, 'reload schema';
