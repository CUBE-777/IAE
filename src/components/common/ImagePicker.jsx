import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * منتقي صورة بمعاينة (للنماذج العامة).
 * - shape="avatar": دائرة للصورة الشخصية. shape="card": مستطيل بنسبة بطاقة التعريف.
 * - `file` / `onPick(file|null)`: الحالة يملكها النموذج الأب. `error` = مفتاح ترجمة.
 * - حقل الملف مخفي بصريًا لكنه قابل للتركيز (لوحة المفاتيح وقارئ الشاشة)، والخطأ بـ role="alert".
 */
export default function ImagePicker({ id, label, hint, required = false, error, file, onPick, shape = 'card', disabled = false }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const handleChange = (e) => {
    const picked = e.target.files && e.target.files[0];
    if (picked) onPick(picked);
    e.target.value = ''; // يسمح باختيار الملف نفسه مرة ثانية بعد إزالته
  };

  return (
    <div className={`field mf-picker mf-picker-${shape}${error ? ' field-invalid' : ''}`}>
      <span className="mf-picker-label" id={`${id}-label`}>
        {label}
        {required && <span className="field-required" aria-hidden="true"> *</span>}
      </span>

      <div className="mf-picker-body">
        <input
          ref={inputRef}
          id={id}
          className="mf-picker-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleChange}
          disabled={disabled}
          aria-labelledby={`${id}-label`}
          aria-invalid={error ? 'true' : undefined}
          aria-required={required || undefined}
          aria-describedby={describedBy}
        />
        <label htmlFor={id} className={`mf-picker-drop${preview ? ' has-image' : ''}`} aria-hidden="true">
          {preview ? (
            <img src={preview} alt="" />
          ) : (
            <span className="mf-picker-empty">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2.5" />
                <circle cx="9" cy="11" r="2" />
                <path d="m21 16-5-5-8 8" />
              </svg>
              <span>{t('membershipForm.picker.empty')}</span>
            </span>
          )}
        </label>

        <div className="mf-picker-actions">
          <button type="button" className="btn btn-ghost mf-picker-btn" onClick={() => inputRef.current?.click()} disabled={disabled}>
            {file ? t('membershipForm.picker.change') : t('membershipForm.picker.choose')}
          </button>
          {file && (
            <button type="button" className="mf-picker-remove" onClick={() => onPick(null)} disabled={disabled}>
              {t('membershipForm.picker.remove')}
            </button>
          )}
        </div>
      </div>

      {hint && <p className="mf-hint" id={hintId}>{hint}</p>}
      {error && <p className="field-error" id={errorId} role="alert">{t(error)}</p>}
    </div>
  );
}
