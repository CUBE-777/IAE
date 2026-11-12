import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { getOptions } from '../challengeTypes';

/** حقل الإجابة بحسب النوع العام. لا يعرض إلا ما في content العلني. */
export default function ChallengeAnswer({ type, content, value, onChange, disabled, lang, onEnter }) {
  const { t } = useTranslation();
  const id = useId();
  const placeholder = typeof content?.placeholder === 'string' ? content.placeholder.slice(0, 120) : undefined;

  if (type === 'choice') {
    const options = getOptions(content, lang);
    return (
      <fieldset className="gp-choices" disabled={disabled}>
        <legend className="gp-sr">{t('games.play.yourAnswer')}</legend>
        {options.map((o) => (
          <label key={o.key} className={`gp-choice${value === o.value ? ' on' : ''}`}>
            <input type="radio" name={id} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  const common = { id, disabled, className: 'gp-input', value: value ?? '', placeholder, onChange: (e) => onChange(e.target.value), 'aria-label': t('games.play.yourAnswer') };
  if (type === 'number') {
    return <input {...common} type="number" inputMode="decimal" dir="ltr" step="any" onKeyDown={(e) => e.key === 'Enter' && onEnter?.()} />;
  }
  if (type === 'json') {
    return <textarea {...common} rows={6} dir="ltr" spellCheck={false} className="gp-input gp-code" />;
  }
  return <input {...common} type="text" maxLength={2000} autoComplete="off" onKeyDown={(e) => e.key === 'Enter' && onEnter?.()} />;
}
