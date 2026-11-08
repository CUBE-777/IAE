import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../../components/admin/Modal';
import AttendanceScanner, { scannerSupported } from './AttendanceScanner';
import {
  publishAttendanceCard, closeAttendanceCard, recordAttendance, recordAttendanceManual, undoAttendance, getAttendanceRoster,
} from '../../services/supabase/adminAttendance.service';
import { tr, trStrong, dateLocale } from '../../i18n/adminDict';
import '../../styles/attendance.css';

const RESULT_TEXT = {
  recorded: 'تم تسجيل الحضور',
  already: 'مسجّل مسبقًا',
  invalid: 'رمز غير صالح لهذا النشاط',
};

/**
 * بطاقة حضور نشاط (0041): نشرها، مسح رموز الأعضاء من داخل الموقع، تسجيل يدوي من القائمة (احتياط حين لا تعمل الكاميرا)،
 * إغلاقها أو إعادة إصدار الرموز. المسح الثاني لعضو سُجِّل حضوره يُظهر «مسجّل مسبقًا» ووقت التسجيل.
 * الرمز المقروء يخصّ النشاط المنشور لأي نشاط؛ إن مُسح رمز نشاط آخر تُرجع القاعدة نتيجة باسم ذلك النشاط ونعرضه.
 */
export default function ActivityAttendanceModal({ activity, onClose, onChanged }) {
  const [roster, setRoster] = useState(undefined); // undefined = تحميل، null = لم تُنشر
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [query, setQuery] = useState('');
  const scanBusy = useRef(false);
  const clearTimer = useRef(null);

  const load = useCallback(() => {
    setError(false);
    return getAttendanceRoster(activity.id)
      .then(setRoster)
      .catch((err) => { console.error('attendance roster failed', err); setError(true); setRoster(null); });
  }, [activity.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => clearTimeout(clearTimer.current), []);

  const showResult = useCallback((r) => {
    setResult(r);
    clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setResult(null), 5000);
  }, []);

  const publish = async (rotate = false) => {
    setBusy(true);
    try {
      await publishAttendanceCard(activity.id, rotate);
      window.notify?.success(tr(rotate ? 'أُعيد إصدار الرموز' : 'نُشرت بطاقة الحضور'));
      await load();
      onChanged?.();
    } catch (err) {
      window.notify?.fromError(err, tr('تعذّر نشر بطاقة الحضور'));
    } finally { setBusy(false); }
  };

  const close = async () => {
    if (!window.confirm(tr('إغلاق البطاقة يمنع تسجيل أي حضور جديد بها. متابعة؟'))) return;
    setBusy(true);
    try {
      await closeAttendanceCard(activity.id);
      await load();
      onChanged?.();
    } catch (err) {
      window.notify?.fromError(err, tr('تعذّر إغلاق البطاقة'));
    } finally { setBusy(false); }
  };

  const rotate = () => {
    if (!window.confirm(tr('ستتغيّر رموز كل الأعضاء وتبطل الرموز السابقة (للحالات التي يتسرّب فيها رمز). متابعة؟'))) return;
    publish(true);
  };

  const onCode = useCallback(async (token) => {
    if (scanBusy.current) return;
    scanBusy.current = true;
    try {
      const r = await recordAttendance(token);
      showResult(r);
      if (r.result !== 'invalid') { await load(); onChanged?.(); }
    } catch (err) {
      window.notify?.fromError(err, /rate_limited/.test(err?.message || '') ? tr('محاولات كثيرة، انتظر قليلًا') : tr('تعذّر تسجيل الحضور'));
    } finally { scanBusy.current = false; }
  }, [load, onChanged, showResult]);

  const manual = async (m) => {
    setBusy(true);
    try {
      if (m.attended_at) {
        if (!window.confirm(tr('إلغاء تسجيل حضور هذا العضو؟'))) return;
        await undoAttendance(activity.id, m.member_id);
      } else {
        const r = await recordAttendanceManual(activity.id, m.member_id);
        if (r.result === 'invalid') window.notify?.error(tr('البطاقة مغلقة أو العضو غير نشط'));
      }
      await load();
      onChanged?.();
    } catch (err) {
      window.notify?.fromError(err, tr('تعذّر التحديث'));
    } finally { setBusy(false); }
  };

  const members = roster?.members || [];
  const attended = members.filter((m) => m.attended_at).length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? members.filter((m) => String(m.full_name || '').toLowerCase().includes(q)) : members;
  }, [members, query]);
  const fmt = (iso) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });

  return (
    <Modal onClose={onClose} wide>
      <h3>{tr('بطاقة الحضور')}</h3>
      <div className="att-modal">
        <p>{trStrong('النشاط: <strong>{{name}}</strong>', { name: activity.title })}</p>

        {roster === undefined && <p>{tr('جاري التحميل...')}</p>}
        {error && <p role="alert">{tr('تعذّر تحميل بيانات الحضور.')}</p>}

        {roster === null && !error && (
          <>
            <p>{tr('لم تُنشر بطاقة الحضور لهذا النشاط بعد. عند النشر يرى كل عضو نشط رمزه الخاص بهذا النشاط وحده في صفحة بطاقته.')}</p>
            <div className="att-actions">
              <button type="button" className="admin-btn admin-btn-primary" disabled={busy} onClick={() => publish(false)}>{tr('نشر بطاقة الحضور')}</button>
            </div>
          </>
        )}

        {roster && (
          <>
            <p className="att-counter" role="status">{tr('الحضور: {{n}} من {{total}}', { n: attended, total: members.length })}</p>

            {roster.open ? (
              <>
                {scannerSupported() ? (
                  <AttendanceScanner onCode={onCode} />
                ) : (
                  <p>{tr('هذا المتصفح لا يدعم المسح بالكاميرا (يعمل في Chrome على أندرويد). استعمل القائمة أدناه لتسجيل الحضور.')}</p>
                )}
                {result && (
                  <div className={`att-result att-result-${result.result}`} role="status">
                    {result.member?.photo_url && <img src={result.member.photo_url} alt="" />}
                    <div>
                      {result.member && <div>{result.member.full_name}</div>}
                      {result.member && <div>{[result.member.university, result.member.promotion].filter(Boolean).join(' · ')}</div>}
                      <div>
                        {tr(RESULT_TEXT[result.result] || RESULT_TEXT.invalid)}
                        {result.result === 'already' && result.checked_in_at ? ` — ${fmt(result.checked_in_at)}` : ''}
                      </div>
                    </div>
                  </div>
                )}
                <div className="att-actions">
                  <button type="button" className="admin-btn admin-btn-ghost" disabled={busy} onClick={rotate}>{tr('إعادة إصدار الرموز')}</button>
                  <button type="button" className="admin-btn admin-btn-danger" disabled={busy} onClick={close}>{tr('إغلاق البطاقة')}</button>
                </div>
              </>
            ) : (
              <div className="att-actions">
                <p>{tr('البطاقة مغلقة أو منتهية.')}</p>
                <button type="button" className="admin-btn admin-btn-primary" disabled={busy} onClick={() => publish(false)}>{tr('إعادة نشر البطاقة (رموز جديدة)')}</button>
              </div>
            )}

            <input
              className="admin-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr('بحث بالاسم...')}
              aria-label={tr('بحث بالاسم...')}
            />
            <ul className="att-roster">
              {shown.map((m) => (
                <li key={m.member_id} className={m.attended_at ? 'is-in' : ''}>
                  <span className="att-name">{m.full_name}{m.attended_at ? ` — ${fmt(m.attended_at)}` : ''}</span>
                  {(roster.open || m.attended_at) && (
                    <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => manual(m)}>
                      {m.attended_at ? tr('إلغاء الحضور') : tr('تسجيل يدوي')}
                    </button>
                  )}
                </li>
              ))}
              {shown.length === 0 && <li>{tr('لا نتائج.')}</li>}
            </ul>
          </>
        )}

        <div className="admin-modal-actions">
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{tr('إغلاق')}</button>
        </div>
      </div>
    </Modal>
  );
}
