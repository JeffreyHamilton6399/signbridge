/**
 * Applies theme, font and reduced-motion preferences to the document root.
 *
 * `system` follows the OS and keeps following it - the media query listener
 * stays attached, so a user who switches their laptop to dark at sunset sees the
 * app follow without a reload.
 */
import { useEffect } from 'react';
import { useSettings } from '@/store';

export function useTheme(): void {
  const { theme, font, reducedMotion } = useSettings((s) => s.settings.display);

  useEffect(() => {
    const root = document.documentElement;

    const apply = (dark: boolean) => {
      root.classList.toggle('dark', dark);
      root.classList.toggle('contrast-high', theme === 'contrast');
    };

    if (theme === 'system') {
      const query = window.matchMedia('(prefers-color-scheme: dark)');
      apply(query.matches);
      const listener = (e: MediaQueryListEvent) => apply(e.matches);
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    }

    apply(theme === 'dark' || theme === 'contrast');
    return undefined;
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.font = font;
  }, [font]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? 'on' : 'off';
  }, [reducedMotion]);
}
