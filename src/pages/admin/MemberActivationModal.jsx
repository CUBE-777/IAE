import { useState } from 'react';
import Modal from '../../components/admin/Modal';
import { issueMemberActivationLink } from '../../services/supabase/memberSpace.service';
import { buildWhatsappLink } from '../../utils/whatsapp';
import { tr, trStrong, dateLocale } from '../../i18n/adminDict';

/**
 * رسالة واتساب بلغة العضو (لا بلغة واجهة الإدارة): يختار المسؤول اللغة. الرابط يحمل ?lang لتُفتح صفحة التفعيل بها.
 * {{name}} اسم العضو، {{url}} الرابط.
 */
const MESSAGES = {
  ar: {
    activate: 'مرحبًا {{name}}، تم إنشاء حسابك في فضاء المنخرطين بنادي IAE. فعّل حسابك واختر كلمة مرورك عبر هذا الرابط (صالح 7 أيام، ويُستعمل مرة واحدة):\n{{url}}',
    reset: 'مرحبًا {{name}}، هذا رابط استعادة الدخول إلى فضاء المنخرطين بنادي IAE. اختر كلمة مرور جديدة عبر الرابط (صالح 7 أيام، ويُستعمل مرة واحدة):\n{{url}}',
  },
  fr: {
    activate: "Bonjour {{name}}, votre compte de l'espace adhérents du club IAE est prêt. Activez-le et choisissez votre mot de passe via ce lien (valable 7 jours, à usage unique) :\n{{url}}",
    reset: "Bonjour {{name}}, voici le lien pour récupérer l'accès à l'espace adhérents du club IAE. Choisissez un nouveau mot de passe via ce lien (valable 7 jours, à usage unique) :\n{{url}}",
  },
  en: {
    activate: 'Hello {{name}}, your IAE club members\' space account is ready. Activate it and choose your password with this link (valid for 7 days, single use):\n{{url}}',
    reset: 'Hello {{name}}, here is your link to regain access to the IAE club members\' space. Choose a new password with it (valid for 7 days, single use):\n{{url}}',
  },
};
const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? '');

/**
 * يُصدر رابط تفعيل (أو استعادة دخول إن كان للعضو حساب). الإصدار يُبطل أي رابط سابق، فلا يتم إلا بضغطة صريحة.
 * الرمز لا يُخزَّن (مجزّأ فقط في القاعدة)، فيظهر هنا مرة واحدة ولا يمكن استرجاعه.
 */
export default function MemberActivationModal({ member, onClose }) {
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null); // { token, expires_at, existing }
  const [lang, setLang] = useState('ar');

  const issue = async () => {
    setBusy(true);
    try {
      setIssued(await issueMemberActivationLink(member.id));
    } catch (err) {
      window.notify?.fromError(err, tr('تعذر إنشاء الرابط'));
    } finally {
      setBusy(false);
    }
  };

  const url = issued ? `${window.location.origin}/member/activate/${issued.token}${lang === 'ar' ? '' : `?lang=${lang}`}` : '';
  const text = issued ? fill(MESSAGES[lang][issued.existing ? 'reset' : 'activate'], { name: member.full_name, url }) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      window.notify?.success(tr('تم نسخ الرابط'));
    } catch {
      window.notify?.info(tr('انسخ الرابط يدويًا من الخانة'));
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{tr('رابط تفعيل حساب العضو')}</h3>
      <p>{trStrong('رابط خاص بـ <strong>{{name}}</strong> ليفعّل حسابه في فضاء المنخرطين ويختار كلمة مروره بنفسه. يدخل ببريده المسجّل لدينا: {{email}}', { name: member.full_name, email: member.email || '—' })}</p>

      {!issued ? (
        <>
          {!member.email && <div className="admin-state-box">{tr('لا يوجد بريد لهذا العضو؛ أضفه من «تعديل» أولًا.')}</div>}
          <p style={{ color: 'var(--admin-text-muted)', fontSize: '.88rem' }}>{tr('إنشاء رابط جديد يُبطل أي رابط سابق لهذا العضو. إن كان له حساب فالرابط يتيح له اختيار كلمة مرور جديدة فقط (استعادة الدخول).')}</p>
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-primary" onClick={issue} disabled={busy || !member.email}>{tr('إنشاء رابط')}</button>
            <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{tr('إلغاء')}</button>
          </div>
        </>
      ) : (
        <>
          {issued.existing && <div className="admin-state-box">{tr('لهذا العضو حساب بالفعل: الرابط لاستعادة الدخول (تغيير كلمة المرور).')}</div>}
          <div className="admin-form-group">
            <label htmlFor="mal_lang">{tr('لغة الرسالة')}</label>
            <select id="mal_lang" className="admin-select" value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="ar">العربية</option>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="admin-form-group">
            <input className="admin-input" dir="ltr" readOnly value={url} onFocus={(e) => e.target.select()} aria-label={tr('رابط التفعيل')} />
            <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
              {tr('صالح حتى {{date}}. يظهر الرابط هنا مرة واحدة فقط.', { date: new Date(issued.expires_at).toLocaleDateString(dateLocale()) })}
            </div>
          </div>
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-primary" onClick={copy}>{tr('نسخ الرابط')}</button>
            <a className="admin-btn admin-btn-ghost" href={buildWhatsappLink(member.phone, text)} target="_blank" rel="noopener noreferrer">{tr('إرسال عبر واتساب')}</a>
            <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{tr('إغلاق')}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
