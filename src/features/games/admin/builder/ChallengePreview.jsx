import { useTranslation } from 'react-i18next';
import { MARKER_RE, buildContent, localize } from './builderModel';

/**
 * معاينة إدارية للتحدي كما سيُخزَّن علنًا (محتواه بعد الخلط). للقراءة فقط: ليست واجهة اللاعب (6.5) ولا ترسل شيئًا.
 * showSolution يُظهر الإجابة الصحيحة للمدير من حالة المحرر المحلية فقط (لا طلب شبكة).
 */
export default function ChallengePreview({ model, lang, showSolution }) {
  const { t } = useTranslation();
  const { content: c, solution: s } = buildContent(model);
  const def = model.defaultLang;
  const L = (o) => localize(o, lang, def, model.allowFallback);
  const title = L(model.title);
  const rtl = lang === 'ar';
  const isCorrect = (cond) => (showSolution && cond ? ' is-correct' : '');

  // يقسم نصًّا على علامات {{id}} ويستبدلها بعنصر
  const withBlanks = (text, render) => {
    const parts = String(text || '').split(new RegExp(MARKER_RE.source, 'g'));
    return parts.map((p, i) => (i % 2 ? render(p, i) : <span key={i}>{p}</span>));
  };
  const blankSelect = (id, groups, litKey, sol) => {
    const g = groups.find((x) => x.id === id);
    return (
      <select key={id} className="gb-pv-blank" disabled aria-label={id} value={showSolution ? sol?.[id] || '' : ''} onChange={() => {}}>
        <option value="">…</option>
        {(g?.options || []).map((o) => <option key={o.id} value={o.id}>{litKey ? o.value : L(o.text)}</option>)}
      </select>
    );
  };

  const body = () => {
    switch (model.type) {
      case 'multiple_choice':
      case 'predict_output': {
        const lit = model.type === 'predict_output';
        return (
          <>
            {lit && c.code && <pre className="gb-pv-code" dir="ltr"><code>{c.code}</code></pre>}
            <ul className="gb-pv-options">
              {(c.options || []).map((o) => (
                <li key={o.id} className={`gb-pv-opt${isCorrect(s.choice === o.id)}`}>
                  <input type="radio" disabled checked={showSolution && s.choice === o.id} readOnly aria-hidden="true" tabIndex={-1} />
                  <span dir={lit ? 'ltr' : undefined}>{lit ? o.value : L(o.text)}</span>
                </li>
              ))}
            </ul>
          </>
        );
      }
      case 'fill_blanks':
        return <p className="gb-pv-text">{withBlanks(L(c.template), (id) => blankSelect(id, c.blanks || [], false, s.blanks))}</p>;
      case 'code_completion':
        return <pre className="gb-pv-code" dir="ltr"><code>{withBlanks(c.code, (id) => blankSelect(id, c.slots || [], true, s.slots))}</code></pre>;
      case 'drag_reorder':
        return (
          <ul className="gb-pv-options">
            {(c.items || []).map((o) => (
              <li key={o.id} className="gb-pv-opt">
                <span aria-hidden="true">⠿</span>
                <span>{L(o.text)}</span>
                {showSolution && <span className="gb-pv-badge">{(s.order || []).indexOf(o.id) + 1}</span>}
              </li>
            ))}
          </ul>
        );
      case 'find_error':
        return (
          <>
            <ol className="gb-pv-lines" dir="ltr">
              {(c.lines || []).map((l, i) => <li key={i} className={isCorrect(s.line === i + 1).trim()}><code>{l || ' '}</code></li>)}
            </ol>
            {c.fix_options && (
              <ul className="gb-pv-options">
                {c.fix_options.map((o) => <li key={o.id} className={`gb-pv-opt${isCorrect(s.fix === o.id)}`}><code dir="ltr">{o.value}</code></li>)}
              </ul>
            )}
          </>
        );
      case 'match_pairs': {
        const rightOf = (lid) => s.pairs?.[lid];
        return (
          <div className="gb-pv-pairs">
            <ul className="gb-pv-options">{(c.left || []).map((o) => <li key={o.id} className="gb-pv-opt"><span>{L(o.text)}</span>{showSolution && <span className="gb-pv-badge">{L((c.right || []).find((r) => r.id === rightOf(o.id))?.text)}</span>}</li>)}</ul>
            <ul className="gb-pv-options">{(c.right || []).map((o) => <li key={o.id} className="gb-pv-opt"><span>{L(o.text)}</span></li>)}</ul>
          </div>
        );
      }
      default:
        return null;
    }
  };

  if (!title && !model.allowFallback) return <p className="admin-hint">{t('games.admin.builder.notInLang')}</p>;
  return (
    <article className="gb-pv" dir={rtl ? 'rtl' : 'ltr'} lang={lang}>
      <h4 className="gb-pv-title">{title || '—'}</h4>
      <p className="gb-pv-meta">{t('games.admin.builder.pvMeta', { d: model.difficulty, p: model.points })}</p>
      {L(model.prompt) && <p className="gb-pv-prompt">{L(model.prompt)}</p>}
      {L(model.instructions) && <p className="gb-pv-instr">{L(model.instructions)}</p>}
      {body()}
      {(c.hints || []).length > 0 && (
        <details className="gb-pv-hints"><summary>{t('games.admin.builder.hintsTitle')}</summary>
          <ul>{c.hints.map((h, i) => <li key={i}>{L(h)}</li>)}</ul>
        </details>
      )}
      {showSolution && L(model.feedback) && <p className="gb-pv-feedback"><strong>{t('games.admin.builder.feedback')}: </strong>{L(model.feedback)}</p>}
    </article>
  );
}
