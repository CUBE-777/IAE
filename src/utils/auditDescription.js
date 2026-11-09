/**
 * src/utils/auditDescription.js
 * أوصاف سجل العمليات تُخزَّن بالعربية في قاعدة البيانات (audit_logs.description). هذه الدالة تعرضها بلغة
 * واجهة الإدارة دون تغيير ما هو مخزَّن: تتعرّف على القوالب المعروفة (من خدمات الواجهة ودوال SQL)
 * وتُبقي الأسماء والأرقام كما هي. أي وصف غير معروف يبقى بالعربية كما كُتب.
 */
import { ADMIN_DICT } from '../i18n/adminDict.data.js';

// [تعبير نمطي على النص العربي، قالب fr، قالب en] — $1 $2 $3 هي المجموعات الملتقطة
const PATTERNS = [
  [/^تعديل النشاط (.+)$/s, "Modification de l'activité $1", 'Updated activity $1'],
  [/^إضافة نشاط جديد: (.+)$/s, 'Nouvelle activité ajoutée : $1', 'Added new activity: $1'],
  [/^تغيير حالة النشاط (.+) إلى (.+)$/s, "Changement de statut de l'activité $1 : $2", 'Changed status of activity $1 to $2', [2]],
  [/^حذف النشاط (.+)$/s, "Suppression de l'activité $1", 'Deleted activity $1'],
  [/^تعديل إعلان: (.*)$/s, "Modification de l'annonce : $1", 'Updated announcement: $1'],
  [/^إضافة إعلان: (.*)$/s, "Ajout d'une annonce : $1", 'Added announcement: $1'],
  [/^نشر إعلان: (.*)$/s, "Publication de l'annonce : $1", 'Published announcement: $1'],
  [/^إلغاء نشر إعلان: (.*)$/s, "Dépublication de l'annonce : $1", 'Unpublished announcement: $1'],
  [/^تثبيت إعلان: (.*)$/s, "Épinglage de l'annonce : $1", 'Pinned announcement: $1'],
  [/^إلغاء تثبيت إعلان: (.*)$/s, "Désépinglage de l'annonce : $1", 'Unpinned announcement: $1'],
  [/^حذف إعلان: (.*)$/s, "Suppression de l'annonce : $1", 'Deleted announcement: $1'],
  [/^تعديل بيانات عضو المكتب (.+)$/s, 'Modification des données du membre du bureau $1', 'Updated board member $1'],
  [/^إضافة عضو مكتب جديد: (.+)$/s, 'Nouveau membre du bureau ajouté : $1', 'Added new board member: $1'],
  [/^حذف عضو المكتب (.+)$/s, 'Suppression du membre du bureau $1', 'Deleted board member $1'],
  [/^إظهار عضو المكتب (.+) في قائمة الأعضاء$/s, 'Affichage du membre du bureau $1 dans la liste des membres', 'Showed board member $1 in the members list'],
  [/^إخفاء عضو المكتب (.+) في قائمة الأعضاء$/s, 'Masquage du membre du bureau $1 dans la liste des membres', 'Hid board member $1 from the members list'],
  [/^إضافة عضو جديد: (.+)$/s, 'Nouveau membre ajouté : $1', 'Added new member: $1'],
  [/^تعديل بيانات العضو (.+)$/s, 'Modification des données du membre $1', 'Updated member $1'],
  [/^حذف العضو (.+)$/s, 'Suppression du membre $1', 'Deleted member $1'],
  [/^استرجاع العضو (.+)$/s, 'Restauration du membre $1', 'Restored member $1'],
  [/^رفع (\d+) صورة إلى المعرض$/s, '$1 image(s) ajoutée(s) à la galerie', 'Uploaded $1 image(s) to the gallery'],
  [/^تعديل صلاحيات المسؤول (.+) \((.+)\) — الدور: (.+)$/s, "Modification des droits de l'administrateur $1 ($2) — rôle : $3", 'Updated admin permissions for $1 ($2) — role: $3', [3]],
  [/^منح صفة إدارية لمنخرط قائم: (.+) \((.+)\) — الدور: (.+)$/s, "Rôle d'administrateur accordé à l'adhérent existant : $1 ($2) — rôle : $3", 'Granted admin role to existing member: $1 ($2) — role: $3', [3]],
  [/^إنشاء مسؤول جديد: (.+) \((.+)\) — الدور: (.+)$/s, 'Nouvel administrateur créé : $1 ($2) — rôle : $3', 'Created new admin: $1 ($2) — role: $3', [3]],
  [/^إزالة صلاحية الوصول عن المسؤول (.+) \((.+)\)$/s, "Accès retiré à l'administrateur $1 ($2)", 'Removed access for admin $1 ($2)'],
];

// عبارات ثابتة أو بادئات متبوعة باسم/موسم (دوال SQL). تُطابَق من بداية النص، والباقي يُلحق كما هو.
const PREFIXES = [
  ['تحديث الإعدادات العامة', 'Mise à jour des paramètres généraux', 'Updated general settings'],
  ['تحديث شكل بطاقات الأعضاء والمكتب', "Mise à jour de l'apparence des cartes des membres et du bureau", 'Updated the look of member and board cards'],
  ['تحديث محتوى الموقع', 'Mise à jour du contenu du site', 'Updated site content'],
  ['تعديل بيانات صورة في المعرض', "Modification des données d'une image de la galerie", 'Updated a gallery image'],
  ['حذف صورة من المعرض', "Suppression d'une image de la galerie", 'Deleted a gallery image'],
  ['إصدار رابط تعبئة الملف الشخصي لعضو المكتب ', 'Émission du lien de remplissage de la fiche du membre du bureau ', 'Issued profile-completion link for board member '],
  ['إصدار رابط تفعيل حساب فضاء المنخرطين للعضو ', "Émission du lien d'activation du compte de l'espace adhérents pour ", "Issued members' space activation link for "],
  ['إصدار رابط نموذج الانخراط', "Émission du lien du formulaire d'adhésion", 'Issued membership form link'],
  ['إعادة إصدار بطاقات الحضور لنشاط', "Réémission des cartes de présence d'une activité", 'Reissued attendance cards for an activity'],
  ['إعادة الملف الشخصي لعضو المكتب ', 'Fiche renvoyée pour modification au membre du bureau ', 'Sent profile back for edits to board member '],
  ['إعادة ترتيب أعضاء المكتب', 'Réorganisation des membres du bureau', 'Reordered board members'],
  ['إغلاق بطاقة الحضور لنشاط', "Clôture de la carte de présence d'une activité", 'Closed attendance card for an activity'],
  ['إلغاء انخراط ', "Annulation de l'adhésion de ", 'Cancelled membership of '],
  ['إلغاء تسجيل حضور عضو في نشاط', "Annulation de la présence d'un membre à une activité", "Cancelled a member's attendance at an activity"],
  ['استعادة الدخول لحساب فضاء المنخرطين (تغيير كلمة المرور)', "Récupération d'accès au compte de l'espace adhérents (changement de mot de passe)", "Members' space account access recovery (password change)"],
  ['اطلاع على وثيقة انخراط (صورة شخصية / بطاقة الطالب)', "Consultation d'un document d'adhésion (photo / carte d'étudiant)", 'Viewed a membership document (photo / student card)'],
  ['اطلاع على وثيقة انخراط (صورة شخصية / بطاقة وطنية)', "Consultation d'un document d'adhésion (photo / carte nationale)", 'Viewed a membership document (photo / national ID)'],
  ['اعتماد الملف الشخصي الذي أرسله عضو المكتب ', 'Validation de la fiche envoyée par le membre du bureau ', 'Approved the profile submitted by board member '],
  ['اعتماد طلب تعديل بطاقة العضو ', "Validation de la demande de modification de la carte du membre ", "Approved card update request for member "],
  ['تجاهل طلب مساعدة في الدخول لعضو', "Demande d'aide à la connexion ignorée pour un membre", 'Dismissed a sign-in help request for a member'],
  ['تسجيل انخراط سنوي', "Enregistrement d'une adhésion annuelle", 'Recorded an annual membership'],
  ['تعطيل جانب المنخرط للحساب الإداري', "Désactivation du volet adhérent du compte administrateur", "Disabled the member side of the admin account"],
  ['تفعيل حساب فضاء المنخرطين', "Activation du compte de l'espace adhérents", "Activated members' space account"],
  ['تم رفض طلب الانخراط', "Demande d'adhésion refusée", 'Membership request rejected'],
  ['تمت الموافقة على طلب الانخراط وتحويله إلى عضو', "Demande d'adhésion approuvée et convertie en membre", 'Membership request approved and converted to a member'],
  ['رفض طلب تعديل بطاقة عضو', "Demande de modification de carte d'un membre refusée", 'Rejected a member card update request'],
  ['طلب تعديل بطاقة المكتب من العضو ', 'Demande de modification de la fiche du bureau par le membre ', 'Board card update requested by member '],
  ['معالجة طلب مساعدة في الدخول لعضو', "Demande d'aide à la connexion traitée pour un membre", 'Handled a sign-in help request for a member'],
  ['منح صفة إدارية لحساب منخرط قائم (حساب مزدوج)', "Rôle d'administrateur accordé à un compte adhérent existant (compte double)", 'Granted admin role to an existing member account (dual account)'],
  ['نشر بطاقة الحضور لنشاط', "Publication de la carte de présence d'une activité", 'Published attendance card for an activity'],
].sort((a, b) => b[0].length - a[0].length);

const TOKENS = [[' — موسم ', ' — saison ', ' — season '], [' للتعديل', ' pour modification', ' for edits']];

const dictLookup = (text, lang) => {
  const e = ADMIN_DICT[text];
  return (e && e[lang]) || text;
};

export function translateAuditDescription(description, lang) {
  if (typeof description !== 'string' || !description || (lang !== 'fr' && lang !== 'en')) return description;
  const idx = lang === 'fr' ? 1 : 2;
  // الحالة والدور فقط قيمتان عربيتان معروفتان تُترجمان من قاموس الإدارة؛ الأسماء والبريد تبقى كما هي
  const fill = (tpl, m, translated = []) =>
    tpl.replace(/\$(\d)/g, (_, n) => {
      const v = m[Number(n)] ?? '';
      return translated.includes(Number(n)) ? dictLookup(v, lang) : v;
    });
  for (const p of PATTERNS) {
    const m = description.match(p[0]);
    if (m) return fill(p[idx], m, p[3]);
  }
  for (const p of PREFIXES) {
    if (description.startsWith(p[0])) {
      let rest = description.slice(p[0].length);
      for (const t of TOKENS) rest = rest.split(t[0]).join(t[idx]);
      return p[idx] + rest;
    }
  }
  return description;
}
