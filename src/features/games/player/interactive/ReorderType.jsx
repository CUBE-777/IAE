import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { initialOrder, optionsOf, sanitizeRaw } from './builderContent';

/**
 * drag_reorder: ترتيب عناصر. عقد الإجابة {order: [id,…]} (كل العناصر بترتيب اللاعب).
 *  - الماوس: سحب وإفلات (HTML5). هذا لا يعمل على معظم شاشات اللمس، لذلك:
 *  - اللمس ولوحة المفاتيح: زرّا «أعلى/أسفل» لكل عنصر (أهداف ≥ 44px)، ويُعلَن الموضع الجديد لقارئات الشاشة (aria-live).
 *  - الترتيب المختار محفوظ في حالة الصفحة (value) فلا يضيع بإعادة الرسم؛ والبداية = ترتيب الخادم المخلوط.
 */
export default function ReorderType({ content, value, onChange, disabled, L }) {
  const { t } = useTranslation();
  const items = optionsOf(content.items);
  const byId = new Map(items.map((o) => [o.id, o]));
  const order = sanitizeRaw(content, value) ?? initialOrder(content);

  const [drag, setDrag] = useState(null); // فهرس العنصر المسحوب
  const [over, setOver] = useState(null); // فهرس الهدف الحالي
  const [live, setLive] = useState('');
  const btnRefs = useRef({});
  const refocus = useRef(null); // { id, dir } لإعادة التركيز على الزر نفسه بعد انتقال العنصر (تحريك العقدة قد يُسقط التركيز)

  useEffect(() => {
    const r = refocus.current;
    if (!r) return;
    refocus.current = null;
    const btn = btnRefs.current[`${r.id}:${r.dir}`];
    (btn && !btn.disabled ? btn : btnRefs.current[`${r.id}:${r.dir === 'up' ? 'down' : 'up'}`])?.focus();
  });

  const move = (from, to, viaButton) => {
    if (disabled || from === to || to < 0 || to >= order.length) return;
    const next = order.slice();
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id);
    onChange(next);
    if (viaButton) refocus.current = { id, dir: to < from ? 'up' : 'down' };
    setLive(t('games.play.interactive.reorder.position', { name: L(byId.get(id)?.text), pos: to + 1, total: next.length }));
  };

  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };

  return (
    <div className="gp-reorder">
      <p className="gp-sub">{t('games.play.interactive.reorder.hint')}</p>
      <ol className="gp-ro-list">
        {order.map((id, i) => {
          const name = L(byId.get(id)?.text);
          return (
            <li
              key={id}
              className={`gp-ro-item${drag === i ? ' dragging' : ''}${over === i && drag !== null && drag !== i ? ' over' : ''}`}
              draggable={!disabled}
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', id); // Firefox لا يبدأ السحب بلا بيانات
              }}
              onDragOver={(e) => {
                if (drag === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (over !== i) setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null) move(drag, i, false);
                endDrag();
              }}
              onDragEnd={endDrag}
            >
              <span className="gp-ro-grip" aria-hidden="true"><GripVertical size={18} /></span>
              <span className="gp-ro-n" aria-hidden="true">{i + 1}</span>
              <span className="gp-ro-text" dir="auto">{name}</span>
              <span className="gp-ro-btns">
                <button
                  type="button"
                  className="gp-ro-btn"
                  ref={(el) => { btnRefs.current[`${id}:up`] = el; }}
                  disabled={disabled || i === 0}
                  onClick={() => move(i, i - 1, true)}
                  aria-label={t('games.play.interactive.reorder.moveUp', { name })}
                >
                  <ArrowUp size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="gp-ro-btn"
                  ref={(el) => { btnRefs.current[`${id}:down`] = el; }}
                  disabled={disabled || i === order.length - 1}
                  onClick={() => move(i, i + 1, true)}
                  aria-label={t('games.play.interactive.reorder.moveDown', { name })}
                >
                  <ArrowDown size={18} aria-hidden="true" />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="gp-sr" role="status" aria-live="polite">{live}</p>
    </div>
  );
}
