import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { MoveButtons, moveItem } from '../components/adminUi';
import { nextId } from './builderModel';

/** حقل نص بلغة التحرير الحالية. عند غياب الترجمة يعرض نص اللغة الافتراضية كـ placeholder (fallback). */
export function LText({ label, value, onChange, lang, defaultLang, multiline = false, rows = 2, maxLength = 300, hint, error, ariaLabel }) {
  const id = useId();
  const v = value || {};
  const props = {
    id, lang, maxLength, 'aria-label': label ? undefined : ariaLabel, dir: lang === 'ar' ? 'rtl' : 'ltr',
    className: multiline ? 'admin-textarea' : 'admin-input',
    value: v[lang] || '',
    placeholder: lang !== defaultLang ? v[defaultLang] || '' : '',
    onChange: (e) => onChange({ ...v, [lang]: e.target.value }),
  };
  return (
    <div className="admin-form-group">
      {label && <label htmlFor={id}>{label}</label>}
      {multiline ? <textarea rows={rows} {...props} /> : <input {...props} />}
      {hint && <p className="admin-hint">{hint}</p>}
      {error && <p className="admin-inline-error" role="alert">{error}</p>}
    </div>
  );
}

/** نص حرفي (كود/ناتج) لا يتغيّر بالترجمة. */
export function CodeField({ label, value, onChange, rows = 5, maxLength = 4000, hint }) {
  const id = useId();
  return (
    <div className="admin-form-group">
      {label && <label htmlFor={id}>{label}</label>}
      <textarea id={id} className="admin-textarea ga-code" dir="ltr" rows={rows} spellCheck={false} maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="admin-hint">{hint}</p>}
    </div>
  );
}

/**
 * قائمة اختيارات/عناصر. literal = نصوص حرفية (value) وإلا نصوص متعددة اللغات (text).
 * onCorrect (اختياري) يضيف زر اختيار الإجابة الصحيحة؛ order=false يخفي أزرار النقل.
 */
export function OptionList({ items, onChange, lang, defaultLang, literal = false, min, max, prefix = 'o', correct, onCorrect, group, moveable = true, label }) {
  const { t } = useTranslation();
  const set = (i, patch) => onChange(items.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const add = () => onChange([...items, { id: nextId(prefix, items), ...(literal ? { value: '' } : { text: { ar: '', fr: '', en: '' } }) }]);
  const remove = (i) => {
    const gone = items[i];
    onChange(items.filter((_, k) => k !== i));
    if (onCorrect && gone.id === correct) onCorrect(null);
  };
  return (
    <div className="gb-list" role="group" aria-label={label}>
      {items.map((o, i) => (
        <div className="gb-row" key={o.id}>
          {onCorrect && (
            <input type="radio" name={group} className="gb-radio" checked={correct === o.id} onChange={() => onCorrect(o.id)} aria-label={t('games.admin.builder.markCorrect')} title={t('games.admin.builder.markCorrect')} />
          )}
          <span className="gb-row-n" aria-hidden="true">{i + 1}</span>
          {literal ? (
            <input className="admin-input ga-code gb-grow" dir="ltr" spellCheck={false} maxLength={300} value={o.value} aria-label={`${label} ${i + 1}`} onChange={(e) => set(i, { value: e.target.value })} />
          ) : (
            <div className="gb-grow">
              <LText ariaLabel={`${label} ${i + 1}`} value={o.text} onChange={(text) => set(i, { text })} lang={lang} defaultLang={defaultLang} />
            </div>
          )}
          {moveable && <MoveButtons index={i} count={items.length} disabled={false} onMove={(from, to) => onChange(moveItem(items, from, to))} />}
          <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" disabled={items.length <= min} onClick={() => remove(i)} aria-label={t('games.admin.builder.remove')} title={t('games.admin.builder.remove')}>✕</button>
        </div>
      ))}
      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={items.length >= max} onClick={add}>+ {t('games.admin.builder.add')}</button>
    </div>
  );
}
