import { useEffect, useRef, useState } from 'react';
import type { HelperClient } from './helperClient';

/** A visual's query from Power BI Desktop. */
export interface DesktopVisual {
  /** Stable key for lists. */
  key: string;
  /** When Desktop ran it (ISO time), when known. */
  at: string | null;
  text: string;
  /** "last": the last visual query in the engine's record; "listened": captured while listening. */
  source: 'last' | 'listened';
}

interface Options {
  client: HelperClient;
  /** Identifies the connected report; null when not connected. */
  connectionKey: string | null;
  /** The "listen to Power BI Desktop while connected" setting. */
  listen: boolean;
}

/**
 * The visuals' queries from Power BI Desktop, for choosing F "from a visual":
 *  - the last one Desktop ran, read from the engine's session list when asked (no listening involved);
 *  - with the listen setting on, every visual query from the moment of connecting (until disconnecting).
 * Lives at the app level, so listening continues while the filters panel is closed.
 */
export function useDesktopVisuals({ client, connectionKey, listen }: Options) {
  const [last, setLast] = useState<DesktopVisual[]>([]);
  const [listened, setListened] = useState<DesktopVisual[]>([]);
  const [listening, setListening] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);

  // A different report (or none): forget what came from the previous one.
  const [visualsFor, setVisualsFor] = useState(connectionKey);
  if (visualsFor !== connectionKey) {
    setVisualsFor(connectionKey);
    setLast([]);
    setListened([]);
    setListening(false);
    setError(null);
  }

  // Listening while connected: start when connected with the setting on; stop when either changes.
  useEffect(() => {
    if (!connectionKey || !listen) return;
    let active = true;
    let timer: number | undefined;
    lastId.current = 0;
    void client
      .startCapture(true)
      .then(() => {
        if (!active) return;
        setListened([]);
        setListening(true);
        timer = window.setInterval(() => {
          void client
            .captured(lastId.current)
            .then((status) => {
              if (!active) return;
              if (status.queries.length > 0) {
                lastId.current = status.queries[status.queries.length - 1].id;
                const added = status.queries.map((q): DesktopVisual => ({ key: `listened:${q.id}`, at: q.at, text: q.text, source: 'listened' }));
                setListened((previous) => [...added.reverse(), ...previous].slice(0, 50));
              }
              if (!status.listening) setListening(false);
            })
            .catch(() => {
              if (active) setListening(false);
            });
        }, 2000);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not listen to Power BI Desktop.');
      });
    return () => {
      active = false;
      window.clearInterval(timer);
      setListening(false);
      void client.stopCapture().catch(() => {});
    };
  }, [client, connectionKey, listen]);

  /** Reads the last visual query Desktop ran (a one-time read of the engine's record). */
  async function checkLast() {
    if (!connectionKey) return;
    setChecking(true);
    setError(null);
    try {
      const recent = await client.recentVisuals();
      setLast(recent.map((q, i): DesktopVisual => ({ key: `last:${q.at ?? i}:${q.text.length}`, at: q.at, text: q.text, source: 'last' })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the last visual from Power BI Desktop.');
    } finally {
      setChecking(false);
    }
  }

  // Newest first; the same query seen both ways appears once.
  const seen = new Set<string>();
  const visuals = [...last, ...listened]
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .filter((v) => (seen.has(v.text) ? false : (seen.add(v.text), true)));

  return { visuals, listening, checking, error, checkLast };
}

export type DesktopVisuals = ReturnType<typeof useDesktopVisuals>;
