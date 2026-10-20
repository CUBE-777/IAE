import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../components/admin/Modal';
import AnnouncementCard from '../../components/announcements/AnnouncementCard';
import { saveAnnouncement } from '../../services/supabase/adminAnnouncements.service';
import { ANNOUNCEMENT_TYPES } from '../../services/supabase/announcements.service';
import { safeUrl } from '../../utils/sanitize';

const LANGS = ['ar', 'fr', 'en'];
const MAX_IMAGE = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const toDateInput = (v) => (v ? String(v).substring(0, 10) : '');

export default function AnnouncementFormModal({ announcement, onClose, onSaved }) {
  const { t } = useTranslation();
  const tr = announcement?.translations || {};
  const [values, setValues] = useState({
    title: announcement?.title || announcement?.text || '',
    excerpt: announcement?.excerpt || '',
    content: announcement?.content || '',
    type: announcement?.type || 'general',
    link: announcement?.link || '',
    start_at: toDateInput(announcement?.start_at),
    end_at: toDateInput(announcement?.end_at),
    is_active: announcement ? announcement.is_active !== false : false, // الإعلان الجديد مسودة افتراضيًا
    is_pinned: announcement?.is_pinned === true,
    fr: { title: tr.fr?.title || '', excerpt: tr.fr?.excerpt || '', content: tr.fr?.content || '' },
    en: { title: tr.en?.title || '', excerpt: tr.en?.excerpt || '', content: tr.en?.content || '' },
  });
  const [lang, setLang] = useState('ar');
  const [imageFile, setImageFile] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const localPreviewUrl = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile]);
  useEffect(() => () => localPreviewUrl && URL.revokeObjectURL(localPreviewUrl), [localPreviewUrl]);

  const currentImage = removeImage ? null : localPreviewUrl || announcement?.image_url || null;

  const handleChange = (e) => {
    const { name, type, checked, value } = e.target;
    setValues((v) => ({ ...v, [name]: type === 'checkbox' ? checked : value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
  };

  // حقول اللغة النشطة: العربية = الأساس، وغيرها داخل translations
  const field = (name) => (lang === 'ar' ? values[name] : values[lang][name]);
  const setField = (name, value) => {
    if (lang === 'ar') {
      setValues((v) => ({ ...v, [name]: value }));
      if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
    } else {
      setValues((v) => ({ ...v, [lang]: { ...v[lang], [name]: value } }));
    }
  };

  const onPickImage = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE) {
      setErrors((er) => ({ ...er, image: t('admin.announcements.imageHint') }));
      return;
    }
    setErrors((er) => ({ ...er, image: undefined }));
    setImageFile(file);
    setRemoveImage(false);
  };

  const validate = () => {
    const er = {};
    const title = values.title.trim();
    if (!title) er.title = t('admin.announcements.titleRequired');
    else if (title.length > 200) er.title = t('admin.announcements.titleTooLong');
    if (values.excerpt.length > 400) er.excerpt = t('admin.announcements.excerptTooLong');
    if (values.link.trim() && !/^https?:\/\//i.test(values.link.trim())) er.link = t('admin.announcements.linkInvalid');
    if (values.start_at && values.end_at && values.end_at < values.start_at) er.end_at = t('admin.announcements.datesInvalid');
    return er;
  };

  /** يبني كائن الإعلان الحالي (للمعاينة والحفظ). */
  const buildTranslations = () => {
    const out = {};
    ['fr', 'en'].forEach((l) => {
      const o = {};
      ['title', 'excerpt', 'content'].forEach((k) => {
        const v = values[l][k].trim();
        if (v) o[k] = v;
      });
      if (Object.keys(o).length) out[l] = o;
    });
    return out;
  };

  const previewRow = {
    ...announcement,
    id: announcement?.id || 'preview',
    slug: announcement?.slug || 'preview',
    title: values.title.trim() || '…',
    text: values.title.trim(),
    excerpt: values.excerpt.trim(),
    content: values.content.trim(),
    type: values.type,
    is_pinned: values.is_pinned,
    image_url: currentImage,
    start_at: values.start_at || announcement?.start_at || new Date().toISOString(),
    created_at: announcement?.created_at || new Date().toISOString(),
    translations: buildTranslations(),
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const er = validate();
    setErrors(er);
    if (Object.keys(er).length) {
      if (er.title) setLang('ar');
      return;
    }
    setSaving(true);
    const toast = window.notify?.loading(t('admin.common.saving'));
    try {
      const title = values.title.trim();
      const payload = {
        title,
        text: title.slice(0, 500), // الشريط العلوي والتوافق مع الأعمدة القديمة
        excerpt: values.excerpt.trim() || null,
        content: values.content.trim() || null,
        type: values.type,
        link: values.link.trim() || null,
        is_active: values.is_active,
        is_pinned: values.is_pinned,
        // تاريخ النشر: المحدد، وإلا الآن عند النشر. (start_at = published_at)
        start_at: values.start_at || (values.is_active && !announcement?.start_at ? new Date().toISOString() : announcement?.start_at || null),
        // ملاحظة محفوظة من الأصل: نهاية اليوم المختار (23:59:59) كي لا تُخفي RLS الإعلان قبل أوانه
        end_at: values.end_at ? `${values.end_at}T23:59:59` : null,
        translations: buildTranslations(),
      };
      await saveAnnouncement(announcement, payload, { file: imageFile, remove: removeImage });
      toast?.remove();
      window.notify?.success(t('admin.common.saved'));
      onSaved();
    } catch (err) {
      toast?.remove();
      window.notify?.fromError(err, t('admin.common.saveFailed'));
      setSaving(false);
    }
  };

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <Modal onClose={onClose} wide>
      <h3>{announcement ? t('admin.announcements.edit') : t('admin.announcements.create')}</h3>
      <form onSubmit={handleSubmit} noValidate>
        <div className="admin-tabs" role="tablist" aria-label={t('admin.announcements.langTab')}>
          {LANGS.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={lang === l}
              className={`admin-tab-btn${lang === l ? ' active' : ''}`} onClick={() => setLang(l)}>
              {l === 'ar' ? 'العربية' : l === 'fr' ? 'Français' : 'English'}
            </button>
          ))}
        </div>
        {lang !== 'ar' && <p className="admin-hint" style={{ marginTop: 0 }}>{t('admin.announcements.translationsHint')}</p>}

        <div className="admin-form-group">
          <label htmlFor="ann_title">{t('admin.announcements.fieldTitle')}{lang === 'ar' && ' *'}</label>
          <input id="ann_title" className="admin-input" dir={dir} maxLength={200} value={field('title')}
            aria-invalid={lang === 'ar' && errors.title ? 'true' : undefined} aria-describedby={errors.title ? 'ann_title_err' : undefined}
            onChange={(e) => setField('title', e.target.value)} />
          {lang === 'ar' && errors.title && <p className="admin-inline-error" id="ann_title_err" role="alert">{errors.title}</p>}
        </div>
        <div className="admin-form-group">
          <label htmlFor="ann_excerpt">{t('admin.announcements.fieldExcerpt')}</label>
          <textarea id="ann_excerpt" className="admin-textarea" dir={dir} rows={2} maxLength={400} value={field('excerpt')}
            aria-invalid={lang === 'ar' && errors.excerpt ? 'true' : undefined}
            onChange={(e) => setField('excerpt', e.target.value)} />
          {lang === 'ar' && errors.excerpt && <p className="admin-inline-error" role="alert">{errors.excerpt}</p>}
        </div>
        <div className="admin-form-group">
          <label htmlFor="ann_content">{t('admin.announcements.fieldContent')}</label>
          <textarea id="ann_content" className="admin-textarea" dir={dir} rows={6} maxLength={20000} value={field('content')}
            onChange={(e) => setField('content', e.target.value)} />
        </div>

        <div className="admin-form-grid-2">
          <div className="admin-form-group">
            <label htmlFor="ann_type">{t('admin.announcements.fieldType')}</label>
            <select id="ann_type" name="type" className="admin-select" value={values.type} onChange={handleChange}>
              {ANNOUNCEMENT_TYPES.map((k) => <option key={k} value={k}>{t(`announcements.types.${k}`)}</option>)}
            </select>
          </div>
          <div className="admin-form-group">
            <label htmlFor="ann_link">{t('admin.announcements.fieldLink')}</label>
            <input id="ann_link" name="link" dir="ltr" className="admin-input" placeholder="https://" value={values.link} onChange={handleChange}
              aria-invalid={errors.link ? 'true' : undefined} />
            {errors.link && <p className="admin-inline-error" role="alert">{errors.link}</p>}
          </div>
          <div className="admin-form-group">
            <label htmlFor="ann_start">{t('admin.announcements.fieldPublishDate')}</label>
            <input id="ann_start" name="start_at" type="date" className="admin-input" value={values.start_at} onChange={handleChange} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="ann_end">{t('admin.announcements.fieldExpiryDate')}</label>
            <input id="ann_end" name="end_at" type="date" className="admin-input" value={values.end_at} onChange={handleChange}
              aria-invalid={errors.end_at ? 'true' : undefined} />
            {errors.end_at && <p className="admin-inline-error" role="alert">{errors.end_at}</p>}
          </div>
        </div>

        <div className="admin-form-group">
          <label>{t('admin.announcements.fieldImage')}</label>
          <div className="admin-image-field">
            {currentImage && safeUrl(currentImage) && <img className="admin-image-thumb" src={currentImage} alt="" />}
            <label className="admin-btn admin-btn-ghost admin-btn-sm admin-upload-label">
              {t('admin.announcements.chooseImage')}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={onPickImage} />
            </label>
            {currentImage && (
              <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm"
                onClick={() => { setImageFile(null); setRemoveImage(true); }}>
                {t('admin.announcements.removeImage')}
              </button>
            )}
          </div>
          <p className="admin-hint">{t('admin.announcements.imageHint')}</p>
          {errors.image && <p className="admin-inline-error" role="alert">{errors.image}</p>}
        </div>

        <div className="admin-form-grid-2">
          <label className="admin-check">
            <input type="checkbox" name="is_active" checked={values.is_active} onChange={handleChange} /> {t('admin.announcements.fieldPublished')}
          </label>
          <label className="admin-check">
            <input type="checkbox" name="is_pinned" checked={values.is_pinned} onChange={handleChange} /> {t('admin.announcements.fieldPinned')}
          </label>
        </div>

        {showPreview && (
          <div className="admin-preview-box" aria-label={t('admin.announcements.previewTitle')}>
            <AnnouncementCard announcement={previewRow} preview />
          </div>
        )}

        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
            {saving && <span className="admin-btn-spinner" aria-hidden="true" />}
            {saving ? t('admin.common.saving') : t('admin.common.save')}
          </button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setShowPreview((v) => !v)} aria-pressed={showPreview}>
            {showPreview ? t('admin.announcements.hidePreview') : t('admin.announcements.preview')}
          </button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{t('admin.common.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}
