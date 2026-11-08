import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, HelpCircle, ScanLine, X } from 'lucide-react';
import InteriorHeader from '../../components/layout/InteriorHeader';
import InteriorFooter from '../../components/layout/InteriorFooter';
import PageHero from '../../components/layout/PageHero';
import { useNoindex } from '../../hooks/useNoindex';
import { verifyMemberCard } from '../../services/supabase/memberSpace.service';
import { verifyState } from '../../utils/memberCardToken';
import '../../styles/public-home.css';
import '../../styles/people.css';
import '../../styles/interior-page.css';
import '../../styles/membership-flow.css';
import '../../styles/member-card.css';

const ICONS = { active: Check, inactive: AlertTriangle, unknown: AlertTriangle, invalid: X, problem: HelpCircle };

/**
 * صفحة عامة يفتحها من يمسح رمز العضو بكاميرا هاتفه العادية. لا تعرض الرمز ولا تُخزّنه، ولا تعرض غير الحقول التي
 * تُرجعها verify_member_card (الاسم، الصورة، الجامعة، الفوج، الشعبة، الموسم، حالة الانخراط).
 * لا نستعمل غلاف الصفحات الداخلية المعتاد عمدًا (الترويسة والتذييل مباشرة): غلافه يكتب مسار الصفحة، وفيه الرمز، في canonical وog:url.
 */
export default function VerifyCard() {
  const { t } = useTranslation();
  const { token } = useParams();
  useNoindex();
  const [phase, setPhase] = useState({ kind: 'loading' }); // loading | result | problem
  const [tick, setTick] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    document.title = `${t('verify.pageTitle')} — ${t('brand.name')}`;
  }, [t]);

  useEffect(() => {
    let alive = true;
    setPhase({ kind: 'loading' });
    verifyMemberCard(token)
      .then((result) => alive && setPhase({ kind: 'result', result }))
      .catch(() => alive && setPhase({ kind: 'problem' })); // شبكة أو rate_limited: ليس حكمًا على الرمز
    return () => { alive = false; };
  }, [token, tick]);

  let state = 'loading';
  let result = null;
  if (phase.kind === 'result') { result = phase.result; state = verifyState(result); }
  else if (phase.kind === 'problem') state = 'problem';

  const Icon = ICONS[state];
  const person = state === 'active' || state === 'inactive' || state === 'unknown' ? result : null;
  const meta = person ? [person.university, person.promotion].filter((v) => v && String(v).trim()).join(' · ') : '';
  const season = person?.membership?.season;

  return (
    <>
      <InteriorHeader />
      <PageHero crumbs={[{ label: t('verify.crumb') }]} title={t('verify.title')} description={t('verify.description')} />
      <section className="mf-section">
        <div className="container">
          <div className="verify-card-wrap" aria-live="polite">
            {state === 'loading' && <p className="mf-loading">{t('verify.loading')}</p>}

            {state !== 'loading' && (
              <div className={`verify-card verify-card-${state}`}>
                <p className="verify-banner">
                  <Icon size={26} aria-hidden="true" focusable="false" />
                  <span>{t(`verify.state.${state}.title`, { season })}</span>
                </p>

                {person && (
                  <div className="verify-person">
                    <img
                      className="verify-avatar"
                      src={person.photo_url || '/logo.jpg'}
                      alt={t('a11y.personPhotoAlt', { name: person.full_name })}
                      onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/logo.jpg'; }}
                    />
                    <div>
                      <h2>{person.full_name}</h2>
                      {meta && <p className="mf-hint">{meta}</p>}
                      {person.track && String(person.track).trim() && <p className="mf-hint">{person.track}</p>}
                    </div>
                  </div>
                )}

                <p className="verify-text">{t(`verify.state.${state}.text`, { season })}</p>

                {state === 'problem' && (
                  <div className="member-actions">
                    <button type="button" className="btn btn-gold member-id-btn" onClick={() => setTick((n) => n + 1)}>
                      {t('verify.retry')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {state !== 'loading' && (
              <div className="verify-another">
                <button
                  type="button"
                  className="btn btn-ghost member-id-btn"
                  aria-expanded={showHelp}
                  aria-controls="verify-scan-help"
                  onClick={() => setShowHelp((v) => !v)}
                >
                  <ScanLine size={18} aria-hidden="true" focusable="false" /> {t('verify.scanAnother')}
                </button>
                {showHelp && <p id="verify-scan-help" className="mf-hint verify-help">{t('verify.scanHelp')}</p>}
              </div>
            )}
          </div>
        </div>
      </section>
      <InteriorFooter />
    </>
  );
}
