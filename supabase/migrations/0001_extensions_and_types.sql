-- ============================================================
-- 0001_extensions_and_types.sql
-- الإضافات (Extensions) والأنواع المخصصة (Enums)
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

do $$ begin
  create type admin_role as enum ('super_admin', 'editor', 'members_manager');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type request_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type activity_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;
