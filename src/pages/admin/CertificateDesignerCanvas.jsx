import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PAGE_W, PAGE_H, MIN_SIZE_MM, SAMPLE } from './certificateDesign';
import { ElementBody } from '../../components/certificates/CertificatePage';

const snap = (v) => Math.round(v * 2) / 2; // خطوة 0.5mm
const CORNERS = ['nw', 'ne', 'sw', 'se'];

/**
 * لوحة A4 أفقية (297×210mm). الإحداثيات بالمليمتر وتُحوَّل إلى بكسل بمقياس = عرض الحاوية / 297،
 * فالمعاينة والتحرير متطابقان وأي حجم شاشة يحافظ على النسبة.
 * السحب: onBegin() مرة واحدة عند أول حركة (لقطة Undo)، ثم onLive(id, patch) دون تسجيل.
 */
export default function CertificateDesignerCanvas({ design, lang, preview, selectedId, onSelect, onBegin, onLive }) {
  const { t } = useTranslation();
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(3);
  const drag = useRef(null);
  const latest = useRef({ design, scale });
  latest.current = { design, scale };
  const cb = useRef({});
  cb.current = { onBegin, onLive };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setScale(Math.max(0.5, el.clientWidth / PAGE_W));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // معالجات النافذة ثابتة الهوية (تُضاف/تُزال بنفس المرجع) وتقرأ الحالة من refs
  const move = useRef(null);
  const up = useRef(null);
  if (!move.current) {
    move.current = (e) => {
      const d = drag.current;
      if (!d) return;
      const { scale: sc } = latest.current;
      const dx = (e.clientX - d.sx) / sc;
      const dy = (e.clientY - d.sy) / sc;
      if (!d.begun) {
        if (Math.abs(dx) + Math.abs(dy) < 0.4) return;
        d.begun = true;
        cb.current.onBegin();
      }
      let { x, y, w, h } = d.orig;
      if (d.mode === 'move') {
        x = snap(x + dx);
        y = snap(y + dy);
      } else {
        const minH = d.isLine ? 0.2 : MIN_SIZE_MM;
        let nw = w;
        let nh = h;
        if (d.mode.includes('e')) nw = w + dx;
        if (d.mode.includes('w')) nw = w - dx;
        nw = Math.max(MIN_SIZE_MM, nw);
        if (d.keepRatio) nh = nw / (w / h);
        else {
          if (d.mode.includes('s')) nh = h + dy;
          if (d.mode.includes('n')) nh = h - dy;
          nh = Math.max(minH, nh);
        }
        if (d.mode.includes('w')) x = x + w - nw;
        if (d.mode.includes('n')) y = y + h - nh;
        x = snap(x);
        y = snap(y);
        w = snap(nw);
        h = d.isLine ? Math.round(nh * 10) / 10 : snap(nh);
        h = Math.max(minH, h);
        w = Math.max(MIN_SIZE_MM, w);
      }
      cb.current.onLive(d.id, { x, y, w, h });
    };
    up.current = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move.current);
      window.removeEventListener('pointerup', up.current);
      window.removeEventListener('pointercancel', up.current);
    };
  }
  useEffect(() => () => up.current && up.current(), []);

  const start = (e, el, mode) => {
    if (preview || el.locked || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(el.id);
    drag.current = {
      id: el.id,
      mode,
      sx: e.clientX,
      sy: e.clientY,
      orig: { x: el.x, y: el.y, w: el.w, h: el.h },
      begun: false,
      keepRatio: el.type === 'image' || el.type === 'qr',
      isLine: el.type === 'shape' && el.shape === 'line',
    };
    window.addEventListener('pointermove', move.current);
    window.addEventListener('pointerup', up.current);
    window.addEventListener('pointercancel', up.current);
  };

  return (
    <div ref={wrapRef} className="cd-stage">
      <div
        className={`cd-page${preview ? ' is-preview' : ''}`}
        style={{ width: PAGE_W * scale, height: PAGE_H * scale, background: design.background.color }}
        role="img"
        aria-label={t('admin.certificates.designer.canvasLabel')}
        onPointerDown={() => !preview && onSelect(null)}
      >
        {design.elements.map((el) => {
          if (el.hidden) return null;
          const selected = !preview && el.id === selectedId;
          return (
            <div
              key={el.id}
              className={`cd-el cd-el-${el.type}${selected ? ' is-selected' : ''}${el.locked ? ' is-locked' : ''}`}
              style={{ left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale, pointerEvents: preview || el.locked ? 'none' : 'auto' }}
              onPointerDown={(e) => start(e, el, 'move')}
            >
              <ElementBody el={el} lang={lang} vars={preview ? SAMPLE[lang] : {}} scale={scale} />
              {selected && !el.locked && CORNERS.map((c) => (
                <span key={c} className={`cd-handle cd-handle-${c}`} onPointerDown={(e) => start(e, el, c)} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
