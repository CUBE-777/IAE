import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import FormField from '../../components/common/FormField';
import { submitContactMessage } from '../../services/supabase/publicContent.service';
import { validateEmail, validateMaxLength, validateName, validateRequired } from '../../utils/validators';

const initialState = { name: '', promo: '', email: '', message: '', botField: '' };
const MESSAGE_MAX = 5000;

function validate(v) {
  const errors = {};
  const set = (k, e) => e && (errors[k] = e);
  set('name', validateName(v.name));
  set('email', validateEmail(v.email));
  set('message', validateRequired(v.message) || validateMaxLength(v.message, MESSAGE_MAX));
  return errors;
}

export default function ContactForm() {
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
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setErrors((er) => ({ ...er, [name]: validate(values)[name] }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (values.botField) return;

    const found = validate(values);
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) {
      setFormError(t('forms.fixErrors'));
      formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await submitContactMessage({
        name: values.name.trim(),
        promo: values.promo.trim(),
        email: values.email.trim(),
        message: values.message.trim(),
      });
      navigate('/thank-you');
    } catch (err) {
      console.error('تعذر إرسال الرسالة:', err);
      setFormError(/network|fetch|failed/i.test(err?.message || '') ? t('forms.networkError') : t('forms.submitError'));
      setSubmitting(false);
    }
  };

  return (
    <form id="contactForm" name="contact" ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      <p className="hp-field" aria-hidden="true">
        <label>
          {t('forms.honeypot')}
          <input name="botField" value={values.botField} onChange={handleChange} tabIndex={-1} autoComplete="off" />
        </label>
      </p>
      <p className="form-required-hint">{t('forms.requiredHint')}</p>
      {formError && <div className="form-alert form-alert-error" role="alert">{formError}</div>}

      <div className="form-row">
        <FormField id="name" label={t('contact.form.name')} required error={errors.name}>
          {(a) => (
            <input {...a} name="name" type="text" autoComplete="name" placeholder={t('contact.form.namePlaceholder')}
              value={values.name} onChange={handleChange} onBlur={handleBlur} />
          )}
        </FormField>
        <FormField id="promo" label={t('contact.form.promo')}>
          {(a) => (
            <input {...a} name="promo" type="text" placeholder={t('contact.form.promoPlaceholder')}
              value={values.promo} onChange={handleChange} />
          )}
        </FormField>
      </div>
      <FormField id="email" label={t('contact.form.email')} required error={errors.email} className="full-row">
        {(a) => (
          <input {...a} name="email" type="email" inputMode="email" autoComplete="email" dir="ltr"
            placeholder={t('contact.form.emailPlaceholder')} value={values.email} onChange={handleChange} onBlur={handleBlur} />
        )}
      </FormField>
      <FormField id="message" label={t('contact.form.message')} required error={errors.message} className="full-row">
        {(a) => (
          <textarea {...a} name="message" placeholder={t('contact.form.messagePlaceholder')}
            value={values.message} onChange={handleChange} onBlur={handleBlur} />
        )}
      </FormField>
      <button type="submit" className="btn btn-gold" disabled={submitting}>
        {submitting && <span className="btn-spinner" aria-hidden="true" />}
        {submitting ? t('common.loading') : t('contact.form.submit')}
      </button>
      <p className="form-note">{t('contact.form.note')}</p>
    </form>
  );
}
