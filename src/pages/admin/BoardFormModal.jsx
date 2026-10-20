import { useState } from 'react';
import Modal from '../../components/admin/Modal';
import { uploadImage } from '../../services/supabase/storage.service';
import { saveBoardMember } from '../../services/supabase/adminBoard.service';
import PublicProfileFields, {
  BOARD_TR_FIELDS,
  initProfileState,
  buildProfile,
  applyProfileToPayload,
} from '../../components/admin/PublicProfileFields';

export default function BoardFormModal({ member, onClose, onSaved }) {
  const isEdit = !!member;
  const [values, setValues] = useState({
    full_name: member?.full_name || '',
    position: member?.position || '',
    university: member?.university || '',
    promotion: member?.promotion || '',
    track: member?.track || '',
    bio: member?.bio || '',
    is_active: member?.is_active !== false,
  });
  const [profile, setProfile] = useState(() => initProfileState(member, BOARD_TR_FIELDS));
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleChange = (e) => {
    const { name, type, checked, value } = e.target;
    setValues((v) => ({ ...v, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const full_name = values.full_name.trim();
    const position = values.position.trim();
    if (!full_name || !position) {
      window.notify?.error('الاسم والصفة مطلوبان');
      return;
    }
    // الملف العام + الترجمات: التحقق من الروابط وبناء الحمولة (نفس منطق نموذج الأعضاء)
    const built = buildProfile(profile, member, BOARD_TR_FIELDS);
    if (built.error) {
      window.notify?.error(built.error);
      return;
    }
    setSaving(true);
    const t = window.notify?.loading('جاري الحفظ...');
    try {
      const payload = {
        full_name,
        position,
        university: values.university.trim() || null,
        bio: values.bio.trim() || null,
        is_active: values.is_active,
      };
      // سنة التخرج والتخصص (migration 0012): تُرسل فقط إن كان العمودان موجودين أصلًا أو كُتب فيهما شيء
      const promotion = values.promotion.trim();
      const track = values.track.trim();
      if ((isEdit && 'promotion' in member) || promotion) payload.promotion = promotion || null;
      if ((isEdit && 'track' in member) || track) payload.track = track || null;
      // أعمدة الملف العام والترجمات (0011): تُرسل فقط إن كانت موجودة أصلًا أو كُتب فيها شيء
      applyProfileToPayload(payload, built, member, isEdit);
      if (photoFile) payload.photo_url = await uploadImage(photoFile, 'board');
      const result = await saveBoardMember(member, payload);
      t?.remove();
      window.notify?.success('تم الحفظ بنجاح');
      if (result?.degraded) {
        window.notify?.info('حُفظت البيانات الأساسية، أما الملف العام والترجمات فيحتاجان تشغيل ملفي SQL رقم 0011 و0012 في Supabase أولًا.');
      }
      onSaved();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, 'تعذر الحفظ');
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{isEdit ? 'تعديل' : 'إضافة'} عضو مكتب</h3>
      <form onSubmit={handleSubmit}>
        <div className="admin-form-group">
          <label htmlFor="f_name">الاسم الكامل *</label>
          <input id="f_name" name="full_name" className="admin-input" required value={values.full_name} onChange={handleChange} />
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_photo">الصورة الشخصية</label>
          <input id="f_photo" type="file" accept="image/*" className="admin-input" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
          {member?.photo_url && (
            <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
              صورة حالية موجودة، اختر ملفًا جديدًا فقط لاستبدالها.
            </div>
          )}
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_position">الصفة *</label>
          <input id="f_position" name="position" className="admin-input" required placeholder="مثال: الرئيس، الكاتب العام..." value={values.position} onChange={handleChange} />
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_uni">الجامعة/الإطار</label>
          <input id="f_uni" name="university" className="admin-input" value={values.university} onChange={handleChange} />
        </div>
        <div className="admin-form-grid-2">
          <div className="admin-form-group">
            <label htmlFor="f_promotion">سنة التخرج (الدفعة)</label>
            <input id="f_promotion" name="promotion" className="admin-input" maxLength={60} value={values.promotion} onChange={handleChange} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="f_track">التخصص (الشعبة)</label>
            <input id="f_track" name="track" className="admin-input" maxLength={200} value={values.track} onChange={handleChange} />
          </div>
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_bio">نبذة مختصرة (تظهر على بطاقة المكتب)</label>
          <textarea id="f_bio" name="bio" className="admin-textarea" rows={3} value={values.bio} onChange={handleChange} />
        </div>
        <PublicProfileFields
          profile={profile}
          setProfile={setProfile}
          trFields={BOARD_TR_FIELDS}
          source={{ position: values.position, bio: values.bio, track: values.track }}
          bioLabel="النبذة العامة (تظهر في نافذة الملف الشخصي)"
        />
        <div className="admin-form-group">
          <label>
            <input type="checkbox" name="is_active" checked={values.is_active} onChange={handleChange} /> نشط ويظهر في الموقع
          </label>
        </div>
        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>حفظ</button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}
