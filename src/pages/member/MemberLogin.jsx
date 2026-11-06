import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import InteriorLayout from '../../layouts/InteriorLayout';
import PageHero from '../../components/layout/PageHero';
import FormField from '../../components/common/FormField';
import { useAuth } from '../../app/providers/AuthProvider';
import { useNoindex } from '../../hooks/useNoindex';
import { validateEmail } from '../../utils/validators';
import '../../styles/membership-flow.css';
import '../../styles/member.css';

/** دخول المنخرطين. إن كانت هناك جلسة فالحارس (MemberLayout) هو من يحكم هل هي لحساب عضو أم لا. */
export default function MemberLogin() {
  const { t } = useTranslation();
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const target = location.state?.from?.pathname?.startsWith('/member') ? location.state.from.pathname : '/member';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useNoindex();

  useEffect(() => {
    document.title = `${t('member.login.pageTitle')} — ${t('brand.name')}`;
  }, [t]);

  if (status === 'authenticated') return <Navigate to={target} replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    const errs = {};
    if (!email.trim()) errs.email = 'member.login.emailRequired';
    else if (validateEmail(email)) errs.email = 'member.login.emailInvalid';
    if (!password) errs.password = 'member.login.passwordRequired';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(target, { replace: true });
    } catch (err) {
      const raw = err?.message || '';
      if (/Invalid login credentials/i.test(raw)) setFormError(t('member.login.invalid'));
      else if (/network|fetch/i.test(raw) || !navigator.onLine) setFormError(t('member.login.network'));
      else setFormError(t('member.login.generic'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <InteriorLayout>
      <PageHero crumbs={[{ label: t('member.crumb') }]} title={t('member.login.title')} description={t('member.login.description')} />
      <section className="mf-section">
        <div className="container">
          <form className="membership-form mf-form member-login" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
            {formError && <div className="form-alert form-alert-error" role="alert">{formError}</div>}
            <fieldset className="mf-group">
              <FormField id="ml-email" label={t('member.login.email')} required error={errors.email}>
                {(a) => <input {...a} type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
              </FormField>
              <FormField id="ml-password" label={t('member.login.password')} required error={errors.password}>
                {(a) => <input {...a} type={show ? 'text' : 'password'} dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
              </FormField>
              <label className="mf-hint" style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {t('member.login.show')}
              </label>
            </fieldset>
            <button type="submit" className="btn btn-gold mf-submit" disabled={submitting}>
              {submitting ? t('member.login.submitting') : t('member.login.submit')}
            </button>
            <p className="mf-privacy">{t('member.login.forgot')}</p>
            <p className="mf-privacy">{t('member.login.noAccount')}</p>
          </form>
        </div>
      </section>
    </InteriorLayout>
  );
}
