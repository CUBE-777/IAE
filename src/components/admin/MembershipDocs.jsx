import { useState } from 'react';
import { useAuth } from '../../app/providers/AuthProvider';
import { getMembershipDocUrl } from '../../services/supabase/membershipFlow.service';
import { tr } from '../../i18n/adminDict';

// نفس أدوار can_manage_members() في SQL (migration 0019): لا يرى البطاقة الوطنية غيرهم
const DOC_ROLES = ['developer', 'super_admin', 'deputy_super_admin', 'members_manager', 'secretary_general', 'deputy_secretary_general'];

const DOCS = [
  ['photo_path', 'عرض الصورة الشخصية'],
  ['id_card_path', 'عرض البطاقة الوطنية'],
];

/**
 * أزرار فتح الوثائق المرفقة بنموذج الانخراط (صورة شخصية + بطاقة وطنية).
 * `data` = بيانات النموذج (membership_forms.data أو member_private.form_data).
 * كل فتح يمرّ بدالة SQL تسجّل الاطلاع في سجل العمليات، والرابط مؤقت (دقيقتان).
 */
export default function MembershipDocs({ data }) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState('');
  const items = DOCS.filter(([key]) => data && typeof data[key] === 'string' && data[key]);

  if (!items.length || !DOC_ROLES.includes(profile?.role)) return null;

  const open = async (key) => {
    // نفتح التبويب فورًا (ضمن نقرة المستخدم) كي لا يحجبه المتصفح بعد الانتظار
    const win = window.open('', '_blank');
    setBusy(key);
    try {
      const url = await getMembershipDocUrl(data[key]);
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch (err) {
      if (win) win.close();
      window.notify?.fromError(err, tr('تعذر فتح الملف'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '8px 0' }}>
      <strong>{tr('وثائق مرفقة')}:</strong>
      {items.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className="admin-btn admin-btn-ghost admin-btn-sm"
          disabled={busy === key}
          onClick={() => open(key)}
        >
          {tr(label)}
        </button>
      ))}
    </div>
  );
}
