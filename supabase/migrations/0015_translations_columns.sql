-- ============================================================
-- 0015_translations_columns.sql
-- Ajoute la colonne `translations jsonb` (traductions FR/EN) aux tables
-- activities, gallery, site_settings et site_content.
--
-- Contexte : le code et l'administration attendaient une migration « 0013 » qui
-- n'a jamais été livrée ni exécutée. Cette migration la remplace (la numérotation
-- 0013 reste volontairement inutilisée). Le code retombait sur l'arabe seul tant
-- que ces colonnes n'existaient pas.
--
-- Prérequis : 0001 à 0012 (tables de base) exécutées.
-- Idempotente : peut être rejouée sans effet. Aucun droit élargi : les politiques
-- RLS et les GRANT existants s'appliquent tels quels aux nouvelles colonnes
-- (aucun REVOKE par colonne n'existe sur ces quatre tables).
--
-- Format attendu :
--   activities / gallery : {"fr": {"title": "...", "description": "..."}, "en": {...}}
--   site_settings        : {"fr": {"value": "..."}, "en": {"value": "..."}}
--   site_content         : {"fr": {"value": "..."}, "en": {"value": "..."}}
-- ============================================================

do $$
begin
  if to_regclass('public.activities') is null
     or to_regclass('public.gallery') is null
     or to_regclass('public.site_settings') is null
     or to_regclass('public.site_content') is null then
    raise exception 'Exécutez d''abord 0001 à 0012 (tables activities, gallery, site_settings, site_content manquantes)';
  end if;
end $$;

-- ---------- Colonnes ----------
alter table public.activities    add column if not exists translations jsonb not null default '{}'::jsonb;
alter table public.gallery       add column if not exists translations jsonb not null default '{}'::jsonb;
alter table public.site_settings add column if not exists translations jsonb not null default '{}'::jsonb;
alter table public.site_content  add column if not exists translations jsonb not null default '{}'::jsonb;

-- ---------- Garde-fous de forme et de taille ----------
alter table public.activities    drop constraint if exists activities_translations_shape_chk;
alter table public.gallery       drop constraint if exists gallery_translations_shape_chk;
alter table public.site_settings drop constraint if exists site_settings_translations_shape_chk;
alter table public.site_content  drop constraint if exists site_content_translations_shape_chk;

-- Les activités embarquent aussi les traductions de sub_activities : limite plus large.
alter table public.activities
  add constraint activities_translations_shape_chk
  check (jsonb_typeof(translations) = 'object' and pg_column_size(translations) <= 64000);
alter table public.gallery
  add constraint gallery_translations_shape_chk
  check (jsonb_typeof(translations) = 'object' and pg_column_size(translations) <= 16000);
alter table public.site_settings
  add constraint site_settings_translations_shape_chk
  check (jsonb_typeof(translations) = 'object' and pg_column_size(translations) <= 16000);
alter table public.site_content
  add constraint site_content_translations_shape_chk
  check (jsonb_typeof(translations) = 'object' and pg_column_size(translations) <= 16000);

-- ---------- RLS : déjà active, on la réaffirme sans rien modifier d'autre ----------
alter table public.activities    enable row level security;
alter table public.gallery       enable row level security;
alter table public.site_settings enable row level security;
alter table public.site_content  enable row level security;

-- Recharge le cache de schéma de PostgREST pour que les nouvelles colonnes soient
-- reconnues immédiatement par l'API (sinon erreur PGRST204 jusqu'au prochain rechargement).
notify pgrst, 'reload schema';
