# Wallee 的 Craft Agents 社区版

当前正式版为 **wallee-v1.5.1（2026-11-17）**，已由用户手动安装并验收。仓库按用户决定公开分享。

- [公开首页与安装入口](README.md)
- [版本日志](docs/personal/CHANGELOG.md)
- [维护手册](docs/personal/MAINTENANCE.md)
- [组件清单](personal-release.json)
- [数据源授权与工具同步验收](docs/personal/SOURCE-SYNC-REVIEW.md)
- [阅读与手势验收](docs/personal/READING-GESTURES-REVIEW.md)
- [工作台集成与验收](docs/personal/VISUAL-REVIEW-REVIEW.md)
- [公开审查说明](docs/personal/PUBLICATION-REVIEW.md)

1.5.1 定点吸收上游 v0.15.10 的项目规则扫描与 OpenAI 工具 schema 修复。仅重建主进程和 interceptor，标准 Pi 1.4.0、renderer、两个 preload、数据源指南和批注工作台保持 1.5.0 原字节。保留 OAuth scopes、完整工具快照、Pele 图表、预览手势和 Finder 文件链接。

正式包与用户已安装的 wallee-v1.5.1-rc.1 候选使用相同程序和 ZIP 字节。晋升仅更新版本记录、发布名称和清单，无需再次安装。应用内部仍可能显示上游 0.14.1，发行版编号以本仓库 Release 为准。

更新时由用户退出应用、拖入新程序并验收。普通回退只替换代码，不回灌旧对话或反馈。官方自动更新保持关闭。账号、API 密钥、历史对话及项目批注仍保存在用户本机，不进入 Git 或发布包。


2026-11-17 用户已安装候选并批准正式版本管理及公开发布为 wallee-v1.5.1。[本次改造与验证](docs/personal/CONTEXT-OPENAI-REVIEW.md)
