-- ============================================================
-- Données initiales de site_settings (club IAE)
-- À exécuter UNE fois sur une base vide ; tout se modifie ensuite depuis
-- l'administration (Paramètres). `on conflict do nothing` garantit qu'un rejeu
-- n'écrase jamais des valeurs déjà saisies.
--
-- Toutes les valeurs de texte/coordonnées sont volontairement VIDES :
--  - nom, titre d'accueil, « à propos » et copyright : le site retombe sur les
--    textes trilingues (AR/FR/EN) des fichiers src/i18n/locales/*.json ;
--  - email, téléphone, WhatsApp, adresse, réseaux : à renseigner dans
--    l'administration ; le site masque les éléments laissés vides.
-- ============================================================

insert into public.site_settings (key, value) values
  ('association_name', ''),
  ('logo_url', '/logo.jpg'),
  ('email', ''),
  ('phone', ''),
  ('whatsapp', ''),
  ('address', ''),
  ('facebook', ''),
  ('instagram', ''),
  ('youtube', ''),
  ('google_maps_url', '')
on conflict (key) do nothing;
