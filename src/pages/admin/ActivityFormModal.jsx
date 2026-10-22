import { useState } from 'react';
import Modal from '../../components/admin/Modal';
import { uploadImage } from '../../services/supabase/storage.service';
import { saveActivity } from '../../services/supabase/adminActivities.service';
import TranslationTabs from '../../components/admin/TranslationTabs';
import { cleanTr, hasTr } from '../../utils/translationForm';

import { tr } from '../../i18n/adminDict';
const TR_MAX = 20000; // وصف النشاط HTML طويل
const ACTIVITY_TR_FIELDS = [
  { key: 'title', label: 'العنوان', max: 300 },
  { key: 'category', label: 'الفئة', max: 200 },
  { key: 'target_audience', label: 'الفئة المستهدفة', max: 300 },
  { key: 'location', label: 'المكان', max: 300 },
  { key: 'description', label: 'الوصف', rows: 8, max: TR_MAX },
];

export default function ActivityFormModal({ activity, onClose, onSaved }) {
  const isEdit = !!activity;
  const [values, setValues] = useState({
    title: activity?.title || '',
    category: activity?.category || '',
    target_audience: activity?.target_audience || '',
    date: activity?.date || '',
    time: activity?.time || '',
    location: activity?.location || '',
    description: activity?.description || '',
  });
  const [translations, setTranslations] = useState(
    activity?.translations && typeof activity.translations === 'object' && !Array.isArray(activity.translations) ? activity.translations : {}
  );
  const subActivities = Array.isArray(activity?.sub_activities) ? activity.sub_activities : [];
  const [imageFile, setImageFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleChange = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const title = values.title.trim();
    if (!title) {
      window.notify?.error(tr('العنوان مطلوب'));
      return;
    }
    setSaving(true);
    const t = window.notify?.loading(tr('جاري الحفظ...'));
    try {
      let coverUrl = activity?.cover_image_url || null;
      if (imageFile) coverUrl = await uploadImage(imageFile, 'activities');
      const payload = {
        title,
        category: values.category.trim() || null,
        target_audience: values.target_audience.trim() || null,
        date: values.date || null,
        time: values.time.trim() || null,
        location: values.location.trim() || null,
        description: values.description || null,
        cover_image_url: coverUrl,
      };
      // الترجمات (0015): تُرسل فقط إن كان العمود موجودًا أصلًا (عند التعديل) أو كُتب فيها شيء
      const cleaned = cleanTr(translations, TR_MAX);
      if ((isEdit && 'translations' in activity) || hasTr(cleaned)) payload.translations = cleaned;
      const result = await saveActivity(activity, payload);
      t?.remove();
      window.notify?.success(tr('تم حفظ النشاط بنجاح'));
      if (result?.degraded) {
        window.notify?.info(tr('حُفظ النص العربي فقط، أما الترجمات فتحتاج تشغيل ملف SQL رقم 0015 في Supabase أولًا.'));
      }
      onSaved();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر حفظ النشاط، حاول مرة أخرى.'));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{isEdit ? tr('تعديل نشاط') : tr('إضافة نشاط جديد')}</h3>
      <form onSubmit={handleSubmit}>
        <div className="admin-form-group">
          <label htmlFor="f_title">{tr('العنوان *')}</label>
          <input id="f_title" name="title" className="admin-input" required value={values.title} onChange={handleChange} />
        </div>
        <div className="admin-form-grid-2">
          <div className="admin-form-group">
            <label htmlFor="f_category">{tr('الفئة')}</label>
            <input id="f_category" name="category" className="admin-input" value={values.category} onChange={handleChange} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="f_target">{tr('الفئة المستهدفة')}</label>
            <input id="f_target" name="target_audience" className="admin-input" value={values.target_audience} onChange={handleChange} />
          </div>
        </div>
        <div className="admin-form-grid-2">
          <div className="admin-form-group">
            <label htmlFor="f_date">{tr('التاريخ')}</label>
            <input id="f_date" name="date" type="date" className="admin-input" value={values.date} onChange={handleChange} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="f_time">{tr('الوقت')}</label>
            <input id="f_time" name="time" className="admin-input" value={values.time} onChange={handleChange} />
          </div>
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_location">{tr('المكان')}</label>
          <input id="f_location" name="location" className="admin-input" value={values.location} onChange={handleChange} />
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_image">{tr('صورة الغلاف')}</label>
          <input id="f_image" type="file" accept="image/*" className="admin-input" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
          {activity?.cover_image_url && (
            <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
              {tr('صورة حالية موجودة، اختر ملفًا جديدًا فقط لاستبدالها.')}
            </div>
          )}
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_description">{tr('الوصف')}</label>
          <textarea id="f_description" name="description" className="admin-textarea" style={{ minHeight: 140 }} value={values.description} onChange={handleChange} />
        </div>
        <TranslationTabs
          translations={translations}
          onChange={setTranslations}
          fields={ACTIVITY_TR_FIELDS}
          source={{ title: values.title, category: values.category, target_audience: values.target_audience, location: values.location, description: values.description.replace(/<[^>]*>/g, ' ').slice(0, 120) }}
          list={{
            key: 'sub_activities',
            label: tr('ترجمة المشاريع الفرعية'),
            items: subActivities,
            itemLabel: (item, i) => `${i + 1}. ${item?.title || ''}`,
            fields: [
              { key: 'title', label: tr('العنوان'), max: 300 },
              { key: 'desc', label: tr('الوصف'), rows: 2, max: 1000 },
            ],
          }}
        />
        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
            {isEdit ? tr('حفظ التعديلات') : tr('حفظ كمسودة')}
          </button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{tr('إلغاء')}</button>
        </div>
      </form>
    </Modal>
  );
}
