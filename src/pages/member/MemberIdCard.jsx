import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Maximize2, RefreshCw, X } from 'lucide-react';
import MemberPage from '../../components/member/MemberPage';
import MembershipBadge from '../../components/member/MembershipBadge';
import { useMemberCardToken } from '../../hooks/useMemberCardToken';
import { useMyMembershipStatus } from '../../hooks/useMyMembershipStatus';
import QrImage from '../../components/member/QrImage';
import MemberAttendanceCards from '../../components/member/MemberAttendanceCards';
import { verifyUrl } from '../../utils/memberCardToken';
import { scrollBehavior } from '../../utils/motion';
import '../../styles/member-card.css';

export default function MemberIdCard() {
  const { t, i18n } = useTranslation();
  const { member } = useOutletContext();
  const { token, secondsLeft, loading, problem, refresh } = useMemberCardToken();
  const { status, failed, reload } = useMyMembershipStatus();
  const [full, setFull] = useState(false);
  const openerRef = useRef(null);
  const closeRef = useRef(null);
  const overlayRef = useRef(null);
  const cardRef = useRef(null);

  const url = token ? verifyUrl(window.location.origin, token) : null;
  const qrLabel = t('member.id.qrLabel');
  const meta = [member.university, member.promotion].filter((v) => v && String(v).trim()).join(' · ');

  // ملء الشاشة: طبقة داخل الصفحة (تعمل على iOS أيضًا) مع محاولة Fullscreen API دون الاعتماد عليها
  useEffect(() => {
    if (!full) return undefined;
    const overlay = overlayRef.current;
    const opener = openerRef.current;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    try {
      overlay?.requestFullscreen?.()?.catch?.(() => {});
    } catch {
      /* غير مدعوم */
    }
    const onKey = (e) => { if (e.key === 'Escape') setFull(false); };
    const onFsChange = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.body.style.overflow = prevOverflow;
      if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
      opener?.focus({ preventScroll: true });
      cardRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    };
  }, [full]);

  // رسالة الحالة لقارئ الشاشة (polite): لا نُعلن العدّ التنازلي كل ثانية
  let statusText = '';
  if (!token && problem === 'forbidden') statusText = t('member.id.problem.forbidden');
  else if (!token && problem === 'rate_limited') statusText = t('member.id.problem.rateLimited');
  else if (!token && problem) statusText = t('member.id.problem.network');
  else if (!token && loading) statusText = t('member.id.status.loading');
  else if (token && problem === 'rate_limited') statusText = t('member.id.problem.rateLimitedKeep');
  else if (token && problem) statusText = t('member.id.problem.networkKeep');
  else if (token) statusText = t('member.id.status.ready');

  const showRetry = !token && problem !== 'forbidden';

  const qrBlock = (large) => (
    <div className={large ? 'member-qr member-qr-large' : 'member-qr'}>
      {url ? <QrImage text={url} label={qrLabel} /> : (
        <div className="member-qr-empty">{loading ? t('member.id.status.loading') : t('member.id.noCode')}</div>
      )}
    </div>
  );

  return (
    <MemberPage titleKey="member.id.title" descriptionKey="member.id.description" pageTitleKey="member.id.pageTitle">
      <div className="mf-form member-id">
        <header className="member-profile-head">
          <img
            className="member-avatar"
            src={member.photo_url || '/logo.jpg'}
            alt={t('a11y.personPhotoAlt', { name: member.full_name })}
            onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/logo.jpg'; }}
          />
          <div className="member-profile-meta">
            <h2>{member.full_name}</h2>
            {meta && <p className="mf-hint">{meta}</p>}
          </div>
        </header>

        <MembershipBadge status={status} failed={failed} onRetry={reload} />
        {status?.active && status.paid_at && (
          <p className="mf-hint">{t('member.id.paidAt', { date: new Date(status.paid_at).toLocaleDateString(i18n.language === 'ar' ? 'ar-MA' : i18n.language) })}</p>
        )}

        <section ref={cardRef} className="member-id-card" aria-label={t('member.id.sectionLabel')}>
          {qrBlock(false)}
          {token && (
            <p className="member-id-countdown">{t('member.id.expiresIn', { seconds: secondsLeft })}</p>
          )}
          <p className="member-id-live mf-hint" role="status" aria-live="polite">{statusText}</p>
          <div className="member-actions member-id-actions">
            <button type="button" className="btn btn-gold member-id-btn" onClick={refresh} disabled={loading}>
              <RefreshCw size={18} aria-hidden="true" focusable="false" /> {t('member.id.refresh')}
            </button>
            <button
              type="button"
              className="btn btn-ghost member-id-btn"
              ref={openerRef}
              onClick={() => setFull(true)}
              disabled={!token}
            >
              <Maximize2 size={18} aria-hidden="true" focusable="false" /> {t('member.id.fullscreen')}
            </button>
            {showRetry && !loading && (
              <span className="mf-hint">{t('member.id.retryHint')}</span>
            )}
          </div>
          <p className="mf-hint">{t('member.id.howTo')}</p>
          <p className="mf-hint">{t('member.id.privacy')}</p>
        </section>

        <MemberAttendanceCards />

        {full && createPortal(
          <div
            ref={overlayRef}
            className="member-qr-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t('member.id.fullscreenLabel')}
          >
            <button type="button" className="member-qr-close btn btn-ghost" ref={closeRef} onClick={() => setFull(false)}>
              <X size={18} aria-hidden="true" focusable="false" /> {t('member.id.close')}
            </button>
            {qrBlock(true)}
            {token && <p className="member-id-countdown">{t('member.id.expiresIn', { seconds: secondsLeft })}</p>}
            {!token && statusText && <p className="member-id-countdown">{statusText}</p>}
          </div>,
          document.body,
        )}
      </div>
    </MemberPage>
  );
}
