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
| **Retirer** un bénéficiaire en attente (correction d'une erreur d'ajout ; suppression définitive, **pas un rejet**) | manage | RPC `certificate_remove_recipient` |
| **Émettre les certificats en attente** (action **collective**, niveau campagne ; **pas une validation individuelle**) | manage | RPC `certificate_issue_campaign` |
| États chargement / vide / erreur avec réessai, confirmations modales, toasts, messages d'erreur traduits (fr/ar/en) pour les codes `certificate_*` | — | — |
| Message dédié si le module est absent de la base (`PGRST202`, `PGRST205`, `42P01`, `42883`) → « migrations 0063–0065 non appliquées » | — | — |

### Validation / rejet individuels : limite de la base (vérifiée dans 0063/0064)
- `certificate_recipients.status` n'accepte que `pending` et `issued` (0063). **Aucun statut « validé », « rejeté » ou « refusé »**, et aucune RPC de validation/rejet par bénéficiaire dans 0064.
- La seule écriture d'émission est `certificate_issue_campaign(p_campaign_id)` : elle émet **tous** les bénéficiaires `pending` de la campagne (les membres supprimés restent `pending`, comptés « ignorés »). Elle ne peut pas cibler un seul bénéficiaire.
- Correction par rapport à la version précédente de ce handoff : l'interface présentait ces actions comme « Valider » (par ligne de campagne) et « Rejeter » (par bénéficiaire). C'était trompeur. Maintenant :
  - le bouton est « Émettre les certificats en attente », avec une note de portée (« s'applique à tous les bénéficiaires en attente… ni validation ni rejet individuel ») et une confirmation qui indique le nombre concerné, l'irréversibilité et l'absence d'e-mail ;
  - le bouton par ligne est « Retirer » : la confirmation dit explicitement que la ligne est supprimée définitivement, que ce n'est pas un rejet et qu'aucun statut « rejeté » n'est conservé ; à n'utiliser que pour corriger une erreur d'ajout. La RPC refuse les bénéficiaires déjà émis (`certificate_recipient_issued_immutable`).
- **Décision à confirmer** : « Retirer » reste disponible car c'est la seule correction d'ajout possible via une RPC existante. Si vous préférez ne proposer aucune suppression, il suffit de retirer la colonne d'actions (`CertificateCampaignDetail.jsx`). Un vrai rejet non destructif ou une validation individuelle exigent une migration (statut + RPC), hors périmètre ici.

### `members_manager`
Il ne dispose dans 0064 que de deux RPC en **lecture** (`certificate_review_*`). Il n'existe donc **aucune RPC de révision/validation/rejet** utilisable par ce rôle (les RPC d'écriture exigent `can_manage_certificates()`). L'interface lui donne une consultation seule (aucun bouton d'écriture, message explicatif), sans accès direct aux tables. Lui ouvrir une action de révision exigerait une nouvelle RPC, donc une nouvelle migration, ce qui est interdit ici.

## 2. Fichiers

Créés lors de la première passe : `src/services/supabase/adminCertificates.service.js`, `src/pages/admin/Certificates.jsx`, `CertificateCampaignDetail.jsx`, `CertificateCampaignFormModal.jsx`, `CertificateRecipientModals.jsx`, `certificateUi.js`, `tests/certificates-admin-ui.test.js`, ce fichier. Modifiés lors de la première passe (ajouts minimaux) : `src/constants/roles.js`, `src/constants/adminNav.js`, `src/app/router/index.jsx`, `src/layouts/AdminLayout.jsx`, `src/i18n/locales/{fr,ar,en}.json`.

**Modifiés dans cette passe** (comparaison fichier par fichier avec le ZIP fourni : seuls ces 7 fichiers diffèrent) :
- `src/services/supabase/adminCertificates.service.js` : `rejectCertificateRecipient` → `removeCertificateRecipient` (même RPC), commentaires corrigés.
- `src/pages/admin/CertificateCampaignDetail.jsx` : bouton/dialogues « Émettre » et « Retirer », note de portée.
- `src/pages/admin/CertificateCampaignFormModal.jsx` : en modification, un modèle devenu inactif (absent de la liste) ne bloque plus la sauvegarde ; `template_id` est envoyé à `null`, et `certificate_update_campaign` conserve alors le modèle existant (`coalesce`).
- `src/i18n/locales/fr.json`, `ar.json`, `en.json` : blocs `validate`/`reject` remplacés par `issue` (+ `scope`) et `remove`.
- `tests/certificates-admin-ui.test.js` : 1 test ajouté (8 au total).

Non touchés : migrations 0063/0064/0065, rollbacks, tests SQL, page publique de vérification, tokens, QR, PDF, e-mail.

## 3. Contraintes respectées
- Aucun `select *` sur `certificates` (ni sur les autres tables de ce module) ; `token_hash`, `token_epoch` et les tables de secret/compteur ne sont jamais référencés (test).
- Écritures uniquement via RPC ; aucun `insert/update/upsert/delete` direct (test).
- Aucun PDF stocké, ni page publique de vérification, ni QR, ni Designer, ni envoi d'e-mail.
- Hiérarchie `developer > super_admin` inchangée (les deux dans les rôles de gestion ; la rotation du secret, réservée au developer, n'est pas dans l'interface).

## 4. Tests réellement exécutés (cette passe)

| Vérification | Résultat |
|---|---|
| `node --test tests/certificates-admin-ui.test.js` (8 tests : rôles = SQL, nav/route, pas de `select *`/colonne sensible/écriture directe, RPC utilisés ∈ 0064, branche members_manager sans accès table, parité i18n fr/ar/en + clés utilisées, fr par défaut, **absence de validation/rejet individuel simulé**) | **8/8 réussis** |
| `node --test` (suite complète) | **426/430 réussis, 4 échecs** : « ملفات الاختبار والتوثيق موجودة », « ملفات المشروع الأساسية موجودة ولا تُرفع الأسرار », « الملفات الأساسية للمستودع موجودة », `tests/sanitize.test.js` |
| Les 4 échecs sont ceux de l'état initial (426 = 418 d'origine + 8 tests certificats ; PHASE_1_HANDOFF.md et .gitignore absents du ZIP, dépendances de `sanitize.test.js` non installées) | Non liés à cette phase |
| `esbuild` : syntaxe des 6 fichiers JSX/JS du module | OK |
| `esbuild --bundle --packages=external` du routeur (résolution des imports relatifs, chunk `Certificates` généré) | OK, 0 erreur, 0 avertissement |

**Non exécuté, et pourquoi :**
- `npm run build` (Vite) et `npm run lint` : pas de `node_modules` ni de réseau. `esbuild` n'est **pas** un build Vite.
- Aucun test navigateur, aucune vérification visuelle (mobile/RTL).
- **Aucune migration appliquée, aucune RPC appelée, `supabase/tests/certificates_smoke.sql` non lancé.** Le comportement réel contre Supabase est inconnu.

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

## 6. Limites restantes
1. **Exécuter 0063→0065 sur un environnement de test**, puis `certificates_smoke.sql`, puis un parcours manuel avec un compte de chaque rôle (developer, super_admin, secretary_general, members_manager). Inconnu tant que non fait : policies SELECT, noms de colonnes, `activities.title/date`.
2. **Pas de validation individuelle ni de rejet non destructif** (voir §1). Nécessite une migration (statut + RPC par bénéficiaire, et RPC de révision pour members_manager), hors périmètre.
3. `members_manager` : consultation seule.
4. Lancer `npm ci && npm run check` (lint + tests + build Vite) sur une machine avec réseau.
5. Hors périmètre, non implémentés : archivage de campagne, révocation, changement de confidentialité du nom après émission, file d'e-mails, rotation du secret.
6. La source « inscriptions » est absente du formulaire (désactivée par un trigger en 0063).
7. Le sélecteur d'activités est limité aux 300 plus récentes ; la recherche de membres renvoie 15 résultats maximum.
8. Les textes passent par les clés i18n `admin.certificates.*` uniquement, pas par le dictionnaire arabe `adminDict`.
9. Un membre supprimé reste `pending` après émission (compté « ignoré ») et peut être retiré via « Retirer ».
