#!/usr/bin/env node
/**
 * check-project.mjs — 插件项目结构与语法自检。
 *
 * 用法：
 *   node check-project.mjs <项目目录> [--json]
 *
 * 退出码：
 *   0 = 全部通过（可能有提示）
 *   1 = 存在失败项
 *   2 = 参数错误 / 目录不存在
 *
 * 它做的是"能自动做的那部分验证"：结构、配置、入口、语法、JSON、locale、图标。
 * 它不验证 slot 是否渲染、主题观感、安装后行为 —— 那些必须真机确认，
 * 不要因为本脚本通过就宣称"功能已验证"。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICON_MAX_BYTES = 256 * 1024
const ICON_TYPES = new Map([
  ['.svg', 'svg'],
  ['.png', 'png'],
  ['.jpg', 'jpeg'],
  ['.jpeg', 'jpeg'],
  ['.webp', 'webp'],
])

const PACKAGE_NAME = /^dsh-[a-z0-9]+(?:-[a-z0-9]+)*$/

async function readJson(path) {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw)
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * 去掉注释与字符串字面量，避免"注释里提到 api"被当成真实调用。
 * 只用于结构检查，不追求完整词法分析。
 */
function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, ' ')
}

/**
 * 语法检查。
 *
 * 优先用 vm.SourceTextModule 做真正的 ESM 语法校验；它在很多受限环境里
 * 需要 --experimental-vm-modules 才存在，此时退化为两种方式：
 *   - 文件含 import/export：用 Function 无法校验，返回 'unverified'，由调用方提示用户
 *     自己跑 `node --check <file>`；
 *   - 纯脚本：用 Function 构造器检查。
 *
 * 关键点：不能把"没有校验能力"报成"语法错误"。
 */
async function checkSyntax(source, filename) {
  const vm = await import('node:vm')
  if (typeof vm.SourceTextModule === 'function') {
    try {
      new vm.SourceTextModule(source, { identifier: filename })
      return { status: 'pass' }
    } catch (error) {
      return { status: 'fail', message: error.message }
    }
  }

  const hasModuleSyntax = /^\s*(?:import|export)\b/m.test(source)
  if (hasModuleSyntax) return { status: 'unverified' }

  try {
    // eslint-disable-next-line no-new-func
    new Function(source)
    return { status: 'pass', degraded: true }
  } catch (error) {
    return { status: 'fail', message: error.message, degraded: true }
  }
}

/* ------------------------------------------------------------------ *
 * 主检查
 * ------------------------------------------------------------------ */

/**
 * @returns {{ checks: Array<{name: string, status: 'pass'|'fail'|'warn', detail: string}> }}
 */
export async function checkProject(root) {
  const checks = []
  const add = (name, status, detail) => checks.push({ name, status, detail })

  /* ---------------- package.json ---------------- */

  const pkgPath = join(root, 'package.json')
  let pkg
  try {
    pkg = await readJson(pkgPath)
    add('package.json 可解析', 'pass', '')
  } catch (error) {
    add('package.json 可解析', 'fail', error.message)
    return { checks }
  }

  const name = typeof pkg.name === 'string' ? pkg.name : ''
  if (PACKAGE_NAME.test(name)) {
    add('插件命名规范', 'pass', name)
  } else {
    add('插件命名规范', 'fail', `"${name}" 不匹配 dsh-xxx-xxx`)
  }

  add(
    'type: module',
    pkg.type === 'module' ? 'pass' : 'fail',
    pkg.type === 'module' ? '' : '缺少 "type": "module"，ESM 入口无法加载',
  )

  /* ---------------- patch ---------------- */

  const patchRel = pkg?.dsh?.bundle?.patch
  let patchText = ''
  if (typeof patchRel !== 'string' || patchRel === '') {
    add('dsh.bundle.patch 声明', 'fail', 'package.json 未声明 dsh.bundle.patch')
  } else {
    const patchPath = join(root, patchRel.replace(/^\.\//, ''))
    if (await exists(patchPath)) {
      patchText = await readFile(patchPath, 'utf8')
      add('dsh.bundle.patch 指向的文件存在', 'pass', patchRel)
      const hasInsert = /^\s*-\s*insert\s*:/m.test(patchText)
      add('patch 含 insert 条目', hasInsert ? 'pass' : 'fail', hasInsert ? '' : '缺少 "- insert:"')
      const nameMentioned = name !== '' && patchText.includes(name)
      add('patch 中行 name 与包名一致', nameMentioned ? 'pass' : 'fail', nameMentioned ? '' : `patch 里没有出现 ${name}`)
      // 缩进：insert 下的条目应该是 4 空格（含 "- insert:" 下的 4 空格）
      const badIndent = patchText
        .split(/\r?\n/)
        .filter((line) => /^\s*-\s+id\s*:/.test(line) && !/^ {4}- id:/.test(line))
      add('patch 缩进', badIndent.length === 0 ? 'pass' : 'warn', badIndent.length === 0 ? '' : '行 id 缩进不是 4 空格，请核对 YAML 层级')
    } else {
      add('dsh.bundle.patch 指向的文件存在', 'fail', `找不到 ${patchRel}`)
    }
  }

  /* ---------------- 入口文件 ---------------- */

  const mainRel = typeof pkg.exports?.['.'] === 'string' ? pkg.exports['.'] : pkg.main
  if (typeof mainRel === 'string') {
    const mainPath = join(root, mainRel.replace(/^\.\//, ''))
    if (await exists(mainPath)) {
      add('Host 入口存在', 'pass', mainRel)
      const source = await readFile(mainPath, 'utf8')
      const exportsApply = /export\s+(?:async\s+)?function\s+apply\s*\(/.test(source)
      const exportsClass = /export\s+default\s+class\s+/.test(source)
      if (exportsApply && exportsClass) {
        add('Host 入口导出形式', 'fail', '同时存在 apply 函数与默认导出 class，二者不可混用')
      } else if (exportsApply || exportsClass) {
        add('Host 入口导出形式', 'pass', exportsApply ? 'apply 函数' : '默认导出 class')
      } else {
        add('Host 入口导出形式', 'fail', '既没有 export function apply 也没有 export default class')
      }
    } else {
      add('Host 入口存在', 'fail', `找不到 ${mainRel}`)
    }
  } else {
    add('Host 入口声明', 'warn', 'package.json 未声明 main / exports["."]（纯 Client 插件可忽略）')
  }

  /* ---------------- Client 半边 ---------------- */

  const clientRel = pkg.exports?.['./client']
  if (typeof clientRel === 'string') {
    const clientPath = join(root, clientRel.replace(/^\.\//, ''))
    if (await exists(clientPath)) {
      add('Client 入口存在', 'pass', clientRel)
      const source = await readFile(clientPath, 'utf8')
      const code = stripCommentsAndStrings(source)
      const occurrences = (code.match(/__ModuleLoader__\s*\.\s*load\s*\(/g) ?? []).length
      add(
        'Client 只注册一次模块',
        occurrences === 1 ? 'pass' : 'fail',
        occurrences === 1 ? '' : `发现 ${occurrences} 次 __ModuleLoader__.load 调用`,
      )
      const idMatch = /__ModuleLoader__\s*\.\s*load\s*\(\s*\{[^}]*?id\s*:\s*['"`]([^'"`]+)['"`]/.exec(source)
      if (idMatch === null) {
        add('Client 模块 id', 'fail', '未找到 id 字段')
      } else {
        add('Client 模块 id 与包名一致', idMatch[1] === name ? 'pass' : 'fail', idMatch[1] === name ? idMatch[1] : `${idMatch[1]} ≠ ${name}`)
      }
      if (/require\(\s*['"]@deepseek-ai\/dsh-client-/.test(code)) {
        add('未引用 Harness Client 包', 'fail', '不要 require @deepseek-ai/dsh-client-*，会随版本变化崩掉整个 slot')
      } else {
        add('未引用 Harness Client 包', 'pass', '')
      }
      if (/\bdocument\s*\.\s*body\s*\.\s*(?:append|appendChild|prepend)/.test(code)) {
        add('未向 document.body 追加节点', 'fail', '不要往 body 追加第二个应用')
      } else {
        add('未向 document.body 追加节点', 'pass', '')
      }
      const platform = pkg?.dsh?.client?.platform
      add('dsh.client.platform', platform === 'web' ? 'pass' : 'warn', platform === 'web' ? 'web' : `当前为 ${platform ?? '(未声明)'}`)
    } else {
      add('Client 入口存在', 'fail', `找不到 ${clientRel}`)
    }
  }

  /* ---------------- locale ---------------- */

  for (const lang of ['en', 'zh']) {
    const localePath = join(root, 'locale', `${lang}.json`)
    if (!(await exists(localePath))) {
      add(`locale/${lang}.json`, 'warn', '缺失，插件管理器会回退到 package.json 文案')
      continue
    }
    try {
      const data = await readJson(localePath)
      const ok = typeof data?.meta?.title === 'string' && typeof data?.meta?.description === 'string' && data.meta.title.trim() !== ''
      add(`locale/${lang}.json 元数据`, ok ? 'pass' : 'fail', ok ? '' : '缺少 meta.title 或 meta.description')
    } catch (error) {
      add(`locale/${lang}.json 可解析`, 'fail', error.message)
    }
  }

  /* ---------------- 图标 ---------------- */

  const iconRel = typeof pkg.icon === 'string' ? pkg.icon : (pkg.exports?.['./icon'] ?? null)
  if (typeof iconRel === 'string') {
    // 先判断路径形态：绝对路径/URL/越界符号链接无论如何都不合规，
    // 不管文件在作者机器上是否存在。
    const outsidePackage = /^[A-Za-z]:[\\/]|^\\\\|^https?:|^\/[^/]/.test(iconRel) || iconRel.split(/[\\/]/).includes('..')
    add(
      '图标路径为包内相对路径',
      outsidePackage ? 'fail' : 'pass',
      outsidePackage ? `${iconRel}（必须是包内相对路径）` : iconRel,
    )

    const iconPath = join(root, iconRel.replace(/^\.\//, ''))
    if (!(await exists(iconPath))) {
      add('图标文件存在', 'fail', `找不到 ${iconRel}`)
    } else {
      const info = await stat(iconPath)
      add('图标大小', info.size <= ICON_MAX_BYTES ? 'pass' : 'fail', `${info.size} bytes`)
      const type = ICON_TYPES.get(extname(iconPath).toLowerCase())
      add('图标格式', type === undefined ? 'fail' : 'pass', type ?? `${extname(iconPath)} 不被支持`)
    }
  } else {
    add('图标声明', 'warn', '未声明 icon / exports["./icon"]')
  }

  /* ---------------- 语法检查 ---------------- */

  const jsFiles = []
  async function collect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await collect(full)
        continue
      }
      if (['.js', '.mjs', '.cjs'].includes(extname(entry.name).toLowerCase())) jsFiles.push(full)
    }
  }
  await collect(root)

  let syntaxFailures = 0
  const unverified = []
  for (const file of jsFiles) {
    const source = await readFile(file, 'utf8')
    const result = await checkSyntax(source, file)
    if (result.status === 'fail') {
      syntaxFailures += 1
      add('语法检查', 'fail', `${file}: ${result.message}`)
    } else if (result.status === 'unverified') {
      unverified.push(relative(root, file))
    }
  }
  if (syntaxFailures === 0) {
    if (unverified.length === 0) {
      add('语法检查', 'pass', `${jsFiles.length} 个 JS 文件通过`)
    } else {
      add(
        '语法检查',
        'warn',
        `${jsFiles.length - unverified.length} 个文件通过；${unverified.length} 个 ESM 文件当前环境无法校验，` +
          `请自行运行 node --check：${unverified.join(', ')}`,
      )
    }
  }

  /* ---------------- 文档与发布面 ---------------- */

  add('README.md', (await exists(join(root, 'README.md'))) ? 'pass' : 'warn', (await exists(join(root, 'README.md'))) ? '' : '缺失')
  add('LICENSE', (await exists(join(root, 'LICENSE'))) ? 'pass' : 'warn', (await exists(join(root, 'LICENSE'))) ? '' : '发布前需补齐')
  add('.gitignore', (await exists(join(root, '.gitignore'))) ? 'pass' : 'warn', (await exists(join(root, '.gitignore'))) ? '' : '建议添加，避免提交 node_modules/.env')

  return { checks }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { target: '.', json: false }
  for (const token of argv) {
    if (token === '--json') args.json = true
    else if (token.startsWith('-')) throw new Error(`未知参数 ${token}`)
    else args.target = token
  }
  return args
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`参数错误：${error.message}`)
    return 2
  }

  const root = args.target
  try {
    const info = await stat(root)
    if (!info.isDirectory()) {
      console.error(`不是目录：${root}`)
      return 2
    }
  } catch {
    console.error(`目录不存在：${root}`)
    return 2
  }

  const { checks } = await checkProject(root)
  const counts = { pass: 0, fail: 0, warn: 0 }
  for (const check of checks) counts[check.status] += 1

  if (args.json) {
    console.log(JSON.stringify({ root, counts, checks }, null, 2))
  } else {
    const label = { pass: '通过', fail: '失败', warn: '提示' }
    console.log(`\n项目自检：${root}`)
    console.log(`通过：${counts.pass}    失败：${counts.fail}    提示：${counts.warn}\n`)
    for (const check of checks) {
      const mark = check.status === 'pass' ? '✔' : check.status === 'fail' ? '✘' : '!'
      console.log(`${mark} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
    }
    console.log('\n注意：本自检只覆盖结构、配置、入口、语法、JSON、locale 与图标。')
    console.log('      slot 是否渲染、主题观感、安装后行为仍需在真实 DSH 中验证。')
  }

  return counts.fail > 0 ? 1 : 0
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`自检失败：${error?.stack ?? error}`)
      process.exit(2)
    },
  )
}
