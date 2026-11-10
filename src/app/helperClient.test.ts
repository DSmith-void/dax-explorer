import { describe, expect, it } from 'vitest';
import { createHelperClient, TOKEN_HEADER, tokenFromHash } from './helperClient';

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
