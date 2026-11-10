# Wallee 的 Craft Agents 个人版

**当前正式版：wallee-v1.1.0（2026-10-29）**

**本地待验收候选：wallee-v1.2.0-rc.2（2026-11-11）**，修复 iCloud、中文及文件夹链接识别，普通文件链接点击后在 Finder 中定位，文件夹直接打开。专用预览入口保留。见 [文件链接验收记录](docs/personal/FINDER-LINKS-REVIEW.md)。

本候选沿用 rc.1 的两份 Pi SDK 1.4.0 引擎与运行资源，只重建界面和主进程；未自动安装或发布。[Pi 升级验证记录](docs/personal/PI-SDK-1.4-REVIEW.md)继续保留。当前主树组件锁对应 rc.2，修复前组件锁保存在 docs/personal/baselines/wallee-v1.2.0-rc.1.json，稳定回退锁保存在 docs/personal/baselines/wallee-v1.1.0.json。

Pele 与展开批注已由用户手动安装并验收通过；正式版与验收候选代码哈希一致，无需重复安装。详见 [验收记录](docs/personal/PELE-REVIEW.md)。

- [下载与更新说明](https://github.com/xunhuang071-source/craft-agents-personal/releases/tag/wallee-v1.1.0)
- [版本日志](docs/personal/CHANGELOG.md)
- [维护手册](docs/personal/MAINTENANCE.md)
- [准确组件清单](personal-release.json)

这是个人维护版本，不跟随官方整包升级。应用仍使用原名称、身份和数据位置；软件内显示的上游版本号可能仍是 0.14.1，个人版编号以此仓库的 Release 为准。

## 你只需做三件事

1. 在对话里提出需求，确认改动方案。
2. 验收新功能和原有常用功能。
3. 需要更新时退出 Craft，将新程序拖入“应用程序”并替换。

每次交付应说明版本号、改了什么、测试结果、安装入口及回退方式。除非另行批准，不自动安装。

## 当前版本保留与新增

- 在原界面结构上定点接入 Pele，统一图表显示、输入识别与校验，修复展开后原地批注。
- 保留原 Pi 1.1 引擎、GPT-6.1 Sol 500K、oauthRelay 与此前后端改造。
- 新增原生菜单 Antigravity 接入，以及独立管理的 CLIProxy / Pi 1.1 适配器。
- 官方自动更新保持关闭。账户授权、API 密钥和历史对话仍由本机原位置保存，不进入此仓库或发布包。

## 存储与回退

Git 保存源码变更；Release 保存正式安装包。无需为每次小改复制完整源码或个人数据。需要回退时下载已知兼容的旧版程序，仅替换应用，不回灌旧对话。

本次正式收尾固定已经安装并验收的程序，不要求重装。历史上游版本的手工备份不是今后的版本管理方式。
