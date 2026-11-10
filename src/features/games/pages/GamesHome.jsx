import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Gamepad2 } from 'lucide-react';

/** الصفحة الرئيسية المؤقتة (المرحلة 1): الاسم وتصميم أولي فقط. لا ألعاب بعد. */
export default function GamesHome() {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = `${t('games.pageTitle')} — ${t('brand.name')}`;
  }, [t]);

  return (
    <section className="games-hero" aria-labelledby="games-title">
      <span className="games-hero-icon"><Gamepad2 size={40} aria-hidden="true" /></span>
      <h1 id="games-title">{t('games.brand')}</h1>
      <p>{t('games.home.tagline')}</p>
    </section>
  );
}
