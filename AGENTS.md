# Wallee personal engine

- This worktree is the separately pinned managed Antigravity Pi adapter, based on Craft v0.15.1 / Pi SDK 1.4.0 (approved upgrade on 2026-10-30 from `cc919345`, Pi 1.1.0).
- The personal distribution lives at https://github.com/xunhuang071-source/craft-agents-personal (private). Its main branch owns release policy; the engine branch owns this source.
- Do not merge an upstream release wholesale or rebuild the frozen UI. Ask for a plan approval before changing behavior.
- Never read Google credential JSON, import another application's account, or log keys, tokens or raw upstream error bodies. Automated tests use local fixtures only.
- Build from the repository root. Changing cwd changes generated path comments and hashes.
- User data and the installed application are not development artifacts; never reset, overwrite or back up the user's complete profile as part of a normal code release.
- Keep source changes, dependency lockfile and tests together. Pin this commit in the main branch release record.
- This local worktree shares Git configuration with other WorkBuddy worktrees. Do not change shared remotes, reset unrelated worktrees, push --all or force-push. Use an explicit approved private repository URL.
- Include `Co-Authored-By: Craft Agent <agents-noreply@craft.do>` on agent-created commits.

## Pi SDK 1.4.0 upgrade verification (2026-10-30)

- Pin existing direct Pi dependencies in root, shared, server-core and pi-agent-server to **exactly 1.4.0**. Do not add direct dependencies merely to align versions. The lock resolves pi-ai, pi-agent-core, pi-coding-agent, pi-telemetry, pi-codemode, pi-mcp and pi-tui to 1.4.0; TypeBox stays 1.3.27. Only the Pi subtree changes: upstream removes chord and its esbuild 0.28 subtree and adds pi-tui's marked-cjk-friendly 0.1.2. Root esbuild and unrelated packages stay pinned by the old lock.
- Use `/Applications/Craft Agents.app/Contents/Resources/app/vendor/bun/bun` (1.3.9); do not assume `bun` is on PATH. Install with `--ignore-scripts`, then verify with `--frozen-lockfile --ignore-scripts`.
- No production adapter behavior changed for 1.4. Keep the per-session `agentDir`, `projectTrusted: false`, provider endpoint environment, credential adaptation, OAuth flow registration and Bedrock static registration. Both main and ephemeral `managedProvider: antigravity` sessions must disable agent/provider retries and cache warming. Normal Pi policy remains unchanged.
- `before_agent_start` fixtures must cover both `messageType: user` and `messageType: custom`, with normalized `systemPromptOptions`. Both receive the exact Craft system prompt. A starting run is already busy; steers batch at its next boundary. `agent_end` precedes `agent_settled`; the verified runs settle once. Stream functions may be entered with an already-aborted signal and must honor it before transport.
- Installed managed 1.1 bundle did **not** contain the separate standard-Pi `loadCraftWorkspaceInstructions` / `noContextFiles` patch. Do not transplant or overwrite the standard engine's AGENTS injection from this worktree.
- Every automated invocation uses a fresh temporary HOME/config and a launch-variable allowlist. Bundle fixtures additionally block Node HTTP/HTTP2/socket traffic and either block all fetch or permit only the one loopback mock origin without redirects. Never inherit `process.env` into a bundle fixture. Only synthetic credentials and transcripts are used.

### Results, kept separate from baseline

| Check | 1.1 baseline | 1.4 final |
| --- | --- | --- |
| pi-agent-server / shared / server-core standard typechecks | All 0 errors | All 0 errors |
| Engine tests | 169 pass, 3 opt-in skip, 0 fail | **191 pass, 0 skip, 0 fail** (25 files, 724 assertions) |
| Shared Pi targeted tests | 128 pass, 0 skip, 0 fail | 128 pass, 0 skip, 0 fail (12 files) |
| All engine tests explicitly included in TypeScript | 17 existing diagnostics | Same 17 diagnostics, normalized logs identical |
| Modified/new test files explicitly typechecked | Not applicable | 0 errors |

The 17 excluded-test diagnostics were reproduced using archived `cc919345` source and an isolated exact Pi 1.1 dependency tree. They remain in adapt-credential, craft-metadata-schema, ephemeral-query-lifecycle and search test fixtures; do not confuse them with standard production typecheck failures. An initial new preload DOM `origin` name collision and an overly strict cancellation mock assertion were fixed before final verification.

The 13 real-protocol integration cases cover file read/write, tool proxying, images, managed main/ephemeral 429 single request, stop, host Mermaid delegation, normal/managed malformed JSON, truncated tool calls, blank results, plain historical messages and complex checkpoint/branch histories. The installed managed 1.1 bundle actually reads the synthetic history before 1.4, then reads and continues it again after 1.4. Compaction and branch-summary checkpoints are synthesized with SDK persistence APIs (not real summarization); summary visibility, abandoned-branch exclusion, parent/from links and stored fields are asserted. OAuth and Bedrock smoke cases drive actual single-file bundles outside the repository up to deterministic offline failures.

### Reproduce locally (never install or start the GUI)

Run from the repository root, with a temporary HOME/config and an explicit environment allowlist:

```sh
BUN='/Applications/Craft Agents.app/Contents/Resources/app/vendor/bun/bun'
H=$(mktemp -d /tmp/craft-pi-verify.XXXXXX)
run_offline() {
  env -i HOME="$H" USERPROFILE="$H" CRAFT_CONFIG_DIR="$H/config" \
    PATH="/Applications/Craft Agents.app/Contents/Resources/app/vendor/bun:/usr/bin:/bin:/usr/sbin:/sbin" "$@"
}
run_offline "$BUN" install --frozen-lockfile --ignore-scripts
run_offline "$BUN" build packages/pi-agent-server/src/index.ts \
  --outfile .personal-build/pi-1.4-audit/managed-pi.js --target bun --format esm --external koffi
run_offline env CRAFT_PI_TEST_BUNDLE="$PWD/.personal-build/pi-1.4-audit/managed-pi.js" \
  CRAFT_PI_TEST_LEGACY_BUNDLE='/Applications/Craft Agents.app/Contents/Resources/app/resources/antigravity-pi-agent-server/index.js' \
  "$BUN" test packages/pi-agent-server/src
```

- Local bundle: `.personal-build/pi-1.4-audit/managed-pi.js` (ignored); repeated root-directory builds are byte-identical.
- Bundle SHA256: `09578725ccaabb332e2c812cd5367fcc3557d50b51c2adeb09b456edd053d920`.
- bun.lock SHA256: `79af32f9d7dbacebb91a913110a7ec6fb6b6228d114eddaf22622a4ab6689aa0`.
- Logs and the archived baseline/isolated dependencies stay under ignored `.personal-build/pi-1.4-audit/`; none are release inputs or committed artifacts.
- Main-tree reuse: copy the integration test plus `test-fixtures/{offline-environment,loopback-network,block-node-network}.ts`. For the standard bundle use `CRAFT_PI_TEST_MANAGED=0`, its own 1.1 legacy bundle, and `-t 'streaming file|user stop|Mermaid|normal|synthetic'` to exclude the managed-only single-request 429 policy. Reuse the startup lifecycle tests and the typed system-prompt fixtures independently. Do not replace the standard tree's context loader.
- Not validated here: real accounts/services, GUI installation, candidate packaging/signing, external summaries or user-data migration. The main release owner pins the engine commit and performs candidate assembly. No push, tag or upstream merge is authorized by this local verification.
