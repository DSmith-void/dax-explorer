import { describe, expect, it, vi } from 'vitest';
import { watchNewerTabs, type TabChannel } from './newerTab';

/** Channels joined like browser tabs: a message reaches every other tab, not the sender. */
function tabs(count: number): TabChannel[] {
  const all: (TabChannel & { receive: (message: unknown) => void })[] = [];
  for (let i = 0; i < count; i++) {
    let handler: ((message: unknown) => void) | null = null;
    const channel: TabChannel & { receive: (message: unknown) => void } = {
      receive: (message) => handler?.(message),
      listen: (h) => {
        handler = h;
      },
      postMessage: (message) => all.filter((c) => c !== channel).forEach((c) => c.receive(message)),
      close: vi.fn(),
    };
    all.push(channel);
  }
  return all;
}

describe('watchNewerTabs', () => {
  it('an older tab learns that a newer one was opened; the newer one is not disturbed', () => {
    const [first, second] = tabs(2);
    const firstNewer = vi.fn();
    const secondNewer = vi.fn();
    watchNewerTabs(first, firstNewer);
    expect(firstNewer).not.toHaveBeenCalled();
    watchNewerTabs(second, secondNewer);
    expect(firstNewer).toHaveBeenCalledOnce();
    expect(secondNewer).not.toHaveBeenCalled();
  });

  it('"use this tab" makes an older tab current again, and the other one learns it', () => {
    const [first, second] = tabs(2);
    const secondNewer = vi.fn();
    const older = watchNewerTabs(first, () => {});
    watchNewerTabs(second, secondNewer);
    older.claim();
    expect(secondNewer).toHaveBeenCalledOnce();
  });

  it('ignores other messages and closes its channel', () => {
    const [first, second] = tabs(2);
    const newer = vi.fn();
    const watcher = watchNewerTabs(first, newer);
    second.postMessage('something else');
    expect(newer).not.toHaveBeenCalled();
    watcher.close();
    expect(first.close).toHaveBeenCalled();
  });
});
