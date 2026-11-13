import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import CodeBlock from './CodeBlock';
import { literalOptionsOf, sanitizeRaw } from './builderContent';

/**
 * find_error: كود بأسطر مرقّمة، يحدّد اللاعب السطر الخاطئ (وإن وُجدت fix_options فيختار أيضًا التصحيح الصحيح).
 * عقد الإجابة {line: n[, fix: id]} برقم السطر من 1. لا شيء من الحلّ في المحتوى العلني؛ والأسطر الفارغة لا تُختار.
 */
export default function FindErrorType({ content, value, onChange, disabled }) {
  const { t } = useTranslation();
  const name = useId();
  // سطر واحد = عنصر واحد: نمنع أي فاصل أسطر داخل العنصر كي لا ينزاح الترقيم عن ترقيم الخادم
  const lines = (Array.isArray(content.lines) ? content.lines : []).map((l) => String(l ?? '').replace(/[\r\n]+/g, ' '));
  const fixes = literalOptionsOf(content.fix_options);
  const current = sanitizeRaw(content, value) ?? {};

  return (
    <>
      <p className="gp-sub">{t('games.play.interactive.findError.hint')}</p>
      <CodeBlock
        code={lines.join('\n')}
        lang={content.code_lang}
        select={{
          value: current.line ?? null,
          onChange: (n) => onChange({ ...current, line: n }),
          disabled,
          isSelectable: (n) => (lines[n - 1] ?? '').trim() !== '',
          label: t('games.play.interactive.findError.lines'),
        }}
      />
      <p className="gp-sub" role="status" aria-live="polite">
        {current.line ? t('games.play.interactive.findError.selected', { n: current.line }) : ''}
      </p>
      {fixes.length > 0 && (
        <fieldset className="gp-choices" disabled={disabled}>
          <legend className="gp-fix-title">{t('games.play.interactive.findError.fixTitle')}</legend>
          {fixes.map((o) => (
            <label key={o.id} className={`gp-choice${current.fix === o.id ? ' on' : ''}`}>
              <input type="radio" name={name} checked={current.fix === o.id} onChange={() => onChange({ ...current, fix: o.id })} />
              <code className="gp-choice-code" dir="ltr">{o.value}</code>
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}
