#!/usr/bin/env node
/**
 * self-check.mjs — 验证 plugin-builder Skill 自身是否完整、可用。
 *
 * 用法：
 *   node scripts/self-check.mjs
 *
 * 检查：
 *   1. 必需文件全部存在且非空
 *   2. SKILL.md 的 frontmatter 合法（name / description）
 *   3. SKILL.md 的 description 不含换行、长度合理
 *   4. 每个 references/、templates/ 文件都被 SKILL.md 引用（避免出现死文件）
 *   5. SKILL.md 里提到的相对路径都真实存在（避免死链）
 *   6. 关键规则确实写进了 SKILL.md（命名、布局、审计、禁止自动安装…）
 *   7. 脚本可被 import、模板通过自身检查器
 *
 * 退出码：0 全部通过；1 有失败项。
 */

import { readFile, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkProject } from './check-project.mjs'
import { scanDirectory } from './audit-scan.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const skillRoot = join(here, '..')

const results = []
const pass = (name, detail = '') => results.push({ name, status: 'pass', detail })
const fail = (name, detail = '') => results.push({ name, status: 'fail', detail })

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 1. 必需文件
 * ------------------------------------------------------------------ */

const REQUIRED = [
  'SKILL.md',
  'references/requirements.md',
  'references/ui-design.md',
  'references/security-audit.md',
  'references/github-release.md',
  'references/dsh-plugin-api.md',
  'references/scenarios.md',
  'templates/README-template.md',
  'templates/audit-report-template.md',
  'templates/project-structure.md',
  'templates/bundle-skeleton/package.json',
  'templates/bundle-skeleton/cordis.patch.yml',
  'templates/bundle-skeleton/index.js',
  'templates/bundle-skeleton/client.js',
  'templates/bundle-skeleton/locale/en.json',
  'templates/bundle-skeleton/locale/zh.json',
  'templates/bundle-skeleton/icon.svg',
  'scripts/audit-scan.mjs',
  'scripts/check-project.mjs',
  'scripts/audit-scan.test.mjs',
  'scripts/check-project.test.mjs',
  'scripts/self-check.mjs',
]

for (const rel of REQUIRED) {
  const path = join(skillRoot, rel)
  if (!(await exists(path))) {
    fail(`必需文件：${rel}`, '不存在')
    continue
  }
  const info = await stat(path)
  if (info.size === 0) {
    fail(`必需文件：${rel}`, '为空')
    continue
  }
  pass(`必需文件：${rel}`, `${info.size} bytes`)
}

/* ------------------------------------------------------------------ *
 * 2. frontmatter
 * ------------------------------------------------------------------ */

let skillText = ''
try {
  skillText = await readFile(join(skillRoot, 'SKILL.md'), 'utf8')
} catch (error) {
  fail('读取 SKILL.md', error.message)
}

const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(skillText)
if (frontmatter === null) {
  fail('SKILL.md frontmatter', '缺少 --- 包裹的 YAML 头')
} else {
  const block = frontmatter[1]
  const nameMatch = /^name:\s*(.+)$/m.exec(block)
  const descMatch = /^description:\s*(.+)$/m.exec(block)

  if (nameMatch === null) fail('frontmatter.name', '缺失')
  else if (nameMatch[1].trim() !== 'plugin-builder') fail('frontmatter.name', `应为 plugin-builder，实际 ${nameMatch[1].trim()}`)
  else pass('frontmatter.name', 'plugin-builder')

  if (descMatch === null) {
    fail('frontmatter.description', '缺失')
  } else {
    const desc = descMatch[1].trim()
    if (desc.length < 40) fail('frontmatter.description', `过短（${desc.length} 字符），模型难以判断何时使用`)
    else if (desc.length > 1024) fail('frontmatter.description', `过长（${desc.length} 字符）`)
    else pass('frontmatter.description', `${desc.length} 字符`)
    if (!/DSH|插件/.test(desc)) fail('frontmatter.description 内容', '未说明适用于 DSH 插件任务')
    else pass('frontmatter.description 内容', '含 DSH/插件关键词')
  }
}

/* ------------------------------------------------------------------ *
 * 3. 关键规则必须写进 SKILL.md
 * ------------------------------------------------------------------ */

const REQUIRED_RULES = [
  ['命名规范 dsh- 前缀', /dsh-xxx-xxx|必须以 `dsh-` 开头/],
  ['未提供名称时给候选', /不得替用户决定最终名称|候选/],
  ['布局选项', /对话框[\s\S]{0,200}侧边栏[\s\S]{0,200}设置页|A 对话框/],
  ['代码审计', /代码审计/],
  ['隐私与脱敏', /脱敏/],
  ['禁止自动安装', /不安装|不得.*安装|默认不安装/],
  ['禁止自动上传/提交', /git commit/],
  ['测试结果四分类', /尚未验证/],
  ['交付报告格式', /插件信息/],
  ['待验证标注', /待验证/],
]

for (const [name, pattern] of REQUIRED_RULES) {
  if (pattern.test(skillText)) pass(`关键规则：${name}`)
  else fail(`关键规则：${name}`, 'SKILL.md 中未找到对应表述')
}

/* ------------------------------------------------------------------ *
 * 4. 引用完整性
 * ------------------------------------------------------------------ */

// 4a. 每个 reference/template 文件都应被 SKILL.md 提到
const RESOURCE_FILES = REQUIRED.filter((p) => p.startsWith('references/') || (p.startsWith('templates/') && !p.includes('bundle-skeleton/')))
for (const rel of RESOURCE_FILES) {
  if (skillText.includes(rel)) pass(`SKILL.md 引用：${rel}`)
  else fail(`SKILL.md 引用：${rel}`, '文件存在但 SKILL.md 未提及，运行时不会读到')
}

// 4b. SKILL.md 里出现的 references/ 或 templates/ 相对路径都应真实存在
const mentioned = new Set()
for (const match of skillText.matchAll(/(?:references|templates)\/[A-Za-z0-9._/-]+/g)) {
  mentioned.add(match[0].replace(/[.),。；、]+$/, ''))
}
for (const rel of mentioned) {
  if (await exists(join(skillRoot, rel))) pass(`路径存在：${rel}`)
  else fail(`路径存在：${rel}`, 'SKILL.md 提到但文件不存在（死链）')
}

/* ------------------------------------------------------------------ *
 * 5. 模板与脚本自检
 * ------------------------------------------------------------------ */

try {
  const { checks } = await checkProject(join(skillRoot, 'templates', 'bundle-skeleton'))
  const failures = checks.filter((c) => c.status === 'fail')
  if (failures.length === 0) pass('bundle-skeleton 通过 check-project')
  else fail('bundle-skeleton 通过 check-project', failures.map((c) => `${c.name}: ${c.detail}`).join('; '))
} catch (error) {
  fail('bundle-skeleton 通过 check-project', error.message)
}

try {
  const result = await scanDirectory(join(skillRoot, 'templates', 'bundle-skeleton'))
  if (result.counts.high === 0) pass('bundle-skeleton 无高危项')
  else fail('bundle-skeleton 无高危项', `${result.counts.high} 项高危`)
} catch (error) {
  fail('bundle-skeleton 无高危项', error.message)
}

try {
  const result = await scanDirectory(skillRoot)
  // 本 Skill 自己的文档会示范占位符与规则文本，允许中危/提示，但不应有高危。
  if (result.counts.high === 0) pass('Skill 目录无高危项', `扫描 ${result.scanned} 个文件`)
  else fail('Skill 目录无高危项', result.findings.filter((f) => f.severity === 'high').map((f) => `${f.rule}@${f.file}`).join('; '))
} catch (error) {
  fail('Skill 目录无高危项', error.message)
}

// 脚本必须可 import（导出了预期符号）
try {
  const scanner = await import('./audit-scan.mjs')
  if (typeof scanner.scanDirectory === 'function') pass('audit-scan 导出 scanDirectory')
  else fail('audit-scan 导出 scanDirectory', '未导出')
} catch (error) {
  fail('audit-scan 导出 scanDirectory', error.message)
}

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */

const failures = results.filter((r) => r.status === 'fail')
console.log(`\nplugin-builder 自检：${relative(process.cwd(), skillRoot) || '.'}`)
console.log(`通过：${results.length - failures.length}    失败：${failures.length}\n`)

for (const result of results) {
  if (result.status === 'fail') console.log(`✘ ${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
}

if (failures.length === 0) {
  console.log('✔ 全部检查通过。')
} else {
  console.log(`\n${failures.length} 项失败，请修复后重跑。`)
}

process.exit(failures.length > 0 ? 1 : 0)
