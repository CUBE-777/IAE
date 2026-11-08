import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** حقل كلمة مرور مع زر إظهار/إخفاء داخل الحقل. يمرّر خصائص الإتاحة القادمة من FormField. */
export default function PasswordInput({ label, show: shownProp, onToggle, ...inputProps }) {
  const { t } = useTranslation();
  const [inner, setInner] = useState(false);
  const controlled = typeof onToggle === 'function';
  const shown = controlled ? shownProp : inner;
  const toggle = controlled ? onToggle : () => setInner((v) => !v);
  return (
    <div className="pw-wrap">
      <input {...inputProps} type={shown ? 'text' : 'password'} dir="ltr" />
      <button type="button" className="pw-toggle" onClick={toggle} aria-pressed={shown} aria-label={label || t('member.login.show')}>
        {shown ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
      </button>
    </div>
  );
}
