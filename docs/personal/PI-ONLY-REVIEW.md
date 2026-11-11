# wallee-v1.3.0-rc.1 单 Pi 候选

候选基于 wallee-v1.2.0。所有模型会话由标准 Pi 执行。Claude 模型继续使用 Anthropic Messages 或供应商提供的兼容协议。旧 Claude 执行器和原生二进制、原独立 Antigravity Pi 及专用管理入口已移除。反重力接入由 Mag派负责。

Sources、MCP 工具池、API 数据源和授权继续使用现有主机和 Pi 工具代理。API 数据源改用标准 MCP 服务接口。旧内置 Antigravity 连接标记在读取时过滤，保留原文件和凭据。若原默认连接是已退役条目，运行时使用首个可用连接。旧 Claude 会话无需迁移。

## 构建与回退

```sh
node scripts/personal-build-pi-only.mjs '/Applications/Craft Agents.app' "$PWD/native-artifacts/pi-only-final"
```

脚本校验 wallee-v1.2.0 基线、重建主进程并签名候选。标准 Pi 1.4.0、renderer、两个 preload、网络拦截器、Bun、Electron 与基线文件哈希一致。候选目录包含组件锁和全文件清单。需要回退时使用正式版 wallee-v1.2.0 程序。

## 验证

- Electron 和 server-core 类型检查通过。Bun 1.3.9 冻结锁文件校验通过。
- 数据源、MCP、浏览器、后端及标准 Pi 会话回归共 372 通过、5 跳过、0 失败。跳过项为 2 项旧独立引擎限流策略、2 项需 Pi 1.1 测试包的跨版本历史用例、1 项需要完整开发分发目录的用例。标准 Pi 集成测试使用候选中的实际 bundle 和本地模拟 Anthropic Messages 接口。
- 任务、自动化、会话锚点及流式重试相关测试共 366 通过、0 失败。
- 候选通过代码签名、资源清单与依赖图审计。无界面启动和本地工作区 RPC 查询通过。测试使用独立数据目录和仅回环网络。早期测试的临时目录限制阻断了 Chromium 创建单实例套接字，调整测试沙箱后通过。
- 文件清单差异为移除 21 个文件，主进程和 2 个签名相关文件变化。磁盘占用从约 754 MiB 降到 525 MiB。
- 桌面界面交互、真实供应商和真实数据源账户需人工验收。通用 Windows、Linux 和服务端打包脚本已清理旧 SDK 引用，当前验证产物为 macOS arm64。
