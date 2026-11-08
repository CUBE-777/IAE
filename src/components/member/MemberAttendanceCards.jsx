import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Download, Eye, EyeOff, Maximize2, X } from 'lucide-react';
import QrImage from './QrImage';
import { getMyAttendanceCards } from '../../services/supabase/memberSpace.service';
import { attendanceCodeText } from '../../utils/attendanceCode';
import { buildAttendancePdf, pdfFileName, saveBlob } from '../../utils/attendanceCardPdf';
import '../../styles/member-card.css';
import '../../styles/attendance.css';

function Avatar({ member, className }) {
  return (
    <img
      className={className}
      src={member?.photo_url || '/logo.jpg'}
      alt=""
      onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/logo.jpg'; }}
    />
  );
}

/**
 * بطاقات حضور الأنشطة المنشورة (0041): رمز ثابت لكل نشاط يخصّ العضو وحده ولا يصلح لنشاط آخر.
 * النص مبهم (IAE-…): كاميرا الهاتف العادية لا تفتح شيئًا، والمنظِّم يمسحه من داخل الموقع فتظهر له صورتك واسمك.
 * كل بطاقة: صورة العضو واسمه + الرمز (ملء الشاشة) + تنزيل PDF. لا شيء يُخزَّن في المتصفح؛ إن لم يكن هناك نشاط لا يُعرض القسم.
 */
export default function MemberAttendanceCards({ member }) {
  const { t, i18n } = useTranslation();
  const [cards, setCards] = useState(null); // null = تحميل
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(null);   // البطاقة المعروضة بملء الشاشة
  const [busyId, setBusyId] = useState(null);
  const [pdfError, setPdfError] = useState(false);
  const [revealed, setRevealed] = useState({}); // بطاقات الحضور المسجَّل: إظهار الرمز عند الطلب
  const closeRef = useRef(null);

  const load = useCallback(() => {
    setFailed(false);
    getMyAttendanceCards().then(setCards).catch(() => { setCards((c) => c ?? []); setFailed(true); });
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!full) return undefined;
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setFull(null); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [full]);

  if (cards === null || (cards.length === 0 && !failed)) return null;
  const locale = i18n.language === 'ar' ? 'ar-MA' : i18n.language;
  const dateText = (c) => (c.date ? new Date(`${c.date}T12:00:00`).toLocaleDateString(locale) : '');
  const meta = [member?.university, member?.promotion].filter((v) => v && String(v).trim()).join(' · ');

  const download = async (c) => {
    setPdfError(false);
    setBusyId(c.activity_id);
    try {
      const blob = await buildAttendancePdf(
        c,
        { fullName: member?.full_name || '', photoUrl: member?.photo_url || null, meta },
        {
          dir: i18n.dir ? i18n.dir() : (i18n.language === 'ar' ? 'rtl' : 'ltr'),
          lang: i18n.language,
          labels: {
            heading: t('member.id.attendance.pdfHeading'),
            show: t('member.id.attendance.pdfShow'),
            attended: c.attended ? t('member.id.attendance.attended') : '',
            dateText: dateText(c),
            brand: t('brand.name'),
          },
        },
      );
      saveBlob(blob, pdfFileName(c));
    } catch {
      setPdfError(true);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="member-attendance" aria-label={t('member.id.attendance.title')}>
      <h3>{t('member.id.attendance.title')}</h3>
      <p className="mf-hint">{t('member.id.attendance.hint')}</p>
      {failed && (
        <p className="mf-hint" role="alert">
          {t('member.id.attendance.error')}{' '}
          <button type="button" className="member-link-btn" onClick={load}>{t('member.home.retry')}</button>
        </p>
      )}
      {pdfError && <p className="form-alert form-alert-error" role="alert">{t('member.id.attendance.downloadError')}</p>}
      <ul className="member-attendance-list">
        {cards.map((c) => {
          const showCode = !c.attended || revealed[c.activity_id];
          return (
            <li key={c.activity_id} className={`member-attendance-card${c.attended ? ' is-attended' : ''}`}>
              <span className={`att-badge ${c.attended ? 'att-badge-done' : 'att-badge-open'}`}>
                {c.attended ? <Check size={14} aria-hidden="true" focusable="false" /> : null}
                {c.attended ? t('member.id.attendance.attended') : t('member.id.attendance.open')}
              </span>
              <div className="att-person">
                <Avatar member={member} className="att-photo" />
                <div className="att-person-text">
                  <strong>{member?.full_name}</strong>
                  {meta && <span>{meta}</span>}
                </div>
              </div>
              <div className="member-attendance-head">
                <strong>{c.title}</strong>
                {c.date && <span className="mf-hint">{dateText(c)}</span>}
              </div>
              {showCode && (
                <div className="member-qr member-attendance-qr">
                  <QrImage text={attendanceCodeText(c.token)} label={t('member.id.attendance.qrLabel', { title: c.title })} />
                </div>
              )}
              <div className="att-actions-row">
                {showCode && (
                  <button type="button" className="btn btn-ghost att-btn" onClick={() => setFull(c)}>
                    <Maximize2 size={18} aria-hidden="true" focusable="false" /> {t('member.id.fullscreen')}
                  </button>
                )}
                {c.attended && (
                  <button type="button" className="btn btn-ghost att-btn" aria-pressed={!!revealed[c.activity_id]} onClick={() => setRevealed((r) => ({ ...r, [c.activity_id]: !r[c.activity_id] }))}>
                    {revealed[c.activity_id] ? <EyeOff size={18} aria-hidden="true" focusable="false" /> : <Eye size={18} aria-hidden="true" focusable="false" />}
                    {revealed[c.activity_id] ? t('member.id.attendance.hideCode') : t('member.id.attendance.showCode')}
                  </button>
                )}
                <button type="button" className="btn btn-gold att-btn" onClick={() => download(c)} disabled={busyId === c.activity_id}>
                  <Download size={18} aria-hidden="true" focusable="false" /> {busyId === c.activity_id ? t('member.id.attendance.downloading') : t('member.id.attendance.download')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {full && createPortal(
        <div className="member-qr-overlay" role="dialog" aria-modal="true" aria-label={t('member.id.attendance.qrLabel', { title: full.title })}>
          <button type="button" className="member-qr-close btn btn-ghost" ref={closeRef} onClick={() => setFull(null)}>
            <X size={18} aria-hidden="true" focusable="false" /> {t('member.id.close')}
          </button>
          <Avatar member={member} className="att-photo att-photo-lg" />
          <p className="att-full-name">{member?.full_name}</p>
          <p className="att-full-title">{full.title}{full.date ? ` · ${dateText(full)}` : ''}</p>
          <div className="member-qr member-qr-large">
            <QrImage text={attendanceCodeText(full.token)} label={t('member.id.attendance.qrLabel', { title: full.title })} />
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
