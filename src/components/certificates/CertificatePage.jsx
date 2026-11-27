import { useMemo } from 'react';
import { PAGE_W, PAGE_H, FONTS, dirOf, textOf, interpolate } from '../../pages/admin/certificateDesign';
import { qrSvgPath } from '../../utils/qr';
import { QR_DARK, QR_LIGHT } from '../member/QrImage';
import '../../styles/certificate-designer.css';

const PT_MM = 0.3528; // 1pt بالمليمتر

function QrSvg({ text }) {
  const qr = useMemo(() => {
    try { return qrSvgPath(text); } catch { return null; }
  }, [text]);
  if (!qr) return null;
  return (
    <svg viewBox={qr.viewBox} width="100%" height="100%" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect width={qr.size} height={qr.size} fill={QR_LIGHT} />
      <path d={qr.d} fill={QR_DARK} />
    </svg>
  );
}

/**
 * رسم عنصر واحد من التصميم — المصدر الوحيد للمعاينة (المصمّم) وللـ PDF، فيتطابقان.
 * vars: قيم المتغيّرات ({} = عرض {{var}} خامًا في التحرير؛ SAMPLE في المعاينة؛ قيم الشهادة الحقيقية في PDF).
 * qr: undefined = مساحة محجوزة (المصمّم) | { text } = QR حقيقي | { blank: true } = مربع أبيض (يُرسم QR المتجهي فوقه في PDF).
 */
export function ElementBody({ el, lang, vars, scale, qr }) {
  if (el.type === 'text') {
    const content = interpolate(textOf(el, lang), vars || {});
    return (
      <div
        className="cd-text"
        dir={dirOf(lang)}
        style={{
          fontFamily: FONTS[el.font] || FONTS.sans,
          fontSize: `${el.size * PT_MM * scale}px`,
          color: el.color,
          textAlign: el.align,
          fontWeight: el.bold ? 700 : 400,
          fontStyle: el.italic ? 'italic' : 'normal',
        }}
      >
        {content}
      </div>
    );
  }
  if (el.type === 'image') {
    return <img src={el.src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: el.fit, opacity: el.opacity }} />;
  }
  if (el.type === 'shape') {
    const sw = el.strokeWidth * scale;
    const style = { width: '100%', height: '100%', boxSizing: 'border-box', opacity: el.opacity, background: el.fill };
    if (el.shape !== 'line' && sw > 0) style.border = `${sw}px solid ${el.stroke}`;
    if (el.shape === 'ellipse') style.borderRadius = '50%';
    return <div style={style} />;
  }
  if (qr?.text) return <QrSvg text={qr.text} />;
  if (qr?.blank) return <div style={{ width: '100%', height: '100%', background: QR_LIGHT }} />;
  return <div className="cd-qr" aria-hidden="true" />;
}

/** صفحة شهادة ثابتة (بلا تفاعل) بمقياس px/mm. تُستعمل لتصوير PDF بقيم حقيقية. */
export default function CertificatePage({ design, lang, vars, qr, scale }) {
  return (
    <div
      className="cd-page is-preview"
      style={{ width: PAGE_W * scale, height: PAGE_H * scale, background: design.background.color, boxShadow: 'none' }}
    >
      {design.elements.map((el) => (el.hidden ? null : (
        <div
          key={el.id}
          className={`cd-el cd-el-${el.type}`}
          style={{ left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale, pointerEvents: 'none' }}
        >
          <ElementBody el={el} lang={lang} vars={vars} scale={scale} qr={qr} />
        </div>
      )))}
    </div>
  );
}
