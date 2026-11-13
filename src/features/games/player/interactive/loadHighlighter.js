let pending = null;

/**
 * يحمّل PrismJS مرة واحدة عند الطلب. عند الفشل (شبكة/حزمة) يُرجع null فيُعرض الكود بنص عادي دون تلوين: التلوين تحسين لا شرط.
 */
export function loadHighlighter() {
  if (!pending) {
    pending = import('./prismSetup').then((m) => m.default).catch((err) => {
      console.error('games syntax highlighter unavailable', err);
      return null;
    });
  }
  return pending;
}
