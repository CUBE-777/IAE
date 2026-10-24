import { useTranslation } from 'react-i18next';

const BTN = {
  display: 'inline-block',
  padding: '10px 20px',
  borderRadius: 10,
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
};

/**
 * شاشة خطأ عامة (بدل شاشة بيضاء أو صفحة خطأ React Router الافتراضية بالإنجليزية).
 * تُستعمل من RouteError (أخطاء العرض داخل المسارات) ومن AppErrorBoundary (أي خطأ خارج الراوتر).
 */
export default function ErrorScreen() {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 24,
        background: 'var(--bg, transparent)',
        color: 'var(--text, inherit)',
        fontFamily: 'var(--font-body, inherit)',
      }}
    >
      <div style={{ maxWidth: 480 }}>
        <h1 style={{ marginBottom: 12 }}>{t('app.error.title')}</h1>
        <p style={{ marginBottom: 20, opacity: 0.8 }}>{t('app.error.message')}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={BTN} onClick={() => window.location.reload()}>
            {t('app.error.reload')}
          </button>
          <a href="/" style={BTN}>
            {t('app.error.home')}
          </a>
        </div>
      </div>
    </div>
  );
}
