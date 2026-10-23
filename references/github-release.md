# GitHub 发布准备与安装边界

配套 `SKILL.md` 阶段 10、§14。核心区别：

- **代码生成** = 开发任务，默认执行。
- **上传 / 提交 / 发布 / 安装** = 环境与远端修改，默认不执行，需明确授权。

---

## 1. 默认只做这些

1. 整理成可发布结构
2. 写 README、LICENSE、.gitignore
3. 提供示例配置（无真实凭据）
4. 给出发布清单
5. 给出"用户自己执行"的命令

## 2. 默认不做这些

| 动作 | 需要 |
|---|---|
| `git init` / `git add` | 用户同意（仅 `git init` 也可能被视作改动，先问） |
| `git commit` | 明确授权 |
| 建远端仓库 | 明确授权 |
| `git push` / 上传 | 明确授权 |
| 打 tag / 发 Release | 明确授权 |
| 安装/启用插件 | 独立授权（见 §6） |

---

## 3. 发布前自查清单

### 结构

- [ ] 顶层就是包根：`package.json` 在仓库根
- [ ] 入口明确：`exports["."]` 指向真实文件
- [ ] `dsh.bundle.patch` 指向真实存在的 patch 文件
- [ ] 需要 Web 半边的，`exports["./client"]` 与 `dsh.client` 都在
- [ ] `files` 覆盖所有运行时文件（本地链接安装不生效，但 npm/GitHub 打包生效）
- [ ] 无嵌套多余目录（`dsh-xxx/dsh-xxx/`）

### 内容

- [ ] 无真实凭据（跑一遍 `audit-scan.mjs`）
- [ ] 无本地绝对路径（`C:\Users\`、`/home/`、`/Users/`）
- [ ] 无 `node_modules`、`dist` 残留、日志、`.env`
- [ ] 测试夹具是构造数据，不是真实会话
- [ ] README 的安装命令用 `<profile>` 占位而不是作者本机 profile 名
- [ ] 图片/图标有版权或为原创

### 文档

- [ ] README 有：功能、安装、使用、配置、隐私、安全、已知限制
- [ ] 安装说明基于真实机制（`dsh plugin --profile <name> add <spec>` 或插件页添加）
- [ ] 卸载说明写了残留清理
- [ ] 声明的功能与实际一致，未验证的部分明确标注

### 版本

- [ ] `package.json` `version` 与发布说明一致
- [ ] `engines.dsh` 声明的区间与实测环境相符
- [ ] LICENSE 存在且与 `package.json` `license` 一致

---

## 4. 推荐文件

### .gitignore

```gitignore
node_modules/
dist/
build/
*.log
.env
.env.*
!.env.example
.DS_Store
Thumbs.db
*.local.json
coverage/
.idea/
.vscode/
```

### .gitattributes

```gitattributes
* text=auto eol=lf
*.png binary
*.jpg binary
*.webp binary
```

### LICENSE

MIT 是最省事的选择。必须写年份与版权人；作者没指定就用用户自己的名义，**不要编造一个用户名或组织**。

### 示例配置

放 `docs/example.config.yml` 或 README 内的代码块，内容全部为占位符：

```yaml
- id: dsh-xxx
  name: 'dsh-xxx'
  config:
    endpoint: 'https://api.example.com/v1'
    token: '<YOUR_TOKEN>'
    timeoutMs: 15000
```

---

## 5. 发布说明草稿（给用户，不代发）

```markdown
## v0.1.0

首个版本。

### 功能
- ...

### 安装
dsh plugin --profile <profile> add github:<user>/<repo>

### 已知限制
- 仅在 DSH 0.2.x + Web 界面验证
- ...

### 安全
- 不联网 / 不采集数据 / 只写 <某处>
- 审计结论：见 AUDIT.md
```

---

## 6. 安装（只有用户明确要求时）

### 6.1 先讲清楚会改什么

```text
安装会做这些事：
1. 在 profile `<name>` 的 package.json 里加一条依赖
2. 把 bundle 加入 dsh.profile.bundles
3. 可能写入/更新 cordis.patch.yml 的一行 insert
4. 需要重启 DSH 才完全生效（Client 半边有时还需刷新页面）

安装位置：$DSH_PROFILE_DIR
卸载方式：插件页停用 + 卸载，或 dsh plugin --profile <name> remove <包名>
```

### 6.2 两条路径

**A. 交给 DSH 的插件管理器（推荐）**

```text
plugin_manager action=install_bundle target=<项目绝对路径>
```

- 它会做包安装与 bundle 选择，不要用 shell 复现。
- 只有用户明确批准了 pendingBuilds 才传 `approvedBuilds`。
- 结果看返回的 `application` / `warnings`：`applied` 才算生效；`restart-required` 需要重启；`failed` 要排查。

**B. 给用户手动命令**

```powershell
dsh plugin --profile <profile> add "C:\path\to\dsh-xxx"     # 本地目录 = 链接安装
dsh plugin --profile <profile> add github:<user>/<repo>      # GitHub 直装
dsh plugin --profile <profile> remove dsh-xxx                # 卸载
```

本地目录安装是链接：**移动或删除源目录，插件即失效**。

### 6.3 安装后

- 用 `cordis_inspect_query` 确认行已激活（免审批）。
- 需要重启/刷新的，明确告诉用户。
- 没在真机上看到界面效果，就写"安装成功但视觉未验证"，不要说"可以用了"。
- 用户改动的状态（启用/停用、配置）测试后要还原。

---

## 7. 交付目录长什么样

```text
dsh-xxx/
├── README.md
├── LICENSE
├── .gitignore
├── .gitattributes
├── package.json
├── cordis.patch.yml
├── index.js
├── client.js
├── locale/
│   ├── en.json
│   └── zh.json
├── icon.svg
├── test/
│   └── client.test.mjs
└── docs/              # 可选：截图、示例配置、审计报告
```

`AUDIT.md` 可放根目录（推荐，发布时一并公开）或 `docs/`。

---

## 8. 常见发布事故

| 事故 | 预防 |
|---|---|
| README 里写着作者本机的 profile 名 | 统一用 `<profile>` 占位 |
| 图标是官方 logo 的截图 | 用原创 SVG 或明确许可的素材 |
| `files` 漏了 `locale/`，别人装上看不到标题 | 安装后核对真实文件列表 |
| `cordis.patch.yml` 的 `name` 与包名不一致 | 三处（包名/patch name/Client id）一起改 |
| 本地绝对路径写进代码 | 用 `import.meta.url` 或配置项 |
| 测试数据是真实会话 | 用构造数据，跑 `audit-scan.mjs` 兜底 |
| 作者以为推了仓库就等于发布 | 只有用户授权才推；推之前再跑一次审计 |
