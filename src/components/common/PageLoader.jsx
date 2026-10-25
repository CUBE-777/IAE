/**
 * src/components/common/PageLoader.jsx
 * احتياطي Suspense أثناء تحميل جزء صفحة (code splitting). عمدًا بلا نص ولا أنماط خارجية:
 * يظهر لأجزاء من الثانية فقط، ويرث لون الخلفية من الصفحة فلا يحدث وميض أبيض في الوضع الداكن.
 */
export default function PageLoader() {
  return <div role="status" aria-busy="true" aria-live="polite" style={{ minHeight: '60vh' }} />;
}
