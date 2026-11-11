# 内置图片与 HTML 批注工作台

个人版 Craft 内置工作台 0.1.0，反馈数据格式为 schemaVersion 2。它在应用内按需运行；不需要为工作台安装 npm、Node 或 Python。应用退出时关闭其工作台进程，项目反馈和草稿仍保存在用户选定的目录。

图片和 HTML 成果交付时附上对应文件的「进入批注」链接。不要在应用资源目录里保存用户的图片、HTML、草稿或反馈。

## Agent 打开方式（macOS 默认安装位置）

通过应用自带 Bun 执行内置命令。所有参数分别引用，避免拼入提示词或 shell 字符串：

```sh
'/Applications/Craft Agents.app/Contents/Resources/app/vendor/bun/bun' \
  '/Applications/Craft Agents.app/Contents/Resources/app/dist/resources/visual-review/open-review.cjs' \
  '/path/to/project/review' '/path/to/image.png' '/path/to/page.html'
```

应用安装在其他位置时，相应调整应用路径。命令只读取 `CRAFT_CONFIG_DIR`（默认 `~/.craft-agent`）下的工作台发现文件并请求已运行的宿主；不自行启动整个 Craft，不加载账号或 API 密钥。

返回 JSON 中 `links` 是每个文件的直达链接。先核实链接可访问，再交付给用户。打开链接可以使用 Craft 内置浏览器。重复打开同版文件会复用工作台；文件更新后创建对应新版的工作台。应用重开后通过命令重新取得链接。

## 用户操作

图片支持涂抹、擦除、矩形、点位、撤销重做和草稿恢复。HTML 支持文字拖选（精确字符范围）及图形区域批注；每条意见绑定自己的选区。涂抹覆盖哪里就选中哪里，沿边画一圈不自动填满。

加入批注后点「保存并生成回传指令」，将指令发送回当前对话。自动发送暂未实现。Agent 读取批次后核对 SHA-256，按字符范围或区域蒙版修改并交付可继续批注的新版。

HTML 当前支持自包含静态文件，固定 900×680 预览视口，内联样式和 data 图片可用，业务脚本和外部资源不执行。HTML 图形区域使用页面坐标，不能直接当作内嵌图片的坐标。

## 源码与版本

源码位于个人版仓库 `extensions/visual-review/`，依赖锁定在该目录的 package-lock.json。安装包内 `module-manifest.json` 记录模块版本、数据格式与文件 SHA-256。项目反馈和本机运行状态不进入源码仓库或发布包。
