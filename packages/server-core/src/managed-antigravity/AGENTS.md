# Managed Antigravity (CLIProxy)

## Boundaries

- Node-compatible implementation; no Electron import and no external runtime dependency.
- Instantiate exactly one `AntigravityManager` per `rootDir`. The Electron owner injects independent keys from Craft's encrypted credential store, opens the validated URL in the system browser, and drains/blocks consumers before replacement or disconnect.
- Never read another application's credentials, exchange Google authorization codes, refresh tokens, or inspect credential JSON. CLIProxy exclusively owns these operations. Only its finite management summaries are consumed.
- `state.json` contains opaque directory IDs, local ports, authorization time and sanitized public model metadata. Keys appear only in memory and the required 0600 per-process temporary config; process directories are removed after confirmed stop. The OAuth account directory is private (0700) and survives `dispose()`.
- Preserve handles and directories if process stop cannot be confirmed. Do not scan or kill unrelated processes. An occupied registered port fails closed; it is never adopted. Registered stale directories remain tracked for explicit disconnect cleanup.

## Public contract (`main.ts`)

Exports `AntigravityManager`, `AntigravityManagerOptions`, `Status`, `Binding`, `Model`, `AntigravityError`, and fixed-version source constants.

- `getStatus()` is read-only; it never launches/downloads/refreshes/writes. `connected` describes retained authorization, not a guarantee of model availability or a running child. `error` is always a fixed machine code.
- `connect(onAuthUrl)` is a complete async login operation, deduplicated during one attempt. A second attempt uses an isolated account directory and temporary port; commit restarts it on the stable metadata port. Cancellation/failure preserves the previous active authorization. A failed replacement start leaves the previous authorization lazily restartable.
- `Binding.baseUrl` includes `/v1`. The Anthropic consumer must remove that suffix before using its SDK, which adds `/v1/messages` itself. The binding's API key is execution-only and must not enter renderer/session/config/log output.
- Successful `connect` returns at least one catalog model. First authorization with unavailable catalog is retained as connected with an empty model list and `catalog_unavailable`; `refreshModels()` can recover it. A catalog failure during replacement preserves the old active. Refresh failures retain the previous list.
- `ensureReady()` only launches an authorized active account, shares concurrent startup, and returns the stable binding. No inference request or forced token refresh is used as readiness proof.
- `cancelLogin()` affects only the current candidate; `disconnect()` stops owned writers and deletes only registered authorization directories; `dispose()` stops owned processes, retains authorization and is repeatable (including retry after failed stop).

## Fixed upstream contract

- CLIProxyAPI MIT v8.0.13, Darwin ARM64 only. `binary.ts` pins the release URL and independently verified archive/executable SHA256. The default installer verifies both. An injected `binaryPath` is a trusted packaging input; the packager owns verification/signing.
- V8 nested config, 127.0.0.1 only; independent access/management keys; management secret strictly below 72 bytes; panel/download/discovery/pprof/request logging disabled. Commercial mode disables creation of the upstream request logger. Request retries and streaming bootstrap retries are zero.
- OAuth: bind 127.0.0.1:51121 before requesting `/v0/management/antigravity-auth-url` without `is_webui`; require exact HTTPS `accounts.google.com` authorization URL/state/localhost redirect; transport one matching callback once to `/oauth-callback`; poll `get-auth-status` (`wait`, `ok`, `error`); confirm a usable saved Antigravity account via `auth-files`.
- Lost callback responses, malformed replies, HTTP 409/5xx are ambiguous: poll the known state, never replay the code. Definite 4xx rejection terminates. Known upstream auth error strings map to fixed codes; unknown/raw errors are never exposed.
- Local HTTP uses `node:http` with `agent:false` and explicit cancellation. Do not switch it to fetch: Bun fetch was observed replaying a dropped callback POST. Keep abort listeners until promise settlement; Bun's Node shim may emit `request.close` before response completion and omit an abort error event.
- Model catalog is the union of account and `/v1/models` entries. Definitions only add known metadata; they are not an allowlist. Never infer capability from model names. No raw child stdout/stderr or upstream error body is retained or logged.

## Tests

Run `bun test packages/server-core/src/managed-antigravity/` and `bun run --cwd packages/server-core typecheck`.

The default suite performs local mock HTTP/owned-process tests only. Native smoke is explicitly opt-in:

```sh
CLIPROXY_NATIVE_BINARY=/absolute/path/to/verified/upstream/cli-proxy-api \
  bun test packages/server-core/src/managed-antigravity/native.test.ts
```

The native test verifies the exact unmodified executable hash, starts it with `-local-model` (smoke-test-only), checks local health/auth/catalog/panel/config permissions, and stops it. It does not request an OAuth URL, import credentials, open a browser, or make a model request. No real Google login belongs in automated tests. Temporary test data stays in this directory and is removed after each run.
