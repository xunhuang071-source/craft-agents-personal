# Personal managed Pi engine

This branch builds the Antigravity-specific adapter for the Wallee distribution. It is not a replacement for the preserved original Pi engine.

- Source baseline: Craft v0.15.1 (`2e3ba53f`), Pi SDK 1.1.0.
- Personal repository: https://github.com/xunhuang071-source/craft-agents-personal
- Remote branch: `engine`.
- Release policy, change log and component lock: the personal repository's `main` branch.
- Bun: 1.3.9. Install with `bun install --frozen-lockfile --ignore-scripts`.

Build **from this repository root**:

```sh
bun build packages/pi-agent-server/src/index.ts --outfile .personal-build/managed-pi.js --target bun --format esm --external koffi
```

Validation:

```sh
bun test packages/pi-agent-server/
CRAFT_PI_TEST_BUNDLE="$PWD/.personal-build/managed-pi.js" bun test packages/pi-agent-server/src/managed-transport.integration.test.ts
```

Integration tests use a local mock HTTP server, generated files and a disposable profile. No real Google login is needed.

The first personal release preserves engine output SHA256 `5f82eeeaf5cdc1e5a6a2214671e8c133afa2b05099bce0ef58cd201aa304b535`. Build commands run from the package subdirectory produce different generated path comments; they must not be mistaken for the release output.
