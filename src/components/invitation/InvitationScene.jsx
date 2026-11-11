import { useEffect, useRef, useState } from 'react';
import InvitationFace from './InvitationFace';
import { ensureInvitationFonts } from '../../utils/invitationFormat';
import '../../styles/invitation.css';

const COLORS = ['#e3c06e', '#f6e3a6', '#2e9bff', '#7fd0ff', '#ffffff', '#ff5fb4', '#8b6cff'];
const STEPS = [[0, 1], [200, 2], [650, 3], [1100, 4], [2100, 5]]; // [تأخير ms من الضغط، رقم المرحلة]

/**
 * مشهد المظروف المتحرك (ترجمة حرفية لـ invitation.html إلى React، بلا سكربت مضمَّن لأن CSP = script-src 'self').
 * children(done) تُرسم أسفل المشهد بعد انتهاء الحركة (أزرار RSVP/PDF). onClose للمعاينة داخل لوحة الإدارة.
 */
export default function InvitationScene({ guest, settings, startsAt, onClose, children }) {
  const [step, setStep] = useState(0);
  const bgRef = useRef(null);
  const fxRef = useRef(null);
  const burstRef = useRef(() => {});
  const timers = useRef([]);
  const reduced = useRef(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => { ensureInvitationFonts(); }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    const bg = bgRef.current; const fx = fxRef.current;
    const bc = bg.getContext('2d'); const fc = fx.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0; let H = 0; let raf = 0; let parts = [];
    const size = () => {
      W = window.innerWidth; H = window.innerHeight;
      [[bg, bc], [fx, fc]].forEach(([c, x]) => {
        c.width = W * dpr; c.height = H * dpr; c.style.width = `${W}px`; c.style.height = `${H}px`;
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
      });
    };
    size();
    window.addEventListener('resize', size);
    const stars = Array.from({ length: 120 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, p: Math.random() * 6, s: 0.4 + Math.random() * 1.2 }));
    burstRef.current = (n) => {
      if (reduced.current) return;
      for (let i = 0; i < n; i += 1) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4; const v = 5 + Math.random() * 10;
        parts.push({ x: W / 2, y: H * 0.45, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 4 + Math.random() * 6, h: 2 + Math.random() * 3, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: COLORS[i % COLORS.length], l: 1 });
      }
    };
    const frame = (t) => {
      bc.clearRect(0, 0, W, H);
      stars.forEach((s) => {
        bc.globalAlpha = 0.3 + 0.4 * Math.sin((t / 1000) * s.s + s.p);
        bc.fillStyle = '#cfe6ff'; bc.beginPath(); bc.arc(s.x * W, s.y * H, s.r, 0, 6.3); bc.fill();
      });
      bc.globalAlpha = 1;
      fc.clearRect(0, 0, W, H);
      parts = parts.filter((p) => p.l > 0);
      parts.forEach((p) => {
        p.vy += 0.22; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.l -= 0.0045;
        fc.save(); fc.globalAlpha = Math.max(p.l, 0); fc.translate(p.x, p.y); fc.rotate(p.r);
        fc.fillStyle = p.c; fc.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); fc.restore();
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', size); };
  }, []);

  const open = () => {
    if (step !== 0) return;
    burstRef.current(40);
    STEPS.forEach(([delay, s]) => {
      timers.current.push(setTimeout(() => {
        setStep(s);
        if (s === 5) burstRef.current(170);
      }, delay));
    });
  };

  const done = step >= 5;
  const cls = (base, ...extra) => [base, ...extra.filter(Boolean)].join(' ');

  return (
    <div className="inv-root inv-font" dir="ltr" lang="fr">
      <canvas ref={bgRef} className="inv-canvas inv-bg" aria-hidden="true" />
      <canvas ref={fxRef} className="inv-canvas inv-fx" aria-hidden="true" />
      {onClose ? <button type="button" className="inv-close" onClick={onClose} aria-label="Fermer">✕</button> : null}
      <main className="inv-stage">
        <div className={cls('inv-scene', step >= 1 && 'opened', done && 'out')} onClick={open}>
          <svg className="inv-layer inv-back" viewBox="0 0 100 66" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="66" fill="#0a3f7a" stroke="#8fc4ff" strokeOpacity=".6" vectorEffect="non-scaling-stroke" /></svg>
          <svg className={cls('inv-flap', step >= 2 && 'open', step >= 3 && 'behind')} viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,0 100,0 50,38" fill="#1a7ed6" stroke="#bfe0ff" strokeWidth="1.4" vectorEffect="non-scaling-stroke" /></svg>
          <div className={cls('inv-card', step >= 4 && 'rise', done && 'out')}>
            <InvitationFace guest={guest} settings={settings} startsAt={startsAt} />
          </div>
          <svg className="inv-layer inv-pocket" viewBox="0 0 100 66" preserveAspectRatio="none" aria-hidden="true">
            <g stroke="#bfe0ff" strokeOpacity=".7" strokeWidth="1.4" vectorEffect="non-scaling-stroke">
              <polygon points="0,0 50,38 0,66" fill="#0f5caa" vectorEffect="non-scaling-stroke" />
              <polygon points="100,0 50,38 100,66" fill="#0c4d95" vectorEffect="non-scaling-stroke" />
              <polygon points="0,66 100,66 50,38" fill="#1368ba" vectorEffect="non-scaling-stroke" />
            </g>
          </svg>
          <button type="button" className={cls('inv-seal', step >= 1 && 'pop')} aria-label="Ouvrir l’invitation"><img src="/invite/seal.png" alt="" /></button>
          <p className="inv-hint">Touchez le sceau pour ouvrir</p>
        </div>
      </main>
      {typeof children === 'function' ? children(done) : null}
    </div>
  );
}
