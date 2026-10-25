import { useTranslation } from 'react-i18next';
import '../../styles/privacy.css';
import PageHero from '../../components/layout/PageHero';
import InteriorLayout from '../../layouts/InteriorLayout';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

/**
 * src/pages/public/Privacy.jsx — سياسة الخصوصية (ar/fr/en من ملفات الترجمة: privacy.*).
 * النص قالب أولي: يجب أن يراجعه مسؤولو النادي ويعدّلوه ليطابق الممارسة الفعلية قبل اعتماده نهائيًا.
 */
export default function Privacy() {
  const { t } = useTranslation();
  const sections = t('privacy.sections', { returnObjects: true });
  useDocumentMeta(t('privacy.metaTitle'), t('privacy.description'));

  return (
    <InteriorLayout>
      <PageHero crumbs={[{ label: t('privacy.crumb') }]} title={t('privacy.title')} description={t('privacy.description')} />
      <section className="privacy-section">
        <div className="container privacy-content">
          <p className="privacy-updated">{t('privacy.updated')}</p>
          {Array.isArray(sections) &&
            sections.map((s) => (
              <div className="privacy-block" key={s.title}>
                <h2>{s.title}</h2>
                <p>{s.body}</p>
              </div>
            ))}
        </div>
      </section>
    </InteriorLayout>
  );
}
