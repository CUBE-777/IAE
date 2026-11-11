import { useLayoutEffect, useRef } from 'react';
import '../styles/public-home.css';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import Lightbox from '../components/common/Lightbox';
import AnnouncementBar from '../components/layout/AnnouncementBar';

export default function PublicLayout({ children, brandName, copyright, announcement }) {
  const stackRef = useRef(null);

  // Header أصلاً position:fixed (يبقى ظاهرًا أثناء التمرير). عند وجود شريط
  // إعلانات فوقه، الاثنان معًا يوضعان داخل حاوية واحدة مثبّتة (fixed)، ويُقاس
  // ارتفاعهما الفعلي ديناميكيًا لدفع محتوى الصفحة (hero) بنفس المقدار بالضبط
  // — بدل قيمة ثابتة قد لا تكفي عند ظهور شريط الإعلانات فتُخفيه خلف الهيدر.
  //
  // - يُقاس بـ getBoundingClientRect (كسري) مع ceil بدل offsetHeight المقرَّب، فلا يبقى فرق نصف بكسل.
  // - الهيدر يصغّر padding عند التمرير (>40px)؛ لو تبعه الـ hero لقفز محتواه أثناء التمرير.
  //   لذلك لا نعتمد القياس "المضغوط" إلا إن لم تكن هناك قيمة بعد؛ وعند العودة للأعلى يكبر الهيدر
  //   فيُطلق ResizeObserver قياساً جديداً صحيحاً (يشمل تغيّر التفاف الإعلان بعد تدوير الجهاز).
  // - تتبّع أي تغيّر في الحجم (تحميل الخط، التفاف نص الإعلان، إغلاقه، تدوير الشاشة) يتم عبر
  //   ResizeObserver؛ وresize/orientationchange احتياط للمتصفحات القديمة.
  // - تُزال القيمة عند مغادرة التخطيط حتى لا تبقى قيمة قديمة لصفحات أخرى.
  useLayoutEffect(() => {
    const el = stackRef.current;
    if (!el) return undefined;
    const root = document.documentElement;
    const setHeight = () => {
      const compact = el.querySelector('#site-header.scrolled') !== null;
      if (compact && root.style.getPropertyValue('--fixed-stack-height')) return;
      root.style.setProperty('--fixed-stack-height', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    };
    setHeight();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(setHeight);
      ro.observe(el);
    }
    window.addEventListener('resize', setHeight);
    window.addEventListener('orientationchange', setHeight);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', setHeight);
      window.removeEventListener('orientationchange', setHeight);
      root.style.removeProperty('--fixed-stack-height');
    };
  }, [announcement]);

  return (
    <>
      {/* top-stack-anchor: sticky بارتفاع 0 (لا يشغل مساحة) يبقى ملتصقاً بأعلى الشاشة، وفيه .fixed-top-stack
          العادي (يُقاس). لم نستعمل position:fixed لأنه يُحسب بالنسبة لـ viewport بينما بقية الصفحة بالنسبة لمنطقة
          المحتوى؛ فعند وجود شريط تمرير كلاسيكي (Windows/RTL) ينزاح الجزء العلوي عن Hero ويظهر شريط جانبي ويُقصّ
          زر اللغة. sticky يشارك Hero نفس الصندوق فلا ينزاح أبداً. */}
      <div className="top-stack-anchor">
        <div className="fixed-top-stack" ref={stackRef}>
          <AnnouncementBar announcement={announcement} />
          <Header brandName={brandName} />
        </div>
      </div>
      <main>{children}</main>
      <Footer brandName={brandName} copyright={copyright} />
      <Lightbox />
    </>
  );
}
