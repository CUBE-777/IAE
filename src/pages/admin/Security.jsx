import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { useAuth } from '../../app/providers/AuthProvider';
import { enrollTotp, listVerifiedTotpFactors, unenrollTotp, verifyTotp } from '../../services/supabase/auth.service';

/**
 * src/pages/admin/Security.jsx — أمان الحساب: تفعيل/إيقاف المصادقة الثنائية (TOTP).
 * اختيارية لكل مسؤول. بعد التفعيل يفرضها الخادم على هذا الحساب (migration 0024).
 * إلغاء عامل موثّق يتطلب أن تكون الجلسة الحالية بمستوى aal2 (وهي كذلك بعد إدخال الرمز عند الدخول).
 */
export default function Security() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const [factors, setFactors] = useState(null);
  const [enroll, setEnroll] = useState(null); // { id, qr, secret }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    document.title = t('admin.security.pageTitle');
  }, [t]);

  const load = useCallback(async () => {
    try {
      setFactors(await listVerifiedTotpFactors());
    } catch (err) {
      console.error('تعذر تحميل عوامل المصادقة:', err);
      window.notify?.fromError(err, t('admin.security.loadError'));
      setFactors([]);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const startEnroll = async () => {
    setError('');
    setBusy(true);
    try {
      setEnroll(await enrollTotp());
      setCode('');
    } catch (err) {
      console.error(err);
      setError(t('admin.security.enrollError'));
    } finally {
      setBusy(false);
    }
  };

  const cancelEnroll = async () => {
    const pending = enroll;
    setEnroll(null);
    setCode('');
    setError('');
    if (pending) unenrollTotp(pending.id).catch(() => {}); // تنظيف عامل لم يُوثَّق
  };

  const confirmEnroll = async (e) => {
    e.preventDefault();
    setError('');
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) {
      setError(t('admin.login.mfaFormat'));
      return;
    }
    setBusy(true);
    try {
      await verifyTotp(enroll.id, clean);
      setEnroll(null);
      setCode('');
      await refresh();
      await load();
      window.notify?.success(t('admin.security.enabledOk'));
    } catch (err) {
      console.error(err);
      setError(t('admin.login.mfaInvalid'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError('');
    try {
      for (const f of factors) await unenrollTotp(f.id);
      setConfirmOff(false);
      await refresh();
      await load();
      window.notify?.success(t('admin.security.disabledOk'));
    } catch (err) {
      console.error(err);
      setError(t('admin.security.disableError'));
    } finally {
      setBusy(false);
    }
  };

  const enabled = Array.isArray(factors) && factors.length > 0;

  return (
    <AdminLayout>
      <AdminPageHeader title={t('admin.security.title')} subtitle={t('admin.security.subtitle')} />

      <div className="admin-panel">
        <h2>{t('admin.security.mfaHeading')}</h2>

        {factors === null && <div className="admin-state-box">{t('admin.security.loading')}</div>}

        {error && <div className="admin-login-error" role="alert" style={{ marginBottom: 14 }}>{error}</div>}

        {factors !== null && !enroll && !enabled && (
          <>
            <p>{t('admin.security.offDescription')}</p>
            <button type="button" className="admin-btn admin-btn-primary" onClick={startEnroll} disabled={busy}>
              {t('admin.security.enable')}
            </button>
          </>
        )}

        {factors !== null && enroll && (
          <form onSubmit={confirmEnroll} noValidate>
            <ol style={{ lineHeight: 2, paddingInlineStart: 20, marginTop: 0 }}>
              <li>{t('admin.security.step1')}</li>
              <li>{t('admin.security.step2')}</li>
              <li>{t('admin.security.step3')}</li>
            </ol>
            <img
              src={enroll.qr}
              alt={t('admin.security.qrAlt')}
              width={200}
              height={200}
              style={{ background: '#fff', padding: 8, borderRadius: 8, display: 'block', margin: '12px 0' }}
            />
            <p style={{ marginBottom: 6 }}>{t('admin.security.manualKey')}</p>
            <code dir="ltr" style={{ display: 'inline-block', padding: '6px 10px', borderRadius: 6, userSelect: 'all', wordBreak: 'break-all' }}>
              {enroll.secret}
            </code>
            <div className="admin-form-group" style={{ marginTop: 16, maxWidth: 260 }}>
              <label htmlFor="sec-code">{t('admin.login.mfaCode')}</label>
              <input
                id="sec-code"
                className="admin-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={7}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <p className="admin-page-subtitle">{t('admin.security.warnLost')}</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>{t('admin.security.confirm')}</button>
              <button type="button" className="admin-btn admin-btn-ghost" onClick={cancelEnroll} disabled={busy}>{t('admin.security.cancel')}</button>
            </div>
          </form>
        )}

        {factors !== null && !enroll && enabled && (
          <>
            <p><strong>{t('admin.security.onStatus')}</strong> — {t('admin.security.onDescription')}</p>
            {!confirmOff ? (
              <button type="button" className="admin-btn admin-btn-danger" onClick={() => setConfirmOff(true)} disabled={busy}>
                {t('admin.security.disable')}
              </button>
            ) : (
              <div>
                <p>{t('admin.security.disableConfirm')}</p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="admin-btn admin-btn-danger" onClick={disable} disabled={busy}>{t('admin.security.disableYes')}</button>
                  <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setConfirmOff(false)} disabled={busy}>{t('admin.security.cancel')}</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
