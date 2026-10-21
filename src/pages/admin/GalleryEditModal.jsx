import { useState } from 'react';
import Modal from '../../components/admin/Modal';
import { updateGalleryItem } from '../../services/supabase/adminGallery.service';
import InlineTranslationInputs from '../../components/admin/InlineTranslationInputs';
import { cleanTr, hasTr } from '../../utils/translationForm';

import { tr } from '../../i18n/adminDict';
export default function GalleryEditModal({ item, activities, onClose, onSaved }) {
  const [title, setTitle] = useState(item.title || '');
  const [description, setDescription] = useState(item.description || '');
  const [activityId, setActivityId] = useState(item.activity_id || '');
  const [translations, setTranslations] = useState(
    item.translations && typeof item.translations === 'object' && !Array.isArray(item.translations) ? item.translations : {}
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const t = window.notify?.loading(tr('جاري الحفظ...'));
    try {
      const payload = {
        title: title.trim() || null,
        description: description.trim() || null,
        activity_id: activityId || null,
      };
      // الترجمات (0013): تُرسل فقط إن كان العمود موجودًا أصلًا أو كُتب فيها شيء
      const cleaned = cleanTr(translations, 600);
      if ('translations' in item || hasTr(cleaned)) payload.translations = cleaned;
      const result = await updateGalleryItem(item, payload);
      t?.remove();
      window.notify?.success(tr('تم الحفظ'));
      if (result?.degraded) {
        window.notify?.info(tr('حُفظ النص العربي فقط، أما الترجمات فتحتاج تشغيل ملف SQL رقم 0013 في Supabase أولًا.'));
      }
      onSaved();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر الحفظ'));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{tr('تعديل الصورة')}</h3>
      <img src={item.image_url} style={{ width: '100%', borderRadius: 10, marginBottom: 14 }} alt={item.title || ''} />
      <div className="admin-form-group">
        <label htmlFor="f_title">{tr('العنوان')}</label>
        <input id="f_title" className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        <InlineTranslationInputs id="f_title" translations={translations} onChange={setTranslations} trKey="title" placeholder={title} maxLength={200} />
      </div>
      <div className="admin-form-group">
        <label htmlFor="f_desc">{tr('الوصف')}</label>
        <textarea id="f_desc" className="admin-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        <InlineTranslationInputs id="f_desc" translations={translations} onChange={setTranslations} trKey="description" placeholder={description} rows={2} maxLength={600} />
      </div>
      <div className="admin-form-group">
        <label htmlFor="f_activity">{tr('ربط بنشاط')}</label>
        <select id="f_activity" className="admin-select" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
          <option value="">{tr('بدون ربط')}</option>
          {activities.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
      </div>
      <div className="admin-modal-actions">
        <button className="admin-btn admin-btn-primary" disabled={saving} onClick={handleSave}>{tr('حفظ')}</button>
        <button className="admin-btn admin-btn-ghost" onClick={onClose}>{tr('إلغاء')}</button>
      </div>
    </Modal>
  );
}
