# 个人版维护手册

## 唯一事实源

- 公开仓库：https://github.com/xunhuang071-source/craft-agents-personal（2026-11-11 经用户批准公开；其他私有仓库不在授权范围内）
- main：主程序、维护规则、组件锁定与版本日志。
- engine：独立 Antigravity Pi 适配器；由 main/personal-release.json 锁定准确提交。
- Release：正式程序 ZIP、SHA256SUMS、release-manifest.json、文件清单与安全审查报告。
- 版本规则：wallee-v1.0.0；修复升补丁位，兼容新功能升次版本，不兼容变化单独说明。标签发布后不覆盖或移动。

## 现有本机工作区

本次主程序在 ~/.craft-agent/development/craft-antigravity-native，引擎在相邻 craft-antigravity-native-engine。二者是 ~/WorkBuddy/craft-agents-oss 的 linked worktree，不是独立克隆。不要改共享 remote 或重置旧 worktree；当前发布只通过明确的本仓库 URL 推送指定 refs。

已有源树和 dependencies 可继续使用，不必复制一份来“备份”。以后新电脑可按下节正常克隆公开仓库。

## 从公开仓库重新准备

```sh
gh repo clone xunhuang071-source/craft-agents-personal
cd craft-agents-personal
git worktree add ../craft-agents-personal-engine origin/engine
```

在两棵源码树分别使用 **Bun 1.3.9** 执行 `bun install --frozen-lockfile --ignore-scripts`，不运行依赖安装脚本、不自动下载新版本 Electron。main 的 esbuild 锁定 0.25.12。

从指定 Release 下载 `personal-release.json` 所列的冻结基础包及 SHA256SUMS；验证完整包的 SHA256 后解压。基础包保存冻结的 UI、旧 Pi、preload、外部 SDK、Electron 和运行资源，不包含用户数据。不要改用纯净官方 0.14.1 包替代这些个人资源。

## 阅读字号与手势（2026-11-11，正式版 1.4.1）

用户批准局部 renderer 例外，使用 `scripts/personal-build-reading-candidate.mjs VERIFIED_BASE_APP NEW_OUTPUT_DIR NEW_CANDIDATE_VERSION`，以已校验 1.4.0 为输入，只构建 renderer。用户已安装验收 1.4.1-rc.1 并批准正式公开发布为 1.4.1；该版本为当前冻结基线，晋升不重建程序。`personal-audit-candidate.py --scope diagram-reading` 要求其他程序资源原字节保持一致。[本次修改与测试](READING-GESTURES-REVIEW.md)

## 数据源能力（2026-11-11，正式版 1.5.0）

用户批准 scopes 和源关闭工具同步。使用 `scripts/personal-build-source-sync-candidate.mjs VERIFIED_1_4_1_APP NEW_OUTPUT_DIR VERSION`，定向构建 main 和标准 Pi，并更新 sources.md；source-sync 全文件审计禁止其余资源漂移。依赖锁不变，Pi 仍为 1.4.0。分支修复明确排除，关闭动作通过公开活动工具 API 避免会话重建。候选 1.5.0-rc.1 已由用户安装验收，随后批准按原字节晋升公开正式版 1.5.0；以该正式版作为后续冻结基线。[说明](SOURCE-SYNC-REVIEW.md)

## 最小构建

当前 wallee-v1.5.0 作为冻结基线。未来获批改动使用新的候选号和输出目录；仅修改主进程/工作台时可用下面的入口，局部界面修改则使用上一节的 reading 构建脚本：

```sh
npm --prefix extensions/visual-review ci --ignore-scripts --omit=optional
node scripts/personal-build-visual-review.mjs '/path/to/verified-wallee-v1.5.0/Craft Agents.app' "$PWD/native-artifacts/new-review-candidate" 'wallee-v1.6.0-rc.1'
```

第三个参数必须是新的候选号，示例不代表已批准 1.6.0 的功能或发布。历史版本可在对应不可变标签下复现原有构建脚本。

下列旧构建命令用于需要独立 Antigravity 引擎的历史版本。

以下脚本按组件锁定向编译，不编译 renderer、preload 或 interceptor。旧稳定版只重建主进程和独立适配器；2026-10-30 获批的 Pi SDK 1.4 候选额外从主树构建常规 Pi。两份 Pi 分别记录期望哈希；不得用冻结 bundle 替代新版本源码。命令从 main 树根目录执行：

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

脚本仅组装并 ad-hoc 签名候选，不安装、不启动、不读账户，不允许覆盖现存候选。冻结资源核对失败必须停止。首次基础包无需从源码重造官方 UI/SDK。Pi SDK 升级时通过 piSdkUpgrade.baselineLock 指定不可变输入锁，输入应用完整校验后再用当前锁校验输出；--scope pi-sdk 审计只放行 main、两份 Pi 和签名，不放行 renderer。详见 [Pi 1.4 验证记录](PI-SDK-1.4-REVIEW.md)。

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
8. 确认目标仍为本仓库、Actions 仍禁用，且用户批准该次发布，再仅推送必要分支/标签并上传代码 Release。当前仓库已获准公开；不得据此公开其他仓库或用户资料。禁止 push --all、mirror、force。
9. 用户自行退出应用、拖入覆盖、打开验收。程序回退只换代码；涉及数据格式迁移时先单独报批。
10. 远端包确认完整后清理重复安装包、临时编译与测试产物；不清理真实账户/对话、唯一源码或其他日期的历史资料。

## 内置批注工作台（2026-11-11，已正式发布为 1.4.0）

用户批准随个人版一起打包，并手动安装验收 wallee-v1.4.0-rc.1，随后批准晋升 wallee-v1.4.0 和公开分享。正式晋升不重新构建、签名或安装程序。后续开发使用本次正式基线。原候选采用 `scripts/personal-build-visual-review.mjs BASE_APP NEW_OUTPUT_DIR NEW_CANDIDATE_VERSION`，输入为已校验 wallee-v1.3.0 应用。只重建主进程并新增版本化工作台资源及指南，不运行通用 Electron 构建。先按 `extensions/visual-review/package-lock.json` 安装模块依赖，再执行构建与隔离测试；使用 `personal-audit-candidate.py --scope visual-review` 核对全文件变化。源码与方法见 [VISUAL-REVIEW-REVIEW.md](VISUAL-REVIEW-REVIEW.md)。候选不得自动覆盖正在使用的程序；安装和正式发布仍由用户决定。

## 上游与技能

官方仓库仅作为参考来源。用户没要求，不主动追版本；不自动合并或推送官方仓库。不恢复 app-update.yml。继承的自动化模板保存在 docs/upstream-workflows，不放在活动的 .github/workflows 目录；Actions 保持禁用，普通发布不要求扩大 workflow 授权。

技能 craft-fork-sync 是此文档的入口，历史 PLAYBOOK 仅供查旧方法。项目版本记录只写本仓库，不写 Notion，不将个人数据放进 Git。


## 文件链接与 Finder 定点更新（2026-11-11 已批准例外）

用户批准修复本地链接识别，并让普通文件链接点击后在 Finder 中定位；2026-11-11 手动安装 rc.2 并验证历史对话后，授权晋升正式版 wallee-v1.2.0。初次修复只重建 renderer 和 main，修复前组件锁为 `docs/personal/baselines/wallee-v1.2.0-rc.1.json`。正式晋升不再重建任何程序组件。

后续构建默认使用 `docs/personal/baselines/wallee-v1.2.0.json` 与正式 Release 基础包；需要复现历史输入时，可显式指定 `--baseline-lock docs/personal/baselines/wallee-v1.2.0-rc.1.json --base-app /path/to/verified-rc.1/Craft\ Agents.app`。两份 Pi 与其余运行组件按相应基线核对。

从主树根目录执行：

```sh
node scripts/personal-build-finder-candidate.mjs --record-lock
node scripts/personal-build-finder-candidate.mjs --out "$PWD/native-artifacts/new-finder-candidate"
```

脚本使用临时 HOME/config 和构建环境变量白名单；验证基础应用、定向构建 main 并重建两份 Pi 作原哈希核对，然后构建 renderer。候选只复制新的 main/renderer，保留基础应用其余资源，重新签名并做 `finder-links` 范围的全文件审计。不会安装、启动候选或读取用户 profile。清单绑定已提交的产品源码后再交付安装包。2026-11-11 的正式发布已获用户授权；未来版本仍按每次改动与发布的流程确认。

真实浏览器点击测试复用本机夹具服务：

```sh
# 终端一，只监听本机
/path/to/verified/bun node_modules/vite/bin/vite.js --config scripts/personal-ui-tests/vite.config.ts
# 终端二，使用生产 Markdown 组件，系统 shell 回调只记录不执行
python3 scripts/personal-ui-tests/run-finder-links.py
```

完整验收范围与安装步骤见 [FINDER-LINKS-REVIEW.md](FINDER-LINKS-REVIEW.md)。

## 图表定点更新（2026-10-29 已批准例外）

本次定点更新已由用户手动安装并验收，正式版本为 wallee-v1.1.0。原 Pi/preload/interceptor 未改变；以后继续冻结新的 renderer 基线，不自动安装或发布。

本次原始构建基线锁保存在 `docs/personal/baselines/wallee-v1.0.0.json`；正式验收基线另存 `docs/personal/baselines/wallee-v1.1.0.json`。构建脚本默认使用后者校验当前正式程序，历史重建可用 `--baseline-lock` 指定前者并提供匹配的 `--base-app`。根目录 personal-release.json 是当前版本锁；--record-lock 只记录组件，不重置版本号。

从仓库根目录操作：

```sh
# 仅在审查过 renderer/校验改动并取得批准后记录新的 main/renderer 哈希。
node scripts/personal-build-diagram-candidate.mjs --record-lock

# 完成回归并提交源码和锁后，输出到从未使用的新目录。
node scripts/personal-build-diagram-candidate.mjs --out "$PWD/native-artifacts/new-candidate"
```

脚本验证原程序、固定工具版本和引擎提交，只构建 main 与 renderer；重新构建的 managed Pi 仅作原哈希核对，不替换冻结代码。构建时明确清空生成目录中的旧 renderer chunks；新候选排除基础包旧 renderer，再复制新 renderer/main，保留其余基线文件，签名并生成全文件清单和候选清单。随后 personal-audit-candidate.py 比对全部文件，确认主可执行文件仅嵌入签名变化，并扫描应用文本资源；误报按文件哈希和匹配值摘要逐项绑定，不豁免整个 bundle 目录。不启动、不安装、不读 profile。

测试服务器只监听本机：

```sh
# Bun 路径采用已校验基础程序中的 vendor/bun/bun（1.3.9）。
/path/to/bun node_modules/vite/bin/vite.js --config scripts/personal-ui-tests/vite.config.ts
python3 scripts/personal-ui-tests/run-e2e.py
```

真实 Pi 代理回归需显式指定 `CRAFT_PI_TEST_BUNDLE` 后运行 `scripts/personal-ui-tests/mermaid-proxy.test.ts`，分别测试原 Pi 与 Antigravity；仅本地模拟端点与临时目录，不使用真实授权。

打包时要如实区分“单一活动绘图引擎”和冻结 Pi 中不可达的上游静态残留。后者清理属于额外引擎重建，不得借小改静默扩大范围。验收细节见 [PELE-REVIEW.md](PELE-REVIEW.md)。


## wallee-v1.1.0 正式晋升记录

2026-10-29 用户手动安装候选并确认满意，随后批准正式版本管理与私有 Release 发布。晋升仅更新源码记录、版本锁、标签和代码包，不重建、不重新签名、不替换正在使用的程序。正式包必须与该安装版的主程序、renderer、Pi、preload、interceptor 哈希相同。

`frozenBaseAsset` 指向当前正式包，供后续普通后端维护使用；`rendererUpdate.baselineAsset` 保留原 1.0.0 构建来源。两个历史基线锁均保留，不覆盖旧版标签和资产。发行包只包含代码、校验清单和已脱离真实 profile 的验证摘要。

## wallee-v1.2.0 正式晋升记录

2026-11-11 用户手动安装 rc.2，并确认历史对话中的产出物链接能够弹出 Finder，随后批准同步私有 GitHub 仓库和正式版本管理。

晋升保持已安装程序与候选 ZIP 的全部字节不变，只更新版本锁、验收记录、发布资产名和不可变标签。主程序源码在 main，引擎固定为 8c433bd85c3a2438042d413b830c347be85cc854 并同步 engine。前述 Pi 1.4 本地升级随本次正式包一起归档，其原有测试限制保留。

`frozenBaseAsset` 指向 wallee-v1.2.0 正式包，`docs/personal/baselines/wallee-v1.2.0.json` 为新稳定锁；rc.1、rc.2 与 1.1.0 锁均保留。安装包与 SHA256SUMS、版本/源码清单、完整应用文件清单和安全验证摘要一并存入私有 Release。仓库保持 private，Actions 关闭，不覆盖旧版本，不重新安装用户当前程序。
