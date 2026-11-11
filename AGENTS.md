# Wallee Craft Agents personal distribution

## Read first

Read PERSONAL.md, personal-release.json, docs/personal/MAINTENANCE.md and docs/personal/CHANGELOG.md. They are the authoritative maintenance record. The upstream README and old skill playbook are not release instructions.

## Product policy

- Maintain this personal distribution, not the official upgrade stream. Evaluate upstream only when the user asks. Never merge an upstream version wholesale.
- Freeze the renderer, both preloads, original Pi engine and network interceptor unless the user explicitly approves an exception. Preserve Sol 500K, oauthRelay and earlier backend fixes.
- Approved 2026-10-30 exception: Pi SDK 1.4.0 candidate. Rebuild both Pi bundles and required host SDK bridges, with source and locks aligned. Renderer, preloads, interceptor, Electron and CLIProxy remain frozen. Local candidate only; installation, real-account tests and publication need separate approval. See docs/personal/PI-SDK-1.4-REVIEW.md.
- Approved 2026-10-29 exception: Pele renderer/editor detection, diagram annotations and host Mermaid validation. The candidate was manually installed and accepted on 2026-10-29; stable release is wallee-v1.1.0. Do not reinstall the accepted code as part of metadata-only promotion. Use scripts/personal-build-diagram-candidate.mjs and docs/personal/PELE-REVIEW.md. Both Pi bundles, preloads and interceptor remain byte-identical; static old validator bytes in Pi are not an active fallback.
- Accepted 2026-11-11: the user installed wallee-v1.2.0-rc.2, verified historical output links in Finder, and authorized private GitHub publication as wallee-v1.2.0. Promotion changes metadata only; do not rebuild, re-sign or reinstall the accepted program. Both Pi SDK 1.4.0 bundles and the Finder fix are source-owned and locked. Use scripts/personal-build-finder-candidate.mjs and docs/personal/FINDER-LINKS-REVIEW.md for future approved work; current renderer, preloads and interceptor remain frozen.
- Accepted 2026-11-11: wallee-v1.3.0 uses standard Pi only. Build this line with `scripts/personal-build-pi-only.mjs` and retain the verified wallee-v1.2.0 base asset. Mag派 owns the replacement Antigravity connection. The managed engine branch remains a historical release input.
- Approved 2026-11-11: bundle the local visual review workbench with the personal app. Candidate wallee-v1.4.0-rc.1 may rebuild main and add versioned workbench resources/docs only; renderer, preloads, Pi and interceptor remain frozen. Use scripts/personal-build-visual-review.mjs and docs/personal/VISUAL-REVIEW-REVIEW.md. Do not auto-install or publish.
- Approved 2026-11-11: improve inline Mermaid reading size and fix existing shared image/diagram preview gestures. Renderer changes are limited to those components, their small layout helper and tests. Keep main, Pi, preloads, interceptor and the bundled workbench byte-identical to wallee-v1.4.0. Use scripts/personal-build-reading-candidate.mjs; local wallee-v1.4.1-rc.1 only, with no automatic installation or release. See docs/personal/READING-GESTURES-REVIEW.md.
- Accepted 2026-11-11: the user installed and accepted wallee-v1.4.1-rc.1 and authorized public release as wallee-v1.4.1. Installed full inventory matches the candidate. Promotion is metadata-only: do not rebuild, re-sign or reinstall. The updated renderer is now the frozen baseline in personal-release.json; further changes need approval. Main, Pi, preloads, interceptor and workbench remain identical to 1.4.0.
- Keep application identity and the existing user profile path. Do not silently change the default model or import a test profile.
- Plan first; implement only after explicit user approval. Do not interrupt or replace the running application.

## Version and release

- The repository is https://github.com/xunhuang071-source/craft-agents-personal. On 2026-11-11 the user explicitly approved making this repository and its existing release history public, and publishing the accepted workbench build as wallee-v1.4.0. This does not authorize publishing other private repositories, workspaces, skills or user data. Host source is on main; historical managed engine source remains pinned on engine.
- Commit source and lockfiles before publishing. Runtime bundle-only patches are not a complete deliverable: mirror changes in source and record any frozen resources.
- Build from repository roots using the script specified by the current release lock. Do not run the generic full Electron build; it rebuilds frozen UI/preloads/old Pi.
- Follow the manual release checklist in docs/personal/MAINTENANCE.md. Never enable imported Actions workflows or official auto-updates without separate approval.
- Keep code-only release archives in this repository's GitHub Releases, not Git/LFS. Exclude node_modules, generated binaries, profiles and logs from Git.
- Include `Co-Authored-By: Craft Agent <agents-noreply@craft.do>` on agent-created commits; use GitHub's private noreply identity, not a local hostname.

## Privacy and rollback

- Never upload real config, credentials, OAuth account directories, conversations, attachments, workspace files, environment secrets or machine memory.
- Never inspect Google credential JSON. CLIProxy owns account tokens. Tests use local fixtures and mock endpoints.
- Normal releases replace application code only. No full-profile backup/restore rehearsal, and no old data snapshot overwrites new conversations.
- A data-format migration requires a separate approved plan. Git tracks code; it is not a backup of user data.
- Scan added source and final application content locally before upload. Review false positives individually; do not broadly exclude all tests or bundles.

## Existing local worktrees

The current host and engine directories are linked worktrees sharing the WorkBuddy Git database. Do not reset other worktrees, edit shared remotes or global Git identity, push --all, or force-push. Push only explicit approved refs to this repository URL. Keep unrelated staged/unstaged files untouched.
