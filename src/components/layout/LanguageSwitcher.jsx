import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, applyDocumentDirection, persistLanguage } from '../../i18n';

/**
 * يظهر فقط اسم اللغة الحالية + سهم صغير، وعند الضغط عليه تنسدل قائمة بباقي
 * اللغات. الاختيار يُحفظ في localStorage ليبقى بعد إعادة تحميل الصفحة
 * (انظر i18n/index.js).
 *
 * Accessibility: نمط "disclosure" (زر يتحكم بقائمة من الأزرار) بدل
 * role=listbox — الـlistbox يتطلب عناصر role=option وإدارة تركيز مختلفة، بينما
 * هنا العناصر أزرار فعلية. لوحة المفاتيح: Enter/Space يفتح، Escape يغلق ويعيد
 * التركيز للزر، ArrowDown/ArrowUp للتنقل، وخروج التركيز من المكوّن يغلق القائمة.
 * كل خيار يحمل lang/dir الخاصَّين بلغته ليُنطق ويُعرض صحيحًا في RTL/LTR.
 */
export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  const current = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) || SUPPORTED_LANGUAGES[0];
  const others = SUPPORTED_LANGUAGES.filter((l) => l.code !== current.code);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const items = () => Array.from(ref.current?.querySelectorAll('.lang-switcher-menu button') || []);

  const handleChange = (code) => {
    i18n.changeLanguage(code);
    applyDocumentDirection(code);
    persistLanguage(code);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (!open) {
      setOpen(true);
      // ننتظر عرض القائمة ثم نركّز أول/آخر عنصر
      requestAnimationFrame(() => {
        const list = items();
        (e.key === 'ArrowUp' ? list[list.length - 1] : list[0])?.focus();
      });
      return;
    }
    const list = items();
    const idx = list.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (idx + 1) % list.length : (idx <= 0 ? list.length - 1 : idx - 1);
    list[next]?.focus();
  };

  // إغلاق القائمة عند انتقال التركيز إلى عنصر آخر خارج المكوّن (مثل Tab).
  // relatedTarget الفارغ (نقر في Safari لا يركّز الأزرار) يُتجاهل حتى لا تُغلق
  // القائمة قبل وصول click؛ النقر خارج المكوّن يعالجه mousedown أعلاه.
  const onBlur = (e) => {
    if (open && e.relatedTarget && !ref.current?.contains(e.relatedTarget)) setOpen(false);
  };

  return (
    <div className="lang-switcher" ref={ref} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        type="button"
        ref={buttonRef}
        className="lang-switcher-current"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${t('a11y.language')}: ${current.code.toUpperCase()} (${current.label})`}
      >
        {current.code.toUpperCase()}
        <span className={`lang-switcher-arrow${open ? ' open' : ''}`} aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="lang-switcher-menu" id={menuId}>
          {others.map((lang) => (
            <li key={lang.code}>
              <button type="button" lang={lang.code} dir={lang.dir} onClick={() => handleChange(lang.code)}>
                {lang.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
