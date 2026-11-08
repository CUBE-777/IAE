import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import QrImage from './QrImage';
import { getMyAttendanceCards } from '../../services/supabase/memberSpace.service';
import { attendanceCodeText } from '../../utils/attendanceCode';
import '../../styles/member-card.css';
import '../../styles/attendance.css';

/**
 * بطاقات حضور الأنشطة المنشورة (0041): رمز ثابت لكل نشاط يخصّ العضو وحده ولا يصلح لنشاط آخر.
 * النص مبهم (IAE-…): كاميرا الهاتف العادية لا تفتح شيئًا، والمنظِّم يمسحه من داخل الموقع فتظهر له صورتك واسمك.
 * لا شيء يُخزَّن في المتصفح؛ إن لم يكن هناك نشاط منشور البطاقة لا يُعرض القسم أصلًا.
 */
export default function MemberAttendanceCards() {
  const { t, i18n } = useTranslation();
  const [cards, setCards] = useState(null); // null = تحميل
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getMyAttendanceCards().then(setCards).catch(() => { setCards((c) => c ?? []); setFailed(true); });
  }, []);
  useEffect(load, [load]);

  if (cards === null || (cards.length === 0 && !failed)) return null;
  const locale = i18n.language === 'ar' ? 'ar-MA' : i18n.language;

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
      <ul className="member-attendance-list">
        {cards.map((c) => (
          <li key={c.activity_id} className="member-attendance-card">
            <div className="member-attendance-head">
              <strong>{c.title}</strong>
              {c.date && <span className="mf-hint">{new Date(`${c.date}T12:00:00`).toLocaleDateString(locale)}</span>}
            </div>
            <div className="member-qr member-attendance-qr">
              <QrImage text={attendanceCodeText(c.token)} label={t('member.id.attendance.qrLabel', { title: c.title })} />
            </div>
            {c.attended && (
              <p className="member-membership member-membership-active">
                <Check size={18} aria-hidden="true" focusable="false" />
                <span>{t('member.id.attendance.attended')}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
