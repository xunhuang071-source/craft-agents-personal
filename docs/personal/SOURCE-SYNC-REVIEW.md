# MCP scopes 与数据源工具同步 · 2026-11-11

用户明确批准 MCP 显式 scopes 和关闭源后移除旧工具，排除分支重复 fork 修复。以正式版 wallee-v1.4.1 为基线，交付本地候选 wallee-v1.5.0-rc.1，不自动安装或发布。

## MCP scopes

McpSourceConfig 与配置校验增加可选 `scopes: string[]`。桌面直接 OAuth 与 prepare/exchange 两条路径均将非空列表以空格连接为授权 URL 的 scope 参数。未填或空列表不发送该参数，沿用服务端默认值，保留 PKCE、resource indicator 和 oauthRelay:false。

源配置示例：`mcp: { url: "https://example.com/mcp", authType: "oauth", scopes: ["app:read", "app:write"] }`。名称只是示例，应以具体服务支持的 scope 为准。已有 token 不会自动获得新权限，须针对该源重新授权。没有批量修改任何源、操作真实账号或读取真实凭据；本次验收为模拟服务与虚拟凭据，不承诺服务端一定批准所请求的权限。

## 工具快照与关闭动作

宿主每次发送会话工具与数据源工具的完整快照，包含最后一个源被关闭的情况；相同快照不重复发送，启动新子进程时重发。保留浏览器开关、call_llm 模型提示和会话工具。

子进程不再合并积累旧工具。下一次用户请求前，对于 SDK 已注册且定义未变化的工具集合，使用 Pi 1.4.0 的公开 setActiveToolsByName API 切换活动集合，保留内置工具；关闭和重新启用旧源不 dispose 会话，不触发 fork。SDK 内可能保留停用工具的注册信息，但不再向模型声明，执行入口也按最新快照阻止调用。

在宿主权限检查前、代理执行入口、异步权限检查后均核对当前快照，阻止模型生成或授权等待期间关闭源后出现的迟到调用。已经发往宿主的调用继续遵循原连接的生命周期行为，未添加新的取消逻辑。

新增工具或定义真正变化时，仍使用既有必要重建路径；等待压缩并确认会话空闲后才 dispose。分支 fork 代码与 1.4.1 源码逐字节一致；本次不修复重启分支或新增工具触发重建时原有的分支问题，也不迁移历史。

## 验证

- 120 项针对性检查通过，0 失败；4 项与 managed/跨旧 SDK 兼容相关的原测试按条件跳过，不计为通过。
- 包含 13 项真实 Pi 子进程测试，使用本地模拟模型、临时目录和虚拟凭据。
- scopes 缺省/空值/显式列表、配置字段保留、PKCE、本地回调、relay、失败不保存凭据。
- 完整宿主快照、关闭最后一个源后保留会话/内置工具、同集合去重、重启子进程重新同步。
- 关闭/重启用保持一个 Pi session ID 与上下文；分支关闭源不重新 fork，不混入父会话后续消息。
- 授权等待以及模型生成期间关闭源，旧调用不执行；生成期间关闭的旧调用不进入宿主权限逻辑。
- 主进程与 Pi adapter TypeScript 检查通过；依赖和锁文件不变，Pi SDK 继续为 1.4.0。

OAuth 桌面路径的模块 mock 测试应单独运行，避免影响同进程的其他测试。宿主测试用应用代码的 config-defaults.json 初始化临时配置目录，不使用真实配置。

## 构建与版本管理

`node scripts/personal-build-source-sync-candidate.mjs VERIFIED_1_4_1_APP NEW_OUTPUT_DIR wallee-v1.5.0-rc.1`

只重建主进程和标准 Pi adapter，替换 sources.md。renderer、preloads、interceptor、Electron、视觉批注模块及其他资源冻结，使用 source-sync 审计范围核对全文件差异。候选组件锁单独保存在输出目录；正式锁仍为 1.4.1。

用户自行安装并验收后，再决定正式晋升和公开 Release。不启动真实账号测试，不更改模型默认值，不重新引入已退役运行时。
