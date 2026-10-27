# plugin-builder

**中文** | [English edition](SKILL.en.md)

一个用于 **DeepSeek Harness（DSH）插件开发**的全流程 Skill：把一个"我想做个插件"的想法，变成结构完整、经过测试与安全审计、可直接交付的插件项目。

> 状态：**39 项脚本测试 + 85 项自检全部通过**，Skill 已在真实 DSH 会话中加载使用。
> **尚未**用它完整走完一个插件从需求到交付的全流程，因此端到端效果未经实机验证（见「已知限制」）。

它**不会**替你安装、启用、上传或发布任何东西。默认交付即停，环境修改必须单独授权。

---

## 这个 Skill 解决什么

直接让模型"做个 DSH 插件"，常见的失败是：还没问清需求就开始写代码、自己替用户起名、凭印象编造 slot 名和配置字段、交付时说"已测试通过"但其实没跑、审计只在脑子里过一遍、最后顺手 `install_bundle` 把用户环境改了。

`plugin-builder` 用 11 个阶段和 4 道确认门把这些堵住，并且把"能自动化的检查"做成**可执行的脚本**，让测试与审计产出真实结果而不是口头结论。

核心原则：

```text
先问清、再设计；先实现、再测试；先审计、再交付；默认不安装。
```

---

## 工作流程

```text
接收需求
  ↓
阶段 0   事实核对（真实 API / 环境 / 已有项目）
阶段 1   需求提取与缺口分析          ── 缺 P0 信息 → 提问
阶段 2   插件命名                    ── 无名称/不合规 → 选项确认   ★必须问
阶段 3   交互布局与配置位置          ── 未指定 → 选项确认         ★必须问
阶段 4   需求总结                    ── ★确认门
阶段 5   架构设计                    ── ★确认门
阶段 6   项目结构与代码实现
阶段 7   测试与构建
阶段 8   代码审计 + 隐私检查 + 脱敏
阶段 9   README 与文档
阶段 10  GitHub 发布准备（只准备，不执行）
阶段 11  交付报告 → 停止
```

用户已经给出的信息不会重复询问；关键决策（名称、布局、需求、架构）必须经用户确认。

---

## 目录结构

```text
plugin-builder/
├── SKILL.md                              核心流程、边界规则、交付格式（中文版）
├── SKILL.en.md                           同一份说明的英文版（English edition）
├── references/
│   ├── dsh-plugin-api.md                 已核实的 DSH 插件 API 契约 + 待验证清单
│   ├── requirements.md                   P0/P1/P2 提问策略与选项写法
│   ├── ui-design.md                      六种布局选型 + 真实 slot 候选表
│   ├── security-audit.md                 审计清单、处置方式、脱敏手法
│   ├── github-release.md                 发布准备与安装边界
│   └── scenarios.md                      7 个行为验收场景
├── templates/
│   ├── bundle-skeleton/                  可直接复制的空插件骨架（已通过自检）
│   ├── README-template.md                插件项目 README 模板
│   ├── audit-report-template.md          审计报告模板
│   └── project-structure.md              项目结构选型
└── scripts/
    ├── check-project.mjs                 结构与配置自检
    ├── audit-scan.mjs                    凭据/隐私/危险写法扫描
    ├── check-project.test.mjs            20 项测试
    ├── audit-scan.test.mjs               19 项测试
    └── self-check.mjs                    验证 Skill 自身完整性
```

---

## 安装

Skill 就是磁盘上的一个目录。把它放进 DSH 会扫描的任一位置即可：

| 作用域 | 路径 |
|---|---|
| 当前项目 | `<项目根>/.dsh/skills/plugin-builder/` |
| 当前项目（agents 约定） | `<项目根>/.agents/skills/plugin-builder/` |
| 全局 | `~/.dsh/skills/plugin-builder/` |
| 全局（agents 约定） | `~/.agents/skills/plugin-builder/` |

说明：

- 项目根取最近的、含 `.git` 的祖先目录；没有则用当前工作目录。
- 项目级（`.dsh/skills`）优先级高于全局（`~/.dsh/skills`）。
- **只扫描一层**：必须是 `<root>/plugin-builder/SKILL.md`，不能再嵌套一层。
- Skill 目录被监听，新增/重命名/删除会在下一个会话步骤生效，通常不用重启。

无需安装任何依赖，脚本只用 Node 内置模块。

---

## 使用

**自动触发**：直接说"帮我做一个 DSH 插件""我想给 DSH 加个 XX 功能"，模型会读到这个 Skill 并按流程走。

**显式触发**：`plugin-builder` 也是可以直接调用的 Skill。

**单独使用脚本**（作用于任何 DSH 插件项目）：

```powershell
# 结构 / 配置 / 入口 / id 一致性 / JSON / locale / 图标 / 语法自检
node scripts/check-project.mjs "<插件项目目录>"

# 凭据、隐私、危险写法 + bundle 结构扫描
node scripts/audit-scan.mjs "<插件项目目录>"
node scripts/audit-scan.mjs "<插件项目目录>" --json      # 结构化输出
node scripts/audit-scan.mjs "<插件项目目录>" --strict    # 中危也算失败

# 验证本 Skill 自身（文件完整、frontmatter、引用无死链、模板可过检）
node scripts/self-check.mjs
```

退出码约定：`0` 通过 / 无高危项，`1` 有失败项 / 有高危项，`2` 参数或路径错误。

扫描器是**筛查**不是保证：命中需要人工判断（很多是刻意的正常用法），未命中也不代表安全。
`<YOUR_API_KEY>`、`your-token-here`、`process.env.X` 这类占位符会被降级为提示，不误报高危。

---

## 设计要点

- **API 有出处**：所有 DSH 契约（bundle 声明、Host/Client 出口、slot、主题 token、安装命令）都来自 `cordis_inspect_query` 实测、官方包文档或本机已装插件。查不到的一律标「待验证」，集中列在 `references/dsh-plugin-api.md` §9。
- **不伪造结果**：测试结论强制四分（实际运行通过 / 运行失败 / 仅静态检查 / 尚未验证）。ESM 语法在无法校验的环境里报 warn，而不是假装通过。
- **审计有产物**：必须生成可见的审计报告，包含范围、问题、已修复、未解决、是否发现真实凭据、能否安全交付。
- **交付即停**：安装、启用、上传、commit、Release 全部分离出去，需要用户单独授权；授权后也要先说明"会改什么"。
- **隐私优先**：不擅自增加遥测、上报或联网能力；发现凭据先修复再交付，并提示轮换。

---

## 测试与自检

```powershell
node scripts/audit-scan.test.mjs     # 19 项：规则命中、占位符降级、退出码、脱敏、结构检查
node scripts/check-project.test.mjs  # 20 项：命名、patch、入口导出、Client id、locale、图标、语法
node scripts/self-check.mjs          # 85 项：本 Skill 完整性（含中英双版一致性）
```

测试直接执行 `node <file>`，不需要 `node --test`——某些受限沙箱里测试 runner 会因为 `spawn EPERM` 失败，而这些测试在设计上就不启动子进程。

---

## 已知限制

1. **端到端未验证**：各阶段、脚本、模板都单独验证过，但没有用它完整交付过一个真实插件，流程衔接仍需实测。
2. **ESM 语法校验依赖运行环境**：`check-project.mjs` 优先用 `vm.SourceTextModule`；该模块在受限环境（含本机沙箱）不可用时，含 `import`/`export` 的文件会报「无法校验」，需要你自己跑 `node --check`。这是刻意设计——宁可报未验证，也不伪造通过。
3. **UI 效果无法自动验证**：slot 是否真的渲染、主题观感、深色模式对比度，必须真机确认。
4. **slot 名与主题 token 会随 DSH 升级变化**：`references/ui-design.md` 与 `dsh-plugin-api.md` 里的是 `0.2.1-rc.2` 快照，Skill 要求每次开工重新 inspection 复核。
5. **命名唯一性不做保证**：没有可靠的 npm/GitHub 查重能力时，不会声称名称唯一。
6. **扫描器有已知边界**：基于逐行正则，无法识别跨行拼接、运行时构造、从远端拉取的配置，也无法证明"没有泄露"。

---

## 许可证

MIT，见 [LICENSE](LICENSE)。
