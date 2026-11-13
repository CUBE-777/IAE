import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { getOwn, optionsOf, sanitizeRaw } from './builderContent';

/**
 * match_pairs: عمودان؛ يضغط اللاعب عنصرًا من جهة ثم نظيره من الجهة الأخرى (بالترتيب الذي يريد) فيُربطان. يعمل بالماوس واللمس ولوحة المفاتيح (أزرار حقيقية).
 * عقد الإجابة {pairs: {leftId: rightId}} وكل عنصر أيسر مربوط. الربط واحد لواحد: اختيار نظير مستعمَل ينقله من صاحبه السابق (لا تكرار).
 * الربط يظهر بالرقم (رقم العنصر الأيسر على نظيره) ونصًّا تحت العنصر الأيسر، فلا يُعتمد على اللون وحده.
 */
export default function MatchType({ content, value, onChange, disabled, L }) {
  const { t } = useTranslation();
  const left = optionsOf(content.left);
  const right = optionsOf(content.right);
  const map = sanitizeRaw(content, value) ?? {};
  const rightText = new Map(right.map((r) => [r.id, r.text]));
  const leftNo = new Map(left.map((l, i) => [l.id, i + 1]));
  const ownerOf = new Map(Object.entries(map).map(([l, r]) => [r, l])); // rightId → leftId

  const [pick, setPick] = useState(null); // { side: 'left'|'right', id }
  const [live, setLive] = useState('');

  const link = (l, r) => {
    const rest = Object.fromEntries(Object.entries(map).filter(([k, v]) => k !== l && v !== r)); // يفكّ ما كان يخصّ l أو r
    onChange({ ...rest, [l]: r });
    setLive(t('games.play.interactive.match.linked', { a: L(left.find((x) => x.id === l)?.text), b: L(rightText.get(r)) }));
  };

  const unlink = (l) => {
    onChange(Object.fromEntries(Object.entries(map).filter(([k]) => k !== l)));
    setLive(t('games.play.interactive.match.unlinked', { a: L(left.find((x) => x.id === l)?.text) }));
  };

  const choose = (side, id) => {
    if (disabled) return;
    if (!pick || pick.side === side) {
      setPick(pick && pick.side === side && pick.id === id ? null : { side, id });
      return;
    }
    link(side === 'left' ? id : pick.id, side === 'right' ? id : pick.id);
    setPick(null);
  };

  const done = left.filter((l) => getOwn(map, l.id) !== undefined).length;

  return (
    <div className="gp-match">
      <p className="gp-sub">{t('games.play.interactive.match.hint')}</p>
      <div className="gp-match-cols">
        <div className="gp-match-col">
          <h3 className="gp-match-h">{t('games.play.interactive.match.left')}</h3>
          <ul className="gp-match-list">
            {left.map((l) => {
              const r = getOwn(map, l.id);
              const on = pick?.side === 'left' && pick.id === l.id;
              return (
                <li key={l.id} className="gp-match-row">
                  <button type="button" className={`gp-match-item${on ? ' on' : ''}${r ? ' linked' : ''}`} aria-pressed={on} disabled={disabled} onClick={() => choose('left', l.id)}>
                    <span className="gp-match-n" aria-hidden="true">{leftNo.get(l.id)}</span>
                    <span className="gp-match-body">
                      <span dir="auto">{L(l.text)}</span>
                      {r && <span className="gp-match-to" dir="auto">→ {L(rightText.get(r))}</span>}
                    </span>
                  </button>
                  {r && (
                    <button type="button" className="gp-match-x" disabled={disabled} onClick={() => unlink(l.id)} aria-label={t('games.play.interactive.match.unlink', { name: L(l.text) })}>
                      <X size={16} aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="gp-match-col">
          <h3 className="gp-match-h">{t('games.play.interactive.match.right')}</h3>
          <ul className="gp-match-list">
            {right.map((r) => {
              const owner = ownerOf.get(r.id);
              const on = pick?.side === 'right' && pick.id === r.id;
              return (
                <li key={r.id} className="gp-match-row">
                  <button type="button" className={`gp-match-item${on ? ' on' : ''}${owner ? ' linked' : ''}`} aria-pressed={on} disabled={disabled} onClick={() => choose('right', r.id)}>
                    <span className="gp-match-body"><span dir="auto">{L(r.text)}</span></span>
                    {owner && (
                      <span className="gp-match-badge">
                        <span aria-hidden="true">{leftNo.get(owner)}</span>
                        <span className="gp-sr">{t('games.play.interactive.match.pairedWith', { n: leftNo.get(owner) })}</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className="gp-sub" aria-live="polite">{t('games.play.interactive.match.progress', { done, total: left.length })}</p>
      <p className="gp-sr" role="status" aria-live="polite">{live}</p>
    </div>
  );
}
