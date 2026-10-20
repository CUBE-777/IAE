import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import FormField from '../../components/common/FormField';
import { submitMembershipRequest } from '../../services/supabase/publicContent.service';
import { validateEmail, validateMaxLength, validateName, validatePhone, validateRequired } from '../../utils/validators';

const initialState = { name: '', phone: '', email: '', promo: '', track: '', message: '', botField: '' };
const MESSAGE_MAX = 2000;

function validate(v) {
  const errors = {};
  const set = (k, e) => e && (errors[k] = e);
  set('name', validateName(v.name));
  set('phone', validatePhone(v.phone));
  set('email', validateEmail(v.email));
  set('track', validateRequired(v.track));
  set('message', validateMaxLength(v.message, MESSAGE_MAX));
  return errors;
}

export default function MembershipForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const formRef = useRef(null);
  const [values, setValues] = useState(initialState);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined })); // يزول الخطأ بمجرد التصحيح
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    const next = validate(values);
    setErrors((er) => ({ ...er, [name]: next[name] }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // حماية بسيطة من الروبوتات (honeypot) — مطابقة للسلوك الأصلي
    if (values.botField) return;

    const found = validate(values);
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) {
      setFormError(t('forms.fixErrors'));
      const first = formRef.current?.querySelector('[aria-invalid="true"]');
      first?.focus();
      return;
    }

    setSubmitting(true);
    const payload = {
      full_name: values.name.trim(),
      phone: values.phone.trim(),
      email: values.email.trim(),
      promotion: values.promo.trim() || null,
      track: values.track || null,
      message: values.message.trim() || null,
    };

    try {
      await submitMembershipRequest(payload);
      navigate('/thank-you');
    } catch (err) {
      console.error('تعذر إرسال طلب الانخراط:', err);
      // 23505 = انتهاك unique (طلب معلّق بنفس البريد) — راجع migration 0008
      const raw = `${err?.code || ''} ${err?.message || ''}`;
      if (/23505|duplicate|unique/i.test(raw)) setFormError(t('forms.duplicatePending'));
      else if (/network|fetch/i.test(raw)) setFormError(t('forms.networkError'));
      else setFormError(t('join.form.error'));
      setSubmitting(false);
    }
  };

  const tracks = t('join.form.tracks', { returnObjects: true });

  return (
    <form id="membershipForm" ref={formRef} className="membership-form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      <p className="hp-field" aria-hidden="true">
        <label>
          {t('forms.honeypot')}
          <input name="botField" value={values.botField} onChange={handleChange} tabIndex={-1} autoComplete="off" />
        </label>
      </p>
      <p className="form-required-hint">{t('forms.requiredHint')}</p>
      {formError && <div className="form-alert form-alert-error" role="alert">{formError}</div>}

      <div className="form-row">
        <FormField id="m-name" label={t('join.form.name')} required error={errors.name}>
          {(a) => (
            <input {...a} name="name" type="text" autoComplete="name" placeholder={t('join.form.namePlaceholder')}
              value={values.name} onChange={handleChange} onBlur={handleBlur} />
          )}
        </FormField>
        <FormField id="m-phone" label={t('join.form.phone')} required error={errors.phone}>
          {(a) => (
            <input {...a} name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr"
              placeholder={t('join.form.phonePlaceholder')} value={values.phone} onChange={handleChange} onBlur={handleBlur} />
          )}
        </FormField>
      </div>
      <div className="form-row">
        <FormField id="m-email" label={t('join.form.email')} required error={errors.email}>
          {(a) => (
            <input {...a} name="email" type="email" inputMode="email" autoComplete="email" dir="ltr"
              placeholder={t('join.form.emailPlaceholder')} value={values.email} onChange={handleChange} onBlur={handleBlur} />
          )}
        </FormField>
        <FormField id="m-promo" label={t('join.form.promo')}>
          {(a) => (
            <input {...a} name="promo" type="text" placeholder={t('join.form.promoPlaceholder')}
              value={values.promo} onChange={handleChange} />
          )}
        </FormField>
      </div>
      <FormField id="m-track" label={t('join.form.track')} required error={errors.track} className="full-row">
        {(a) => (
          <select {...a} name="track" value={values.track} onChange={handleChange} onBlur={handleBlur}>
            <option value="" disabled>{t('join.form.trackPlaceholder')}</option>
            {tracks.map((track) => (
              <option key={track} value={track}>{track}</option>
            ))}
          </select>
        )}
      </FormField>
      <FormField id="m-message" label={t('join.form.message')} error={errors.message} className="full-row">
        {(a) => (
          <textarea {...a} name="message" placeholder={t('join.form.messagePlaceholder')}
            value={values.message} onChange={handleChange} onBlur={handleBlur} />
        )}
      </FormField>
      <button type="submit" className="btn btn-gold" disabled={submitting}>
        {submitting && <span className="btn-spinner" aria-hidden="true" />}
        {submitting ? t('join.form.submitting') : t('join.form.submit')}
      </button>
    </form>
  );
}
