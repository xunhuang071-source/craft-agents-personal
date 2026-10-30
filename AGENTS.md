# Wallee Craft Agents personal distribution

## Read first

Read PERSONAL.md, personal-release.json, docs/personal/MAINTENANCE.md and docs/personal/CHANGELOG.md. They are the authoritative maintenance record. The upstream README and old skill playbook are not release instructions.

## Product policy

- Maintain this personal distribution, not the official upgrade stream. Evaluate upstream only when the user asks. Never merge an upstream version wholesale.
- Freeze the renderer, both preloads, original Pi engine and network interceptor unless the user explicitly approves an exception. Preserve Sol 500K, oauthRelay and earlier backend fixes.
- Approved 2026-10-30 exception: Pi SDK 1.4.0 candidate. Rebuild both Pi bundles and required host SDK bridges, with source and locks aligned. Renderer, preloads, interceptor, Electron and CLIProxy remain frozen. Local candidate only; installation, real-account tests and publication need separate approval. See docs/personal/PI-SDK-1.4-REVIEW.md.
- Approved 2026-10-29 exception: Pele renderer/editor detection, diagram annotations and host Mermaid validation. The candidate was manually installed and accepted on 2026-10-29; stable release is wallee-v1.1.0. Do not reinstall the accepted code as part of metadata-only promotion. Use scripts/personal-build-diagram-candidate.mjs and docs/personal/PELE-REVIEW.md. Both Pi bundles, preloads and interceptor remain byte-identical; static old validator bytes in Pi are not an active fallback.
- Keep application identity and the existing user profile path. Do not silently change the default model or import a test profile.
- Plan first; implement only after explicit user approval. Do not interrupt or replace the running application.

## Version and release

- The private repository is https://github.com/xunhuang071-source/craft-agents-personal. Host source is on main; managed engine source is separately pinned on engine.
- Commit source and lockfiles before publishing. Runtime bundle-only patches are not a complete deliverable: mirror changes in source and record any frozen resources.
- Build from repository roots using scripts/personal-build.mjs. Do not run the generic full Electron build; it rebuilds frozen UI/preloads/old Pi.
- Follow the manual release checklist in docs/personal/MAINTENANCE.md. Never enable imported Actions workflows or official auto-updates without separate approval.
- Keep release archives in private GitHub Releases, not Git/LFS. Exclude node_modules, generated binaries, profiles and logs from Git.
- Include `Co-Authored-By: Craft Agent <agents-noreply@craft.do>` on agent-created commits; use GitHub's private noreply identity, not a local hostname.

## Privacy and rollback

- Never upload real config, credentials, OAuth account directories, conversations, attachments, workspace files, environment secrets or machine memory.
- Never inspect Google credential JSON. CLIProxy owns account tokens. Tests use local fixtures and mock endpoints.
- Normal releases replace application code only. No full-profile backup/restore rehearsal, and no old data snapshot overwrites new conversations.
- A data-format migration requires a separate approved plan. Git tracks code; it is not a backup of user data.
- Scan added source and final application content locally before upload. Review false positives individually; do not broadly exclude all tests or bundles.

## Existing local worktrees

The current host and engine directories are linked worktrees sharing the WorkBuddy Git database. Do not reset other worktrees, edit shared remotes or global Git identity, push --all, or force-push. Push only explicit approved refs to the private repository URL. Keep unrelated staged/unstaged files untouched.
