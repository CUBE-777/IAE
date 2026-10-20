import { useState } from 'react';
import Modal from '../../components/admin/Modal';
import { createAdminProfile, updateAdminProfile } from '../../services/supabase/adminUsers.service';
import { useAuth } from '../../app/providers/AuthProvider';

export default function AdminUserFormModal({ profile, onClose, onSaved }) {
  const isEdit = !!profile;
  const { profile: me } = useAuth();
  const iAmDeveloper = me?.role === 'developer';
  const [values, setValues] = useState({
    full_name: profile?.full_name || '',
    email: profile?.email || '',
    role: profile?.role || 'editor',
    password: '',
    is_active: profile?.is_active !== false,
  });
  const [saving, setSaving] = useState(false);

  // كلمة مرور عشوائية بلا أحرف ملتبسة (0/O و1/l/I) ليسهل نقلها للمسؤول الجديد
  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = new Uint32Array(12);
    crypto.getRandomValues(bytes);
    const pwd = Array.from(bytes, (b) => chars[b % chars.length]).join('');
    setValues((v) => ({ ...v, password: pwd }));
  };

  const handleChange = (e) => {
    const { name, type, checked, value } = e.target;
    setValues((v) => ({ ...v, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const full_name = values.full_name.trim();
    const email = values.email.trim();
    if (!full_name || !email) {
      window.notify?.error('الاسم والبريد مطلوبان');
      return;
    }
    if (!isEdit && values.password.length < 8) {
      window.notify?.error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
      return;
    }
    setSaving(true);
    const t = window.notify?.loading('جاري الحفظ...');
    try {
      if (isEdit) {
        // البريد لا يُرسل: مصدره Supabase Auth ولا يُعدَّل من هنا (تفادي بيانات غير متزامنة)
        await updateAdminProfile(profile, { full_name, role: values.role, is_active: values.is_active });
        t?.remove();
        window.notify?.success('تم الحفظ بنجاح');
      } else {
        await createAdminProfile({ email, full_name, role: values.role, password: values.password });
        t?.remove();
        window.notify?.success('تم إنشاء المسؤول. سلّمه البريد وكلمة المرور ليدخل من صفحة تسجيل الدخول.');
      }
      onSaved();
    } catch (err) {
      t?.remove();
      if (err.userMessage) window.notify?.error(err.userMessage);
      else window.notify?.fromError(err, isEdit ? 'تعذر الحفظ' : 'تعذر إنشاء المسؤول');
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{isEdit ? 'تعديل صلاحيات' : 'إنشاء مسؤول جديد'}</h3>
      <form onSubmit={handleSubmit}>
        <div className="admin-form-group">
          <label htmlFor="f_name">الاسم الكامل *</label>
          <input id="f_name" name="full_name" className="admin-input" required value={values.full_name} onChange={handleChange} />
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_email">البريد الإلكتروني *</label>
          <input
            id="f_email"
            name="email"
            type="email"
            className="admin-input"
            required
            dir="ltr"
            placeholder="name@example.com"
            value={values.email}
            onChange={handleChange}
            readOnly={isEdit}
            aria-readonly={isEdit || undefined}
            aria-describedby={isEdit ? 'f_email_hint' : undefined}
          />
          {isEdit && (
            <p className="admin-hint" id="f_email_hint">
              لا يمكن تغيير البريد من هنا لأنه مرتبط بحساب الدخول في Supabase Auth.
            </p>
          )}
        </div>
        {!isEdit && (
          <div className="admin-form-group">
            <label htmlFor="f_password">كلمة المرور *</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="f_password"
                name="password"
                type="text"
                className="admin-input"
                dir="ltr"
                autoComplete="off"
                minLength={8}
                required
                value={values.password}
                onChange={handleChange}
              />
              <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={generatePassword}>
                توليد
              </button>
            </div>
            <p className="admin-hint">8 أحرف على الأقل. انسخها وسلّمها للمسؤول الجديد، ويمكنه تغييرها لاحقًا.</p>
          </div>
        )}
        <div className="admin-form-group">
          <label htmlFor="f_role">الدور</label>
          <select id="f_role" name="role" className="admin-select" value={values.role} onChange={handleChange}>
            <option value="editor">محرر</option>
            <option value="members_manager">مسؤول الأعضاء</option>
            <option value="treasurer">أمين المال</option>
            <option value="super_admin">مسؤول أعلى</option>
            {iAmDeveloper && <option value="developer">مطوّر</option>}
          </select>
        </div>
        {isEdit && (
          <div className="admin-form-group">
            <label>
              <input type="checkbox" name="is_active" checked={values.is_active} onChange={handleChange} /> حساب نشط
            </label>
          </div>
        )}
        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>حفظ</button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}
