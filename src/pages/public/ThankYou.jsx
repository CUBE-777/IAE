import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../../styles/thank-you.css';

export default function ThankYou() {
  const { t } = useTranslation();

  return (
    <div className="thank-you-box-wrap">
      <div className="box">
        <div className="icon">✓</div>
        <h1>{t('thankYou.title')}</h1>
        <p>{t('thankYou.message')}</p>
        <Link to="/">{t('thankYou.backHome')}</Link>
      </div>
    </div>
  );
}
