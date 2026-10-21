/**
 * src/i18n/adminDict.js
 * Traduction de l'interface d'administration (pages CRUD) : la source est le texte arabe d'origine,
 * le français/anglais sont dans adminDict.data.js. L'arabe est renvoyé tel quel ; si une clé manque
 * dans une langue, on retombe sur l'arabe (jamais de clé technique affichée).
 * AdminLayout remonte son contenu à chaque changement de langue (key), donc tr() est relu à l'affichage.
 */
import i18n from './index';
import { ADMIN_DICT } from './adminDict.data';

const LOCALES = { ar: 'ar-MA', fr: 'fr-FR', en: 'en-GB' };

export function currentLang() {
  return String(i18n.resolvedLanguage || i18n.language || 'ar').slice(0, 2);
}

export function dateLocale() {
  return LOCALES[currentLang()] || LOCALES.ar;
}

function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}

/** Traduit un texte source arabe ; {{var}} est remplacé par vars.var. */
export function tr(text, vars) {
  if (typeof text !== 'string') return text;
  const lang = currentLang();
  const entry = lang === 'ar' ? null : ADMIN_DICT[text];
  const out = entry && entry[lang] ? entry[lang] : text;
  return interpolate(out, vars);
}

const escapeHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Variante pour les phrases contenant <strong>{{name}}</strong> : les variables sont échappées,
 * seules les balises <strong> du texte source sont conservées. Retourne un élément React-safe (span).
 */
export function trStrong(text, vars) {
  const safe = {};
  Object.keys(vars || {}).forEach((k) => { safe[k] = escapeHtml(vars[k]); });
  const html = tr(text, safe);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
