/**
 * src/utils/motion.js
 * سلوك التمرير الذي يحترم تفضيل «تقليل الحركة» في النظام (WCAG 2.3.3): 'auto' إن فُعِّل، وإلا 'smooth'.
 * أي تعطّل في matchMedia (بيئة بلا متصفح) يُعيد 'smooth' بدل أن ينكسر الاستدعاء.
 */
export function scrollBehavior() {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch {
    return 'smooth';
  }
}
