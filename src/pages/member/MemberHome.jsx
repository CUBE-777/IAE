import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MemberPage from '../../components/member/MemberPage';
import FormField from '../../components/common/FormField';
import { updateMyPrivate, cancelCardRequest } from '../../services/supabase/memberSpace.service';
import { validatePhone } from '../../utils/validators';

const show = (v) => (v == null || String(v).trim() === '' ? '—' : v);

export default function MemberHome() {
  const { t, i18n } = useTranslation();
  const { member, reload } = useOutletContext();
  const [phone, setPhone] = useState(member.phone || '');
  const [city, setCity] = useState(member.city || '');
  const [phoneError, setPhoneError] = useState('');
  const [msg, setMsg] = useState(null); // { kind: 'ok' | 'error', text }
  const [busy, setBusy] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const msgRef = useRef(null);
  const req = member.latest_request;

  const flash = (kind, text) => setMsg({ kind, text });

  // الرسالة أعلى الصفحة بينما أزرار الحفظ أسفلها: نمرّر إليها ونقرأها لقارئ الشاشة ليراها العضو دائمًا
  useEffect(() => {
    if (!msg || !msgRef.current) return;
    msgRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    msgRef.current.focus({ preventScroll: true });
  }, [msg]);

  const savePrivate = async (e) => {
    e.preventDefault();
    setMsg(null);
    setPhoneError('');
    // الهاتف إلزامي في سجلات الانخراط ولا يُمحى من الخادم؛ نتحقق منه محليًا قبل الإرسال
    if (phone.trim() && validatePhone(phone)) { setPhoneError('member.home.private.phoneInvalid'); return; }
    setBusy(true);
    try {
      await updateMyPrivate({ phone: phone.trim(), city: city.trim() });
      flash('ok', t('member.home.private.saved'));
      await reload();
    } catch (err) {
      console.error('update private failed', err);
      flash('error', t('member.home.private.error'));
    } finally {
      setBusy(false);
    }
  };

  const hideCard = async () => {
    setMsg(null);
    setConfirmHide(false);
    setBusy(true);
    try {
      await updateMyPrivate({ hide_from_directory: 'true' });
      flash('ok', t('member.home.hide.done'));
      await reload();
    } catch (err) {
      console.error('hide failed', err);
      flash('error', t('member.home.hide.error'));
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async () => {
    setMsg(null);
    setBusy(true);
    try {
      await cancelCardRequest();
      flash('ok', t('member.home.request.cancelled_ok'));
      await reload();
    } catch (err) {
      console.error('cancel failed', err);
      flash('error', t('member.home.request.cancelError'));
    } finally {
      setBusy(false);
    }
  };

  const fields = [
    ['university', member.university],
    ['promotion', member.promotion],
    ['track', member.track],
    ['profession', member.profession],
    ['email', member.email],
  ];
  const sentAt = req ? new Date(req.created_at).toLocaleDateString(i18n.language === 'ar' ? 'ar-MA' : i18n.language) : '';

  return (
    <MemberPage titleKey="member.home.title" descriptionKey="member.home.description" pageTitleKey="member.home.pageTitle">
      <div className="mf-form">
        {msg && <div ref={msgRef} tabIndex={-1} className={`form-alert ${msg.kind === 'ok' ? 'form-alert-success' : 'form-alert-error'}`} role={msg.kind === 'ok' ? 'status' : 'alert'}>{msg.text}</div>}

        <div className="mf-fee" role="note">{t('member.home.hello', { name: member.full_name })}</div>

        <fieldset className="mf-group">
          <legend>{t('member.home.cardTitle')}</legend>
          <p className="mf-hint">{t('member.home.cardText')}</p>
          <dl className="member-grid">
            {fields.map(([k, v]) => (
              <div key={k}><dt>{t(`member.home.fields.${k}`)}</dt><dd dir={k === 'email' ? 'ltr' : undefined}>{show(v)}</dd></div>
            ))}
          </dl>
          <p className="mf-hint">{member.show_in_directory ? t('member.home.inDirectory') : t('member.home.notInDirectory')}</p>
          <div className="member-actions">
            <Link className="btn btn-gold" to="/member/card">{t('member.home.editCard')}</Link>
          </div>
        </fieldset>

        {req && (
          <fieldset className="mf-group">
            <legend>{t('member.home.request.title')}</legend>
            <p>
              <span className={`member-badge member-badge-${req.status}`}>{t(`member.home.request.${req.status}`)}</span>{' '}
              <span className="mf-hint">{t('member.home.request.sentAt', { date: sentAt })}</span>
            </p>
            {req.review_note && req.status === 'rejected' && (
              <p><strong>{t('member.home.request.note')}</strong> {req.review_note}</p>
            )}
            {req.status === 'pending' && (
              <div className="member-actions">
                <button type="button" className="btn btn-ghost" onClick={cancelRequest} disabled={busy}>{t('member.home.request.cancel')}</button>
              </div>
            )}
          </fieldset>
        )}

        <form onSubmit={savePrivate} noValidate>
          <fieldset className="mf-group">
            <legend>{t('member.home.private.title')}</legend>
            <p className="mf-hint">{t('member.home.private.text')}</p>
            <div className="form-row">
              <FormField id="mh-phone" label={t('member.home.private.phone')} error={phoneError || undefined}>
                {(a) => <input {...a} type="tel" dir="ltr" autoComplete="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />}
              </FormField>
              <FormField id="mh-city" label={t('member.home.private.city')}>
                {(a) => <input {...a} type="text" maxLength={100} value={city} onChange={(e) => setCity(e.target.value)} />}
              </FormField>
            </div>
            <div className="member-actions">
              <button type="submit" className="btn btn-gold" disabled={busy}>{busy ? t('member.home.private.saving') : t('member.home.private.save')}</button>
            </div>
          </fieldset>
        </form>

        {member.show_in_directory && (
          <fieldset className="mf-group">
            <legend>{t('member.home.hide.title')}</legend>
            <p className="mf-hint">{t('member.home.hide.text')}</p>
            {confirmHide ? (
              <div className="member-confirm" role="alertdialog" aria-labelledby="mh-hide-title" aria-describedby="mh-hide-text">
                <strong id="mh-hide-title">{t('member.home.hide.confirmTitle')}</strong>
                <p id="mh-hide-text" className="mf-hint">{t('member.home.hide.confirmText')}</p>
                <div className="member-actions">
                  <button type="button" className="btn btn-gold" onClick={hideCard} disabled={busy} autoFocus>{t('member.home.hide.confirm')}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmHide(false)} disabled={busy}>{t('member.home.hide.cancel')}</button>
                </div>
              </div>
            ) : (
              <div className="member-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmHide(true)} disabled={busy}>{t('member.home.hide.button')}</button>
              </div>
            )}
          </fieldset>
        )}
      </div>
    </MemberPage>
  );
}
