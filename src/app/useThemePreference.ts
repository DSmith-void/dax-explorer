import { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

/** Must stay in sync with the inline script in index.html. */
export const THEME_STORAGE_KEY = 'dax-explorer-theme';

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // Storage can be unavailable (private mode, blocked site data). Fall back to system.
  }
  return 'system';
}

/**
 * Theme preference stored in localStorage and reflected as a `data-theme`
 * attribute on <html>. "system" removes the attribute so the CSS
 * `prefers-color-scheme` media query decides.
 */
export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(readStoredPreference);

  useEffect(() => {
    const root = document.documentElement;
    if (preference === 'system') {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = preference;
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Non-fatal: the theme still applies for this session.
    }
  }, [preference]);

  return [preference, setPreference] as const;
}
