import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadHighlighter } from './loadHighlighter';
import { SLOT_FIRST, SLOT_LAST, SLOT_SPLIT, toLines, withSlotMarks, withoutSlots } from './highlight';

/**
 * عرض كود للقراءة والتفاعل المحدود فقط (ليس محررًا ولا بيئة تنفيذ): تلوين + أرقام أسطر + تمرير أفقي داخل الصندوق فقط.
 * يُعرض دائمًا LTR (dir="ltr") حتى داخل صفحة عربية RTL فلا ينعكس اتجاه الكود؛ والنص العربي داخل التعليقات يتبع خوارزمية الاتجاه الطبيعية.
 *
 *   code     : النص (الأسطر تُرقَّم من 1).
 *   lang     : code_lang من Builder (text = بلا تلوين).
 *   slots    : (code_completion فقط) { [slotId]: عنصر React } يُرسم مكان علامة {{slotId}}؛ بدونه تبقى العلامات نصًّا حرفيًا.
 *   select   : (find_error) { value, onChange(n), disabled, isSelectable(n), label } ⇒ كل سطر زرّ اختيار (radiogroup) بلوحة المفاتيح واللمس.
 *   ariaLabel: وصف منطقة الكود لقارئات الشاشة.
 * التلوين يُحمَّل كسولًا؛ قبل وصوله (أو إن فشل) يظهر الكود نفسه بنص عادي.
 */
export default function CodeBlock({ code, lang = 'text', slots, select, ariaLabel }) {
  const { t } = useTranslation();
  const [hl, setHl] = useState(null); // { P: Prism } أو null
  const rowRefs = useRef([]);

  useEffect(() => {
    let alive = true;
    if (lang && lang !== 'text') {
      loadHighlighter().then((P) => {
        if (alive && P) setHl({ P });
      });
    }
    return () => {
      alive = false;
    };
  }, [lang]);

  const hasSlots = !!slots;
  const { text, ids } = useMemo(() => (hasSlots ? withSlotMarks(code) : withoutSlots(code)), [code, hasSlots]);
  const lines = useMemo(() => toLines(text, lang, hl?.P || null), [text, lang, hl]);
  const plainLines = useMemo(() => text.split('\n'), [text]);

  const renderSegments = (segments, rowKey) => segments.map((seg, i) => seg.text.split(SLOT_SPLIT).map((part, j) => {
    if (!part) return null;
    const k = `${rowKey}-${i}-${j}`;
    const c = part.charCodeAt(0);
    if (part.length === 1 && c >= SLOT_FIRST && c <= SLOT_LAST) {
      return <span key={k} className="gp-cb-slot">{slots?.[ids[c - SLOT_FIRST]] ?? '…'}</span>;
    }
    return seg.kind ? <span key={k} className={`gp-tok gp-tok-${seg.kind}`}>{part}</span> : <Fragment key={k}>{part}</Fragment>;
  }));

  const selectable = (n) => (select?.isSelectable ? select.isSelectable(n) : true);
  const firstSelectable = select ? lines.findIndex((_, i) => selectable(i + 1)) + 1 : 0;
  const tabStop = select ? (select.value && selectable(select.value) ? select.value : firstSelectable) : 0;

  const onKey = (e, n) => {
    if (!select || select.disabled) return;
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    let k = n + dir;
    while (k >= 1 && k <= lines.length && !selectable(k)) k += dir;
    if (k >= 1 && k <= lines.length) {
      rowRefs.current[k]?.focus();
      select.onChange(k);
    }
  };

  const label = ariaLabel || t('games.play.interactive.codeRegion');
  const showLang = lang && lang !== 'text';

  return (
    <figure className="gp-cb" dir="ltr" translate="no">
      {showLang && <figcaption className="gp-cb-lang">{lang}</figcaption>}
      <div
        className="gp-cb-scroll"
        {...(select
          ? { role: 'radiogroup', 'aria-label': select.label || label }
          : { role: 'region', 'aria-label': label, tabIndex: 0 })}
      >
        <div className="gp-cb-body">
          {lines.map((segments, idx) => {
            const n = idx + 1;
            const body = (
              <>
                <span className="gp-cb-ln" aria-hidden="true">{n}</span>
                <span className="gp-cb-code">{segments.length ? renderSegments(segments, n) : '\u200b'}</span>
              </>
            );
            if (!select) return <div className="gp-cb-row" key={n}>{body}</div>;
            const ok = selectable(n) && !select.disabled;
            const on = select.value === n;
            return (
              <button
                type="button"
                role="radio"
                key={n}
                ref={(el) => { rowRefs.current[n] = el; }}
                className={`gp-cb-row gp-cb-pick${on ? ' on' : ''}${selectable(n) ? '' : ' off'}`}
                aria-checked={on}
                aria-disabled={!ok}
                aria-label={t('games.play.interactive.lineN', { n }) + (plainLines[idx] ? `: ${plainLines[idx]}` : '')}
                tabIndex={n === tabStop ? 0 : -1}
                disabled={select.disabled}
                onClick={() => { if (ok) select.onChange(n); }}
                onKeyDown={(e) => onKey(e, n)}
              >
                {body}
              </button>
            );
          })}
        </div>
      </div>
    </figure>
  );
}
