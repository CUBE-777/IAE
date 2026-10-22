import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import InteriorLayout from '../../layouts/InteriorLayout';
import PageHero from '../../components/layout/PageHero';
import FormField from '../../components/common/FormField';
import { getMembershipForm, submitMembershipForm } from '../../services/supabase/membershipFlow.service';
import { validateName, validatePhone, validateRequired, validateEmail, validateMaxLength } from '../../utils/validators';
import '../../styles/membership-flow.css';

const EMPTY = {
  full_name: '', birth_date: '', phone: '', email: '', city: '',
  university: '', track: '', level: '', promotion: '',
  profession: '', skills: '', interests: '', github: '', linkedin: '', bio: '',
  emergency_name: '', emergency_phone: '', emergency_relation: '',
  rules_accepted: false,
};

function validate(v) {
  const e = {};
  const set = (k, err) => err && (e[k] = err);
  set('full_name', validateName(v.full_name));
  set('birth_date', validateRequired(v.birth_date));
  set('phone', validatePhone(v.phone));
  if (v.email.trim()) set('email', validateEmail(v.email));
  set('city', validateRequired(v.city));
  set('university', validateRequired(v.university));
  set('track', validateRequired(v.track));
  set('level', validateRequired(v.level));
  set('emergency_name', validateName(v.emergency_name));
  set('emergency_phone', validatePhone(v.emergency_phone));
  set('emergency_relation', validateRequired(v.emergency_relation));
  set('skills', validateMaxLength(v.skills, 600));
  set('interests', validateMaxLength(v.interests, 600));
  set('bio', validateMaxLength(v.bio, 600));
  if (!v.rules_accepted) e.rules_accepted = 'membershipForm.rulesRequired';
  return e;
}

function StateBox({ title, text }) {
  const { t } = useTranslation();
  return (
    <section className="mf-section">
      <div className="container">
        <div className="mf-state" role="status">
          <h2>{title}</h2>
          <p>{text}</p>
          <Link className="btn btn-gold" to="/">{t('thankYou.backHome')}</Link>
        </div>
      </div>
    </section>
  );
}

export default function MembershipFormPage() {
  const { token } = useParams();
  const { t } = useTranslation();
  const formRef = useRef(null);
  const [info, setInfo] = useState(null); // réponse de get_membership_form
  const [loadError, setLoadError] = useState(false);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = `${t('membershipForm.pageTitle')} — ${t('brand.name')}`;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [t]);

  useEffect(() => {
    let alive = true;
    getMembershipForm(token)
      .then((data) => {
        if (!alive) return;
        setInfo(data);
        if (data?.state === 'ok' && data.prefill) {
          const p = data.prefill;
          setValues((v) => ({
            ...v,
            full_name: p.full_name || '',
            phone: p.phone || '',
            email: p.email || '',
            city: p.city || '',
            track: p.track || '',
            promotion: p.promotion || '',
            profession: p.profession || '',
          }));
        }
      })
      .catch((err) => {
        console.error('membership form load failed', err);
        if (alive) setLoadError(true);
      });
    return () => { alive = false; };
  }, [token]);

  const levels = useMemo(() => t('membershipForm.levels', { returnObjects: true }), [t]);
  const relations = useMemo(() => t('membershipForm.relations', { returnObjects: true }), [t]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setValues((v) => ({ ...v, [name]: type === 'checkbox' ? checked : value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
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
      await submitMembershipForm(token, { ...values, rules_accepted: true });
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('membership form submit failed', err);
      setFormError(navigator.onLine ? t('membershipForm.submitError') : t('forms.networkError'));
    } finally {
      setSubmitting(false);
    }
  };

  const input = (name, props = {}) => (a) => (
    <input {...a} name={name} value={values[name]} onChange={handleChange} {...props} />
  );

  let body;
  if (loadError) {
    body = <StateBox title={t('membershipForm.loadErrorTitle')} text={t('membershipForm.loadErrorText')} />;
  } else if (!info) {
    body = <section className="mf-section"><div className="container"><p className="mf-loading">{t('membershipForm.loading')}</p></div></section>;
  } else if (info.state !== 'ok') {
    const key = ['submitted', 'expired', 'closed'].includes(info.state) ? info.state : 'invalid';
    body = <StateBox title={t(`membershipForm.state.${key}.title`)} text={t(`membershipForm.state.${key}.text`)} />;
  } else if (done) {
    body = <StateBox title={t('membershipForm.successTitle')} text={t('membershipForm.successText')} />;
  } else {
    body = (
      <section className="mf-section">
        <div className="container">
          <form ref={formRef} className="membership-form mf-form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
            <p className="form-required-hint">{t('forms.requiredHint')}</p>
            {info.fee && (
              <div className="mf-fee" role="note">
                {t('membershipForm.feeNote', { fee: info.fee, season: info.season || '' })}
              </div>
            )}
            {formError && <div className="form-alert form-alert-error" role="alert">{formError}</div>}

            <fieldset className="mf-group">
              <legend>{t('membershipForm.groups.personal')}</legend>
              <div className="form-row">
                <FormField id="mf-name" label={t('membershipForm.fields.fullName')} required error={errors.full_name}>
                  {input('full_name', { type: 'text', autoComplete: 'name' })}
                </FormField>
                <FormField id="mf-birth" label={t('membershipForm.fields.birthDate')} required error={errors.birth_date}>
                  {input('birth_date', { type: 'date', dir: 'ltr', max: new Date().toISOString().slice(0, 10) })}
                </FormField>
              </div>
              <div className="form-row">
                <FormField id="mf-phone" label={t('membershipForm.fields.phone')} required error={errors.phone}>
                  {input('phone', { type: 'tel', inputMode: 'tel', autoComplete: 'tel', dir: 'ltr' })}
                </FormField>
                <FormField id="mf-email" label={t('membershipForm.fields.email')} error={errors.email}>
                  {input('email', { type: 'email', inputMode: 'email', autoComplete: 'email', dir: 'ltr' })}
                </FormField>
              </div>
              <div className="form-row">
                <FormField id="mf-city" label={t('membershipForm.fields.city')} required error={errors.city}>
                  {input('city', { type: 'text', autoComplete: 'address-level2' })}
                </FormField>
              </div>
            </fieldset>

            <fieldset className="mf-group">
              <legend>{t('membershipForm.groups.study')}</legend>
              <div className="form-row">
                <FormField id="mf-univ" label={t('membershipForm.fields.university')} required error={errors.university}>
                  {input('university', { type: 'text' })}
                </FormField>
                <FormField id="mf-track" label={t('membershipForm.fields.track')} required error={errors.track}>
                  {input('track', { type: 'text' })}
                </FormField>
              </div>
              <div className="form-row">
                <FormField id="mf-level" label={t('membershipForm.fields.level')} required error={errors.level}>
                  {(a) => (
                    <select {...a} name="level" value={values.level} onChange={handleChange}>
                      <option value="">{t('membershipForm.choose')}</option>
                      {Array.isArray(levels) && levels.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  )}
                </FormField>
                <FormField id="mf-promo" label={t('membershipForm.fields.promotion')}>
                  {input('promotion', { type: 'text' })}
                </FormField>
              </div>
            </fieldset>

            <fieldset className="mf-group">
              <legend>{t('membershipForm.groups.tech')}</legend>
              <div className="form-row">
                <FormField id="mf-skills" label={t('membershipForm.fields.skills')} error={errors.skills}>
                  {(a) => <textarea {...a} name="skills" rows={3} value={values.skills} onChange={handleChange} placeholder={t('membershipForm.placeholders.skills')} />}
                </FormField>
                <FormField id="mf-interests" label={t('membershipForm.fields.interests')} error={errors.interests}>
                  {(a) => <textarea {...a} name="interests" rows={3} value={values.interests} onChange={handleChange} placeholder={t('membershipForm.placeholders.interests')} />}
                </FormField>
              </div>
              <div className="form-row">
                <FormField id="mf-github" label="GitHub">
                  {input('github', { type: 'text', dir: 'ltr', placeholder: 'github.com/username' })}
                </FormField>
                <FormField id="mf-linkedin" label="LinkedIn">
                  {input('linkedin', { type: 'text', dir: 'ltr', placeholder: 'linkedin.com/in/username' })}
                </FormField>
              </div>
              <div className="form-row">
                <FormField id="mf-prof" label={t('membershipForm.fields.profession')}>
                  {input('profession', { type: 'text' })}
                </FormField>
              </div>
              <FormField id="mf-bio" label={t('membershipForm.fields.bio')} error={errors.bio}>
                {(a) => <textarea {...a} name="bio" rows={4} value={values.bio} onChange={handleChange} placeholder={t('membershipForm.placeholders.bio')} />}
              </FormField>
            </fieldset>

            <fieldset className="mf-group">
              <legend>{t('membershipForm.groups.emergency')}</legend>
              <p className="mf-hint">{t('membershipForm.emergencyHint')}</p>
              <div className="form-row">
                <FormField id="mf-em-name" label={t('membershipForm.fields.emergencyName')} required error={errors.emergency_name}>
                  {input('emergency_name', { type: 'text' })}
                </FormField>
                <FormField id="mf-em-phone" label={t('membershipForm.fields.emergencyPhone')} required error={errors.emergency_phone}>
                  {input('emergency_phone', { type: 'tel', inputMode: 'tel', dir: 'ltr' })}
                </FormField>
              </div>
              <div className="form-row">
                <FormField id="mf-em-rel" label={t('membershipForm.fields.emergencyRelation')} required error={errors.emergency_relation}>
                  {(a) => (
                    <select {...a} name="emergency_relation" value={values.emergency_relation} onChange={handleChange}>
                      <option value="">{t('membershipForm.choose')}</option>
                      {Array.isArray(relations) && relations.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </FormField>
              </div>
            </fieldset>

            <div className={`mf-consent${errors.rules_accepted ? ' field-invalid' : ''}`}>
              <label>
                <input
                  type="checkbox"
                  name="rules_accepted"
                  checked={values.rules_accepted}
                  onChange={handleChange}
                  aria-invalid={errors.rules_accepted ? 'true' : undefined}
                  aria-required="true"
                />
                <span>{t('membershipForm.rulesLabel')} <span className="field-required" aria-hidden="true">*</span></span>
              </label>
              {errors.rules_accepted && <p className="field-error" role="alert">{t(errors.rules_accepted)}</p>}
            </div>

            <button type="submit" className="btn btn-gold mf-submit" disabled={submitting}>
              {submitting ? t('membershipForm.submitting') : t('membershipForm.submit')}
            </button>
            <p className="mf-privacy">{t('membershipForm.privacy')}</p>
          </form>
        </div>
      </section>
    );
  }

  return (
    <InteriorLayout>
      <PageHero
        crumbs={[{ label: t('membershipForm.crumb') }]}
        title={t('membershipForm.title')}
        description={t('membershipForm.description')}
      />
      {body}
    </InteriorLayout>
  );
}
