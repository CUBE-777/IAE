/**
 * Prépare un lien WhatsApp (wa.me) à partir d'un numéro saisi librement.
 * Hypothèse : numéros marocains saisis en format local (06…, 07…) → préfixe 212.
 * Les numéros déjà internationaux (+…, 00…) sont conservés.
 */
export function normalizeWhatsappNumber(raw) {
  const original = String(raw || '').trim();
  let digits = original.replace(/[^\d]/g, '');
  if (!digits) return '';
  if (original.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) return `212${digits.slice(1)}`;
  return digits;
}

export function buildWhatsappLink(phone, message) {
  const number = normalizeWhatsappNumber(phone);
  const text = encodeURIComponent(message || '');
  return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
}
