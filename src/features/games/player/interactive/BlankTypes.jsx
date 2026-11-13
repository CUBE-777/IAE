import { useTranslation } from 'react-i18next';
import CodeBlock from './CodeBlock';
import { getOwn, groupsOf, sanitizeRaw, splitMarkers } from './builderContent';

/** قائمة منسدلة أصلية: خيارات محدّدة سلفًا فقط (لا كتابة حرّة)، وتعمل بالمس ولوحة المفاتيح وقارئات الشاشة. */
function BlankSelect({ label, value, options, onChange, disabled, literal, L }) {
  const { t } = useTranslation();
  return (
    <select
      className={`gp-blank${value ? ' filled' : ''}`}
      aria-label={label}
      disabled={disabled}
      value={value || ''}
      dir={literal ? 'ltr' : 'auto'}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{t('games.play.interactive.choose')}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{literal ? o.value : L(o.text)}</option>)}
    </select>
  );
}

/** يبني دالة تحديث لفراغ/فتحة: تضيف الاختيار أو تحذفه، وتُبقي بقية الاختيارات. */
const setter = (current, onChange) => (id) => (optionId) => {
  const rest = Object.fromEntries(Object.entries(current).filter(([k]) => k !== id));
  onChange(optionId ? { ...rest, [id]: optionId } : rest);
};

/** fill_blanks: نص بعلامات {{id}} يُرسم مكانها اختيار من قائمة الفراغ. عقد الإجابة {blanks: {blankId: optionId}} وكل الفراغات مطلوبة. */
export function FillBlanksType({ content, value, onChange, disabled, L }) {
  const { t } = useTranslation();
  const blanks = groupsOf(content.blanks, false);
  const current = sanitizeRaw(content, value) ?? {};
  const set = setter(current, onChange);

  return (
    <div className="gp-template" dir="auto">
      {splitMarkers(L(content.template)).map((part, i) => {
        if (part.id === undefined) return <span key={i}>{part.text}</span>;
        const idx = blanks.findIndex((b) => b.id === part.id);
        if (idx < 0) return <span key={i} className="gp-blank gp-blank-missing" aria-hidden="true">…</span>;
        return (
          <BlankSelect
            key={i}
            label={t('games.play.interactive.blankN', { n: idx + 1 })}
            value={getOwn(current, part.id)}
            options={blanks[idx].options}
            onChange={set(part.id)}
            disabled={disabled}
            literal={false}
            L={L}
          />
        );
      })}
    </div>
  );
}

/** code_completion: كود بفتحات {{id}} يُرسم مكانها اختيار حرفي. لا كتابة كود حرّ ولا تنفيذ. عقد الإجابة {slots: {slotId: optionId}}. */
export function CodeCompletionType({ content, value, onChange, disabled, L }) {
  const { t } = useTranslation();
  const slots = groupsOf(content.slots, true);
  const current = sanitizeRaw(content, value) ?? {};
  const set = setter(current, onChange);

  const nodes = Object.fromEntries(slots.map((s, i) => [s.id, (
    <BlankSelect
      key={s.id}
      label={t('games.play.interactive.slotN', { n: i + 1 })}
      value={getOwn(current, s.id)}
      options={s.options}
      onChange={set(s.id)}
      disabled={disabled}
      literal
      L={L}
    />
  )]));

  return <CodeBlock code={typeof content.code === 'string' ? content.code : ''} lang={content.code_lang} slots={nodes} />;
}
