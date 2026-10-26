# Wallee personal engine

- This worktree is the separately pinned managed Antigravity Pi adapter, based on Craft v0.15.1 / Pi SDK 1.1.0.
- The personal distribution lives at https://github.com/xunhuang071-source/craft-agents-personal (private). Its main branch owns release policy; the engine branch owns this source.
- Do not merge an upstream release wholesale or rebuild the frozen UI. Ask for a plan approval before changing behavior.
- Never read Google credential JSON, import another application's account, or log keys, tokens or raw upstream error bodies. Automated tests use local fixtures only.
- Build from the repository root. Changing cwd changes generated path comments and hashes.
- User data and the installed application are not development artifacts; never reset, overwrite or back up the user's complete profile as part of a normal code release.
- Keep source changes, dependency lockfile and tests together. Pin this commit in the main branch release record.
- This local worktree shares Git configuration with other WorkBuddy worktrees. Do not change shared remotes, reset unrelated worktrees, push --all or force-push. Use an explicit approved private repository URL.
- Include `Co-Authored-By: Craft Agent <agents-noreply@craft.do>` on agent-created commits.
