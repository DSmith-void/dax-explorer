import { useEffect, useRef, useState } from 'react';

/** What is used of a BroadcastChannel (a fake in tests). */
export interface TabChannel {
  postMessage(message: unknown): void;
  listen(handler: (message: unknown) => void): void;
  close(): void;
}

const CHANNEL = 'dax-explorer-tabs';
const OPENED = 'opened';

/**
 * Every DAX Explorer tab shares the one running program (and its connection to Power BI Desktop). A newly
 * opened tab (a second click on the ribbon, for another report perhaps) says so; older tabs then know they
 * no longer show what the program is connected to. `claim` makes this tab the current one again.
 */
export function watchNewerTabs(channel: TabChannel, onNewer: () => void): { claim: () => void; close: () => void } {
  channel.listen((message) => {
    if (message === OPENED) onNewer();
  });
  const claim = () => channel.postMessage(OPENED);
  claim();
  return { claim, close: () => channel.close() };
}

/**
 * True once DAX Explorer was opened in a newer tab. Only tabs started by the program (`active`: they have
 * its token) take part; without BroadcastChannel this simply stays false.
 */
export function useNewerTab(active: boolean): { newer: boolean; useThisTab: () => void } {
  const [newer, setNewer] = useState(false);
  const claim = useRef<() => void>(() => {});
  useEffect(() => {
    if (!active || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    const watcher = watchNewerTabs(
      {
        postMessage: (message) => channel.postMessage(message),
        listen: (handler) => {
          channel.onmessage = (event) => handler(event.data);
        },
        close: () => channel.close(),
      },
      () => setNewer(true),
    );
    claim.current = watcher.claim;
    return watcher.close;
  }, [active]);
  return {
    newer,
    // Take over: tell the other tabs, then reload so this tab shows what the program is connected to now.
    useThisTab: () => {
      claim.current();
      window.location.reload();
    },
  };
}
