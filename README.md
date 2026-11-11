# Craft Agents · Wallee 社区版

基于 [Craft Agents](https://github.com/craft-ai-agents/craft-agents-oss) 的独立社区发行版。保留多会话 Agent 工作流，提供图片和 HTML 的本地批注工作台，并选择性维护模型接入、文件链接和图表体验。

本项目与 Craft Docs Ltd. 无隶属或官方背书关系。应用的名称、身份与数据路径沿用既有兼容约定，个人版版本号以本仓库 Release 为准；应用内部可能仍显示上游的 `0.14.1`。

## 下载与安装

**当前正式版：[wallee-v1.5.0](https://github.com/xunhuang071-source/craft-agents-personal/releases/tag/wallee-v1.5.0)**

- [下载 macOS Apple Silicon 安装 ZIP](https://github.com/xunhuang071-source/craft-agents-personal/releases/download/wallee-v1.5.0/Craft-Agents-wallee-v1.5.0-mac-arm64.zip)
- [SHA256 校验文件](https://github.com/xunhuang071-source/craft-agents-personal/releases/download/wallee-v1.5.0/SHA256SUMS)
- [版本日志](docs/personal/CHANGELOG.md)

当前提供 macOS Apple Silicon 构建。退出旧版应用后，解压 ZIP，将 `Craft Agents.app` 拖入“应用程序”替换。程序采用本地 ad-hoc 签名，未进行 Apple 公证；请先核对下载校验值，并按 macOS 的安全提示处理首次打开。

首次使用需配置自己的模型连接、订阅或 API 凭据。发行包不包含维护者的账户、密钥、对话、图片、工作区或技能集合。

## 主要功能

### 数据源授权与工具同步

MCP OAuth 可通过源配置中的可选 `mcp.scopes` 请求服务支持的授权范围；未填写时保留默认行为，新增范围需对该源重新授权。关闭源后，下一次请求前更新活动工具列表，保留内置和会话工具；重新启用原工具不重建会话。生成或权限等待期间关闭源后的过期调用会被阻断。Pi 依赖仍为 1.4.0，分支重复 fork 修复不在本版范围内。详见 [实现与验收](docs/personal/SOURCE-SYNC-REVIEW.md)。

### 图表阅读与预览手势

Mermaid 嵌入图默认以约 14px 标签等比显示，与正文协调；宽图保留横向滚动，展开预览使用原尺寸。图片与图表预览支持双指捏合缩放、双指滚动平移和鼠标拖动。图表文字仍可拖选，Alt/中键可在文字上拖动画布。

### 图片与 HTML 批注

内置工作台 **0.1.0**，由应用按需启动，退出时回收。

- 图片：涂抹、擦除、矩形、点位、撤销重做、显示/隐藏选区。
- HTML：精确拖选字符范围；对图片等图形做涂抹、框选或点位批注。
- 草稿在本机保存，可重新打开继续编辑。
- 每条意见关联原文件 SHA-256、字符范围或原尺寸蒙版，支持 Agent 读取后修改并交付新版。
- 反馈留在项目目录，应用升级时继续使用。当前回传方式为复制指令到 Agent 对话，尚未提供自动发送或原生批注按钮。

工作台无需额外安装 Node 或 npm。macOS 默认安装位置下，可以让 Agent 按以下方式打开文件：

```sh
'/Applications/Craft Agents.app/Contents/Resources/app/vendor/bun/bun' \
  '/Applications/Craft Agents.app/Contents/Resources/app/dist/resources/visual-review/open-review.cjs' \
  '/absolute/path/to/project/review' \
  '/absolute/path/to/image.png' \
  '/absolute/path/to/page.html'
```

命令返回各文件的 `links`，可在 Craft 内置浏览器打开。应用重启后重新运行命令获取链接。希望 Agent 默认提供入口时，可将此约定加入自己的工作区 AGENTS.md。

HTML 当前支持自包含静态文件：内联样式和 data 图片可用，业务脚本、外部网络资源不执行。页面预览视口为 900×680。完整使用和数据格式见 [工作台说明](extensions/visual-review/README.md) 与 [内置入口指南](extensions/visual-review/BUNDLED-GUIDE.md)。

### 个人发行版维护

- 标准 Pi 1.4.0 提供模型运行路径，保留已验证的数据源、MCP、任务和工作流能力。
- 文件链接兼容中文、空格、iCloud 路径和行号；普通文件可在 Finder 定位。
- Pele 图表渲染及展开批注修复。
- 官方自动更新关闭；采用明确版本、组件锁和手工升级，避免覆盖社区改动。

生图模型与外部技能按用户自己的连接配置使用。个人工作区的自定义 Codex 生图技能及 API 凭据不包含在本应用包中。

## 构建与版本管理

- `main`：当前社区版主程序、工作台、构建和维护记录。
- `engine`：历史版本使用的独立 Antigravity 引擎来源；当前 1.5.0 应用不包含该引擎。
- `extensions/visual-review/`：版本化工作台源码及独立依赖锁。
- `personal-release.json`：正式版组件锁、验收记录及模块版本。
- Release：代码安装包、完整应用文件清单、SHA256 和验证摘要。大文件不存入 Git/LFS。

本项目选择性维护固定基线，不直接合并官方整包升级。重建需取得已校验的基础应用，并遵循 [维护手册](docs/personal/MAINTENANCE.md)；不要使用通用 `electron:build` 重建被冻结组件。

工作台开发者可单独安装其锁定依赖并运行测试：

```sh
npm --prefix extensions/visual-review ci --ignore-scripts --omit=optional
node extensions/visual-review/build.mjs
node --test extensions/visual-review/tests/host.test.mjs
```

根仓库依赖使用 Bun 1.3.9，主构建 esbuild 0.25.12。[本次集成与验收](docs/personal/VISUAL-REVIEW-REVIEW.md)

## 历史、隐私与许可证

本仓库于 2026-11-11 从私有维护转为公开分享。公开前检查了个人改动历史、历史发布元数据及当前发行包；旧 Release 中的“保持私有”字段记录当时的维护策略，后续以本次公开决定为准，历史文件保持原样。[公开审查说明](docs/personal/PUBLICATION-REVIEW.md)

请勿提交真实配置、凭据、对话、附件或工作区资料。仓库公开不等于授权公开维护者的其他仓库。GitHub Actions 与官方自动更新仍保持关闭。

上游与本仓库代码按 [Apache License 2.0](LICENSE) 分发，请保留 [NOTICE](NOTICE) 及第三方许可。工作台使用 Fabric.js（MIT）与 pngjs（MIT），安装包附带相应声明；商标说明见 [TRADEMARK.md](TRADEMARK.md)。
