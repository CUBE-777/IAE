import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider';
import { validateEmail } from '../../utils/validators';
import ThemeToggle from '../../components/layout/ThemeToggle';
import '../../styles/admin-login.css';

export default function Login() {
  const { t } = useTranslation();
  const { status, profile, login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = t('admin.login.pageTitle');
  }, [t]);

  // إن كانت هناك جلسة نشطة بالفعل، انتقل مباشرة إلى لوحة التحكم (سلوك مطابق للأصل).
  // يُشترط profile نشط حتى لا تنشأ حلقة مع ProtectedRoute أثناء تسجيل خروج حساب غير نشط.
  useEffect(() => {
    if (status === 'authenticated' && profile?.is_active) navigate('/admin/dashboard', { replace: true });
  }, [status, profile, navigate]);

  useEffect(() => {
    if (searchParams.get('reason') === 'inactive') setError(t('admin.login.inactive'));
  }, [searchParams, t]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const errs = {};
    if (!email.trim()) errs.email = 'admin.login.emailRequired';
    else if (validateEmail(email)) errs.email = 'admin.login.emailInvalid';
    if (!password) errs.password = 'admin.login.passwordRequired';
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(errs.email ? 'email' : 'password')?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      const raw = err?.message || '';
      let msg = t('admin.login.generic');
      if (/Invalid login credentials/i.test(raw)) msg = t('admin.login.invalid');
      else if (/network|fetch/i.test(raw)) msg = t('admin.login.network');
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-login-wrap">
      <ThemeToggle className="theme-toggle-floating" />
      <form className="admin-login-box" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <img src="/logo.jpg" alt={t('admin.layout.logoAlt')} />
        <h1>{t('admin.login.title')}</h1>
        <p className="sub">{t('admin.login.subtitle')}</p>

        {error && <div className="admin-login-error" role="alert">{error}</div>}

        <div className="admin-login-group">
          <label htmlFor="email">{t('admin.login.email')}</label>
          <input
            id="email"
            type="email"
            dir="ltr"
            autoComplete="username"
            placeholder="admin@example.com"
            value={email}
            aria-invalid={fieldErrors.email ? 'true' : undefined}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
          {fieldErrors.email && <p className="admin-login-field-error" id="email-error" role="alert">{t(fieldErrors.email)}</p>}
        </div>
        <div className="admin-login-group">
          <label htmlFor="password">{t('admin.login.password')}</label>
          <div className="admin-login-password">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              dir="ltr"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              aria-invalid={fieldErrors.password ? 'true' : undefined}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="admin-login-toggle"
              aria-label={showPassword ? t('admin.login.hide') : t('admin.login.show')}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
          {fieldErrors.password && <p className="admin-login-field-error" id="password-error" role="alert">{t(fieldErrors.password)}</p>}
        </div>
        <button type="submit" disabled={submitting}>
          {submitting && <span className="admin-btn-spinner" aria-hidden="true" />}
          {submitting ? t('admin.login.submitting') : t('admin.login.submit')}
        </button>
        <Link to="/" className="admin-login-back">← {t('admin.login.back')}</Link>
      </form>
    </div>
  );
}
