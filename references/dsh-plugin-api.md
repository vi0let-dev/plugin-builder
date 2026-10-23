# DSH 插件 API 契约（已核实 / 待验证）

本文件记录**动手写代码前需要知道的事实**。全部标注来源与核实方式，方便你在新版本上重新判断是否仍然成立。

核实环境：DSH `0.2.1-rc.2`，profile `desktop`，Web GUI，2026-10-23。
核实方式：`cordis_inspect_query`（Config / Service / Slots / Theme）、已安装包 README、`dsh --help`、本机已安装插件源码。

> 升级后必须重新核对标记为「版本敏感」的条目。任何拿不准的东西标「待验证」，不要写进交付代码还宣称可用。

---

## 1. 一个插件 = 一个 bundle 包

最小可行插件就是一个 npm 包目录：

```text
dsh-xxx/
├── package.json          # 包名 = 插件名 = patch 行 name = client ModuleLoader id
├── cordis.patch.yml      # insert 一行把插件挂进 profile 组合树
├── index.js              # Host 半边（可以什么也不做）
├── client.js             # Web 半边（可选）
├── locale/en.json        # 插件管理器显示用
├── locale/zh.json
├── icon.svg
├── README.md
└── test/
```

**已核实**（来源：`cordis-plugin-development/references/host-plugin.md`、本机 `dsh-session-export` 包）：

- bundle 的判定条件是 `package.json` 里有 `dsh.bundle.patch` 指向 patch 文件。
- Host-only bundle **不需要**任何运行时依赖，也不需要构建工具或安装脚本。
- 目录必须能被当作包解析（有 `package.json`，`type: "module"` 让 ESM 生效）。

### package.json 关键字段

```json
{
  "name": "dsh-xxx",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg",
    "./package.json": "./package.json"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg", "README.md", "LICENSE"],
  "icon": "./icon.svg",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": [] }
  },
  "engines": { "node": "^22.19.0 || >=24.0.0", "dsh": ">=0.2.1-rc.2 <0.3.0" }
}
```

要点：

| 字段 | 规则 | 来源 |
|---|---|---|
| `dsh.bundle.patch` | 必填，指向 patch 文件 | host-plugin.md（已核实） |
| `dsh.client.platform` | Web UI 用 `"web"` | 官方模板 + 本机插件（已核实） |
| `dsh.client.immediately` | `true` = 立即激活 Client 半边 | 同上 |
| `dsh.client.inject` | 只用于**激活顺序**，不是依赖注入 | practices.md（已核实口径） |
| `exports["./client"]` | Client 模块入口，缺了浏览器半边加载不到 | 同上 |
| `exports["./locale/*.json"]`、`"icon"` | 插件管理器显示标题/描述/图标 | host-plugin.md |
| `files` | 打包白名单；**本地目录安装是链接，`files` 不过滤** | host-plugin.md（重要） |
| `engines.dsh` | 声明兼容区间，安装时校验 | `plugin_manager` 行为 |

**待验证**：`engines.dsh` 的具体校验强度（不满足是硬拒绝还是警告）随版本可能变化。安装前用 `plugin_manager list_plugins` / 安装返回信息确认，不要假设。

---

## 2. cordis.patch.yml

```yaml
# 行 id / 行 name 与包名保持一致；client.js 的 ModuleLoader id 也必须一致。
- insert:
    - id: dsh-xxx
      name: 'dsh-xxx'
      config: {}
```

**已核实**：

- 顶层是 patch 数组，`insert:` 下挂条目；条目 `name` 是包名，`id` 是组合树里的行 id（默认与包名相同最省事）。
- 用户自己的覆盖层在 `$DSH_PROFILE_DIR/cordis.patch.yml`；安装器会把 bundle 加进 profile 的 `package.json` → `dsh.profile.bundles`。
- **不要手写 profile 的 `package.json` / `cordis.patch.yml`**：交给 `plugin_manager install_bundle`。
- 同名覆盖会**整体替换** `config`（不是深合并）。这一条对"升级后配置丢失"问题很关键，写文档时要提醒用户。
- `!!js` 表达式在 patch 里可用（Loader YAML 方言），细节见 `cordis-composition-reference` Skill。

**禁止**：为了让插件生效去改 `$DSH_HOME` 下的任何文件。那属于安装动作，需要单独授权。

---

## 3. Host 半边（index.js）

**已核实**（host-plugin.md + 本机 `dsh-session-export/index.js`）：

```js
// 形式一：函数式插件（推荐）
export function apply(ctx, config) {}

// 形式二：默认导出 service class
export default class MyService {}
```

两种形式**不可混用**。可选导出：

```js
export const name = 'dsh-xxx'        // 显示名，可省
export const inject = []             // 硬依赖的 service key，数组省略也行
export const Config = Schema.object({ /* schemastery */ })  // 有配置时才有意义
```

规则：

- 所有注册都放在 `apply` 内，用 `ctx.effect(() => { ...; return cleanup })` 或 `ctx.on(...)`，并交回清理函数。**卸载后不留残留是硬要求。**
- 可选依赖用 `ctx.inject(['webServer'], (scoped) => { ... })`（本机 `dsh-session-export` 的做法），这样 profile 里没有该 service 时插件保持不激活而不是抛错。
- 声明了 `Config` 的插件在激活时校验行 `config`。写 `config` 前先用 `Config.listConfigs` 查真实 schema，跟随 `$defs`。
- 日志用 `ctx.logger?.info/warn`，只记事件与错误，**不记消息内容、文件内容、凭据**。

**待验证**：`ctx.logger` 的具体方法与等级集合、`ctx.effect` 第二参数（标签）的语义。写代码时按"存在就用，不存在就跳过"的防御写法处理。

### 已核实的 Host service（节选，供设计选型）

| service | 关键方法 | 用途 |
|---|---|---|
| `webServer` | `register({kind:'exact'\|'prefix', path, handler})`、`getOrigin()` | 给 Web 半边提供本机 HTTP 接口；返回 disposer |
| `tools` | `register(definition)`、`get`、`schemas`、`execute`、`guard`、`restrict` | 注册模型可调用的工具 |
| `commands` | `register(definition)`、`find`、`execute` | 注册人类命令 |
| `storageDomain` | `open(spec)`、`get(name)` | 插件自有持久化 |
| `fs` | `resolve`、`readText`、`writeText`、`listDir` | 经统一文件服务读写（受沙箱策略约束） |
| `systemPrompt` | `section`、`context`、`tools`、`variable` | 往提示词加内容 |
| `credentials` | `resolve`、`set`、`unset`、`readRecord` | 凭据读取，**不要自己存明文** |
| `web` | `registerSearchProvider`、`search`、`fetch` | 出网；不要绕过它直连 |
| `approval` / `userQuestions` | `request`、`ask` | 需要用户确认时 |
| `clientModules` | `graph`、`clientPath`、`fetchBundle` | Web 半边模块分发（一般不用碰） |

查更多：`cordis_inspect_query` → provider `Service`，不带 `service` 参数拿目录，带 `service: "<key>"` 拿精确签名。

**待验证**：service 的可用性依 profile 组合而定（例如 `webServer` 在非 Web profile 不存在）。设计时必须把目标 profile 说清楚，并在 README 标注。

---

## 4. Client 半边（client.js）

**已核实**（官方 `templates/decoration/client.js` + 两个本机已装插件）：

```js
window.__ModuleLoader__.load({
  id: 'dsh-xxx',            // 必须等于包名
  factory(require) {
    const React = require('react')   // 由浏览器模块表提供，禁止再装一份 React
    const h = React.createElement

    function apply(ctx) {
      // 注册 slot、样式、locale
    }
    return { apply }
  },
})
```

规则：

- 文件是**经典脚本**，恰好一次 `__ModuleLoader__.load` 调用。
- `require` 只解析平台提供的模块（`react` 等）；其他模块走 `dsh.client.external` 声明，且通常不该有。
- **不要** `require('@deepseek-ai/dsh-client-ui-primitives')` 或任何 Harness Client 包 —— 它们随版本变化且无类型检查，抛错会让整个 slot 条目空白（控制台：`slot entry crashed in '<slot>'`）。
- 不要在 `document.body` 追加第二个应用，不要替换 app root，不要读别的插件的 DOM/样式。
- 样式：优先组件内联样式 + 主题 token；全局样式用 `document.head` 里带 `data-plugin` 的 `<style>`，并在 cleanup 里 `remove()`。
- 文案走 Client locale：`ctx.locale.bind(NS)`、`ctx.locale.register(NS, { zh, en })`（本机插件做法，已核实可用）。
- `apply` 里所有注册都要能被卸载回收。

### slot 注册

**已核实**的真实写法（`settings.section`）：

```js
ctx.slots.inject('settings.section', () =>
  ctx.slots.register(
    { name: 'settings.section', id: 'dsh-xxx', order: 37, label: () => t('nav'), locale: NS },
    (props) => h(MyPage, { ...props, t }),
  ),
)
```

**已核实**的装饰型写法（`conversation.composer.dock`）：

```js
ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
  name: 'conversation.composer.dock', id: 'my-decoration', order: 5,
}, Decoration))
```

list slot 的注册参数：`id`（必填）、`order`、`label`（可选）。keyed slot 用 `key`（必填）。single slot 无注册参数，直接注册组件。

### 已核实的 slot 落点（2026-10-23 快照，**每次仍要现场复核**）

| 需求 | slot | kind |
|---|---|---|
| 侧边栏图标入口 | `sidebar.panellist` | list |
| 侧边栏底部动作 | `sidebar.footer.action` | list |
| 会话行右键菜单项 | `sidebar.workspaces.session.menu.item` | list |
| 设置整页 | `settings.section` | list |
| 设置里单行偏好 | `settings.general.item` | list |
| 插件设置分页 | `settings.plugins.tab` | list |
| 输入框下方常驻入口 | `conversation.composer.dock` | list |
| 输入框上方整宽条 | `conversation.input.dock` | list |
| 输入框工具行左右 | `conversation.input.left` / `.right` | list |
| 消息下方的操作 | `conversation.chat.assistant-actions` | list |
| 整帧浮层 | `shell.overlay` | list |
| 新增聊天行类型 | `conversation.chat.node` | keyed（需配 `ctx.uiConversation.events.register()`） |

查法：`cordis_inspect_query` → platform `client`、provider `Slots`、method `listSubTree`；不带 `root` 拿全树，带 `root: "<slot 名>"` 拿该 slot 的 catalog 与占用者。

**待验证**：slot 的 props 形状随所属插件版本变化。写组件前用 `root=<slot>` 看一次，或用防御式 `props?.xxx`。

---

## 5. 主题与视觉

**已核实**（`Theme.listTokens`）：主题以 CSS 变量形式提供，全部要求同时适配明暗两套：

```text
--dsw-alias-bg-base / -bg-layer-1 / -bg-layer-2 / -bg-overlay
--dsw-alias-border-l1 / -l2
--dsw-alias-brand-primary
--dsw-alias-label-primary / -label-secondary
--dsw-alias-state-error-primary / -success-primary / -warn-primary / -idle-primary
--dsw-specific-sidebar-fill
```

用法：`style={{ color: 'var(--dsw-alias-label-primary)' }}`。**不要写死颜色**（图标等纯装饰性 artwork 除外）。

**待验证**：token 集合是"当前主题"的子集；换主题插件后可能不同。开工时重新 `Theme.listTokens`。

---

## 6. 显示元数据（插件管理器/设置里显示什么）

**已核实**（host-plugin.md）：插件管理器与设置页在不激活插件的情况下读取：

- `locale/<lang>.json` 的 `meta.title` 与 `meta.description`
- `exports["./icon"]` 或 `exports["./locale/*.json"]`

```json
{ "meta": { "title": "会话导出", "description": "把选中的会话导出为 Markdown 或 JSON。" } }
```

规则：

- 中英文都要写，不能留模板文案。
- 图标：SVG/PNG/JPEG/WebP，≤ 256 KiB，必须在包内，绝对路径 / URL / 出包符号链接会被拒。
- 缺字段会回退到 `package.json` 的 `name` / `description`；缺图用默认图。交付时不要靠回退遮掩。
- 本地目录安装是链接目录，`files` 不过滤 —— 检查真实目录里到底有什么。

---

## 7. 安装与卸载（**只在用户明确要求时执行**）

**已核实**：

```text
dsh plugin --profile <name> add <spec>      # 转发给 pnpm，spec 可为 github:user/repo、本地目录、npm 包
dsh plugin --profile <name> remove <name>
dsh --profile <name> --dump-config          # 看组合后的配置
```

- 安装器（`plugin_manager install_bundle`）会做包安装 + bundle 选择；**不要用 shell 复现这些步骤**。
- 本地目录安装是**链接安装**：移动/删除源目录插件即失效，写进 README。
- 安装/替换已装包通常需要重启才加载新的 JS 模块代；单纯新增 bundle 可能走 HMR 立即激活。
- 判断是否生效看安装返回的 `application` / `warnings`，不看日志、进程表或页面 boot 数据。
- 卸载：插件页停用并卸载，重启 DSH，刷新页面。文档里要写"残留什么、怎么清"。

**待验证**：不同版本 `install_bundle` 返回字段的细节、HMR 对 Client 半边的具体生效时机。

---

## 8. 测试可行性边界

**已核实**：

- `node --check <file>` 可用于语法检查（ESM/CJS 都行；本机 Node v24.17.0）。
- 浏览器半边可以在 `node:vm` 里跑：注入 `window.__ModuleLoader__.load` 桩、`document` 桩、`require('react')` 桩 —— 本机 `dsh-chat-beautify/test/client.test.mjs` 已验证该做法可行（16 项测试）。
- `node --test test` 在某些受限沙箱会因 `spawn EPERM` 失败；此时**直接 `node test/xxx.test.mjs`**。

**不可在无 GUI 环境验证**：slot 是否真的渲染、主题下的实际观感、权限弹窗、安装后启动行为。这些一律标「尚未验证」，写清用户在真机上怎么确认。

---

## 9. 待验证清单（交付时必须如实列出）

开工时逐条确认，仍无法确认的写进 README「已知限制」：

- [ ] 目标 profile 是否存在、是否含本插件依赖的 service（如 `webServer`）
- [ ] 选用的 slot 在当前版本仍存在且 kind 未变
- [ ] 主题 token 是否仍存在
- [ ] `engines.dsh` 声明是否与实际环境相容
- [ ] Client 半边在目标 DSH 版本上的加载方式（`__ModuleLoader__` 契约）是否变化
- [ ] 插件卸载后是否真的无残留（需真机）
