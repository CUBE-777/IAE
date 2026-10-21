import { useState } from 'react';
import Modal from '../../components/admin/Modal';
import { uploadImage } from '../../services/supabase/storage.service';
import { createMember, updateMember } from '../../services/supabase/adminMembers.service';
import { SOCIAL_PLATFORMS, isKnownPlatform, normalizeSocialUrl } from '../../constants/socialPlatforms';

import { tr } from '../../i18n/adminDict';
const MAX_EXTRA_ITEMS = 8;

const emptyForm = {
  full_name: '', university: '', promotion: '', track: '', profession: '', city: '', email: '', phone: '', status: 'active', bio: '',
  public_bio: '', study_path: '', socials: {},
};

export default function MemberFormModal({ member, onClose, onSaved }) {
  const isEdit = !!member;
  const [values, setValues] = useState(
    member
      ? {
          full_name: member.full_name || '',
          university: member.university || '',
          promotion: member.promotion || '',
          track: member.track || '',
          profession: member.profession || '',
          city: member.city || '',
          email: member.email || '',
          phone: member.phone || '',
          status: member.status === 'inactive' ? 'inactive' : 'active',
          bio: member.bio || '',
          public_bio: member.public_bio || '',
          study_path: member.study_path || '',
          socials: member.socials && typeof member.socials === 'object' && !Array.isArray(member.socials) ? { ...member.socials } : {},
        }
      : emptyForm
  );
  const [extraItems, setExtraItems] = useState(
    member && member.extra && Array.isArray(member.extra.items)
      ? member.extra.items.map((it) => ({ label: it.label || '', value: it.value || '' }))
      : []
  );
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleChange = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }));
  const handleSocial = (key, val) => setValues((v) => ({ ...v, socials: { ...v.socials, [key]: val } }));
  const setExtra = (i, field, val) => setExtraItems((list) => list.map((it, idx) => (idx === i ? { ...it, [field]: val } : it)));
  const addExtra = () => setExtraItems((list) => (list.length >= MAX_EXTRA_ITEMS ? list : [...list, { label: '', value: '' }]));
  const removeExtra = (i) => setExtraItems((list) => list.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!values.full_name.trim()) {
      window.notify?.error(tr('الاسم الكامل مطلوب'));
      return;
    }
    // الروابط: كل رابط غير فارغ يجب أن يكون رابط http/https صالحًا، ويُحفظ منظَّفًا.
    const socials = {};
    for (const [key, raw] of Object.entries(values.socials)) {
      const val = String(raw || '').trim();
      if (!val) continue;
      if (!isKnownPlatform(key)) {
        socials[key] = val; // مفتاح غير معروف (من نسخة مستقبلية): نُبقيه كما هو
        continue;
      }
      const href = normalizeSocialUrl(val);
      if (!href) {
        const label = SOCIAL_PLATFORMS.find((p) => p.key === key)?.label || key;
        window.notify?.error(tr('رابط غير صالح: {{label}}', { label: label }));
        return;
      }
      socials[key] = href;
    }
    const items = extraItems
      .map((it) => ({ label: it.label.trim().slice(0, 40), value: it.value.trim().slice(0, 200) }))
      .filter((it) => it.label && it.value);

    setSaving(true);
    const payload = {
      full_name: values.full_name.trim(),
      university: values.university.trim() || null,
      promotion: values.promotion.trim() || null,
      track: values.track.trim() || null,
      profession: values.profession.trim() || null,
      city: values.city.trim() || null,
      email: values.email.trim() || null,
      phone: values.phone.trim() || null,
      status: values.status,
      bio: values.bio.trim() || null,
    };

    // حقول الملف العام (migration 0010): تُرسل فقط إن كانت الأعمدة موجودة أصلًا (عند التعديل)
    // أو إن كتب المسؤول فيها شيئًا، فلا يتأثر الحفظ العادي إن لم يُشغَّل ملف SQL بعد.
    const columnsExist = isEdit && 'socials' in member;
    const extra = { ...((member && member.extra && typeof member.extra === 'object') ? member.extra : {}) };
    if (items.length) extra.items = items; else delete extra.items;
    const profile = {
      public_bio: values.public_bio.trim() || null,
      study_path: values.study_path.trim() || null,
      socials,
      extra,
    };
    const filled = {
      public_bio: !!profile.public_bio,
      study_path: !!profile.study_path,
      socials: Object.keys(socials).length > 0,
      extra: items.length > 0,
    };
    Object.keys(profile).forEach((k) => {
      if (columnsExist || filled[k]) payload[k] = profile[k];
    });
    const loadingToast = window.notify?.loading(isEdit ? tr('جاري حفظ التعديلات...') : tr('جاري إضافة العضو...'));
    try {
      if (photoFile) {
        payload.photo_url = await uploadImage(photoFile, 'members');
      }
      let result;
      if (isEdit) {
        result = await updateMember(member.id, payload);
        loadingToast?.remove();
        window.notify?.success(tr('تم حفظ التعديلات بنجاح'));
      } else {
        result = await createMember(payload);
        loadingToast?.remove();
        window.notify?.success(tr('تمت إضافة العضو بنجاح'));
      }
      if (result?.degraded) {
        window.notify?.info(tr('حُفظت البيانات الأساسية، أما الملف العام (النبذة/المسار/الروابط) فيحتاج تشغيل ملف SQL الخاص به في Supabase أولًا.'));
      }
      onSaved();
    } catch (err) {
      loadingToast?.remove();
      window.notify?.fromError(err, tr('تعذر حفظ البيانات، حاول مرة أخرى.'));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{isEdit ? tr('تعديل عضو') : tr('إضافة عضو جديد')}</h3>
      <form onSubmit={handleSubmit}>
        <div className="admin-form-group">
          <label htmlFor="f_full_name">{tr('الاسم الكامل *')}</label>
          <input id="f_full_name" name="full_name" className="admin-input" required value={values.full_name} onChange={handleChange} />
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_photo">{tr('الصورة الشخصية')}</label>
          <input id="f_photo" type="file" accept="image/*" className="admin-input" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
          {member?.photo_url && (
            <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
              {tr('صورة حالية موجودة، اختر ملفًا جديدًا فقط لاستبدالها.')}
            </div>
          )}
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_university">{tr('الجامعة / المعهد (اختصار)')}</label>
          <input id="f_university" name="university" className="admin-input" maxLength={60} placeholder={tr('مثال: FSA، ENSA، ISTA')} value={values.university} onChange={handleChange} />
          <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
            {tr('يظهر تحت صورة العضو في الموقع كما تكتبه تمامًا، فاكتب الاختصار.')}
          </div>
        </div>
        <div className="admin-form-grid-2">
          <div className="admin-form-group">
            <label htmlFor="f_promotion">{tr('الدفعة')}</label>
            <input id="f_promotion" name="promotion" className="admin-input" value={values.promotion} onChange={handleChange} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="f_track">{tr('الشعبة')}</label>
            <input id="f_track" name="track" className="admin-input" value={values.track} onChange={handleChange} />
          </div>
        </div>
        <div className="admin-form-grid-2">
          <div className="admin-form-group">
            <label htmlFor="f_profession">{tr('المهنة')}</label>
            <input id="f_profession" name="profession" className="admin-input" value={values.profession} onChange={handleChange} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="f_city">{tr('المدينة')}</label>
            <input id="f_city" name="city" className="admin-input" value={values.city} onChange={handleChange} />
          </div>
        </div>
        <div className="admin-form-grid-2">
          <div className="admin-form-group">
            <label htmlFor="f_email">{tr('البريد الإلكتروني')}</label>
            <input id="f_email" name="email" type="email" className="admin-input" value={values.email} onChange={handleChange} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="f_phone">{tr('الهاتف')}</label>
            <input id="f_phone" name="phone" className="admin-input" value={values.phone} onChange={handleChange} />
          </div>
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_status">{tr('الحالة')}</label>
          <select id="f_status" name="status" className="admin-select" value={values.status} onChange={handleChange}>
            <option value="active">{tr('نشط')}</option>
            <option value="inactive">{tr('غير نشط')}</option>
          </select>
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_bio">{tr('ملاحظات داخلية (لا تظهر للزوار)')}</label>
          <textarea id="f_bio" name="bio" className="admin-textarea" rows={2} value={values.bio} onChange={handleChange} />
        </div>

        <fieldset style={{ border: '1px solid var(--admin-border)', borderRadius: 12, padding: '12px 14px', margin: '4px 0 14px' }}>
          <legend style={{ padding: '0 8px', fontWeight: 700, fontSize: '.9rem' }}>{tr('الملف العام — اختياري (يظهر في الموقع)')}</legend>
          <div className="admin-form-group">
            <label htmlFor="f_public_bio">{tr('نبذة عن العضو')}</label>
            <textarea id="f_public_bio" name="public_bio" className="admin-textarea" rows={3} maxLength={600} value={values.public_bio} onChange={handleChange} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="f_study_path">{tr('المسار الدراسي')}</label>
            <textarea id="f_study_path" name="study_path" className="admin-textarea" rows={3} maxLength={800} placeholder={tr('مثال: باكالوريا علوم فيزيائية 2024 ← الكلية المتعددة التخصصات ← إجازة في المعلوميات')} value={values.study_path} onChange={handleChange} />
          </div>
          <div className="admin-form-group">
            <label>{tr('حسابات التواصل (الصق الرابط)')}</label>
            <div className="admin-form-grid-2">
              {SOCIAL_PLATFORMS.map((p) => (
                <input
                  key={p.key}
                  className="admin-input"
                  dir="ltr"
                  aria-label={tr(p.label)}
                  placeholder={`${tr(p.label)} — ${p.placeholder}`}
                  value={values.socials[p.key] || ''}
                  onChange={(e) => handleSocial(p.key, e.target.value)}
                />
              ))}
            </div>
          </div>
          <div className="admin-form-group" style={{ marginBottom: 0 }}>
            <label>{tr('معلومات إضافية (عنوان + قيمة، مثل: اللغات ← العربية، الفرنسية)')}</label>
            {extraItems.map((it, i) => (
              <div key={i} className="admin-form-grid-2" style={{ alignItems: 'center', marginBottom: 8 }}>
                <input className="admin-input" aria-label={tr('العنوان')} placeholder={tr('العنوان')} maxLength={40} value={it.label} onChange={(e) => setExtra(i, 'label', e.target.value)} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="admin-input" aria-label={tr('القيمة')} placeholder={tr('القيمة')} maxLength={200} value={it.value} onChange={(e) => setExtra(i, 'value', e.target.value)} />
                  <button type="button" className="admin-btn admin-btn-ghost" aria-label={tr('حذف هذا الحقل')} onClick={() => removeExtra(i)}>×</button>
                </div>
              </div>
            ))}
            {extraItems.length < MAX_EXTRA_ITEMS && (
              <button type="button" className="admin-btn admin-btn-ghost" onClick={addExtra}>{tr('+ إضافة معلومة')}</button>
            )}
          </div>
        </fieldset>
        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
            {isEdit ? tr('حفظ التعديلات') : tr('إضافة العضو')}
          </button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{tr('إلغاء')}</button>
        </div>
      </form>
    </Modal>
  );
}
