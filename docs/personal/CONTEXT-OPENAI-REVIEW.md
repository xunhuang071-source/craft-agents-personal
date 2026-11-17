# wallee-v1.5.1 候选　规则扫描与 OpenAI 工具约束

事项日期 2026-11-17。用户批准两项上游修复的定点移植及本地候选构建。当前正式版仍为 wallee-v1.5.0，候选为 wallee-v1.5.1-rc.1。安装、正式晋升及发布待用户后续决定。

## 来源和改造

基于个人版主树 `f2dbe262`，使用修复分支 `fix/context-scan-openai-schema-20261117`。上游来源为 [v0.15.10 最终提交 4932ebb68db8](https://github.com/craft-ai-agents/craft-agents-oss/commit/4932ebb68db8)。原始 PR [1141](https://github.com/craft-ai-agents/craft-agents-oss/pull/1141) 和 [1135](https://github.com/craft-ai-agents/craft-agents-oss/pull/1135) 未直接合并，不以原始 PR 作为最终版本替代。

规则发现保留个人版的提示词清洗，采用最终上游的广度优先扫描。Git 目录只检查祖先链和所选子树。非 Git 目录同样受限制。默认下探六层、最多读取 4,000 个目录，目录读取之间检查 150 毫秒预算。保留大小写匹配、最多 30 个文件和五分钟缓存，移除无关规则兜底。

时间预算无法中断一次已经阻塞的同步磁盘读取。深层、隐藏及超出预算的规则可能不再自动列出。中文历史归档目录不属于自动排除名单。Pi 的工作区 AGENTS 注入和 noContextFiles 保持原行为。

OpenAI Chat Completions 和 Responses 适配器保留调用方原有 additionalProperties 值，不再删除 false。工具元数据已声明在 properties 和 required 中。仅导出两个适配器作为测试接缝，Anthropic 适配器保持原行为。

## 最小构建

本次批准对 interceptor 的限定解冻。仅重建 main.cjs 与 interceptor.cjs，候选签名按现有方法重新生成。标准 Pi bundle、SDK 1.4.0、依赖锁、renderer、两个 preload、sources.md 和内置批注工作台保留正式版原字节。

不可变输入锁为 `docs/personal/baselines/wallee-v1.5.0.json`。从仓库根目录运行以下命令，输入应用必须通过锁和签名校验，输出目录必须尚不存在。

```sh
node scripts/personal-build-context-openai-candidate.mjs \
  '/path/to/verified-wallee-v1.5.0/Craft Agents.app' \
  "$PWD/native-artifacts/context-openai-v1.5.1-rc.1" \
  'wallee-v1.5.1-rc.1'
```

固定 Bun 1.3.9 与 esbuild 0.25.12。临时 HOME/config 和环境变量白名单隔离构建。旧 interceptor 从仓库根构建，SHA256 完全复现正式版的 `35af764281e6f3afb191ef03ae80e30e07f6644ff920ae289b2608a91bfe95ae`。从 apps/electron 构建会改变路径注释，因此定向脚本必须从仓库根调用。

新增 `context-openai` 全文件审计 scope，仅放行 main、interceptor、必要签名和原可执行文件的签名区变化。主可执行代码保持一致。不得使用通用 Electron 全量构建。

## 自动验证

所有测试使用临时目录和合成资料。外部服务验证限定为本机模拟端点，没有使用真实 OpenAI、Claude 或 OAuth 账号。

- 修改前，三项 Git 规则回归失败，复现当前目录规则被挤掉、无关规则兜底和扫描范围错误。
- 修改前，schema 矩阵中 12 项失败。修改后，52 项 schema 测试全部通过，覆盖两个 API、Rich tool descriptions 开关、内置与 MCP 工具、严格与非严格工具、false/true/缺省值和重复注入。
- 23 个相关测试文件共 271 项通过，无失败和跳过。覆盖扫描、系统提示词清洗、SSE、Responses 历史修复、工具元数据、OAuth scopes、授权失败凭证保留、工具快照同步和个人版 AGENTS 加载。
- 合成目录含 4,500 个子目录。指定上限 50 时只读 50 个目录；默认上限读取 4,000 个后停止，均保留根 AGENTS。单次本机记录默认约 57 毫秒，仅作为观测，不作为跨机器时延承诺。
- server-core 与 Electron 类型检查通过。Pi 标准 `bun run typecheck` 通过。新增集成测试与网络隔离夹具显式类型检查通过。
- shared 标准类型检查仍有三处既有诊断。用未修改 `f2dbe262` 的隔离源码快照重跑，输出逐字相同。涉及旧 Claude 测试导出、既有 fetch mock 的 preconnect 类型及缺失 url-validator 模块。此次未新增诊断，也不将其表述为全绿。

实际编译的 interceptor 配合保留的标准 Pi bundle，通过 Chat Completions 和 Responses 两条本机模拟链路，验证闭合 MCP schema、工具元数据注入与清除、工具执行结果回传。旧拦截器对两条链路均失败。独立编译产物用例额外验证 strict true 的内置 read schema。自定义兼容端点由 SDK 推断 strict 支持，集成测试不强迫 SDK 开启其未声明支持的严格模式。

复现实机产物测试时，使用已验证 Bun 运行下列命令，环境必须来自临时 HOME/config 和启动变量白名单。

```sh
CRAFT_PI_TEST_BUNDLE='/path/to/verified/Craft Agents.app/Contents/Resources/app/resources/pi-agent-server/index.js' \
CRAFT_INTERCEPTOR_TEST_BUNDLE='/path/to/candidate/Craft Agents.app/Contents/Resources/app/dist/interceptor.cjs' \
/path/to/verified/bun test packages/pi-agent-server/src/openai-interceptor.integration.test.ts
```

测试子进程先预加载单一本机源网络约束，再加载真实 interceptor，阻断 Node HTTP/socket 通道和跳转。未设置上述产物路径时，集成测试跳过，跳过不能视为通过。

## 手动验收与回退

用户自行退出当前应用、将候选拖入 Applications 并打开。建议检查原有会话能继续回复，工作目录的根 AGENTS 仍生效，OpenAI API 新会话能调用读取工具，工具卡片仍显示名称和意图，数据源开关仍按完整快照同步。

如需回退，只恢复 wallee-v1.5.0 程序代码，不回灌旧 profile 或历史对话。本次没有数据格式迁移。候选不会自行安装或发布。

候选的最终哈希、全文件差异、签名、ZIP 解压复验和测试统计记录在同目录版本清单及 native-artifacts 的候选审计附件中。


## 候选最终结果

- 产品源码提交为 `6952a80044a8ce39d2b7eafe6c2635a7def1dfdd`，构建时工作树干净。
- 共 287 项测试通过、0 失败、4 跳过。跳过为两个已退役 managed 专用 429 场景及两个未提供旧版 bundle 的历史双向兼容场景，不计入通过。
- 候选 1,741 个文件和 14 个符号链接通过组件锁、签名和 ZIP 解压复验，解压清单与打包前完全一致。
- 仅 main、interceptor、CodeResources 与可执行文件签名区发生变化，没有新增或删除应用文件。可执行代码在签名区之前保持一致。
- 文本与代码扫描覆盖 1,443 个文件，无未审查发现。唯一匹配为既有 renderer source map 中文档 URL，沿用绑定文件哈希和值摘要的单项误报记录。
- ZIP 大小为 193,237,553 字节，SHA256 为 `dcb686fce8091bf3d2038f27232d686b06ef4b3438697ad8053f38acef3aac49`。
- main SHA256 为 `b98a6cd9e21342e47b3e71e978e74af2ff53ad33ce8fc172929cca8514cacc88`。
- 标准 Pi SHA256 保持 `a24f85daf9df5dcb6bc39024d8093c42891b050552958f8194f93c66d76ec698`。
- 候选锁保存为 `docs/personal/baselines/wallee-v1.5.1-rc.1.json`，根 personal-release.json 继续指向已验收正式版 1.5.0。
- 未安装、未启动候选、未推送或发布，没有修改真实 profile。
