# 代码审计报告：plugin-builder

| 项 | 值 |
|---|---|
| 项目版本 | `0.1.0`（初始版本，未打 tag） |
| 审计日期 | 2026-10-23 |
| 审计环境 | DSH `0.2.1-rc.2`，Node `v24.17.0`，Windows |
| 审计范围 | 仓库内全部文件（`SKILL.md`、`references/`、`templates/`、`scripts/`、`README.md`、`LICENSE`），共 26 个文件 |
| 扫描命令 | `node scripts/audit-scan.mjs .` |

## 结论

**可安全交付。**

无高危项；16 项中危与 3 项提示经逐条人工复核，全部为本仓库的固有特征（本仓库是 Skill 而非插件 bundle；文档中包含"要被检测的路径与危险写法"示例；测试夹具包含刻意的危险代码用于验证检测能力），**无一为真实凭据、真实隐私数据或真实安全缺陷**。

## 检查项

| # | 类别 | 结果 | 说明 |
|---|---|---|---|
| 1 | 凭据泄露 | 通过 | 无私钥、无 API Key、无 Token、无密码。测试夹具中的假凭据在运行时字符串拼接生成，源码中不存在可用凭据 |
| 2 | 隐私数据 | 通过 | 不含任何真实会话内容、用户数据、账号信息；文档示例用 `<name>`、`<YOUR_API_KEY>` 等占位符 |
| 3 | 网络请求 | 通过 | 三个脚本不发起任何网络请求，只用 Node 内置模块读写本地文件 |
| 4 | 文件读写 | 通过 | 只读取被扫描目录内的文件（跳过 `node_modules`、`.git` 等），不写任何文件 |
| 5 | 注入与动态执行 | 通过（有提示） | 运行时代码无 `eval` / `new Function`；`check-project.mjs` 用 `new Function` 做**降级语法校验**，输入是本地已读文件内容，不涉及外部输入 |
| 6 | 权限与能力 | 通过 | 不使用任何 Host service，不注册工具，不修改 DSH 配置 |
| 7 | 第三方依赖 | 通过 | 零运行时依赖，仅用 Node 内置模块（`node:fs`、`node:path`、`node:vm`、`node:test`、`node:url`） |
| 8 | 发布面 | 通过 | 无绝对路径、无临时文件、无构建产物、无日志；`.gitignore` 已覆盖 `node_modules`、`.env`、日志与编辑器目录 |

## 发现的问题

### 高

无。

### 中

| # | 位置 | 问题 | 处理 |
|---|---|---|---|
| M-1 | `package.json` | 扫描器报告"缺少 package.json，不是有效 bundle" | **接受**：本仓库是 DSH **Skill**（目录 + `SKILL.md`），不是插件 bundle，按设计就无需 `package.json`。该规则面向被审计的插件项目，命中此处属预期 |
| M-2 | `references/github-release.md:45`、`references/security-audit.md:40,105` | 命中"本地绝对路径" | **接受**：这些是**规则示例**，写的是 `C:\Users\<名>\`、`/home/<名>/` 这类占位形式，用于告诉使用者要检测什么。不含真实用户名 |
| M-3 | `references/security-audit.md:41` | 命中 `eval(` / `new Function(` | **接受**：审计清单在列举"要检查的危险写法"，属说明文本 |
| M-4 | `templates/bundle-skeleton/index.js` 等模板中的 `<YOUR_TOKEN>` 等 | 命中占位符降级 | **接受**：占位符已被扫描器正确降级为提示，符合预期 |
| M-5 | `scripts/audit-scan.mjs:137,143` | 命中"本地绝对路径" | **接受**：这是扫描器自身的**检测正则**，即规则定义本身 |
| M-6 | `scripts/audit-scan.test.mjs:110,115,121,188` | 命中绝对路径、`innerHTML`、`eval` | **接受**：测试夹具，用于验证扫描器能检出这些模式；假凭据在运行时拼接，源码中无真实凭据 |
| M-7 | `scripts/check-project.mjs:85` | 命中 `new Function(` | **接受**：降级语法校验路径。已在代码注释中说明用途；输入为本地文件内容，非外部输入；`vm.SourceTextModule` 可用时不会走到该分支 |

### 低 / 提示

| # | 位置 | 问题 | 处理 |
|---|---|---|---|
| L-1 | `templates/bundle-skeleton/` | 缺少 `README.md` / `LICENSE` | **接受**：它是"待复制的骨架"，这两份文件由使用者在阶段 9/10 按模板生成；`check-project.mjs` 对此只报提示不报失败 |
| L-2 | `templates/bundle-skeleton/package.json` | 未标记 `private: true` | 已确认：该模板**包含** `"private": true`；此提示来自对仓库根目录的扫描（根目录无 `package.json`），不适用于模板 |

## 已修复

| # | 原状态 | 修复方式 | 复扫结果 |
|---|---|---|---|
| 1 | `references/scenarios.md` 示例路径含真实用户名 `C:\Users\Acer\...` | 改为 `C:\Users\<name>\...` 占位符 | 已清零 |
| 2 | 测试夹具曾直接写死假 API Key 与私钥字面量 | 改为运行时字符串拼接生成 | 已降级为提示 |
| 3 | `check-project.mjs` 与 `audit-scan.mjs` 曾用 `child_process` 做语法检查，在受限沙箱触发 `spawn EPERM` | 改为进程内实现（`vm.SourceTextModule`，不可用时如实报"无法校验"） | 已修复，测试全通过 |

## 尚未解决

无阻塞项。已知边界（见下）属于设计取舍，非缺陷。

## 隐私数据处理

| 问题 | 结论 |
|---|---|
| 读取哪些用户数据 | 不读取任何用户数据。仅在你显式指定目录时读取该目录内的文本文件用于扫描 |
| 数据是否离开本机 | 否。脚本不联网 |
| 是否写入日志 | 否。只在标准输出打印扫描结论；报告中的凭据片段被截断为前 8 字符 + `<redacted>` |
| 是否持久化 | 否。脚本不写任何文件（`AUDIT.md` 等报告由使用者按模板手动生成） |
| 用户如何清除 | 无需清除，不产生持久化数据 |

## 凭据检查

| 问题 | 结论 |
|---|---|
| 是否发现真实凭据 | **否** |
| 已如何处理 | 不适用 |
| 是否曾进入 Git 历史 | 不适用（本审计在首次提交前完成） |
| 需要用户执行的轮换 | 无 |

## 复扫结果

```text
$ node scripts/audit-scan.mjs .
扫描文件：26
高危：0    中危：16    提示：3
```

中危与提示项均已在上文逐条登记并说明接受理由。

## 测试与审计的边界

- **已实际运行并通过**
  - `node scripts/audit-scan.test.mjs` → 19 / 19 通过
  - `node scripts/check-project.test.mjs` → 20 / 20 通过
  - `node scripts/self-check.mjs` → 58 / 58 通过
- **仅静态检查**：`references/*.md`、`templates/*.md` 为文档，只做人工审阅与引用完整性检查（由 `self-check.mjs` 校验无死链）。
- **尚未验证**
  - 本 Skill 未用于完整交付过一个真实 DSH 插件，端到端流程衔接未经实机验证。
  - `vm.SourceTextModule` 在受限环境中不可用时，含 `import`/`export` 的文件语法无法由脚本校验（需 `node --check` 手动确认）——这是刻意的"如实报未验证"设计。
  - UI/slot 渲染效果无法在无 GUI 环境验证。

## 审计人

DeepSeek Harness Agent，2026-10-23。本报告基于上述范围内的文件；范围外的改动不在此报告覆盖之内。
