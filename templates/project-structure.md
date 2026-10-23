# 项目结构参考

配套 `SKILL.md` 阶段 5–6。按复杂度选结构，**不要为了"专业"把三个文件的插件拆成十个**。

---

## 1. 极简：纯 Host 工具插件（4 个文件）

适用：只注册一个工具 / 只加提示词 / 只接一个服务，没有任何界面。

```text
dsh-xxx/
├── package.json
├── cordis.patch.yml
├── index.js
├── README.md
└── locale/{en,zh}.json   # 仍需显示元数据
```

`index.js`：

```js
export const inject = ['tools']

export function apply(ctx, config) {
  ctx.effect(() => ctx.tools.register({
    name: 'xxx',
    description: '...',
    parameters: { /* JSON Schema */ },
    async execute(args) { /* ... */ },
  }), 'dsh-xxx: tool')
}
```

> 工具 schema 的形状必须用 `cordis_inspect_query`（host `Tool`）或官方文档确认后再写。

---

## 2. 标准：单区域 UI 插件（7–9 个文件）

适用：一个设置页、或一个侧边栏入口、或一个输入框下的切换器。

```text
dsh-xxx/
├── package.json          # dsh.bundle.patch + dsh.client
├── cordis.patch.yml
├── index.js              # Host：可以只有 export function apply() {}
├── client.js             # Web：ModuleLoader + slot 注册 + 组件
├── locale/en.json
├── locale/zh.json
├── icon.svg
├── test/client.test.mjs
├── README.md
└── LICENSE / .gitignore / .gitattributes
```

约定：

- `client.js` 单文件时，内部按 **常量 → 纯函数 → 组件 → apply** 分段，段间空行 + 注释分隔。
- 纯函数（格式化、校验、归一化）留在文件顶部并导出到 `__test`，方便测试。
- 超过 ~600 行再拆文件。

---

## 3. 复杂：Host + Client + 多模块（按需）

适用：既有 Host 逻辑（读数据、出路由）又有完整界面，或界面含多个视图。

```text
dsh-xxx/
├── package.json
├── cordis.patch.yml
├── index.js                  # Host 入口：装配
├── lib/
│   ├── service.js            # 业务逻辑
│   ├── routes.js             # HTTP 路由（需要 webServer 时）
│   └── format.js             # 纯函数：渲染/序列化
├── client.js                 # Client 入口：ModuleLoader + apply
├── ui/
│   ├── page.js               # 主视图
│   ├── components.js         # 复用控件
│   └── styles.js             # CSS 字符串（用 token）
├── locale/{en,zh}.json
├── icon.svg
├── test/
│   ├── format.test.mjs       # 纯函数测试
│   └── client.test.mjs       # vm 里的注册/行为测试
├── docs/
│   └── example.config.yml
├── README.md
├── AUDIT.md
└── LICENSE / .gitignore / .gitattributes
```

注意：浏览器半边是**经典脚本**，不能直接 `import './ui/page.js'`。两种做法：

- 把 UI 全部放在 `client.js` 里（简单可靠）；
- 或者用构建工具产出单文件 —— 那就要引入构建步骤，**先问用户是否接受**。

> 没有构建步骤时，`ui/*.js` 只能是供测试复用的纯函数模块，不能作为 Client 运行时依赖。这一点必须在架构设计阶段说清，避免"写完发现加载不了"。

---

## 4. 各文件职责与硬性要求

| 文件 | 必须 | 禁止 |
|---|---|---|
| `package.json` | `name`=`dsh-xxx`；`type: module`；`exports` 覆盖入口；`dsh.bundle.patch` | 写死依赖版本到本地路径 |
| `cordis.patch.yml` | `- insert:` 一行；`id`/`name`/`config` | 手写 profile 级配置 |
| `index.js` | `export function apply(ctx, config)`；注册走 `ctx.effect`/`ctx.on` | 顶层副作用、顶层读文件 |
| `client.js` | 恰好一次 `__ModuleLoader__.load`；`id`=包名 | 第二个 React、`document.body` 追加、读别的插件 DOM |
| `locale/*.json` | `meta.title`、`meta.description` | 留模板文案 |
| `icon.svg` | 原创或有许可；<256 KiB | 官方 logo、外链图片 |
| `test/*.mjs` | 可 `node xxx.mjs` 直接跑 | 依赖真机 GUI |
| `README.md` | 功能/安装/配置/隐私/限制 | 描述不存在的功能 |
| `AUDIT.md` | 结论 + 问题 + 处理 | 留空结论 |

---

## 5. 命名约定

| 对象 | 规则 | 例 |
|---|---|---|
| 包名 / 插件名 | `dsh-` + 小写 + 连字符 | `dsh-session-export` |
| patch 行 `id` | 与包名一致（最省心） | `dsh-session-export` |
| patch 行 `name` | 与包名一致 | `dsh-session-export` |
| Client `ModuleLoader.id` | 与包名一致 | `dsh-session-export` |
| CSS 类前缀 | 包名缩写，短 | `.dse-*` |
| localStorage 键 | 包名 + 冒号 + 字段 | `dsh-session-export:format` |
| 路由前缀 | `/api/<包名>` | `/api/dsh-session-export` |
| 测试文件 | `<被测文件>.test.mjs` | `client.test.mjs` |

四处改名要一起改：`package.json` name、patch `name`、Client `id`、README 标题。

---

## 6. 生成顺序

1. `package.json`（先定名与入口）
2. `cordis.patch.yml`
3. `index.js`（先跑通空实现）
4. `client.js`（先跑通 slot 注册，再填 UI）
5. `locale/` + `icon.svg`
6. `test/`
7. `README.md`
8. `AUDIT.md`（审计后）
9. `LICENSE`、`.gitignore`、`.gitattributes`

先让"空插件"结构成立，再填功能——能避免大量文件写完后才发现入口没接通。
