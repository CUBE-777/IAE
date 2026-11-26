# PHASE 2A — Administration des certificats (handoff)

**Statut : code écrit et vérifié statiquement. Rien n'a été exécuté contre Supabase.**
Les migrations 0063, 0064 et 0065 ne sont pas confirmées comme appliquées : aucune fonctionnalité ci-dessous n'est démontrée sur une vraie base.

## 1. Fonctionnalités implémentées

Route `/admin/certificates` (entrée « Certificats » dans la navigation, section dédiée). Détail d'une campagne via `?c=<id>`.

| Fonctionnalité | Rôles | Source de données |
|---|---|---|
| Liste des campagnes (recherche par titre, filtre par statut, compteurs bénéficiaires/émis) | developer, super_admin, secretary_general, members_manager | RPC `certificate_review_campaigns` |
| Création de campagne (titre, type, source, activité, modèle, langue — **fr par défaut** —, affichage public du nom) | developer, super_admin, secretary_general | RPC `certificate_create_campaign` |
| Modification (brouillon uniquement : titre, modèle, langue, affichage du nom) | idem | RPC `certificate_update_campaign` |
| Détail et statut d'une campagne | manage : lecture des tables, colonnes explicites ; members_manager : RPC | `certificate_campaigns`, `certificate_templates` / `certificate_review_recipients` |
| Liste et recherche des bénéficiaires (nom, e-mail, n° de certificat, filtre de statut), statut bénéficiaire + statut certificat | manage : tables ; members_manager : RPC (pas d'e-mail, seulement « renseigné ») | `certificate_recipients`, `certificates` / `certificate_review_recipients` |
| Ajout depuis les présences (campagnes `attendance_based`) | manage | RPC `certificate_add_attendance_recipients` |
| Ajout manuel d'un membre (recherche par nom) ou d'une personne externe (`manual_selection`) | manage | RPC `certificate_add_member_recipient` / `certificate_add_external_recipient` |
| **Rejeter** un bénéficiaire en attente | manage | RPC `certificate_remove_recipient` |
| **Valider et émettre** les bénéficiaires en attente | manage | RPC `certificate_issue_campaign` |
| États chargement / vide / erreur avec réessai, confirmations modales, toasts, messages d'erreur traduits (fr/ar/en) pour les codes `certificate_*` | — | — |
| Message dédié si le module est absent de la base (`PGRST202`, `PGRST205`, `42P01`, `42883`) → « migrations 0063–0065 non appliquées » | — | — |

### Interprétation à confirmer : « validation » et « rejet »
Le schéma 0063/0064 n'a **aucun statut ni RPC de validation/rejet par bénéficiaire** : un bénéficiaire est `pending` ou `issued`. J'ai donc mappé :
- **Rejeter** = `certificate_remove_recipient` (suppression d'un bénéficiaire `pending`, refusée par le serveur s'il est déjà émis).
- **Valider** = `certificate_issue_campaign` : action **au niveau campagne** qui émet tous les bénéficiaires en attente (numérotation, jetons). Elle demande une confirmation explicite et indique qu'elle est irréversible et n'envoie aucun e-mail.

### `members_manager`
Il ne dispose dans 0064 que de deux RPC en **lecture** (`certificate_review_*`). Il n'existe donc **aucune RPC de validation/rejet** utilisable par ce rôle. L'interface lui donne une consultation seule (aucun bouton d'écriture, message explicatif), sans accès direct aux tables. Lui ouvrir la validation/rejet exigerait une nouvelle RPC, donc une nouvelle migration, ce qui était interdit ici.

## 2. Fichiers

Créés :
- `src/services/supabase/adminCertificates.service.js`
- `src/pages/admin/Certificates.jsx`, `CertificateCampaignDetail.jsx`, `CertificateCampaignFormModal.jsx`, `CertificateRecipientModals.jsx`, `certificateUi.js`
- `tests/certificates-admin-ui.test.js`
- `PHASE_2A_HANDOFF.md`

Modifiés (ajouts minimaux) :
- `src/constants/roles.js` : `ROLES_CERT_MANAGE`, `ROLES_CERT_REVIEW` (miroirs de `can_manage_certificates()` / `can_review_certificate_recipients()` ; aucun rôle ni permission nouveau)
- `src/constants/adminNav.js` : section + entrée « Certificats »
- `src/app/router/index.jsx` : import lazy + route protégée
- `src/layouts/AdminLayout.jsx` : icône `Award` ajoutée à la table d'icônes
- `src/i18n/locales/fr.json`, `ar.json`, `en.json` : `admin.nav.certificates`, `admin.nav.sectionCertificates`, bloc `admin.certificates` (insertion de texte, aucun reformatage)

Non touchés : migrations 0063/0064/0065 (MD5 identiques au ZIP d'origine), rollback, permissions SQL.

## 3. Contraintes respectées
- Aucun `select *` sur `certificates` (ni sur les autres tables de ce module) ; `token_hash`, `token_epoch` et les tables de secret/compteur ne sont jamais référencés (test).
- Écritures uniquement via RPC ; aucun `insert/update/upsert/delete` direct (test).
- Aucun PDF stocké, ni page publique de vérification, ni QR, ni Designer, ni envoi d'e-mail.
- Hiérarchie `developer > super_admin` inchangée (les deux dans les rôles de gestion ; la rotation du secret, réservée au developer, n'est pas dans l'interface).

## 4. Tests réellement exécutés

| Vérification | Résultat |
|---|---|
| `node --test tests/certificates-admin-ui.test.js` (7 tests : rôles = SQL, nav/route, pas de `select *`/colonne sensible/écriture directe, RPC utilisés ∈ 0064, branche members_manager sans accès table, parité i18n fr/ar/en + variables, fr par défaut) | **7/7 réussis** |
| `node --test` (suite complète) | **425/429 réussis, 4 échecs** |
| Même suite sur le ZIP d'origine, avant mes changements | 418/422 réussis, **les mêmes 4 échecs** |
| `esbuild` : syntaxe JSX des 10 fichiers touchés/créés | OK |
| `esbuild --bundle` du routeur (résolution de tous les imports et exports nommés, chunk `Certificates` généré) | OK, 0 erreur, 0 avertissement |

Les 4 échecs préexistants : `PHASE_1_HANDOFF.md` absent, `.gitignore` absent du ZIP, `tests/sanitize.test.js` (dépendances non installées). Non liés à cette phase.

**Non exécuté, et pourquoi :**
- `npm run build` (Vite), `npm run lint` : pas de `node_modules` et pas de réseau dans l'environnement, donc impossible à installer. L'`esbuild` ci-dessus est un substitut partiel, **pas** un build Vite.
- Aucun test dans un navigateur, aucune vérification visuelle (mobile/RTL).
- Aucun SQL, aucune RPC appelée, `supabase/tests/certificates_smoke.sql` non lancé.

## 5. Dépendances envers les migrations Supabase

Tout l'écran dépend de l'application effective de **0063 + 0064** (0065 : file d'e-mails, non utilisée par cette phase).

| Écran / action | Nécessite |
|---|---|
| Liste des campagnes | 0064 `certificate_review_campaigns` |
| Création / modification | 0063 (tables `certificate_templates`, `certificate_campaigns`, 4 modèles système) + 0064 RPC |
| Détail / bénéficiaires (manage) | 0063 tables + policies SELECT pour `can_manage_certificates()` |
| Détail / bénéficiaires (members_manager) | 0064 `certificate_review_recipients` |
| Ajout présences / membre / externe, rejet, validation | 0064 RPC correspondantes ; présences : tables `activity_attendance` (0041) |
| Choix d'activité / recherche de membre | RLS existantes sur `activities` et `members` |

Si les migrations manquent, la page affiche le message « module indisponible » au lieu d'un écran cassé.

## 6. Problèmes restants / à vérifier
1. **Exécuter 0063→0065 sur un environnement de test**, puis `certificates_smoke.sql`, puis un parcours manuel de l'interface avec un compte de chaque rôle (developer, super_admin, secretary_general, members_manager). Tant que ce n'est pas fait, le fonctionnement réel est inconnu (policies SELECT, noms de colonnes, `activities.title/date`).
2. Confirmer l'interprétation « valider = émettre la campagne » et « rejeter = retirer le bénéficiaire » ; sinon, il faut une migration (statuts/RPC par bénéficiaire, et RPC d'écriture pour members_manager).
3. Lancer `npm ci && npm run check` (lint + tests + build Vite) sur une machine avec réseau.
4. Hors périmètre, non implémentés : archivage de campagne, révocation d'une certification, changement de confidentialité du nom après émission, file d'e-mails, rotation du secret.
5. La source « inscriptions » est volontairement absente du formulaire (désactivée par un trigger en 0063).
6. Le sélecteur d'activités est limité aux 300 plus récentes ; la recherche de membres renvoie 15 résultats maximum.
7. Les textes ne passent pas par le dictionnaire arabe `adminDict` : seules les clés i18n `admin.certificates.*` sont utilisées.
