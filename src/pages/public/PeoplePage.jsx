import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import InteriorLayout from '../../layouts/InteriorLayout';
import PageHero from '../../components/layout/PageHero';
import PersonCard from '../../components/common/PersonCard';
import PersonModal from '../../components/common/PersonModal';
import { fetchPeopleDirectory } from '../../services/supabase/peopleDirectory.service';
import { normalizeSearchValue, matchesMemberSearch } from '../../utils/arabicSearch';
import { localizePerson } from '../../utils/personTranslations';

/**
 * صفحة موحّدة تُستخدم لكل من /members و/board — تطابق تمامًا العلاقة بين
 * members.html و board.html الأصليين، اللذين كانا نسخة طبق الأصل من بعضهما
 * البعض (نفس البنية والـ CSS) مع تغيير القيم فقط عبر `options` في js/members.js.
 */
export default function PeoplePage({
  listKey,
  title,
  description,
  crumbLabel,
  countLabel,
  fallbackBadge,
  emptyText,
  switchHref,
  switchLabel,
  searchPlaceholder,
}) {
  const isBoard = listKey === 'board';
  const { t, i18n } = useTranslation();
  const lang = String(i18n.resolvedLanguage || i18n.language || 'ar').slice(0, 2);
  const [people, setPeople] = useState(null); // null = يحمَّل
  const [query, setQuery] = useState('');
  const [error, setError] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null); // مفتاح العضو المعروض ملفه (نشتق الكائن من القائمة ليتبع لغة الزائر)

  const load = useCallback(() => {
    let alive = true;
    setError(false);
    setPeople(null);
    fetchPeopleDirectory(listKey)
      .then((data) => alive && setPeople(data))
      .catch((err) => {
        console.error('تعذر تحميل البيانات من Supabase:', err);
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [listKey]);

  useEffect(() => load(), [load]);

  // عرض الأشخاص بلغة الزائر (الاسم اللاتيني، المنصب، النبذة...) مع رجوع تلقائي للعربية عند غياب الترجمة
  const localized = useMemo(
    () => (people ? people.map((p, i) => ({ ...localizePerson(p, lang), _key: p.id ?? `${p.name}-${i}` })) : null),
    [people, lang]
  );

  const filtered = useMemo(() => {
    if (!localized) return [];
    const normalizedQuery = normalizeSearchValue(query);
    return localized.filter((p) => matchesMemberSearch(p, normalizedQuery));
  }, [localized, query]);

  const selected = useMemo(
    () => (selectedKey == null || !localized ? null : localized.find((p) => p._key === selectedKey) || null),
    [localized, selectedKey]
  );

  useEffect(() => {
    document.title = `${title} — ${t('brand.name')}`;
  }, [title, t]);

  return (
    <InteriorLayout>
      <PageHero crumbs={[{ label: t('nav.members'), href: '/#members' }, { label: crumbLabel }]} title={title} description={description} />
      <section className="people-page">
        <div className="container">
          <div className="people-toolbar" role="search">
            <label className="sr-only" htmlFor="peopleSearch">
              {searchPlaceholder}
            </label>
            <input
              className="people-search"
              id="peopleSearch"
              type="search"
              placeholder={searchPlaceholder}
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!people || !people.length}
            />
            <span className="people-count" aria-live="polite">
              {people && people.length > 0
                ? query
                  ? t('peoplePage.resultsCount', { count: filtered.length, total: people.length })
                  : `${people.length} ${countLabel}`
                : ''}
            </span>
          </div>

          <div className={isBoard ? 'board-grid' : 'members-grid'} id="peopleGrid">
            {people === null && !error && <div className="gallery-empty" role="status">{t('peoplePage.loading')}</div>}
            {error && (
              <div className="gallery-empty" role="alert">
                <p>{t('common.loadError')}</p>
                <button type="button" className="interior-btn people-retry" onClick={load}>{t('common.retry')}</button>
              </div>
            )}
            {people && people.length === 0 && <div className="gallery-empty">{emptyText}</div>}
            {people && people.length > 0 && filtered.length === 0 && (
              <div className="gallery-empty">{t('peoplePage.noResults')}</div>
            )}
            {filtered.map((person, i) => (
              <PersonCard
                key={person._key}
                person={person}
                fallbackBadge={fallbackBadge}
                variant={isBoard ? 'board' : 'member'}
                featured={isBoard && i === 0 && !query}
                onOpen={isBoard ? undefined : (p) => setSelectedKey(p._key)}
              />
            ))}
          </div>

          <div className="people-switch">
            <a href={switchHref} className="interior-btn">
              {switchLabel}
            </a>
          </div>
        </div>
      </section>
      {selected && <PersonModal person={selected} fallbackBadge={fallbackBadge} onClose={() => setSelectedKey(null)} />}
    </InteriorLayout>
  );
}
