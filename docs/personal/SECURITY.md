# 发布前本地隐私检查

检查对象是准备提交的个人源码增量与实际程序包，不扫描或上传用户的账户目录、会话、密钥库及工作资料。

使用经官方 GitHub asset digest 验证的 Gitleaks 8.30.1；扫描完全在本机执行，报告开启 100% redaction。源码暂存区和完整应用包分别扫描。扫描不等于绝对安全保证，需结合包内文件清单与人工复核。

## wallee-v1.0.0 应用包复核

原始扫描提示 22 项，均为 generic-api-key 规则；逐项核对后不是静态账户密钥：

- 语法解析器的 ctrlKey / Babel *_KEYS / 图形布局 fKey 等代码标识符。
- apiKey 字段从 resolved2 运行时对象读取；这是变量引用，扫描到的并非密钥值。
- SDK 内模板清单中 token-plan 文件名对应的是 SHA 内容哈希，不是账户 token。
- 表格文件解析器的 encryptedHmacKey 赋值表达式，不是预置密码或用户凭据。

这些复核仅适用于本 Release 中精确哈希绑定的文件，不把所有 bundles、tests 或 generic-api-key 规则永久排除。后续版本须重新扫描与复核。逐项位置、原因及文件哈希见 Release 附件 security-review.json；不附原始秘密内容。

程序清单另核对：相同应用身份、冻结资源、签名、包内链接不逃出应用、无用户环境文件/密钥库/JSONL 会话。GitHub 仓库保持私有，导入的 Actions 不运行。
