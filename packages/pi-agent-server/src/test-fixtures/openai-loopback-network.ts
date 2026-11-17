import './block-node-network.ts';

// Load before the actual interceptor so it wraps an already restricted fetch.
const fixtureOrigin = process.env.CRAFT_PI_TEST_ORIGIN;
if (!fixtureOrigin || new URL(fixtureOrigin).hostname !== '127.0.0.1') {
  throw new Error('A loopback fixture origin is required');
}
const nativeFetch = globalThis.fetch;
function assertFixture(input: string | URL | Request): void {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (url.origin !== fixtureOrigin || !['/v1/chat/completions', '/v1/responses'].includes(url.pathname)) {
    throw new Error('OFFLINE_FETCH_BLOCKED');
  }
}
globalThis.fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assertFixture(input);
    return nativeFetch(input, { ...init, redirect: 'error' });
  },
  { preconnect: (url: string | URL): void => { assertFixture(url); } },
) satisfies typeof globalThis.fetch;
