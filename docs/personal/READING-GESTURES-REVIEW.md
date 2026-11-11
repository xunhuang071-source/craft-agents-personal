# 嵌入图表字号与预览手势 · 2026-11-11

用户批准先改善文档/对话内 Mermaid 字号，手势仅在小范围可行时修复。以 wallee-v1.4.0 为已验收基线，交付本地候选 wallee-v1.4.1-rc.1；正式版本锁保持 1.4.0，不自动安装或发布。

## 字号

Pele 的普通流程图根字号为 16px，正文默认 15px。嵌入图改用 14/16 的等比显示，通常对应 14px 标签。图形、连接线、选区和文字一起缩放，保留 SVG 原有布局与字符内容。

轻微溢出可适配容器，缩放下限对应 12px；容器更窄或图更宽时按阅读比例横向滚动，避免继续压小文字。删除原来基于 280px 最小图高的多分支布局规则。展开预览仍从原尺寸开始，不改变 Pele 版本或渲染选项。

## 手势

已在实际组件夹具中复现：原版预览经 Dialog Portal 延后挂载，useEffect 读取到空的 containerRef 后直接返回；后续 DOM 挂载未改变该 ref 对象本身，wheel 事件没有重新绑定。因此按钮能缩放，捏合却没有效果。

两个预览组件改为通过稳定的 state ref 回调传递实际挂载元素，共享钩子随元素挂载/卸载绑定和清理事件。没有增加交互库或新的架构层。

- 触摸板双指捏合：在指针位置连续缩放，使用 Chromium 的 ctrl+wheel 事件。
- 双指滚动：水平/垂直平移。Ctrl/Command 配合滚轮也可缩放。
- 鼠标拖动图片或图表空白/图形区域：平移。
- Mermaid 文字仍可拖选，Alt/中键可在文字上拖动画布。
- 保留加减号、快捷键、缩放上下限、复位和关闭行为。

## 验证

- 43 项 Bun 测试：布局边界、Pele 渲染及主题、安全限制、缩放坐标与边界。
- Electron TypeScript 检查通过。
- 实际 React 组件在独立 Electron 39.2.7 壳中完成 146 项断言并全部通过，不读取真实账户/profile；覆盖 1280px modal 与 900px fullscreen、首次打开与重新打开、捏合指针锚定、平移、拖动、文字选择、按钮和事件清理。进一步覆盖窄正文、明暗主题及嵌入/展开视图的批注字符锚点一致性。
- 自动化使用捏合等效 wheel 输入和鼠标事件；真实触摸板手感由用户在候选中最终验收。

```sh
'/Applications/Craft Agents.app/Contents/Resources/app/vendor/bun/bun' test \
  packages/ui/src/components/markdown/__tests__/mermaid-inline-layout.test.ts \
  packages/ui/src/components/markdown/__tests__/mermaid-renderer.test.ts \
  packages/ui/src/components/overlay/__tests__/useRichBlockInteractions.test.ts
node scripts/personal-diagram-reading-smoke.mjs '/path/to/verified-app/Craft Agents.app' '/path/to/report.json'
```

夹具使用候选的 Electron 与 CSS、当前源码的真实组件，主程序为独立最小入口；它不启动用户实际会话。隔离壳仅为测试临时签名，测试后自动清理。

## 定向构建与冻结检查

```sh
node scripts/personal-build-reading-candidate.mjs \
  '/path/to/verified-wallee-v1.4.0/Craft Agents.app' \
  '/path/to/fresh-candidate-directory' 'wallee-v1.4.1-rc.1'
```

只执行 Vite renderer 构建，复制已校验的 1.4.0 应用其余资源，必要重签名。候选目录保存 component-lock、candidate-manifest、完整应用文件清单、差异与隐私扫描。`personal-audit-candidate.py --scope diagram-reading` 禁止 main、Pi、preload、interceptor、工作台等其他组件漂移。主程序可执行代码在签名段之前也必须一致。

## 候选包最终结果

- 真实候选再次通过 146 项 Electron 界面断言。
- 与正式版 renderer 的全部 source map 对比，恰好只有上述 4 个组件变化，新增 1 个尺寸辅助模块，无其他源码模块变化。
- 主进程、Pi、preload、interceptor、工作台和其他非 renderer 资源原字节一致；可执行代码的签名前内容也一致。
- 1443 个代码/静态资源扫描无未审查的高置信命中。新 source map 内 markdown-it-task-lists 文档 URL 的既有误报已按文件和内容双重摘要逐条核实。
- ZIP 解压后的 1741 个文件、14 个符号链接与候选完全一致，签名复验通过。
- 本地目录 `native-artifacts/diagram-reading-v1.4.1-rc.1/` 保存 ZIP、SHA256SUMS、组件锁、源码映射差异和完整验证摘要。

本地候选不代表正式晋升。用户退出应用并安装验收后，再决定是否更新正式锁和公开 Release。
