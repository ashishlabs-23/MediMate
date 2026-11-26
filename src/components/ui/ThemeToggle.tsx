import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycles: Array<typeof theme> = ['light', 'dark', 'system'];
  const nextTheme = cycles[(cycles.indexOf(theme) + 1) % cycles.length];

  const labels = {
    light: 'Switch to dark mode',
    dark: 'Switch to system theme',
    system: 'Switch to light mode',
  };

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme)}
      aria-label={labels[theme]}
      title={labels[theme]}
      className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-btn text-ink-secondary hover:text-ink-primary hover:bg-slate-100 transition-colors"
    >
      {theme === 'dark' ? (
        <Moon className="w-5 h-5" aria-hidden="true" />
      ) : theme === 'system' ? (
        <Monitor className="w-5 h-5" aria-hidden="true" />
      ) : (
        <Sun className="w-5 h-5" aria-hidden="true" />
      )}
    </button>
  );
}
