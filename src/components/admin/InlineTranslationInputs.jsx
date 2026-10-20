import { TR_LANGS, getTr, setTr } from '../../utils/translationForm';

/**
 * خانتا ترجمة (FR/EN) تُوضعان تحت حقل عربي واحد في نماذج الإدارة.
 * translations: كائن الترجمات الكامل للسجل، onChange يستقبل الكائن الجديد.
 * trKey: مفتاح الحقل داخل كل لغة (الافتراضي "value" لجداول المفتاح/القيمة).
 * الخانة الفارغة = يظهر النص العربي للزائر.
 */
export default function InlineTranslationInputs({ id, translations, onChange, trKey = 'value', placeholder = '', rows = 0, maxLength = 1000 }) {
  return (
    <div style={{ marginTop: 6 }}>
      {TR_LANGS.map(({ code, label }) => {
        const common = {
          id: `${id}_${code}`,
          className: rows ? 'admin-textarea' : 'admin-input',
          dir: 'ltr',
          maxLength,
          placeholder,
          'aria-label': `ترجمة ${label}`,
          value: getTr(translations, code, trKey),
          onChange: (e) => onChange(setTr(translations, code, trKey, e.target.value)),
        };
        return (
          <div key={code} style={{ marginTop: 4 }}>
            <label htmlFor={common.id} style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)' }}>
              {label}
            </label>
            {rows ? <textarea rows={rows} {...common} /> : <input {...common} />}
          </div>
        );
      })}
    </div>
  );
}
