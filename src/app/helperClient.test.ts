import { describe, expect, it } from 'vitest';
import { createHelperClient, startSample, TOKEN_HEADER, tokenFromHash, type HelperClient } from './helperClient';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

/** A fake fetch that records requests and replies from a table of responses. */
function fakeFetch(replies: Record<string, Response | Error>) {
  const calls: { path: string; init: RequestInit }[] = [];
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    calls.push({ path, init });
    const reply = replies[`${init.method ?? 'GET'} ${path}`];
    if (reply instanceof Error) throw reply;
    if (!reply) return new Response('not found', { status: 404 });
    return reply.clone();
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

describe('tokenFromHash', () => {
  it.each([
    [`#token=${TOKEN}`, TOKEN],
    [`token=${TOKEN}`, TOKEN],
    [`#other=1&token=${TOKEN}`, TOKEN],
    ['#token=short', null],
    ['', null],
    ['#', null],
  ])('%s → %s', (hash, expected) => {
    expect(tokenFromHash(hash)).toBe(expected);
  });
});

describe('createHelperClient', () => {
  it('sends the token with every request', async () => {
    const { impl, calls } = fakeFetch({ 'GET /api/desktop/instances': json([]) });
    await createHelperClient(TOKEN, impl).instances();
    expect(new Headers(calls[0].init.headers).get(TOKEN_HEADER)).toBe(TOKEN);
  });

  it('reports the helper as available with its status', async () => {
    const status = { helperVersion: '1.0', connection: null, modelSummary: null };
    const { impl } = fakeFetch({ 'GET /api/status': json(status) });
    expect(await createHelperClient(TOKEN, impl).check()).toEqual({ kind: 'available', status });
  });

  it('says the page needs the helper link when the token is rejected', async () => {
    const { impl } = fakeFetch({ 'GET /api/status': json({ error: 'no token' }, 401) });
    expect(await createHelperClient(null, impl).check()).toEqual({ kind: 'needs-token' });
  });

  it.each([
    ['the helper is not running (network error)', new TypeError('Failed to fetch')],
    ['nothing answers /api (plain web server)', new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
    ['the dev proxy cannot reach the helper', new Response('', { status: 502 })],
  ])('is unavailable when %s', async (_case, reply) => {
    const { impl } = fakeFetch({ 'GET /api/status': reply });
    expect(await createHelperClient(TOKEN, impl).check()).toEqual({ kind: 'unavailable' });
  });

  it('posts the chosen port when connecting', async () => {
    const { impl, calls } = fakeFetch({ 'POST /api/connect': json({ connected: true }) });
    await createHelperClient(TOKEN, impl).connect(61403);
    expect(calls[0].init.body).toBe('{"port":61403}');
    expect(new Headers(calls[0].init.headers).get('Content-Type')).toBe('application/json');
  });

  it("shows the helper's own error message", async () => {
    const { impl } = fakeFetch({ 'POST /api/connect': json({ error: 'That Power BI Desktop report is no longer open.' }, 404) });
    await expect(createHelperClient(TOKEN, impl).connect(1)).rejects.toThrow('That Power BI Desktop report is no longer open.');
  });

  it('combines problem title and detail', async () => {
    const { impl } = fakeFetch({ 'POST /api/connect': json({ title: 'Could not read the model.', detail: 'Try again.' }, 502) });
    await expect(createHelperClient(TOKEN, impl).connect(1)).rejects.toThrow('Could not read the model. Try again.');
  });

  it('explains when the helper stops responding', async () => {
    const { impl } = fakeFetch({ 'GET /api/model': new TypeError('Failed to fetch') });
    await expect(createHelperClient(TOKEN, impl).model()).rejects.toThrow('The helper is not responding');
  });
});

describe('startSample', () => {
  /** A client whose sample replies come from scripted lists. */
  function sampleClient(opened: 'open' | 'starting', connectReplies: ('connected' | 'waiting')[]) {
    const calls: string[] = [];
    const client = {
      openSample: async () => {
        calls.push('open');
        return opened;
      },
      connectSample: async () => {
        calls.push('connect');
        return connectReplies.shift() ?? 'waiting';
      },
    } as unknown as HelperClient;
    return { client, calls };
  }
  const noWait = async () => {};

  it('opens the sample, then checks until Desktop has loaded it', async () => {
    const { client, calls } = sampleClient('starting', ['waiting', 'waiting', 'connected']);
    const progress: string[] = [];
    await startSample(client, { sleep: noWait, onProgress: (p) => progress.push(p) });
    expect(calls).toEqual(['open', 'connect', 'connect', 'connect']);
    expect(progress).toEqual(['opening', 'opening', 'loading', 'loading']);
  });

  it('connects right away when the sample is already open', async () => {
    const { client, calls } = sampleClient('open', ['connected']);
    await startSample(client, { sleep: noWait });
    expect(calls).toEqual(['open', 'connect']);
  });

  it('gives up with a plain explanation when Desktop takes too long', async () => {
    const { client, calls } = sampleClient('starting', []);
    await expect(startSample(client, { sleep: noWait, intervalMs: 1000, timeoutMs: 3000 })).rejects.toThrow(
      'Power BI Desktop has not finished opening the sample yet',
    );
    expect(calls.filter((c) => c === 'connect')).toHaveLength(4); // at 0, 1, 2 and 3 seconds
  });

  it('posts to the sample endpoints', async () => {
    const { impl, calls } = fakeFetch({
      'POST /api/sample/open': json({ state: 'starting' }),
      'POST /api/sample/connect': json({ state: 'connected' }),
    });
    const client = createHelperClient(TOKEN, impl);
    expect(await client.openSample()).toBe('starting');
    expect(await client.connectSample()).toBe('connected');
    expect(calls.map((c) => c.path)).toEqual(['/api/sample/open', '/api/sample/connect']);
  });

  it('shows the helper message when another report is named like the sample', async () => {
    const { impl } = fakeFetch({ 'POST /api/sample/connect': json({ error: "…isn't DAX Explorer's sample…" }, 409) });
    await expect(createHelperClient(TOKEN, impl).connectSample()).rejects.toThrow("isn't DAX Explorer's sample");
  });
});

describe('capture from Desktop', () => {
  it('starts, reads only new queries, and stops', async () => {
    const { impl, calls } = fakeFetch({
      'POST /api/capture/start': json({ listening: true, stopsAt: '2026-11-10T21:05:00Z' }),
      'GET /api/capture?after=3': json({ listening: true, stopsAt: '2026-11-10T21:05:00Z', queries: [{ id: 4, at: '2026-11-10T21:01:00Z', text: 'EVALUATE …' }] }),
      'POST /api/capture/stop': json({ listening: false }),
    });
    const client = createHelperClient(TOKEN, impl);
    await client.startCapture();
    const status = await client.captured(3);
    expect(status.queries.map((q) => q.id)).toEqual([4]);
    await client.stopCapture();
    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.path}`)).toEqual(['POST /api/capture/start', 'GET /api/capture?after=3', 'POST /api/capture/stop']);
  });

  it("shows the helper's message when it can't listen", async () => {
    const { impl } = fakeFetch({ 'POST /api/capture/start': json({ error: 'Connect to a report first.' }, 409) });
    await expect(createHelperClient(TOKEN, impl).startCapture()).rejects.toThrow('Connect to a report first.');
  });
});
