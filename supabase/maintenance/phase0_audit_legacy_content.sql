-- ============================================================
-- PHASE 0 — Audit des contenus Supabase hérités de l'ancienne association
-- LECTURE SEULE : uniquement des SELECT. À exécuter MANUELLEMENT dans
-- Supabase → SQL Editor, puis corriger depuis l'administration.
-- Ne modifie rien. Utilise to_jsonb(ligne) pour rester valable que les colonnes
-- `translations` (migration 0015) existent ou non.
-- Les données personnelles des membres (email, téléphone…) ne sont PAS affichées.
-- ============================================================

-- 1) Lignes contenant des termes de l'ancienne association (adapter la liste au besoin)
with pat as (
  select 'مرابط|morabit|mourabit|ثانوية|lyc[ée]e|خريج|alumni|anciens|ancien élève|بيوكرة|biougra|bioukra|اشتوكة|chtouka|جمعية|association|laureats|laur[ée]ats|679672284' as re
)
select 'site_settings' as source, s.key as ref, left(to_jsonb(s)::text, 160) as extrait
  from public.site_settings s, pat where to_jsonb(s)::text ~* pat.re
union all
select 'site_content', c.section || '.' || c.key, left(to_jsonb(c)::text, 160)
  from public.site_content c, pat where to_jsonb(c)::text ~* pat.re
union all
select 'activities', a.slug, left(a.title, 160)
  from public.activities a, pat where to_jsonb(a)::text ~* pat.re
union all
select 'announcements', coalesce(n.slug, n.id::text), left(coalesce(n.title, n.text), 160)
  from public.announcements n, pat where to_jsonb(n)::text ~* pat.re
union all
select 'board_members', b.id::text, left(b.full_name || ' — ' || b.position, 160)
  from public.board_members b, pat where to_jsonb(b)::text ~* pat.re
union all
select 'gallery', g.id::text, left(coalesce(g.title, g.image_url), 160)
  from public.gallery g, pat where to_jsonb(g)::text ~* pat.re
union all
-- membres : on ne liste que l'id et le nom, jamais les contacts
select 'members', m.id::text, left(m.full_name, 160)
  from public.members m, pat
  where (coalesce(m.promotion,'') || coalesce(m.track,'') || coalesce(m.university,'') || coalesce(m.bio,'') || coalesce(m.public_bio,'') || coalesce(m.study_path,'')) ~* pat.re
order by 1, 2;

-- 2) Coordonnées actuellement publiées (vérifier qu'elles sont bien celles du club)
select key, value from public.site_settings
 where key in ('association_name','email','phone','whatsapp','address','facebook','instagram','youtube','google_maps_url')
 order by key;

-- 3) Activités éventuellement issues des anciennes activités par défaut
select slug, title, status from public.activities
 where slug in ('annual-meeting','study-mentorship','student-support','volunteer-initiatives');

-- 4) Fiches de membres encore présentes (vérifier qu'aucune ne vient de l'ancienne association)
select id, full_name, status, promotion, university from public.members
 where deleted_at is null
 order by full_name;

-- 5) Fichiers du stockage. Le bucket « association-media » est un identifiant technique :
--    ne PAS le renommer (le code et les politiques de stockage en dépendent).
select name, created_at from storage.objects
 where bucket_id = 'association-media'
 order by created_at;
