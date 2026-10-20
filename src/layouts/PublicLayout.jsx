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
  useLayoutEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const setHeight = () => {
      document.documentElement.style.setProperty('--fixed-stack-height', `${el.offsetHeight}px`);
    };
    setHeight();
    const ro = new ResizeObserver(setHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [announcement]);

  return (
    <>
      <div className="fixed-top-stack" ref={stackRef}>
        <AnnouncementBar announcement={announcement} />
        <Header brandName={brandName} />
      </div>
      <main>{children}</main>
      <Footer brandName={brandName} copyright={copyright} />
      <Lightbox />
    </>
  );
}
