# Pi SDK 1.4.0 升级候选验收记录

候选：**wallee-v1.2.0-rc.1**  
稳定回退基线：**wallee-v1.1.0**  
日期：2026-10-30  
状态：本地代码、自动测试与候选审计完成；未安装、未发布，用户手动验收待完成。

## 范围

- 常规 Pi、Antigravity 独立 Pi 与主进程 Pi 依赖统一为 exact 1.4.0。
- 对齐 manifest、bun.lock、实际依赖树和运行 bundle；固定引擎提交 8c433bd85c3a2438042d413b830c347be85cc854。
- 定向补齐 Azure provider ID 映射、agentDir/projectTrusted 隔离、错误工具结果标记、utility 模型常量及自定义模型思考/输出额度字段。
- Sol 500K 保持本地描述符权威，即使新 SDK 目录已有同名条目，也不覆盖个人版元数据。
- 保留常规 Pi 的工作区 AGENTS 注入；不向此前无此注入的独立引擎扩散新行为。
- 不启用 Pi codemode、自带 MCP、遥测或官方自动升级。CLIProxy、Electron、外部 Claude/Copilot SDK 不变；Pi 内部所需的 OpenAI/Anthropic 客户端作为其依赖子树更新，不替换独立外部 SDK。

## 基线追溯

升级前主程序 5968bfa0 的依赖仍为 Pi 0.87.1；但正式资源内的常规 Pi 已是 1.1.0，独立引擎 cc919345 同为 1.1.0。

- 修改前 personal-build.mjs --verify-current 成功；main 与 managed Pi 均与稳定版组件锁逐字节一致。
- 原常规 Pi 的 SDK 适配来自已保留的 v0.15.1 / 2e3ba53f 组件。其 agentDir、provider ID、设置与工具结果实现可在旧 bundle 中对应。
- 2026-10-25 的常规 Pi 上下文隔离修改此前留在 bundle 补丁：限定读取 Craft workspaceRootPath/AGENTS.md，关闭 Pi 祖先上下文扫描，并在 user/custom 开始事件中保留该内容。本次将这一行为正式落回源码与测试。
- 旧常规 bundle 哈希继续保存在不可变 wallee-v1.1.0 基线锁；不宣称通过当前旧主树单独重建出了旧常规 bundle。新候选的三项组件均从当前源码定向构建并二次核对哈希。
- 修改前相关 120 项测试中 118 通过、2 项 settings 断言失败，属于旧源码/依赖差异；升级后的最终相关测试全部通过。

## 验证结果

测试使用 Bun 1.3.9、临时 HOME/config、环境变量白名单及合成数据。真实 bundle 在源码树外启动。最终候选协议与认证/Pele 测试额外使用 macOS sandbox-exec 阻断非回环网络。

| 项目 | 结果 |
|---|---|
| 主程序常规 Pi 源码回归 | 171 通过，0 失败；22 文件，559 断言；不计另行执行的 bundle/协议测试 |
| 宿主 Pi、权限、模型、上下文回归 | 144 通过，0 失败；16 文件，429 断言 |
| oauthRelay、MCP resources/prompts、Antigravity 宿主 | 59 通过，0 失败；6 文件，642 断言 |
| 常规 Pi 候选内真实协议 | 8 通过，0 失败；另 5 项是 managed 专用或另一策略用例，显式按模式过滤，不算通过 |
| 独立 Pi 候选内真实协议 | 13 通过，0 失败，0 跳过；123 断言 |
| 两个候选内 bundle 的 OAuth/Bedrock/Pele | 每条路径 3 通过、0 失败，合计 6；使用候选实际文件，不依赖重建代替 |
| 独立引擎源码完整回归 | 191 通过、0 跳过、0 失败；包含其 13 项协议、2 项认证 smoke、6 项生命周期；不得再与这些子项相加当独立用例 |
| 独立引擎 shared Pi 定向回归 | 128 通过、0 跳过、0 失败；旧 1.1 基线同为 128 通过 |
| 标准 TypeScript | 主树 pi-agent-server、shared、server-core、Electron 均通过；独立树三个标准组件均通过 |
| 宿主打包目录 smoke | Node 22.23.1 下，esbuild 单文件脱离源码目录与 node_modules、禁止联网运行通过；4 类 provider 目录和 Sol 500K 有效 |
| 冻结安装 | 两树 frozen-lockfile + ignore-scripts 安装通过；Pi 家族 7 个包全部解析为 1.4.0 |
| 确定性构建 | main、常规 Pi、managed Pi 二次构建代码哈希一致 |
| 候选全文件审计 | 5 个文件变化、0 新增、0 删除、0 未授权差异；可执行文件签名前指令字节一致 |
| 候选隐私扫描 | 扫描 1440 个代码/文本资源，0 未审查高置信匹配；保留原先按文件哈希绑定的文档 URL 误报说明 |
| ZIP 与解压复验 | ZIP 完整性通过；本地 APFS 解压后 1752 文件、14 符号链接、签名及完整清单均与打包前一致；包体 296189821 字节 |

### 协议与历史覆盖

- 流式文件读写、MCP 代理、图片 payload、取消和会话退出。
- Antigravity 主会话及临时查询 429 单次请求，不自动重放。
- normal/managed 畸形工具 JSON 和 max_tokens 截断工具调用不执行副作用；空白 bash 输出可继续下一次请求。
- 1.1 → 1.4 → 1.1 普通历史往返，实际请求保留所有合成消息标记。
- 使用 SDK 持久化 API 构造压缩检查点、branch summary 与侧分支，再交给两个实际版本 bundle 读取和续写。验证 summary 进入请求、废弃分支不进入请求、parentId/fromId 链接有效、四个检查点原字段保持。
- before_agent_start 启动即 busy、启动期 steer 批量交付、启动期取消、idle custom prompt、agent_end 后 agent_settled 一次。
- 实际 Mermaid 工具请求精确一次到宿主；宿主真实 Pele 校验 mindmap 成功。

## 失败与修复记录

不将失败、跳过或过滤项算作通过。

1. 首次主树安装受原 HOME/npm 配置影响，在依赖解析阶段超时；改用临时 HOME、公共 registry、ignore-scripts 后正常完成。未修改用户 npm 配置。
2. 临时 profile 初次缺少仓库 config-defaults，导致 5 项权限测试失败；复制仓库默认配置后，144 项全部通过。未使用真实配置。
3. 首次个人功能测试对全部 Node 网络硬阻断，误伤 fixture 自己的本机 HTTP，14 项失败；改用 OS 仅回环沙箱后 59 项全部通过。
4. 首次主树 Bedrock smoke 复用夹具时漏复制 block-network 对 Node 网络守卫的导入，合成 smoke 请求到达 Bedrock 并被假密钥拒绝。只发送合成测试文本与假凭据；没有读取或发送真实账户、用户配置或历史。该次不算离线验证。随后补齐 HTTP/HTTPS/TCP/fetch 守卫，先运行守卫自检，再重跑认证 smoke；最终候选测试同时启用 OS 网络沙箱并全部通过。
5. 独立树将历史上排除的全部测试纳入额外 TypeScript 检查时仍有 17 项类型债。已用 cc919345 与独立 exact Pi 1.1 依赖复现，标准化路径后日志逐字一致；本次新增/改动测试显式类型检查通过。标准生产组件 typecheck 为 0 错误，不将额外全测试类型债表述为已解决。

## 组件哈希

| 组件 | SHA256 |
|---|---|
| main.cjs | 14f05d7fc77f3d943fdbcba18ecf4521f9bbdf654f823b6bc742ce387d4d786e |
| 常规 Pi | 90bff5453e4c18bacf84d63b5d489aa054b53d218af18c6257562c77174d54cb |
| Antigravity Pi | 09578725ccaabb332e2c812cd5367fcc3557d50b51c2adeb09b456edd053d920 |

冻结 renderer、preload、interceptor、Info.plist、Bun、Electron 及其余资源的准确值以 personal-release.json 和候选全文件清单为准。仅主程序、两个 Pi 和签名文件发生变化。

候选 ZIP：Craft-Agents-wallee-v1.2.0-rc.1-mac-arm64.zip；SHA256 为 63e6af12dcd6682a165b3dc7245612dfd7a36057d69e2a61cd07dcd8d189d034。安装包不含用户 profile。

## 可复验入口

从主树根目录执行：

```sh
node scripts/test-pi-sdk-upgrade.mjs
node scripts/personal-build.mjs \
  --bun '/Applications/Craft Agents.app/Contents/Resources/app/vendor/bun/bun' \
  --verify-current
```

真实 bundle 使用 packages/pi-agent-server/src/managed-transport.integration.test.ts：指定 CRAFT_PI_TEST_BUNDLE、CRAFT_PI_TEST_LEGACY_BUNDLE；常规链指定 CRAFT_PI_TEST_MANAGED=0，按 normal/通用/历史用例过滤。两链都运行 scripts/personal-ui-tests/mermaid-proxy.test.ts 与 bundle-smoke.test.ts，后者可直接指定候选文件，避免以临时重建替代实际包。

候选构建仍使用 scripts/build-native-antigravity-release.sh，但输入通过旧基线锁、输出通过新组件锁；自动执行 --scope pi-sdk 全文件审计。不可调用通用 Electron/UI 构建。

## 限制与待验收

- 未完成真实账户登录、真实模型服务请求验证、真实长会话摘要生成或全量产品回归；不把合成压缩检查点测试表述为摘要模型服务已验证。
- 未自动安装、关闭或重启 Craft；当前应用与 profile 保持不变。
- renderer 完全未变，本轮不重跑其全部图形交互测试；两个实际 Pi→宿主 Pele 路径已回归。用户仍需检查实际会话和图表批注。
- 用户安装后重点验收：当前常用模型与 Sol 500K、旧会话续写、分支、文件与图片工具、停止、长会话压缩、Antigravity、Mermaid 与展开批注。
- 自动兼容测试通过后，程序回退只换回 wallee-v1.1.0，不回灌旧配置或旧对话。本次不迁移真实数据。
- 正式发布和标签仍待用户另行批准；候选不等于正式版。
