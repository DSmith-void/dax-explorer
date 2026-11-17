/**
 * Whether Power BI Desktop is busy with its own slow queries (a report page with heavy visuals), which makes every
 * value DAX Explorer asks for wait. Asked of the helper every few seconds while connected, only while the tab is
 * visible. Checked in Power BI Desktop: a page with heavy visuals kept two of its queries running for minutes, and
 * switching the report to an empty page let the engine rest.
 */
import { useEffect, useState } from 'react';
import type { DesktopBusy, HelperClient } from './helperClient';

export const BUSY_CHECK_MS = 5000;

export function useDesktopBusy(client: HelperClient, connected: boolean): DesktopBusy | null {
  const [busy, setBusy] = useState<DesktopBusy | null>(null);
  useEffect(() => {
    if (!connected) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const now = await client.desktopBusy();
        if (!stopped) setBusy(now.running > 0 ? now : null);
      } catch {
        // An older helper, or the report just closed: no notice.
        if (!stopped) setBusy(null);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), BUSY_CHECK_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [client, connected]);
  // A notice from before a disconnect isn't shown.
  return connected ? busy : null;
}

/** "Power BI Desktop is still calculating 2 of the report's visuals (for 4 minutes)…". */
export function busyText(busy: DesktopBusy): string {
  const minutes = Math.floor(busy.longestMs / 60000);
  const how = minutes >= 1 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : `${Math.max(1, Math.round(busy.longestMs / 1000))} seconds`;
  const what = busy.running === 1 ? 'one of the report’s own visuals' : `${busy.running} of the report’s own visuals`;
  return `Power BI Desktop is still calculating ${what} (for ${how}), so values here wait for it. If Power BI Desktop responds, switching the report to an empty page stops them; if it doesn’t, they may take several minutes.`;
}
