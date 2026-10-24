import { useEffect } from 'react';

/**
 * ينقل الصفحة إلى القسم المطابق لـ #hash في الرابط عند فتح الصفحة (مثل /#join).
 *
 * لماذا لازم؟ الموقع SPA: عند فتح رابط فيه #join يحاول المتصفح التمرير فورًا، لكن أقسام الصفحة
 * لم تُرسم بعد (React يرسمها لاحقًا ثم تصل البيانات وتتغير الارتفاعات)، فيبقى القارئ في أعلى الصفحة.
 *
 * الحل: نعيد المحاولة لفترة قصيرة إلى أن يوجد العنصر وتستقر المحاذاة (تظهر الصور والمشاريع فوقه
 * فتتحرك الأقسام). نتوقف فورًا إذا لمس الزائر الشاشة أو مرّر بالعجلة أو ضغط مفتاحًا، كي لا نسحبه من يده.
 * scroll-margin-top في enhancements.css يحفظ العنوان من التغطية بالهيدر الثابت.
 */
const POLL_MS = 120;
const STABLE_TICKS = 8;     // ~1 ثانية من الاستقرار ثم نتوقف
const MAX_MS = 6000;        // حد أقصى مهما حدث

export function useScrollToHash() {
  useEffect(() => {
    let id = '';
    try {
      id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    } catch (_e) {
      return undefined;
    }
    if (!id) return undefined;

    let stable = 0;
    let stopped = false;
    const startedAt = Date.now();

    const stop = () => {
      stopped = true;
      window.clearInterval(timer);
      ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((ev) => window.removeEventListener(ev, stop));
    };
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((ev) => window.addEventListener(ev, stop, { passive: true }));

    const tick = () => {
      if (stopped) return;
      if (Date.now() - startedAt > MAX_MS) { stop(); return; }
      const el = document.getElementById(id);
      if (!el) { stable = 0; return; }

      const margin = parseFloat(window.getComputedStyle(el).scrollMarginTop) || 0;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const aligned = Math.abs(el.getBoundingClientRect().top - margin) < 3 || atBottom;

      if (aligned) {
        stable += 1;
        if (stable >= STABLE_TICKS) stop();
        return;
      }
      stable = 0;
      // 'instant' يتجاوز scroll-behavior: smooth حتى لا تتصارع حركات التمرير المتتالية
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
    };

    const timer = window.setInterval(tick, POLL_MS);
    tick();
    return stop;
  }, []);
}
