import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MemberPage from '../../components/member/MemberPage';
import FormField from '../../components/common/FormField';
import { changeMyPassword, signOutOtherSessions } from '../../services/supabase/memberSpace.service';
import { MIN_LEN, MAX_LEN, STRENGTH_KEYS, passwordStrength } from '../../utils/passwordStrength';

/**
 * أمان الحساب: تغيير كلمة المرور (بعد إعادة التحقق من الحالية) وإنهاء الجلسات على الأجهزة الأخرى.
 * لا مصادقة ثنائية هنا عمدًا: دوال العضو في القاعدة لا تفحص مستوى aal، فتفعيلها من الواجهة لن يُفرض في الخادم.
 */
export default function MemberSecurity() {
  const { t } = useTranslation();
  const { member } = useOutletContext();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [endOthers, setEndOthers] = useState(true);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState(null); // { kind: 'ok' | 'error', text }
  const [busy, setBusy] = useState(false);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const msgRef = useRef(null);

  // الرسالة أعلى الصفحة وأزرار الحفظ أسفلها: نمرّر إليها وننقل التركيز لتصل لقارئ الشاشة
  useEffect(() => {
    if (!msg || !msgRef.current) return;
    msgRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    msgRef.current.focus({ preventScroll: true });
  }, [msg]);

  const strength = passwordStrength(next);
  const type = show ? 'text' : 'password';

  const submit = async (e) => {
    e.preventDefault();
    setMsg(null);
    const errs = {};
    if (!current) errs.current = 'member.security.password.currentRequired';
    if (next.length < MIN_LEN) errs.next = 'member.activate.tooShort';
    else if (next.length > MAX_LEN) errs.next = 'member.activate.tooLong';
    else if (next === current) errs.next = 'member.security.password.same';
    if (!errs.next && confirm !== next) errs.confirm = 'member.activate.mismatch';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const { othersEnded } = await changeMyPassword(current, next, { endOthers });
      setCurrent('');
      setNext('');
      setConfirm('');
      setMsg({ kind: 'ok', text: t(endOthers && othersEnded ? 'member.security.password.savedOthers' : 'member.security.password.saved') });
    } catch (err) {
      console.error('change password failed', err);
      if (err?.code === 'WRONG_CURRENT') setErrors({ current: 'member.security.password.wrongCurrent' });
      else if (err?.code === 'SAME') setErrors({ next: 'member.security.password.same' });
      else if (!navigator.onLine || /network|fetch/i.test(err?.message || '')) setMsg({ kind: 'error', text: t('forms.networkError') });
      else setMsg({ kind: 'error', text: t('member.security.password.error') });
    } finally {
      setBusy(false);
    }
  };

  const endSessions = async () => {
    setMsg(null);
    setSessionsBusy(true);
    const ok = await signOutOtherSessions();
    setMsg(ok ? { kind: 'ok', text: t('member.security.sessions.done') } : { kind: 'error', text: t('member.security.sessions.error') });
    setSessionsBusy(false);
  };

  return (
    <MemberPage titleKey="member.security.title" descriptionKey="member.security.description" pageTitleKey="member.security.pageTitle">
      <div className="mf-form">
        {msg && <div ref={msgRef} tabIndex={-1} className={`form-alert ${msg.kind === 'ok' ? 'form-alert-success' : 'form-alert-error'}`} role={msg.kind === 'ok' ? 'status' : 'alert'}>{msg.text}</div>}

        <fieldset className="mf-group">
          <legend>{t('member.security.accountTitle')}</legend>
          <dl className="member-grid">
            <div><dt>{t('member.security.email')}</dt><dd dir="ltr">{member.email || '—'}</dd></div>
          </dl>
        </fieldset>

        <form onSubmit={submit} noValidate aria-busy={busy}>
          <fieldset className="mf-group">
            <legend>{t('member.security.password.title')}</legend>
            <p className="mf-hint">{t('member.security.password.text')}</p>
            <FormField id="ms-current" label={t('member.security.password.current')} required error={errors.current}>
              {(a) => <input {...a} type={type} dir="ltr" autoComplete="current-password" maxLength={MAX_LEN} value={current} onChange={(e) => setCurrent(e.target.value)} />}
            </FormField>
            <FormField id="ms-new" label={t('member.security.password.new')} required error={errors.next}>
              {(a) => <input {...a} type={type} dir="ltr" autoComplete="new-password" maxLength={MAX_LEN} value={next} onChange={(e) => setNext(e.target.value)} />}
            </FormField>
            <p className="mf-hint">{t('member.activate.hint')}</p>
            {strength && (
              <p className={`mf-hint member-strength member-strength-${strength}`} role="status">
                {t('member.activate.strengthLabel', { level: t(STRENGTH_KEYS[strength]) })}
              </p>
            )}
            <FormField id="ms-confirm" label={t('member.security.password.confirm')} required error={errors.confirm}>
              {(a) => <input {...a} type={type} dir="ltr" autoComplete="new-password" maxLength={MAX_LEN} value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
            </FormField>
            <label className="mf-hint member-show-pw">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {t('member.activate.show')}
            </label>
            <label className="mf-hint member-show-pw">
              <input type="checkbox" checked={endOthers} onChange={(e) => setEndOthers(e.target.checked)} /> {t('member.security.password.endOthers')}
            </label>
            <div className="member-actions">
              <button type="submit" className="btn btn-gold" disabled={busy}>
                {busy ? t('member.security.password.submitting') : t('member.security.password.submit')}
              </button>
            </div>
          </fieldset>
        </form>

        <fieldset className="mf-group">
          <legend>{t('member.security.sessions.title')}</legend>
          <p className="mf-hint">{t('member.security.sessions.text')}</p>
          <div className="member-actions">
            <button type="button" className="btn btn-ghost" onClick={endSessions} disabled={sessionsBusy || busy}>
              {sessionsBusy ? t('member.security.sessions.busy') : t('member.security.sessions.button')}
            </button>
          </div>
        </fieldset>
      </div>
    </MemberPage>
  );
}
