/**
 * src/utils/internalFiles.js
 * Règles des fichiers internes (miroir des contraintes SQL de 0017 et des limites du bucket).
 */

export const INTERNAL_FILE_MAX_BYTES = 20 * 1024 * 1024; // 20 Mo

// [valeur en base, texte arabe source (traduit via tr())]
export const INTERNAL_FILE_CATEGORIES = [
  ['administrative', 'إدارية'],
  ['minutes', 'محاضر الاجتماعات'],
  ['educational', 'تعليمية'],
  ['templates', 'نماذج'],
  ['other', 'أخرى'],
];

// Le type est déduit de l'extension (les navigateurs en rapportent parfois de variables, ex. zip/csv sous Windows).
const EXT_MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  zip: 'application/zip',
};

export const INTERNAL_FILE_ACCEPT = Object.keys(EXT_MIME).map((e) => `.${e}`).join(',');

export function fileExtension(name) {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** Type MIME autorisé d'après l'extension, ou null si le format n'est pas accepté. */
export function internalFileMime(name) {
  return EXT_MIME[fileExtension(name)] || null;
}

/** Nom de stockage sûr : a-z, 0-9, point, tiret, souligné ; 120 caractères max, extension conservée. */
export function safeStorageName(name, max = 120) {
  const ext = fileExtension(name);
  let base = String(name || '')
    .replace(/\.[^.]*$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  if (!base) base = 'file';
  const suffix = ext ? `.${ext}` : '';
  return `${base.slice(0, Math.max(1, max - suffix.length))}${suffix}`;
}

/** Retourne { ok: true, mime } ou { ok: false, reason: 'empty' | 'type' | 'size' }. */
export function validateInternalFile(file) {
  if (!file || !file.size) return { ok: false, reason: 'empty' };
  const mime = internalFileMime(file.name);
  if (!mime) return { ok: false, reason: 'type' };
  if (file.size > INTERNAL_FILE_MAX_BYTES) return { ok: false, reason: 'size' };
  return { ok: true, mime };
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
