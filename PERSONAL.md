# Wallee 的 Craft Agents 社区版

当前正式版为 **wallee-v1.5.0（2026-11-11）**，已由用户手动安装并验收。仓库按用户决定公开分享。

- [公开首页与安装入口](README.md)
- [版本日志](docs/personal/CHANGELOG.md)
- [维护手册](docs/personal/MAINTENANCE.md)
- [组件清单](personal-release.json)
- [数据源授权与工具同步验收](docs/personal/SOURCE-SYNC-REVIEW.md)
- [阅读与手势验收](docs/personal/READING-GESTURES-REVIEW.md)
- [工作台集成与验收](docs/personal/VISUAL-REVIEW-REVIEW.md)
- [公开审查说明](docs/personal/PUBLICATION-REVIEW.md)

1.5.0 增加 MCP OAuth scopes 和数据源完整工具快照同步，关闭/重新启用原工具不重建会话，保留 Pi 1.4.0，未修改分支 fork 逻辑。1.4.1 改善 Mermaid 文档嵌入字号，并恢复图片/图表预览的捏合、平移和拖动，保留文字批注。1.4.0 将图片与 HTML 批注工作台 0.1.0 随应用提供，由应用按需托管。保留标准 Pi 1.4.0、Pele 图表、Finder 文件链接及现有工作流；本次只更新主进程、标准 Pi adapter 与 sources 指南；renderer、preload、interceptor 和工作台保持 1.4.1 原字节。

正式包与用户已安装的 wallee-v1.5.0-rc.1 候选使用相同程序字节，晋升仅更新版本记录、发布名称和清单，无需再次安装。应用内部仍可能显示上游 0.14.1，发行版编号以本仓库 Release 为准。

更新时由用户退出应用、拖入新程序并验收。普通回退只替换代码，不回灌旧对话或反馈。官方自动更新保持关闭。账号、API 密钥、历史对话及项目批注仍保存在用户本机，不进入 Git 或发布包。
