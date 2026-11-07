import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import InteriorLayout from '../../layouts/InteriorLayout';
import PageHero from '../../components/layout/PageHero';
import FormField from '../../components/common/FormField';
import { useAuth } from '../../app/providers/AuthProvider';
import { getActivationLink, activateMember } from '../../services/supabase/memberSpace.service';
import { useNoindex } from '../../hooks/useNoindex';
import { MIN_LEN, MAX_LEN, STRENGTH_KEYS, passwordStrength } from '../../utils/passwordStrength';
import { scrollBehavior } from '../../utils/motion';
import { SUPPORTED_LANGUAGES, applyDocumentDirection } from '../../i18n';
import '../../styles/membership-flow.css';
import '../../styles/member.css';

function StateBox({ title, text, action }) {
  return (
    <section className="mf-section">
      <div className="container">
        <div className="mf-state" role="status">
          <h2>{title}</h2>
          <p>{text}</p>
          {action}
        </div>
      </div>
    </section>
  );
}

/** تفعيل الحساب (أو استعادة الدخول لحساب قائم) برابط شخصي: /member/activate/:token — صفحة غير مفهرسة. */
export default function MemberActivate() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null); // { reset }
  useNoindex();

  // لغة الرسالة التي وصلت للعضو (?lang=fr|en|ar)
  useEffect(() => {
    const known = SUPPORTED_LANGUAGES.find((l) => l.code === searchParams.get('lang'));
    if (known && known.code !== i18n.language) {
      i18n.changeLanguage(known.code);
      applyDocumentDirection(known.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = `${t('member.activate.pageTitle')} — ${t('brand.name')}`;
  }, [t]);

  useEffect(() => {
    let alive = true;
    getActivationLink(token)
      .then((d) => alive && setInfo(d))
      .catch((err) => {
        console.error('activation link load failed', err);
        if (alive) setLoadError(true);
      });
    return () => { alive = false; };
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    const errs = {};
    if (password.length < MIN_LEN) errs.password = 'member.activate.tooShort';
    else if (password.length > MAX_LEN) errs.password = 'member.activate.tooLong';
    if (!errs.password && confirm !== password) errs.confirm = 'member.activate.mismatch';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    try {
      const res = await activateMember(token, password);
      const reset = !!res?.reset || !!info?.existing;
      // دخول مباشر بعد التفعيل؛ إن فشل لأي سبب نعرض رسالة النجاح مع رابط صفحة الدخول كما كان
      try {
        await login(res?.email || '', password);
        navigate('/member', { replace: true });
        return;
      } catch (loginErr) {
        console.error('auto login after activation failed', loginErr);
      }
      setDone({ reset });
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    } catch (err) {
      console.error('member activation failed', err);
      // رسائل الخادم بالعربية؛ نعرضها كما هي في اللغة العربية فقط وإلا الرسالة العامة المترجمة
      setFormError(err?.userMessage && i18n.language === 'ar' ? err.userMessage : t('member.activate.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = !!info?.existing;
  const strength = passwordStrength(password);
  let body;
  if (loadError) {
    body = <StateBox title={t('member.activate.loadErrorTitle')} text={t('member.activate.loadErrorText')} />;
  } else if (!info) {
    body = <section className="mf-section"><div className="container"><p className="mf-loading">{t('member.loading')}</p></div></section>;
  } else if (!info.valid) {
    const key = ['used', 'expired'].includes(info.reason) ? info.reason : 'invalid';
    body = (
      <StateBox
        title={t(`member.activate.state.${key}.title`)}
        text={t(`member.activate.state.${key}.text`)}
        action={key === 'used' ? <Link className="btn btn-gold" to="/member/login">{t('member.activate.goLogin')}</Link> : null}
      />
    );
  } else if (done) {
    body = (
      <StateBox
        title={t(done.reset ? 'member.activate.successResetTitle' : 'member.activate.successNewTitle')}
        text={t(done.reset ? 'member.activate.successResetText' : 'member.activate.successNewText')}
        action={<Link className="btn btn-gold" to="/member/login">{t('member.activate.goLogin')}</Link>}
      />
    );
  } else {
    body = (
      <section className="mf-section">
        <div className="container">
          <form className="membership-form mf-form member-login" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
            <div className="mf-fee" role="note">{t('member.activate.greeting', { name: info.full_name })}</div>
            <p className="mf-privacy" role="note" dir="ltr">{t('member.activate.emailLabel', { email: info.email_hint })}</p>
            {formError && <div className="form-alert form-alert-error" role="alert">{formError}</div>}
            <fieldset className="mf-group">
              <FormField id="ma-password" label={t('member.activate.password')} required error={errors.password}>
                {(a) => <input {...a} type={show ? 'text' : 'password'} dir="ltr" autoComplete="new-password" maxLength={MAX_LEN} value={password} onChange={(e) => setPassword(e.target.value)} />}
              </FormField>
              <p className="mf-hint">{t('member.activate.hint')}</p>
              {strength && (
                <p className={`mf-hint member-strength member-strength-${strength}`} role="status">
                  {t('member.activate.strengthLabel', { level: t(STRENGTH_KEYS[strength]) })}
                </p>
              )}
              <FormField id="ma-confirm" label={t('member.activate.confirm')} required error={errors.confirm}>
                {(a) => <input {...a} type={show ? 'text' : 'password'} dir="ltr" autoComplete="new-password" maxLength={MAX_LEN} value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
              </FormField>
              <label className="mf-hint member-show-pw">
                <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {t('member.activate.show')}
              </label>
            </fieldset>
            <button type="submit" className="btn btn-gold mf-submit" disabled={submitting}>
              {submitting ? t('member.activate.submitting') : t(reset ? 'member.activate.submitReset' : 'member.activate.submit')}
            </button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <InteriorLayout>
      <PageHero
        crumbs={[{ label: t('member.crumb') }, { label: t('member.activate.crumb') }]}
        title={t('member.activate.title')}
        description={t(reset ? 'member.activate.descriptionReset' : 'member.activate.descriptionNew')}
      />
      {body}
    </InteriorLayout>
  );
}
