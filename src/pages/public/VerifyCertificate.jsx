import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import InteriorHeader from '../../components/layout/InteriorHeader';
import InteriorFooter from '../../components/layout/InteriorFooter';
import PageHero from '../../components/layout/PageHero';
import { useNoindex } from '../../hooks/useNoindex';
import { verifyCertificate } from '../../services/supabase/certificatePublic.service';
import '../../styles/public-home.css';
import '../../styles/interior-page.css';
import '../../styles/membership-flow.css';
import '../../styles/member-card.css';

const ICONS = { valid: CheckCircle2, revoked: XCircle, not_found: AlertTriangle, problem: HelpCircle };

export default function VerifyCertificate() {
  const { t, i18n } = useTranslation();
  const { token } = useParams();
  useNoindex();
  const [phase, setPhase] = useState('loading');
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    document.title = `${t('certificateVerify.pageTitle')} — ${t('brand.name')}`;
  }, [t]);

  useEffect(() => {
    let alive = true;
    setPhase('loading');
    setResult(null);
    verifyCertificate(token)
      .then((data) => {
        if (!alive) return;
        setResult(data);
        setPhase(data.status);
      })
      .catch(() => alive && setPhase('problem'));
    return () => { alive = false; };
  }, [token, retry]);

  const state = ['valid', 'revoked', 'not_found', 'problem'].includes(phase) ? phase : 'loading';
  const Icon = ICONS[state] || HelpCircle;
  const date = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(parsed);
  };

  return (
    <>
      <InteriorHeader />
      <PageHero crumbs={[{ label: t('certificateVerify.crumb') }]} title={t('certificateVerify.title')} description={t('certificateVerify.description')} />
      <section className="mf-section">
        <div className="container">
          <div className="verify-card-wrap" aria-live="polite" aria-busy={state === 'loading'}>
            {state === 'loading' && <p className="mf-loading">{t('certificateVerify.loading')}</p>}
            {state !== 'loading' && (
              <div className={`verify-card verify-card-${state}`}>
                <p className="verify-banner">
                  <Icon size={26} aria-hidden="true" focusable="false" />
                  <span>{t(`certificateVerify.state.${state}.title`)}</span>
                </p>
                <p className="verify-text">{t(`certificateVerify.state.${state}.text`)}</p>

                {state === 'valid' && result && (
                  <dl className="certificate-verify-details">
                    {result.holder_name && <div><dt>{t('certificateVerify.fields.holder')}</dt><dd>{result.holder_name}</dd></div>}
                    {result.certificate_number && <div><dt>{t('certificateVerify.fields.number')}</dt><dd dir="ltr">{result.certificate_number}</dd></div>}
                    {result.campaign_title && <div><dt>{t('certificateVerify.fields.campaign')}</dt><dd>{result.campaign_title}</dd></div>}
                    {result.activity_title && <div><dt>{t('certificateVerify.fields.activity')}</dt><dd>{result.activity_title}</dd></div>}
                    {date(result.activity_date) && <div><dt>{t('certificateVerify.fields.activityDate')}</dt><dd>{date(result.activity_date)}</dd></div>}
                    {date(result.issued_at) && <div><dt>{t('certificateVerify.fields.issuedAt')}</dt><dd>{date(result.issued_at)}</dd></div>}
                  </dl>
                )}
                {state === 'revoked' && result?.certificate_number && (
                  <dl className="certificate-verify-details">
                    <div><dt>{t('certificateVerify.fields.number')}</dt><dd dir="ltr">{result.certificate_number}</dd></div>
                    {date(result.issued_at) && <div><dt>{t('certificateVerify.fields.issuedAt')}</dt><dd>{date(result.issued_at)}</dd></div>}
                    {date(result.revoked_at) && <div><dt>{t('certificateVerify.fields.revokedAt')}</dt><dd>{date(result.revoked_at)}</dd></div>}
                  </dl>
                )}
                {state === 'problem' && (
                  <div className="member-actions">
                    <button type="button" className="btn btn-gold member-id-btn" onClick={() => setRetry((n) => n + 1)}>
                      {t('certificateVerify.retry')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
      <InteriorFooter />
    </>
  );
}
