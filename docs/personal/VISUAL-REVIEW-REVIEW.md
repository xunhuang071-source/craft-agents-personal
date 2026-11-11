# wallee-v1.4.0-rc.1 · 内置批注工作台

2026-11-11 用户批准做到“随自有 Craft 一起打包”，本次为本地候选，不自动安装或发布。

## 范围

- 基于已验收的 wallee-v1.3.0；主进程增加应用托管入口，工作台按需运行于 Electron utilityProcess，退出时回收。
- 内置工作台模块 0.1.0，源码 `extensions/visual-review/`，独立 package-lock.json 固定 Fabric 6.9.1 与 pngjs 7.0.0。主程序 bun.lock 不变。
- 构建为无外部 npm 运行依赖的 server.cjs、open-review.cjs 及浏览器资源。模块清单记录文件 SHA-256 和反馈 schemaVersion 2。
- 应用启动仅创建本机受认证入口。Agent 使用应用自带 Bun 运行 open-review.cjs，获得每个文件的批注链接。重复文件复用进程，文件版本变化后重新打开。
- renderer、preloads、标准 Pi、interceptor、应用身份与现有配置保持基线一致。没有增加原生按钮或自动发送消息功能。
- 用户图像、HTML、反馈、草稿保存在指定项目目录；临时发现文件位于 CONFIG_DIR/visual-review/runtime.json，权限 0600，退出时仅移除本实例的发现文件。代码包不含真实账号或对话。

## 构建

在仓库根目录执行：

```sh
npm --prefix extensions/visual-review ci --ignore-scripts --omit=optional
node extensions/visual-review/build.mjs
node --test extensions/visual-review/tests/host.test.mjs
node scripts/personal-build-visual-review.mjs '/path/to/verified-v1.3.0/Craft Agents.app' '/path/to/fresh-candidate-dir'
node scripts/personal-visual-review-smoke.mjs '/path/to/candidate/Craft Agents.app'
```

依赖仅在开发/打包时安装。候选应用使用已有 Electron utilityProcess 和自带 Bun，不需要用户安装 Node、npm 或工作区临时脚本。

## 验收与发布

- 宿主回归覆盖发现文件权限、认证、浏览器来源拒绝、并发复用、内置资源、命令入口、源文件变更、非法路径与进程回收。
- Electron TypeScript 检查；定向构建、签名与完整应用清单；visual-review 范围审计只允许主进程和新增资源变化。
- 隔离 Electron 夹具使用候选自带运行时及真实 utilityProcess，测试内置 Bun 命令、资源可访问和退出清理；不使用真实账号或 profile。
- 用户安装验收与私有 Release 发布另行决定。当前正式版本锁仍为 wallee-v1.3.0，本次 candidate-manifest 与 component-lock 保存于候选目录。
- 更新时用户退出 Craft，拖入候选应用覆盖。回退只替换应用代码，不覆盖现有对话或反馈目录。
