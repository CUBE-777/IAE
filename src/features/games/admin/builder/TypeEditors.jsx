import { useTranslation } from 'react-i18next';
import { Field } from '../components/adminUi';
import { CODE_LANGS, LIMITS, nextId, splitLines } from './builderModel';
import { CodeField, LText, OptionList } from './builderUi';

const stripMarker = (s, id) => String(s || '').split(`{{${id}}}`).join('');

function CodeLangSelect({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <Field id="gb_codelang" label={t('games.admin.builder.codeLang')} hint={t('games.admin.builder.codeLangHint')}>
      <select id="gb_codelang" className="admin-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {CODE_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
    </Field>
  );
}

function MultipleChoice({ data, set, lang, defaultLang }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="admin-hint">{t('games.admin.builder.hints.multiple_choice')}</p>
      <OptionList label={t('games.admin.builder.options')} items={data.options} onChange={(options) => set({ options })} lang={lang} defaultLang={defaultLang}
        min={LIMITS.options[0]} max={LIMITS.options[1]} correct={data.correct} onCorrect={(correct) => set({ correct })} group="gb-mc" />
    </>
  );
}

function PredictOutput({ data, set, lang, defaultLang }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="admin-hint">{t('games.admin.builder.hints.predict_output')}</p>
      <CodeField label={t('games.admin.builder.code')} value={data.code} onChange={(code) => set({ code })} />
      <CodeLangSelect value={data.codeLang} onChange={(codeLang) => set({ codeLang })} />
      <OptionList label={t('games.admin.builder.outputs')} literal items={data.options} onChange={(options) => set({ options })} lang={lang} defaultLang={defaultLang}
        min={LIMITS.options[0]} max={LIMITS.options[1]} correct={data.correct} onCorrect={(correct) => set({ correct })} group="gb-po" />
    </>
  );
}

/** blanks/slots: كل فراغ له علامة {{id}} في النص/الكود وقائمة اختياراته. */
function Blanks({ data, set, lang, defaultLang, codeMode }) {
  const { t } = useTranslation();
  const key = codeMode ? 'slots' : 'blanks';
  const [min, max] = LIMITS[key];
  const list = data[key];
  const prefix = codeMode ? 's' : 'b';
  const update = (i, patch) => set({ [key]: list.map((b, k) => (k === i ? { ...b, ...patch } : b)) });
  const insert = (id) => {
    const m = `{{${id}}}`;
    if (codeMode) set({ code: `${data.code}${m}` });
    else set({ template: { ...data.template, [lang]: `${data.template[lang] || ''}${m}` } });
  };
  const add = () => {
    const id = nextId(prefix, list);
    set({ [key]: [...list, { id, options: [{ id: 'o1', ...(codeMode ? { value: '' } : { text: { ar: '', fr: '', en: '' } }) }, { id: 'o2', ...(codeMode ? { value: '' } : { text: { ar: '', fr: '', en: '' } }) }], correct: null }] });
  };
  const remove = (i) => {
    const id = list[i].id;
    const patch = { [key]: list.filter((_, k) => k !== i) };
    if (codeMode) patch.code = stripMarker(data.code, id);
    else patch.template = Object.fromEntries(Object.entries(data.template).map(([l, s]) => [l, stripMarker(s, id)]));
    set(patch);
  };
  return (
    <div className="gb-list">
      {list.map((b, i) => (
        <fieldset className="ga-fieldset gb-card" key={b.id}>
          <legend>{t(codeMode ? 'games.admin.builder.slotN' : 'games.admin.builder.blankN', { n: i + 1 })} <code dir="ltr">{`{{${b.id}}}`}</code></legend>
          <div className="gb-card-tools">
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => insert(b.id)}>{t('games.admin.builder.insertMarker')}</button>
            <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" disabled={list.length <= min} onClick={() => remove(i)}>{t('games.admin.builder.remove')}</button>
          </div>
          <OptionList label={t('games.admin.builder.options')} literal={codeMode} items={b.options} onChange={(options) => update(i, { options })} lang={lang} defaultLang={defaultLang}
            min={LIMITS.options[0]} max={LIMITS.options[1]} correct={b.correct} onCorrect={(correct) => update(i, { correct })} group={`gb-${key}-${b.id}`} />
        </fieldset>
      ))}
      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={list.length >= max} onClick={add}>+ {t(codeMode ? 'games.admin.builder.addSlot' : 'games.admin.builder.addBlank')}</button>
    </div>
  );
}

function FillBlanks(props) {
  const { t } = useTranslation();
  const { data, set, lang, defaultLang } = props;
  return (
    <>
      <p className="admin-hint">{t('games.admin.builder.hints.fill_blanks')}</p>
      <LText label={t('games.admin.builder.template')} value={data.template} onChange={(template) => set({ template })} lang={lang} defaultLang={defaultLang} multiline rows={4} maxLength={LIMITS.template} />
      <Blanks {...props} codeMode={false} />
    </>
  );
}

function CodeCompletion(props) {
  const { t } = useTranslation();
  const { data, set } = props;
  return (
    <>
      <p className="admin-hint">{t('games.admin.builder.hints.code_completion', { id: '{{id}}', s1: '{{s1}}', interpolation: { escapeValue: false } })}</p>
      <CodeField label={t('games.admin.builder.codeTemplate')} value={data.code} onChange={(code) => set({ code })} rows={6} />
      <CodeLangSelect value={data.codeLang} onChange={(codeLang) => set({ codeLang })} />
      <Blanks {...props} codeMode />
    </>
  );
}

function DragReorder({ data, set, lang, defaultLang }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="admin-hint">{t('games.admin.builder.hints.drag_reorder')}</p>
      <OptionList label={t('games.admin.builder.items')} items={data.items} onChange={(items) => set({ items })} lang={lang} defaultLang={defaultLang}
        min={LIMITS.items[0]} max={LIMITS.items[1]} prefix="i" />
    </>
  );
}

function FindError({ data, set, lang, defaultLang }) {
  const { t } = useTranslation();
  const lines = splitLines(data.lines);
  return (
    <>
      <p className="admin-hint">{t('games.admin.builder.hints.find_error')}</p>
      <CodeField label={t('games.admin.builder.linesField')} hint={t('games.admin.builder.linesHint')} value={data.lines} rows={8} onChange={(v) => set({ lines: v, errorLine: null })} />
      <CodeLangSelect value={data.codeLang} onChange={(codeLang) => set({ codeLang })} />
      <div className="admin-form-group">
        <span className="gb-label">{t('games.admin.builder.pickErrorLine')}</span>
        <ol className="gb-lines" dir="ltr">
          {lines.map((l, i) => (
            <li key={i} className={data.errorLine === i + 1 ? 'is-picked' : ''}>
              <label>
                <input type="radio" name="gb-errline" disabled={!l.trim()} checked={data.errorLine === i + 1} onChange={() => set({ errorLine: i + 1 })} />
                <code>{l || ' '}</code>
              </label>
            </li>
          ))}
        </ol>
      </div>
      <label className="gb-check">
        <input type="checkbox" checked={data.askFix} onChange={(e) => set({ askFix: e.target.checked })} /> {t('games.admin.builder.askFix')}
      </label>
      {data.askFix && (
        <OptionList label={t('games.admin.builder.fixOptions')} literal items={data.fixOptions} onChange={(fixOptions) => set({ fixOptions })} lang={lang} defaultLang={defaultLang}
          min={LIMITS.fix[0]} max={LIMITS.fix[1]} prefix="f" correct={data.fix} onCorrect={(fix) => set({ fix })} group="gb-fix" />
      )}
    </>
  );
}

function MatchPairs({ data, set, lang, defaultLang }) {
  const { t } = useTranslation();
  const [min, max] = LIMITS.pairs;
  const upd = (i, patch) => set({ pairs: data.pairs.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  return (
    <>
      <p className="admin-hint">{t('games.admin.builder.hints.match_pairs')}</p>
      <div className="gb-list">
        {data.pairs.map((p, i) => (
          <div className="gb-row gb-pair" key={p.id}>
            <span className="gb-row-n" aria-hidden="true">{i + 1}</span>
            <div className="gb-grow"><LText label={t('games.admin.builder.leftItem')} value={p.left} onChange={(left) => upd(i, { left })} lang={lang} defaultLang={defaultLang} /></div>
            <div className="gb-grow"><LText label={t('games.admin.builder.rightItem')} value={p.right} onChange={(right) => upd(i, { right })} lang={lang} defaultLang={defaultLang} /></div>
            <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" disabled={data.pairs.length <= min} aria-label={t('games.admin.builder.remove')}
              onClick={() => set({ pairs: data.pairs.filter((_, k) => k !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={data.pairs.length >= max}
          onClick={() => set({ pairs: [...data.pairs, { id: nextId('p', data.pairs), left: { ar: '', fr: '', en: '' }, right: { ar: '', fr: '', en: '' } }] })}>+ {t('games.admin.builder.addPair')}</button>
      </div>
    </>
  );
}

const EDITORS = {
  multiple_choice: MultipleChoice, predict_output: PredictOutput, fill_blanks: FillBlanks, drag_reorder: DragReorder,
  find_error: FindError, match_pairs: MatchPairs, code_completion: CodeCompletion,
};

export default function TypeEditor({ type, ...rest }) {
  const Editor = EDITORS[type];
  return Editor ? <Editor {...rest} /> : null;
}
