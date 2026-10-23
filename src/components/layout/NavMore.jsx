import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Entrée « Plus » du menu principal (bureau) : regroupe les liens secondaires dans un menu déroulant.
 * Dans le tiroir mobile, le CSS affiche ces liens à plat (le bouton est masqué) : même contenu partout.
 *
 * items : [{ key, label, href?, to? }]  (to = route interne via <Link>, href = lien/ancre classique)
 * activeKey : clé du lien actif (met aussi le bouton en surbrillance)
 */
export default function NavMore({ label, items, activeKey, activeCurrent = 'page', onNavigate }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const hasActive = items.some((i) => i.key === activeKey);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleNavigate = () => {
    setOpen(false);
    onNavigate?.();
  };

  return (
    <li ref={rootRef} className={`nav-more${open ? ' open' : ''}`}>
      <button
        type="button"
        ref={btnRef}
        className={`nav-more-btn${hasActive ? ' active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <span className="nav-more-caret" aria-hidden="true" />
      </button>
      <ul className="nav-more-menu">
        {items.map((item) => {
          const active = activeKey === item.key;
          const common = {
            className: active ? 'active' : undefined,
            'aria-current': active ? activeCurrent : undefined,
            onClick: handleNavigate,
          };
          return (
            <li key={item.key}>
              {item.to ? <Link to={item.to} {...common}>{item.label}</Link> : <a href={item.href} {...common}>{item.label}</a>}
            </li>
          );
        })}
      </ul>
    </li>
  );
}
