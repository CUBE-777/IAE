import { useCallback, useEffect, useRef, useState } from 'react';
import { parseAttendanceCode } from '../../utils/attendanceCode';
import { tr } from '../../i18n/adminDict';

const SAME_CODE_COOLDOWN_MS = 4000;

/** هل المتصفح يدعم المسح من الكاميرا (BarcodeDetector + getUserMedia)؟ Chrome/Android نعم؛ Safari وFirefox غالبًا لا. */
export const scannerSupported = () =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

/**
 * ماسح رمز بطاقة الحضور من داخل الموقع. لا يرسل الصورة لأي مكان: الكشف محلي في المتصفح، وما يخرج هو الرمز المقروء فقط
 * (عبر onCode). يبدأ بزر (إذن الكاميرا يحتاج لمسة)، ويوقف الكاميرا عند الإغلاق أو إخفاء الصفحة.
 */
export default function AttendanceScanner({ onCode }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const lastRef = useRef({ token: null, at: 0 });
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [state, setState] = useState('idle'); // idle | starting | running | denied | error

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState((s) => (s === 'running' || s === 'starting' ? 'idle' : s));
  }, []);

  useEffect(() => {
    const onHide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); stop(); };
  }, [stop]);

  const start = async () => {
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      setState('running');
      timerRef.current = setInterval(async () => {
        if (video.readyState < 2) return;
        try {
          const found = await detector.detect(video);
          for (const f of found) {
            const token = parseAttendanceCode(f.rawValue);
            if (!token) continue;
            const now = Date.now();
            if (lastRef.current.token === token && now - lastRef.current.at < SAME_CODE_COOLDOWN_MS) return;
            lastRef.current = { token, at: now };
            onCodeRef.current(token);
            return;
          }
        } catch {
          /* إطار غير صالح: نتجاهله ونكمل */
        }
      }, 300);
    } catch (err) {
      stop();
      setState(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'error');
    }
  };

  return (
    <div className="att-scan">
      <div className="att-video-wrap" hidden={state !== 'running'}>
        <video ref={videoRef} className="att-video" playsInline muted />
      </div>
      {state !== 'running' && (
        <button type="button" className="admin-btn admin-btn-primary" onClick={start} disabled={state === 'starting'}>
          {state === 'starting' ? tr('جاري تشغيل الكاميرا...') : tr('تشغيل الكاميرا للمسح')}
        </button>
      )}
      {state === 'running' && <button type="button" className="admin-btn admin-btn-ghost" onClick={stop}>{tr('إيقاف الكاميرا')}</button>}
      {state === 'denied' && <p role="alert">{tr('لم يُسمح باستعمال الكاميرا. اسمح بها من إعدادات المتصفح للموقع أو استعمل القائمة أدناه.')}</p>}
      {state === 'error' && <p role="alert">{tr('تعذّر تشغيل الكاميرا على هذا الجهاز. استعمل القائمة أدناه لتسجيل الحضور.')}</p>}
    </div>
  );
}
