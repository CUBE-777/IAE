import { useState } from 'react';
import Modal from '../../components/admin/Modal';
import TranslationTabs from '../../components/admin/TranslationTabs';
import { uploadImage, deleteImageByUrl } from '../../services/supabase/storage.service';
import { saveProject } from '../../services/supabase/adminProjects.service';
import { cleanTr } from '../../utils/translationForm';
import { parseTechnologies, isHttpsUrl, MAX_TECHNOLOGIES } from '../../utils/projects';

import { tr } from '../../i18n/adminDict';

const PROJECT_TR_FIELDS = [
  { key: 'title', label: 'العنوان', max: 200 },
  { key: 'summary', label: 'ملخص قصير', rows: 3, max: 400 },
  { key: 'description', label: 'الوصف', rows: 8, max: 10000 },
];

export default function ProjectFormModal({ project, onClose, onSaved }) {
  const isEdit = !!project;
  const [values, setValues] = useState({
    title: project?.title || '',
    summary: project?.summary || '',
    description: project?.description || '',
    status: project?.status || 'in_progress',
    technologies: (project?.technologies || []).join(', '),
    github_url: project?.github_url || '',
    demo_url: project?.demo_url || '',
    sort_order: project?.sort_order ?? 0,
  });
  const [translations, setTranslations] = useState(
    project?.translations && typeof project.translations === 'object' && !Array.isArray(project.translations) ? project.translations : {}
  );
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
    const github = values.github_url.trim();
    const demo = values.demo_url.trim();
    if ((github && !isHttpsUrl(github)) || (demo && !isHttpsUrl(demo))) {
      window.notify?.error(tr('يجب أن يبدأ الرابط بـ https:// ويكون صالحًا.'));
      return;
    }
    const order = Number.parseInt(values.sort_order, 10);
    if (!Number.isFinite(order) || order < 0 || order > 9999) {
      window.notify?.error(tr('ترتيب العرض رقم صحيح بين 0 و9999.'));
      return;
    }

    setSaving(true);
    const t = window.notify?.loading(tr('جاري الحفظ...'));
    let uploadedUrl = null;
    try {
      let imageUrl = project?.image_url || null;
      if (imageFile) {
        uploadedUrl = await uploadImage(imageFile, 'projects');
        imageUrl = uploadedUrl;
      }
      await saveProject(project, {
        title,
        summary: values.summary.trim() || null,
        description: values.description.trim() || null,
        status: values.status === 'completed' ? 'completed' : 'in_progress',
        technologies: parseTechnologies(values.technologies),
        github_url: github ? new URL(github).toString() : null,
        demo_url: demo ? new URL(demo).toString() : null,
        sort_order: order,
        image_url: imageUrl,
        translations: cleanTr(translations, 10000),
      });
      t?.remove();
      window.notify?.success(tr('تم حفظ المشروع بنجاح'));
      onSaved();
    } catch (err) {
      t?.remove();
      // Image envoyée mais projet non enregistré : on retire le fichier orphelin
      if (uploadedUrl) deleteImageByUrl(uploadedUrl);
      window.notify?.fromError(err, tr('تعذر حفظ المشروع، حاول مرة أخرى.'));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{isEdit ? tr('تعديل مشروع') : tr('إضافة مشروع جديد')}</h3>
      <form onSubmit={handleSubmit}>
        <div className="admin-form-group">
          <label htmlFor="p_title">{tr('العنوان *')}</label>
          <input id="p_title" name="title" className="admin-input" required maxLength={200} value={values.title} onChange={handleChange} />
        </div>
        <div className="admin-form-group">
          <label htmlFor="p_summary">{tr('ملخص قصير')}</label>
          <textarea id="p_summary" name="summary" className="admin-textarea" style={{ minHeight: 70 }} maxLength={400} value={values.summary} onChange={handleChange} />
        </div>
        <div className="admin-form-group">
          <label htmlFor="p_description">{tr('الوصف')}</label>
          <textarea id="p_description" name="description" className="admin-textarea" style={{ minHeight: 140 }} maxLength={10000} value={values.description} onChange={handleChange} />
          <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>{tr('نص عادي بدون HTML؛ تُحفظ الأسطر الجديدة.')}</div>
        </div>
        <div className="admin-form-grid-2">
          <div className="admin-form-group">
            <label htmlFor="p_status">{tr('حالة المشروع')}</label>
            <select id="p_status" name="status" className="admin-select" value={values.status} onChange={handleChange}>
              <option value="in_progress">{tr('قيد التنفيذ')}</option>
              <option value="completed">{tr('منجز')}</option>
            </select>
          </div>
          <div className="admin-form-group">
            <label htmlFor="p_order">{tr('ترتيب العرض')}</label>
            <input id="p_order" name="sort_order" type="number" min="0" max="9999" className="admin-input" value={values.sort_order} onChange={handleChange} />
          </div>
        </div>
        <div className="admin-form-group">
          <label htmlFor="p_tech">{tr('التقنيات (مفصولة بفواصل)')}</label>
          <input id="p_tech" name="technologies" dir="ltr" className="admin-input" placeholder="Python, ESP32, TensorFlow Lite" value={values.technologies} onChange={handleChange} />
          <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
            {tr('حتى {{max}} تقنية، تُحذف المكررات تلقائيًا.', { max: MAX_TECHNOLOGIES })}
          </div>
        </div>
        <div className="admin-form-grid-2">
          <div className="admin-form-group">
            <label htmlFor="p_github">{tr('رابط GitHub')}</label>
            <input id="p_github" name="github_url" type="url" dir="ltr" className="admin-input" placeholder="https://github.com/..." maxLength={500} value={values.github_url} onChange={handleChange} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="p_demo">{tr('رابط العرض / التجربة')}</label>
            <input id="p_demo" name="demo_url" type="url" dir="ltr" className="admin-input" placeholder="https://..." maxLength={500} value={values.demo_url} onChange={handleChange} />
          </div>
        </div>
        <div className="admin-form-group">
          <label htmlFor="p_image">{tr('صورة الغلاف')}</label>
          <input id="p_image" type="file" accept="image/*" className="admin-input" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
          {project?.image_url && (
            <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
              {tr('صورة حالية موجودة، اختر ملفًا جديدًا فقط لاستبدالها.')}
            </div>
          )}
        </div>
        <TranslationTabs
          translations={translations}
          onChange={setTranslations}
          fields={PROJECT_TR_FIELDS}
          source={{ title: values.title, summary: values.summary, description: values.description.slice(0, 120) }}
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
