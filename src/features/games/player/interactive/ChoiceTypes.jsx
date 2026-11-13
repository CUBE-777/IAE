import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import CodeBlock from './CodeBlock';
import { literalOptionsOf, optionsOf } from './builderContent';

/**
 * multiple_choice (خيارات نصية متعددة اللغات) و predict_output (كود + ناتج حرفي). اختيار واحد: عقد الإجابة {choice: id}.
 * predict_output لا يُنفَّذ فيه الكود: الكود للعرض، والناتج يُختار من قائمة محدّدة سلفًا (لا إدخال حرّ).
 */
export default function ChoiceType({ content, value, onChange, disabled, L, literal }) {
  const { t } = useTranslation();
  const name = useId();
  const options = literal ? literalOptionsOf(content.options) : optionsOf(content.options);

  return (
    <>
      {literal && typeof content.code === 'string' && content.code && <CodeBlock code={content.code} lang={content.code_lang} />}
      <fieldset className="gp-choices" disabled={disabled}>
        <legend className="gp-sr">{t('games.play.interactive.chooseOne')}</legend>
        {options.map((o) => (
          <label key={o.id} className={`gp-choice${value === o.id ? ' on' : ''}`}>
            <input type="radio" name={name} checked={value === o.id} onChange={() => onChange(o.id)} />
            {literal
              ? <code className="gp-choice-code" dir="ltr">{o.value}</code>
              : <span dir="auto">{L(o.text)}</span>}
          </label>
        ))}
      </fieldset>
    </>
  );
}
