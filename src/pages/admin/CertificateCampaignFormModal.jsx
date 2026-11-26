import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../components/admin/Modal';
import StateBox from '../../components/admin/StateBox';
import {
  CERT_TYPES, CERT_SOURCES, CERT_LANGUAGES, CERT_NAME_MODES,
  fetchCertificateTemplates, fetchCertificateActivities, createCertificateCampaign, updateCertificateCampaign,
} from '../../services/supabase/adminCertificates.service';
import { notifyCertError } from './certificateUi';

/**
 * إنشاء/تعديل حملة. التعديل مسموح للمسودة فقط: العنوان والقالب واللغة وخصوصية الاسم
 * (النوع ومصدر الأهلية والنشاط مقفلة بعد الإنشاء في الخادم أيضًا).
 */
export default function CertificateCampaignFormModal({ campaign, onClose, onSaved }) {
  const { t } = useTranslation();
  const editing = !!campaign;
  const [refs, setRefs] = useState(null); // { templates, activities }
  const [refsError, setRefsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [values, setValues] = useState({
    title: campaign?.title || '',
    certificate_type: campaign?.certificate_type || 'participation',
    eligibility_source: campaign?.eligibility_source || 'attendance_based',
    activity_id: campaign?.activity_id || '',
    template_id: campaign?.template_id || '',
    language: campaign?.language || 'fr',
    public_name_mode: campaign?.public_name_mode || 'masked',
  });

  const loadRefs = () => {
    setRefs(null);
    setRefsError(false);
    Promise.all([fetchCertificateTemplates(), editing ? Promise.resolve([]) : fetchCertificateActivities()])
      .then(([templates, activities]) => {
        setRefs({ templates, activities });
        setValues((v) => (v.template_id || !templates.length ? v : { ...v, template_id: templates[0].id }));
      })
      .catch((err) => {
        console.error('تعذر تحميل مراجع الحملة:', err);
        setRefsError(true);
      });
  };
  useEffect(loadRefs, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const validate = () => {
    const er = {};
    const title = values.title.trim();
    if (title.length < 3 || title.length > 200) er.title = t('admin.certificates.form.errTitle');
    // en modification, un modèle devenu inactif n'est plus listé : on le laisse inchangé (l'RPC garde le modèle existant si null)
    if (!values.template_id && !editing) er.template_id = t('admin.certificates.form.errTemplate');
    if (!editing && values.eligibility_source === 'attendance_based' && !values.activity_id) er.activity_id = t('admin.certificates.form.errActivity');
    return er;
  };

  const submit = async (e) => {
    e.preventDefault();
    const er = validate();
    setErrors(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    const toast = window.notify?.loading(t('admin.common.saving'));
    try {
      const payload = { ...values, title: values.title.trim(), template_id: values.template_id || null };
      let newId = null;
      if (editing) await updateCertificateCampaign(campaign.id, payload);
      else newId = await createCertificateCampaign(payload);
      toast?.remove();
      window.notify?.success(t('admin.certificates.form.saveOk'));
      onSaved(newId);
    } catch (err) {
      toast?.remove();
      notifyCertError(err, t, 'admin.certificates.form.saveFailed');
      setSaving(false);
    }
  };

  const ready = !!refs;

  return (
    <Modal onClose={onClose} wide>
      <h3>{editing ? t('admin.certificates.form.editTitle') : t('admin.certificates.form.createTitle')}</h3>
      {!ready && <StateBox state={refsError ? 'error' : 'loading'} errorText={t('admin.certificates.form.refsError')} onRetry={loadRefs} />}
      {ready && (
        <form onSubmit={submit} noValidate>
          <div className="admin-form-group">
            <label htmlFor="cert_title">{t('admin.certificates.form.fieldTitle')} *</label>
            <input id="cert_title" className="admin-input" maxLength={200} value={values.title} onChange={set('title')}
              aria-invalid={errors.title ? 'true' : undefined} />
            {errors.title && <p className="admin-inline-error" role="alert">{errors.title}</p>}
          </div>

          <div className="admin-form-grid-2">
            <div className="admin-form-group">
              <label htmlFor="cert_type">{t('admin.certificates.form.fieldType')}</label>
              <select id="cert_type" className="admin-select" value={values.certificate_type} onChange={set('certificate_type')} disabled={editing}>
                {CERT_TYPES.map((k) => <option key={k} value={k}>{t(`admin.certificates.types.${k}`)}</option>)}
              </select>
            </div>
            <div className="admin-form-group">
              <label htmlFor="cert_source">{t('admin.certificates.form.fieldSource')}</label>
              <select id="cert_source" className="admin-select" value={values.eligibility_source} onChange={set('eligibility_source')} disabled={editing}>
                {CERT_SOURCES.map((k) => <option key={k} value={k}>{t(`admin.certificates.sources.${k}`)}</option>)}
              </select>
            </div>
          </div>

          {!editing && (
            <div className="admin-form-group">
              <label htmlFor="cert_activity">
                {t('admin.certificates.form.fieldActivity')}{values.eligibility_source === 'attendance_based' ? ' *' : ''}
              </label>
              <select id="cert_activity" className="admin-select" value={values.activity_id} onChange={set('activity_id')}
                aria-invalid={errors.activity_id ? 'true' : undefined}>
                <option value="">{t('admin.certificates.form.fieldActivityNone')}</option>
                {refs.activities.map((a) => <option key={a.id} value={a.id}>{a.title}{a.date ? ` — ${a.date}` : ''}</option>)}
              </select>
              {errors.activity_id && <p className="admin-inline-error" role="alert">{errors.activity_id}</p>}
            </div>
          )}

          <div className="admin-form-grid-2">
            <div className="admin-form-group">
              <label htmlFor="cert_template">{t('admin.certificates.form.fieldTemplate')} *</label>
              <select id="cert_template" className="admin-select" value={values.template_id} onChange={set('template_id')}
                aria-invalid={errors.template_id ? 'true' : undefined}>
                <option value="">—</option>
                {refs.templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
              </select>
              {errors.template_id && <p className="admin-inline-error" role="alert">{errors.template_id}</p>}
            </div>
            <div className="admin-form-group">
              <label htmlFor="cert_lang">{t('admin.certificates.form.fieldLanguage')}</label>
              <select id="cert_lang" className="admin-select" value={values.language} onChange={set('language')}>
                {CERT_LANGUAGES.map((k) => <option key={k} value={k}>{t(`admin.certificates.languages.${k}`)}</option>)}
              </select>
            </div>
          </div>

          <div className="admin-form-group">
            <label htmlFor="cert_name_mode">{t('admin.certificates.form.fieldNameMode')}</label>
            <select id="cert_name_mode" className="admin-select" value={values.public_name_mode} onChange={set('public_name_mode')}>
              {CERT_NAME_MODES.map((k) => <option key={k} value={k}>{t(`admin.certificates.nameModes.${k}`)}</option>)}
            </select>
            <p className="admin-hint">{t('admin.certificates.form.nameModeHint')}</p>
          </div>
          {editing && <p className="admin-hint">{t('admin.certificates.form.lockedHint')}</p>}

          <div className="admin-modal-actions">
            <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>{saving ? t('admin.common.saving') : t('admin.common.save')}</button>
            <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose} disabled={saving}>{t('admin.common.cancel')}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
