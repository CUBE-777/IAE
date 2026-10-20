import { useCallback, useEffect, useState } from 'react';

/**
 * Thème clair / sombre.
 * - Préférence mémorisée dans localStorage (clé « iae:theme »), sinon préférence système.
 * - L'attribut data-theme est posé sur <html> avant le premier rendu par un petit script
 *   dans index.html (évite le flash), et resynchronisé ici pour les changements ultérieurs.
 * - Plusieurs boutons peuvent coexister (en-tête, admin) : ils restent synchronisés via
 *   un événement personnalisé.
 */
const THEME_KEY = 'iae:theme';
const THEME_EVENT = 'iae:theme-change';

export function getStoredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // localStorage indisponible (navigation privée) : on retombe sur la préférence système
  }
  return null;
}

function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#061631' : '#0a66c8');
}

export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || getStoredTheme() || systemTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const onChange = (e) => setTheme(e.detail);
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignoré : le thème reste appliqué pour la session
    }
    applyTheme(next);
    setTheme(next);
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
  }, [theme]);

  return { theme, toggle };
}
