# 个人版维护手册

## 唯一事实源

- 私有仓库：https://github.com/xunhuang071-source/craft-agents-personal
- main：主程序、维护规则、组件锁定与版本日志。
- engine：独立 Antigravity Pi 适配器；由 main/personal-release.json 锁定准确提交。
- Release：正式程序 ZIP、SHA256SUMS、release-manifest.json、文件清单与安全审查报告。
- 版本规则：wallee-v1.0.0；修复升补丁位，兼容新功能升次版本，不兼容变化单独说明。标签发布后不覆盖或移动。

## 现有本机工作区

本次主程序在 ~/.craft-agent/development/craft-antigravity-native，引擎在相邻 craft-antigravity-native-engine。二者是 ~/WorkBuddy/craft-agents-oss 的 linked worktree，不是独立克隆。不要改共享 remote 或重置旧 worktree；当前发布只通过明确的私有仓库 URL 推送指定 refs。

已有源树和 dependencies 可继续使用，不必复制一份来“备份”。以后新电脑可按下节正常克隆私人仓库。

## 从私有仓库重新准备

```sh
gh repo clone xunhuang071-source/craft-agents-personal
cd craft-agents-personal
git worktree add ../craft-agents-personal-engine origin/engine
```

在两棵源码树分别使用 **Bun 1.3.9** 执行 `bun install --frozen-lockfile --ignore-scripts`，不运行依赖安装脚本、不自动下载新版本 Electron。main 的 esbuild 锁定 0.25.12。

从指定 Release 下载 `personal-release.json` 所列的冻结基础包及 SHA256SUMS；验证完整包的 SHA256 后解压。基础包保存冻结的 UI、旧 Pi、preload、外部 SDK、Electron 和运行资源，不包含用户数据。不要改用纯净官方 0.14.1 包替代这些个人资源。

## 最小构建

以下脚本只编译主进程和新适配器，不编译 renderer、preload 或原 Pi。命令从 main 树根目录执行：

```sh
node scripts/personal-build.mjs \
  --engine-root ../craft-agents-personal-engine \
  --bun /path/to/verified-base/Craft\ Agents.app/Contents/Resources/app/vendor/bun/bun \
  --verify-current
```

输出到忽略的 `.personal-build/`。初始 wallee-v1.0.0 已验证两份输出与当前安装文件字节一致。整个 app 的重签名与压缩元数据不保证逐字节重现；代码与冻结资源必须对应。

如需生成新的完整候选，先更新版本/引擎锁定/期望输出，再使用：

```sh
CRAFT_BASELINE_APP='/path/to/verified-base/Craft Agents.app' \
CRAFT_PERSONAL_ENGINE='../craft-agents-personal-engine' \
CRAFT_RELEASE_OUT="$PWD/native-artifacts/candidate" \
bash scripts/build-native-antigravity-release.sh
```

脚本仅组装并 ad-hoc 签名候选，不安装、不启动、不读账户，不允许覆盖现存候选。冻结资源核对失败必须停止。首次基础包无需从源码重造官方 UI/SDK。

禁止使用通用 `electron:build` / `electron:dist`，它们会重建冻结组件。旧 `.env` 或用户 token 不是当前个人版的构建输入；已验证构建期 OAuth defines 为空。用户授权仅在运行时本机保存。

## 安装包归档

使用 `bash scripts/personal-package.sh '/path/to/Craft Agents.app' '/path/to/new-release.zip'`。脚本只打包已校验的程序，保留代码、执行权限和符号链接，不保存 Finder/资源叉等扩展元数据。正式发布前，在本机非 iCloud 的开发临时目录解压，再用 personal-app-inventory.py 验证签名与全文件清单一致。不要因解压到同步盘产生元数据问题而改动正在使用的应用。

## 每次改动与发布

1. 读取 AGENTS.md、组件锁定和日志；先给用户改动计划。
2. 获批准后在功能分支修改源码与测试；不要只改已安装的 main.cjs。
3. 用临时 profile 运行相关测试；需要外部账户的测试另行批准。本地 mock 子进程测试可自动运行。
4. 如改引擎，先提交其源码，再在 main 锁定新的 engineCommit。正常未改引擎时沿用原提交。
5. 编译到开发目录，记录期望输出；组装候选，核对冻结资源与签名。
6. 提交 main，创建新不可变标签，发布清单固定 main/engine 提交、工具版本、安装包与文件哈希。使用 GitHub 隐私邮箱和 Craft Agent co-author。
7. 本地扫描暂存源码和最终 app。误报须逐项说明并绑定文件哈希；不得用整个 tests/bundles 路径豁免真实密钥检查。
8. 确认仓库仍为 private、Actions 仍禁用，且用户批准该次发布，再仅推送必要分支/标签，上传私有 Release。禁止 push --all、mirror、force。
9. 用户自行退出应用、拖入覆盖、打开验收。程序回退只换代码；涉及数据格式迁移时先单独报批。
10. 远端包确认完整后清理重复安装包、临时编译与测试产物；不清理真实账户/对话、唯一源码或其他日期的历史资料。

## 上游与技能

官方仓库仅作为参考来源。用户没要求，不主动追版本；不自动合并或推送官方仓库。不恢复 app-update.yml。继承的自动化模板保存在 docs/upstream-workflows，不放在活动的 .github/workflows 目录；Actions 保持禁用，普通发布不要求扩大 workflow 授权。

技能 craft-fork-sync 是此文档的入口，历史 PLAYBOOK 仅供查旧方法。项目版本记录只写本仓库，不写 Notion，不将个人数据放进 Git。


## 图表定点更新（2026-10-29 已批准例外）

本地候选 wallee-v1.1.0-rc.1 可以更新 renderer 与 host Mermaid 校验，但不得改动冻结 Pi/preload/interceptor。正式安装版仍为 wallee-v1.0.0，不自动安装或发布。

基线锁保存在 `docs/personal/baselines/wallee-v1.0.0.json`，必须用它核对原基础程序，不能用新 renderer 哈希验证旧基础包。新组件锁仍是根目录的 personal-release.json。

从仓库根目录操作：

```sh
# 仅在审查过 renderer/校验改动并取得批准后记录新的 main/renderer 哈希。
node scripts/personal-build-diagram-candidate.mjs --record-lock

# 完成回归并提交源码和锁后，输出到从未使用的新目录。
node scripts/personal-build-diagram-candidate.mjs --out "$PWD/native-artifacts/pele-rc1"
```

脚本验证原程序、固定工具版本和引擎提交，只构建 main 与 renderer；重新构建的 managed Pi 仅作原哈希核对，不替换冻结代码。新目录排除旧 renderer chunks，再复制新 renderer/main，保留其余基线文件，签名并生成全文件清单和候选清单。不启动、不安装、不读 profile。

测试服务器只监听本机：

```sh
# Bun 路径采用已校验基础程序中的 vendor/bun/bun（1.3.9）。
/path/to/bun node_modules/vite/bin/vite.js --config scripts/personal-ui-tests/vite.config.ts
python3 scripts/personal-ui-tests/run-e2e.py
```

真实 Pi 代理回归需显式指定 `CRAFT_PI_TEST_BUNDLE` 后运行 `scripts/personal-ui-tests/mermaid-proxy.test.ts`，分别测试原 Pi 与 Antigravity；仅本地模拟端点与临时目录，不使用真实授权。

打包时要如实区分“单一活动绘图引擎”和冻结 Pi 中不可达的上游静态残留。后者清理属于额外引擎重建，不得借小改静默扩大范围。验收细节见 [PELE-REVIEW.md](PELE-REVIEW.md)。
