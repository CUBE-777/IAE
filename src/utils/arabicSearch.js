export function normalizeSearchValue(value) {
  return String(value == null ? '' : value)
    .toLocaleLowerCase('ar')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesMemberSearch(person, query) {
  if (!query) return true;
  const searchableText = [person.name, person.altName, person.university, person.promo]
    .map(normalizeSearchValue)
    .join(' ');
  return searchableText.includes(query);
}
