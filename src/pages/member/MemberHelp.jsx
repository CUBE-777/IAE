import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import InteriorLayout from '../../layouts/InteriorLayout';
import MemberAuthShell from '../../components/member/MemberAuthShell';
import FormField from '../../components/common/FormField';
import { requestAccessHelp } from '../../services/supabase/memberSpace.service';
import { useNoindex } from '../../hooks/useNoindex';
import { validateEmail } from '../../utils/validators';
import '../../styles/membership-flow.css';
import '../../styles/member.css';

/**
 * طلب مساعدة في الدخول (نسيت كلمة المرور / لم يصلني رابط التفعيل) بلا جلسة.
 * رسالة النجاح واحدة مهما كان البريد (لا نكشف هل هو مسجّل)، والرابط لا يُعرض هنا:
 * يُصدره المسؤول ويُرسله إلى وسيلة الاتصال المسجّلة للعضو لدى النادي (0039).
 */
export default function MemberHelp() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  useNoindex();

  useEffect(() => {
    document.title = `${t('member.help.pageTitle')} — ${t('brand.name')}`;
  }, [t]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!email.trim()) { setError('member.login.emailRequired'); return; }
    if (validateEmail(email)) { setError('member.login.emailInvalid'); return; }
    setError('');
    setSubmitting(true);
    try {
      await requestAccessHelp(email);
      setDone(true);
    } catch (err) {
      console.error('access help request failed', err);
      if (String(err?.message || '').includes('rate_limited')) setFormError(t('member.help.rateLimited'));
      else if (!navigator.onLine || /network|fetch/i.test(err?.message || '')) setFormError(t('member.login.network'));
      else setFormError(t('member.help.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <InteriorLayout>
      <MemberAuthShell title={t('member.help.title')} description={t('member.help.description')}>
        {done ? (
          <div className="ma-done" role="status">
            <h2>{t('member.help.doneTitle')}</h2>
            <p>{t('member.help.doneText')}</p>
            <Link className="btn btn-gold ma-submit" to="/member/login">{t('member.help.backToLogin')}</Link>
          </div>
        ) : (
          <form className="ma-form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
            {formError && <div className="form-alert form-alert-error" role="alert">{formError}</div>}
            <p className="ma-note" role="note">{t('member.help.intro')}</p>
            <FormField id="mh-email" label={t('member.login.email')} required error={error || undefined}>
              {(a) => <input {...a} type="email" dir="ltr" inputMode="email" autoComplete="email" autoCapitalize="none" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />}
            </FormField>
            <button type="submit" className="btn btn-gold ma-submit" disabled={submitting}>
              {submitting ? t('member.help.submitting') : t('member.help.submit')}
            </button>
            <p className="ma-note">{t('member.help.privacy')}</p>
            <p className="ma-note"><Link to="/member/login">{t('member.help.backToLogin')}</Link></p>
          </form>
        )}
      </MemberAuthShell>
    </InteriorLayout>
  );
}
