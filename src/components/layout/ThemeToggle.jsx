import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';

/** Bouton de bascule clair/sombre (public + administration). */
export default function ThemeToggle({ className = '' }) {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? t('a11y.themeToLight') : t('a11y.themeToDark');

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {isDark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    </button>
  );
}
