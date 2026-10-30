import './block-node-network.ts';

/** Bundle integration tests may reach only their one disposable HTTP fixture. */
const origin = process.env.CRAFT_PI_TEST_ORIGIN;
if (!origin || new URL(origin).hostname !== '127.0.0.1') {
  throw new Error('A loopback fixture origin is required');
}
const nativeFetch = globalThis.fetch;
function assertFixture(input: string | URL | Request): void {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (url.origin !== origin || url.pathname !== '/v1/messages') {
    throw new Error('OFFLINE_FETCH_BLOCKED: only the local fixture endpoint is allowed');
  }
}
globalThis.fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assertFixture(input);
    // Manual redirects cannot escape the origin check in this wrapper.
    return nativeFetch(input, { ...init, redirect: 'error' });
  },
  { preconnect: (url: string | URL): void => { assertFixture(url); } },
) satisfies typeof globalThis.fetch;
