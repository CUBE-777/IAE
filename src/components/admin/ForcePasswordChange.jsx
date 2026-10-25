import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../app/providers/AuthProvider';
import { changeOwnPassword } from '../../services/supabase/auth.service';
import ThemeToggle from '../layout/ThemeToggle';
import '../../styles/admin-login.css';

/**
 * شاشة إلزامية لحساب أنشأه مسؤول بكلمة مرور مؤقتة (علم user_metadata.must_change_password).
 * تعرضها ProtectedRoute بدل أي صفحة إدارية حتى يختار صاحب الحساب كلمة مرور خاصة به.
 */
export default function ForcePasswordChange() {
  const { t } = useTranslation();
  const { refresh, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = t('admin.forcePassword.title');
  }, [t]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8 || password.length > 72) {
      setError(t('admin.forcePassword.tooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('admin.forcePassword.mismatch'));
      return;
    }
    setSubmitting(true);
    try {
      await changeOwnPassword(password);
      await refresh(); // يقرأ الجلسة المحدّثة (العلم أُسقط) فتفتح اللوحة
    } catch (err) {
      console.error('تعذر تغيير كلمة المرور:', err);
      setError(t('admin.forcePassword.failed'));
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-login-wrap">
      <ThemeToggle className="theme-toggle-floating" />
      <form className="admin-login-box" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <img src="/logo.jpg" alt={t('admin.layout.logoAlt')} />
        <h1>{t('admin.forcePassword.title')}</h1>
        <p className="sub">{t('admin.forcePassword.subtitle')}</p>

        {error && <div className="admin-login-error" role="alert">{error}</div>}

        <div className="admin-login-group">
          <label htmlFor="new-password">{t('admin.forcePassword.newPassword')}</label>
          <input
            id="new-password"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="sub" style={{ margin: '6px 0 0' }}>{t('admin.forcePassword.hint')}</p>
        </div>
        <div className="admin-login-group">
          <label htmlFor="confirm-password">{t('admin.forcePassword.confirmPassword')}</label>
          <input
            id="confirm-password"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting && <span className="admin-btn-spinner" aria-hidden="true" />}
          {submitting ? t('admin.forcePassword.submitting') : t('admin.forcePassword.submit')}
        </button>
        <button type="button" className="admin-login-back" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => logout()}>
          ← {t('admin.forcePassword.logout')}
        </button>
      </form>
    </div>
  );
}
