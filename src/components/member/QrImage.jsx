import { useMemo } from 'react';
import { qrSvgPath } from '../../utils/qr';

// ألوان الرمز ثابتة (لا تتبع الوضع الداكن): مسح الكاميرا يحتاج تباينًا عاليًا وخلفية بيضاء دائمًا
export const QR_DARK = '#0b1220';
export const QR_LIGHT = '#ffffff';

/** رمز QR كـ SVG داخل المكوّن: بلا canvas ولا مصادر خارجية. */
export default function QrImage({ text, label }) {
  const qr = useMemo(() => {
    try {
      return qrSvgPath(text);
    } catch {
      return null; // تجاوز السعة: لا يحدث بأطوال النصوص المستعملة، لكن لا نكسر الصفحة
    }
  }, [text]);
  if (!qr) return null;
  return (
    <svg className="member-qr-svg" viewBox={qr.viewBox} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={qr.size} height={qr.size} fill={QR_LIGHT} />
      <path d={qr.d} fill={QR_DARK} />
    </svg>
  );
}
