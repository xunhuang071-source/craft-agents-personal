# 文件链接与 Finder 修复候选验收记录

候选：**wallee-v1.2.0-rc.2**；日期：2026-11-11；修复前组件基线：**wallee-v1.2.0-rc.1**。

状态：2026-11-11 用户已手动安装候选，并确认历史对话中的产出物链接能够自动弹出 Finder，实现文件定位目标；随后授权同步私有仓库并按既有纪律完成正式版本管理。正式版为 **wallee-v1.2.0**，晋升不改变任何程序代码或签名。

## 用户可见行为

- 普通文件链接点击后，在 Finder 中打开所在文件夹并选中文件。
- 文件夹链接点击后，直接打开该文件夹。
- 支持 iCloud 路径中的 com~apple~CloudDocs、中文、空格、明确路径的未知后缀与无后缀文件。
- 文件引用末尾的 :行号 或 :行号:列号按引用位置处理；如果同名含冒号的文件实际存在，优先定位该真实文件。
- 文件不存在时明确提示“文件不存在”。图片、PDF、Markdown 等专用预览块及预览中的外部打开动作继续走现有入口。

## 根因与实现

原 isFilePathTarget 使用路径字符和后缀白名单。中间的 ~ 不在白名单中，因此 iCloud 的 com~apple~CloudDocs 被误判为网址，随后 OPEN_URL 的 URL 校验拒绝该请求。文件夹、未知后缀和带行号引用也会误判。

已对实际安装包的分类函数及完整 Markdown 渲染链路作复现。标准 Markdown 会百分号编码中文与空格，因此不能把所有中文路径都归因于中文本身；iCloud 的 ~ 是本次确认的独立触发条件。原始 HTML anchor 中的中文未经过相同编码，也受原白名单影响。

修改点：

1. linkify.ts：明确本地前缀独立判断，不依赖文件后缀；协议、协议相对网址和片段继续走 URL 路由。裸相对文件名保留已知后缀判断，避免将任意文字解释为文件夹。
2. App.tsx：共享文件链接入口接到现有 showInFolder；专用预览读取接口与外部打开接口保留。
3. system.ts 的 SHOW_IN_FOLDER：执行现有路径校验后检查存在性；文件调用客户端 showItemInFolder，目录调用客户端 openPath；缺失引用尝试去掉行列号后重新校验。已有本地工作区与敏感路径限制保留。

## 基线与构建

实际安装应用已用修复前 rc.1 锁完整校验通过，签名与 1752 个文件、14 个符号链接符合基线。这是本轮实际组件校验结果；此前 rc.1 历史文档中的人工验收状态不据此自动改为通过。

- 使用 scripts/personal-build-finder-candidate.mjs，从主树根目录定向构建。
- 构建使用临时 HOME/config、环境变量白名单；不使用真实账号或用户数据。
- 两份 Pi 重建仅用于原哈希核对，候选继续复制基线中的两份原 bundle。
- 只替换 renderer/main，重新签名，不修改运行中的应用。
- 原 Pi 升级记录和正式版 wallee-v1.1.0 回退记录继续保留，不在本次修复中重做引擎升级。

## 自动验证

| 项目 | 结果 |
|---|---|
| 链接与宿主定点测试 | 97 通过，0 失败；3 文件，134 断言 |
| 生产 Markdown 真实 Chromium 点击 | 8 通过，0 失败，0 页面异常 |
| Electron TypeScript | 通过，0 诊断 |
| server-core TypeScript | 通过，0 诊断 |
| 确定性构建 | main 与 renderer 二次构建哈希相同，两份 Pi 与原基线字节一致 |
| 候选全文件审计 | 7 个同名文件变化、16 新增、16 删除；0 未授权组件变化 |
| 主可执行文件 | 除嵌入签名外，指令字节一致 |
| 隐私扫描 | 扫描 1440 个代码/文本资源，0 未审查高置信匹配 |
| ZIP 解压复验 | 1752 文件、14 符号链接，完整清单一致、签名通过 |

浏览器测试覆盖 iCloud Markdown、原始 HTML 中文图片链接、文件夹、行列号、未知后缀、file URL、网页以及危险协议。使用真实鼠标点击生产 Markdown 组件，系统 shell 回调仅记录，不弹真实窗口。宿主 RPC 测试用真实临时文件和模拟客户端核对 showItemInFolder/openPath 的选择与参数。危险 URL 仍交给原有 URL 校验，并不因本次修复而获准执行。

自动化测试未直接操控真实 Finder 窗口，也未启动完整候选应用或连接真实账号。2026-11-11 用户自行安装后测试过去的对话，确认产出物链接能够弹出 Finder；这是人工验收结果，与前述自动化测试范围分别记录。

首次宿主测试的 8 项失败来自隔离环境中 /tmp → /private/tmp 的符号链接别名：原有路径校验将夹具的真实目录拒绝。将测试 TMPDIR 设置为真实 /private/tmp 后，97 项全部通过；未为测试放宽生产路径检查。

敏感信息扫描唯一匹配为已审查的 markdown-it-task-lists 文档 URL slug，与旧候选匹配值哈希一致；新源码映射文件单独绑定精确文件哈希，没有整目录豁免。

## 产物

- 应用：native-artifacts/wallee-v1.2.0-rc.2/Craft Agents.app
- 安装 ZIP：/Users/wallee/Downloads/Craft-Agents-wallee-v1.2.0-rc.2-mac-arm64.zip
- 安装 ZIP 大小：296190616 字节
- 安装 ZIP SHA256：5919738caeb68ae6177e7220898b1e23cc1a52643ac4cf105cd157640cdf5402
- main SHA256：4cd9fe8eac985790896de3e4742d9273fe811c8df9045d146dd236e32dcfb4a5
- renderer tree SHA256：794d4881cb7e73ead33ab215ffde4ecc8c1fa8b6d6a830fc15aec5eb025fb372
- managed Pi SHA256：09578725ccaabb332e2c812cd5367fcc3557d50b51c2adeb09b456edd053d920
- standard Pi SHA256：90bff5453e4c18bacf84d63b5d489aa054b53d218af18c6257562c77174d54cb

候选目录保留 application-files.json、baseline-diff.json、privacy-scan.json、package-verification.json 和 candidate-manifest.json。测试日志与截图保存在 .personal-build/finder-* 及 .personal-build/finder-links/，不进入 Git。

## 安装和人工验收

1. 退出 Craft Agents。
2. 解压下载文件夹中的 ZIP，将 Craft Agents.app 拖入“应用程序”并替换。
3. 重新打开，点击一条已有 iCloud 文件链接，确认 Finder 弹出并选中文件。
4. 点击一条文件夹链接，确认进入该文件夹；再检查网页链接和专用图片或文档预览。
5. 文件链接对应的文件已被移动或删除时，确认出现“文件不存在”，而不是无效网址错误。

回退到修复前代码时，可使用本机已保存的 native-artifacts/pi-sdk-1.4-rc.1-20261030/Craft Agents.app；该目录的应用与 rc.1 锁已核对。退出应用后只替换程序。不会用旧对话或账号快照覆盖当前数据。正式稳定版 wallee-v1.1.0 仍保留其独立版本记录。

2026-11-11 用户明确授权同步 GitHub 并完成版本管理。已安装应用按候选锁通过全文件清单及签名复核，所有条目与 rc.2 原包一致。正式 Release 使用同一 ZIP 字节，仅将资产名标记为 Craft-Agents-wallee-v1.2.0-mac-arm64.zip；主程序与引擎源码分别固定到 main 和 engine 分支。
