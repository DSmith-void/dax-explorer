import { useEffect, useState } from 'react';

/**
 * Like useState, but remembered in this browser's localStorage (JSON-encoded).
 * Stored values are validated on load; anything unexpected falls back to `initial`.
 * Storage failures (private mode, blocked site data) are ignored: the value still
 * works for the current session.
 */
export function usePersistentState<T>(key: string, initial: T, isValid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (isValid(parsed)) return parsed;
      }
    } catch {
      // Fall through to the initial value.
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Non-fatal.
    }
  }, [key, value]);

  return [value, setValue] as const;
}
