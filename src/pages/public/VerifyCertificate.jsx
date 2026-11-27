import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, HelpCircle, X } from 'lucide-react';
import InteriorHeader from '../../components/layout/InteriorHeader';
import InteriorFooter from '../../components/layout/InteriorFooter';
import PageHero from '../../components/layout/PageHero';
import { useNoindex } from '../../hooks/useNoindex';
import { verifyCertificate } from '../../services/supabase/certificateVerify.service';
import { formatCertDate } from '../../utils/certificateRender';
import '../../styles/public-home.css';
import '../../styles/people.css';
import '../../styles/interior-page.css';
import '../../styles/membership-flow.css';
import '../../styles/member-card.css';

// حالة التحقق → صنف CSS الموجود أصلًا لصفحة /verify/ (أخضر / أحمر / كهرماني / محايد) وأيقونة
const LOOK = {
  valid: { cls: 'active', Icon: Check },
  revoked: { cls: 'invalid', Icon: X },
  not_found: { cls: 'inactive', Icon: AlertTriangle },
  problem: { cls: 'problem', Icon: HelpCircle },
};

/**
 * صفحة عامة تفتحها كاميرا الهاتف من QR الشهادة: /verify-certificate/:token (مستقلة عن /verify/:token الخاص ببطاقات الأعضاء).
 * لا تُخزّن الرمز ولا تعرضه ولا تسجّله ولا تضعه في العنوان؛ ولا تستعمل غلاف الصفحات الداخلية (يكتب المسار في canonical/og:url).
 * valid: بيانات الشهادة والاسم حسب وضع الخصوصية. revoked: الرقم والتواريخ فقط. not_found: لا شيء.
 */
export default function VerifyCertificate() {
  const { t, i18n } = useTranslation();
  const { token } = useParams();
  useNoindex();
  const [phase, setPhase] = useState({ kind: 'loading' }); // loading | result | problem
  const [tick, setTick] = useState(0);

  useEffect(() => {
    document.title = `${t('certificateVerify.pageTitle')} — ${t('brand.name')}`;
  }, [t]);

  useEffect(() => {
    let alive = true;
    setPhase({ kind: 'loading' });
    verifyCertificate(token)
      .then((result) => alive && setPhase({ kind: 'result', result }))
      .catch(() => alive && setPhase({ kind: 'problem' })); // شبكة/خادم: ليس حكمًا على الشهادة
    return () => { alive = false; };
  }, [token, tick]);

  const state = phase.kind === 'loading' ? 'loading' : phase.kind === 'problem' ? 'problem' : phase.result.status;
  const r = phase.kind === 'result' ? phase.result : null;
  const look = LOOK[state];
  const date = (v) => formatCertDate(v, i18n.language);
  const row = (label, value) => (value ? <p className="verify-text" key={label}><strong>{label}</strong>{' — '}{value}</p> : null);
  const F = (k) => t(`certificateVerify.fields.${k}`);

  return (
    <>
      <InteriorHeader />
      <PageHero crumbs={[{ label: t('certificateVerify.crumb') }]} title={t('certificateVerify.title')} description={t('certificateVerify.description')} />
      <section className="mf-section">
        <div className="container">
          <div className="verify-card-wrap" aria-live="polite">
            {state === 'loading' && <p className="mf-loading">{t('certificateVerify.loading')}</p>}

            {look && (
              <div className={`verify-card verify-card-${look.cls}`}>
                <p className="verify-banner">
                  <look.Icon size={26} aria-hidden="true" focusable="false" />
                  <span>{t(`certificateVerify.state.${state}.title`)}</span>
                </p>
                <p className="verify-text">{t(`certificateVerify.state.${state}.text`)}</p>

                {state === 'valid' && (
                  <>
                    {row(F('number'), r.certificate_number)}
                    {row(F('type'), r.certificate_type && t(`certificateVerify.types.${r.certificate_type}`, { defaultValue: r.certificate_type }))}
                    {row(F('holder'), r.holder_name || t('certificateVerify.fields.holderHidden'))}
                    {row(F('campaign'), r.campaign_title)}
                    {row(F('activity'), r.activity_title)}
                    {row(F('activityDate'), date(r.activity_date))}
                    {row(F('issuedAt'), date(r.issued_at))}
                  </>
                )}
                {state === 'revoked' && (
                  <>
                    {row(F('number'), r.certificate_number)}
                    {row(F('type'), r.certificate_type && t(`certificateVerify.types.${r.certificate_type}`, { defaultValue: r.certificate_type }))}
                    {row(F('issuedAt'), date(r.issued_at))}
                    {row(F('revokedAt'), date(r.revoked_at))}
                  </>
                )}

                {state === 'problem' && (
                  <div className="member-actions">
                    <button type="button" className="btn btn-gold member-id-btn" onClick={() => setTick((n) => n + 1)}>
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
