import { useState } from 'react';
import { TR_LANGS, getTr, setTr, getTrItem, setTrItem } from '../../utils/translationForm';

/**
 * قسم "الترجمات" بتبويبين FR/EN لنماذج الإدارة ذات الحقول المتعددة (الأنشطة...).
 *  translations / onChange : كائن الترجمات الكامل للسجل وطريقة تحديثه
 *  fields : [{ key, label, rows?, max }]  — الحقول النصية (rows>0 = textarea)
 *  source : نصوص عربية أصلية تظهر كـ placeholder (key → text)
 *  list   : اختياري، قائمة عناصر لها ترجمة بحسب الفهرس:
 *           { key: 'sub_activities', label, items: [{...}], itemLabel: (item) => string,
 *             fields: [{ key, label, rows?, max }] }  (المفتاح داخل العنصر مثل title/desc)
 * أي خانة فارغة = يظهر النص العربي للزائر.
 */
export default function TranslationTabs({ translations, onChange, fields, source = {}, list = null }) {
  const [lang, setLang] = useState('fr');
  const fieldStyle = { fontSize: '.8rem', color: 'var(--admin-text-muted)' };

  return (
    <fieldset style={{ border: '1px solid var(--admin-border)', borderRadius: 12, padding: '12px 14px', margin: '4px 0 14px' }}>
      <legend style={{ padding: '0 8px', fontWeight: 700, fontSize: '.9rem' }}>الترجمات — اختيارية (تظهر عند تغيير لغة الموقع)</legend>
      <div style={{ ...fieldStyle, marginBottom: 10 }}>أي خانة تتركها فارغة سيظهر نصها العربي للزائر. اكتب النص العربي أولًا ثم ترجمته هنا.</div>

      <div role="tablist" aria-label="لغة الترجمة" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {TR_LANGS.map(({ code, label }) => (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={lang === code}
            className={`admin-btn ${lang === code ? 'admin-btn-primary' : 'admin-btn-ghost'}`}
            onClick={() => setLang(code)}
          >
            {label}
          </button>
        ))}
      </div>

      {fields.map((f) => {
        const id = `tr_${lang}_${f.key}`;
        const common = {
          id,
          dir: 'ltr',
          maxLength: f.max,
          placeholder: source[f.key] || '',
          value: getTr(translations, lang, f.key),
          onChange: (e) => onChange(setTr(translations, lang, f.key, e.target.value)),
        };
        return (
          <div className="admin-form-group" key={`${lang}-${f.key}`}>
            <label htmlFor={id}>{f.label}</label>
            {f.rows ? <textarea className="admin-textarea" rows={f.rows} style={f.rows > 4 ? { minHeight: 140 } : undefined} {...common} /> : <input className="admin-input" {...common} />}
          </div>
        );
      })}

      {list && list.items.length > 0 && (
        <div className="admin-form-group" style={{ marginBottom: 0 }}>
          <label>{list.label}</label>
          {list.items.map((item, i) => (
            <div key={`${lang}-${list.key}-${i}`} style={{ border: '1px dashed var(--admin-border)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <div style={{ ...fieldStyle, marginBottom: 6 }}>{list.itemLabel ? list.itemLabel(item, i) : `#${i + 1}`}</div>
              {list.fields.map((f) => {
                const id = `tr_${lang}_${list.key}_${i}_${f.key}`;
                const common = {
                  id,
                  dir: 'ltr',
                  maxLength: f.max,
                  placeholder: (item && item[f.key]) || '',
                  'aria-label': f.label,
                  value: getTrItem(translations, lang, list.key, i, f.key),
                  onChange: (e) => onChange(setTrItem(translations, lang, list.key, i, f.key, e.target.value)),
                };
                return (
                  <div key={f.key} style={{ marginBottom: 6 }}>
                    {f.rows ? <textarea className="admin-textarea" rows={f.rows} {...common} /> : <input className="admin-input" {...common} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}
