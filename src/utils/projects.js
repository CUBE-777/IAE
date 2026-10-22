/**
 * src/utils/projects.js
 * Utilitaires purs (sans dépendance) pour les projets du club.
 */

export const PROJECT_STATUSES = ['in_progress', 'completed'];
export const MAX_TECHNOLOGIES = 20;
export const MAX_TECHNOLOGY_LEN = 40;

/** Texte saisi « Python, ESP32, TensorFlow Lite » → tableau nettoyé, sans doublon (insensible à la casse). */
export function parseTechnologies(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[,،;\n]+/);
  const seen = new Set();
  const out = [];
  raw.forEach((item) => {
    const t = String(item || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TECHNOLOGY_LEN);
    const key = t.toLowerCase();
    if (t && !seen.has(key) && out.length < MAX_TECHNOLOGIES) {
      seen.add(key);
      out.push(t);
    }
  });
  return out;
}

/**
 * Slug propre (a-z, 0-9, tirets) : accents latins retirés ; un titre arabe donne « projet ».
 * Un suffixe unique est ajouté pour éviter toute collision.
 */
export function slugifyProject(title, suffix = Date.now().toString(36)) {
  const base = String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return `${base || 'projet'}-${suffix}`;
}

/** URL https uniquement (même règle que les contraintes SQL) ; '' si invalide. */
export function httpsUrlOrEmpty(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

export const isHttpsUrl = (value) => httpsUrlOrEmpty(value) !== '';
