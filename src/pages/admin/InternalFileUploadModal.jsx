import { useState } from 'react';
import Modal from '../../components/admin/Modal';
import { uploadInternalFile } from '../../services/supabase/internalFiles.service';
import {
  INTERNAL_FILE_ACCEPT, INTERNAL_FILE_CATEGORIES, INTERNAL_FILE_MAX_BYTES, formatBytes, validateInternalFile,
} from '../../utils/internalFiles';

import { tr } from '../../i18n/adminDict';

const REASON_TEXT = {
  empty: 'الملف فارغ أو لم يتم اختياره.',
  type: 'نوع الملف غير مدعوم. المسموح: PDF وWord وExcel وPowerPoint وصور وCSV وTXT وZIP.',
  size: 'حجم الملف أكبر من الحد المسموح (20MB).',
};

export default function InternalFileUploadModal({ onClose, onSaved }) {
  const [values, setValues] = useState({ title: '', category: 'administrative', description: '' });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleChange = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }));

  const handleFile = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    // Le titre est pré-rempli avec le nom du fichier (sans extension) s'il est encore vide
    if (f && !values.title.trim()) setValues((v) => ({ ...v, title: f.name.replace(/\.[^.]*$/, '').slice(0, 200) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const title = values.title.trim();
    if (!title) {
      window.notify?.error(tr('العنوان مطلوب'));
      return;
    }
    const check = validateInternalFile(file);
    if (!check.ok) {
      window.notify?.error(tr(REASON_TEXT[check.reason]));
      return;
    }
    setSaving(true);
    const t = window.notify?.loading(tr('جاري رفع الملف...'));
    try {
      await uploadInternalFile(file, { title, category: values.category, description: values.description.trim() });
      t?.remove();
      window.notify?.success(tr('تم رفع الملف بنجاح'));
      onSaved();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر رفع الملف، حاول مرة أخرى.'));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{tr('رفع ملف داخلي')}</h3>
      <form onSubmit={handleSubmit}>
        <div className="admin-form-group">
          <label htmlFor="if_file">{tr('الملف *')}</label>
          <input id="if_file" type="file" required accept={INTERNAL_FILE_ACCEPT} className="admin-input" onChange={handleFile} />
          <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
            {tr('الحد الأقصى {{size}} — لا يُنشر الملف علنًا أبدًا.', { size: formatBytes(INTERNAL_FILE_MAX_BYTES) })}
          </div>
        </div>
        <div className="admin-form-group">
          <label htmlFor="if_title">{tr('العنوان *')}</label>
          <input id="if_title" name="title" className="admin-input" required maxLength={200} value={values.title} onChange={handleChange} />
        </div>
        <div className="admin-form-group">
          <label htmlFor="if_category">{tr('الفئة')}</label>
          <select id="if_category" name="category" className="admin-select" value={values.category} onChange={handleChange}>
            {INTERNAL_FILE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{tr(label)}</option>)}
          </select>
        </div>
        <div className="admin-form-group">
          <label htmlFor="if_desc">{tr('الوصف')}</label>
          <textarea id="if_desc" name="description" className="admin-textarea" style={{ minHeight: 80 }} maxLength={1000} value={values.description} onChange={handleChange} />
        </div>
        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>{tr('رفع الملف')}</button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{tr('إلغاء')}</button>
        </div>
      </form>
    </Modal>
  );
}
