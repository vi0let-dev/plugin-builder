#!/usr/bin/env node
/**
 * audit-scan.mjs — plugin-builder 的静态隐私/安全检查器。
 *
 * 用法：
 *   node audit-scan.mjs <项目目录> [--json] [--strict]
 *
 * 退出码：
 *   0 = 无高危项
 *   1 = 存在高危项（--strict 时中危也算）
 *   2 = 参数错误 / 目录不存在
 *
 * 设计取向：宁可多报（提示级），不要把疑似凭据判为安全。
 * 这里是"筛查"，不是"证明"——命中要人工判断，未命中不代表安全。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, extname, sep, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ------------------------------------------------------------------ *
 * 扫描范围
 * ------------------------------------------------------------------ */

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cache',
  '__pycache__', '.venv', 'venv', 'out', '.turbo', '.pnpm-store',
])

const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'])

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx',
  '.json', '.yml', '.yaml', '.md', '.txt', '.sh', '.ps1', '.cmd', '.bat',
  '.html', '.css', '.svg', '.toml', '.ini', '.cfg', '.env', '',
  // 私钥/证书常见扩展名：必须被扫描，不能因为"不是源码"就跳过
  '.pem', '.key', '.crt', '.cer', '.p12', '.pfx', '.asc', '.gpg',
])

const MAX_BYTES = 2 * 1024 * 1024

/* ------------------------------------------------------------------ *
 * 规则
 * ------------------------------------------------------------------ */

/**
 * 明显是占位符的值：命中后降级为提示，不报高危。
 *
 * 刻意收紧：不能因为源码里出现一个普通 HTML 标签（如 `<div>`）就认为整行是占位符，
 * 否则 `innerHTML = "<div>x</div>"` 这类真实风险会被误降级。所以尖括号只认
 * `<YOUR_TOKEN>` 这种大写占位写法。
 */
const PLACEHOLDER = new RegExp(
  [
    'your[-_ ]?[a-z]*(?:key|token|secret|name|path|id)',
    '<[A-Z][A-Z0-9_]{2,40}>',
    '\\bxxxx+\\b',
    '\\bx{4,}\\b',
    '\\bplaceholder\\b',
    '\\bdummy\\b',
    '\\bfake\\b',
    '\\bredacted\\b',
    '\\bchangeme\\b',
    '\\bTODO\\b',
    '\\$\\{[^}]{1,60}\\}',
    'process\\.env',
    'import\\.meta\\.env',
    '\\bexample\\.(?:com|org|net)\\b',
  ].join('|'),
  'i',
)

/**
 * severity: 'high' | 'medium' | 'low'
 * test: 正则。扫描时重新构造，避免 lastIndex 串味。
 */
const RULES = [
  {
    id: 'private-key',
    severity: 'high',
    message: '疑似私钥/证书内容',
    test: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g,
  },
  {
    id: 'aws-key',
    severity: 'high',
    message: '疑似 AWS Access Key ID',
    test: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: 'github-token',
    severity: 'high',
    message: '疑似 GitHub Token',
    test: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  {
    id: 'slack-token',
    severity: 'high',
    message: '疑似 Slack Token',
    test: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: 'google-api-key',
    severity: 'high',
    message: '疑似 Google API Key',
    test: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: 'openai-style-key',
    severity: 'high',
    message: '疑似模型服务 API Key（sk- 前缀）',
    test: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'bearer-literal',
    severity: 'high',
    message: '硬编码 Bearer Token',
    test: /Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
  },
  {
    id: 'secret-assignment',
    severity: 'medium',
    message: '疑似硬编码密钥赋值',
    test: /\b(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|client[_-]?secret|access[_-]?key|private[_-]?key)\b\s*[:=]\s*['"`]([^'"`\n]{16,})['"`]/gi,
    capturePlaceholderIndex: 1,
  },
  {
    id: 'jwt',
    severity: 'medium',
    message: '疑似 JWT',
    test: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: 'absolute-win-user-path',
    severity: 'medium',
    message: '本地绝对路径（含用户名）',
    // JS 字符串里的路径是 `C:\\Users\\name`，所以反斜杠可能成对出现。
    test: /\b[A-Za-z]:\\{1,2}Users\\{1,2}[^\\\s'"]+/g,
  },
  {
    id: 'absolute-posix-home',
    severity: 'medium',
    message: '本地绝对路径（含用户名）',
    test: /(?:\/home\/|\/Users\/)[A-Za-z0-9._-]+/g,
  },
  {
    id: 'dynamic-exec',
    severity: 'medium',
    message: '动态代码执行',
    test: /\b(?:eval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"`])/g,
  },
  {
    id: 'html-injection',
    severity: 'medium',
    message: 'HTML 注入风险（innerHTML / outerHTML / document.write）',
    test: /\.(?:innerHTML|outerHTML)\s*=|document\.write\s*\(/g,
  },
  {
    id: 'shell-concat',
    severity: 'low',
    message: '疑似 shell 命令拼接，确认没有注入面',
    test: /\b(?:exec|execSync|spawnSync|execFile)\s*\(\s*[`'"][^`'"]*(?:\$\{|\+\s*[A-Za-z_$])/g,
  },
  {
    id: 'non-loopback-fetch',
    severity: 'low',
    message: '出网调用，确认为必需且已写入隐私说明',
    test: /\b(?:fetch|axios(?:\.\w+)?|https?\.request|https?\.get)\s*\(\s*[`'"]https?:\/\/(?!127\.0\.0\.1|localhost|\[::1\])[^`'"\s]+/g,
  },
  {
    id: 'insecure-url',
    severity: 'low',
    message: '明文 HTTP 地址',
    // 排除 XML 命名空间标识符：它们是标识符而不是可请求的地址。
    test: /['"`]http:\/\/(?!127\.0\.0\.1|localhost|\[::1\]|www\.w3\.org\/|ns\.adobe\.com\/)[^'"`\s]+/g,
  },
  {
    id: 'console-of-payload',
    severity: 'low',
    message: '日志可能打印了数据体，确认不含用户内容',
    test: /console\.(?:log|info|debug)\s*\(\s*(?:JSON\.stringify\s*\(\s*)?(?:body|content|text|messages?|events?|data|payload|req|res)\b/g,
  },
  {
    id: 'ts-ignore',
    severity: 'low',
    message: '类型检查被绕过，确认无误',
    test: /@ts-(?:ignore|nocheck)|eslint-disable(?:-next-line)?\b/g,
  },
]

/* ------------------------------------------------------------------ *
 * 文件遍历
 * ------------------------------------------------------------------ */

async function* walk(dir, root) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      yield* walk(full, root)
      continue
    }
    if (!entry.isFile()) continue
    if (SKIP_FILES.has(entry.name)) continue
    if (entry.name.startsWith('.env') && entry.name !== '.env.example') {
      // .env 本身可能是真实凭据，作为高危目标而不是跳过
      yield { full, rel: relative(root, full) }
      continue
    }
    const ext = extname(entry.name).toLowerCase()
    if (!TEXT_EXT.has(ext)) continue
    try {
      const info = await stat(full)
      if (info.size > MAX_BYTES) continue
    } catch {
      continue
    }
    yield { full, rel: relative(root, full) }
  }
}

/* ------------------------------------------------------------------ *
 * 扫描
 * ------------------------------------------------------------------ */

function normalize(p) {
  return p.split(sep).join('/')
}

/**
 * 占位符判定只检查命中片段本身（有捕获组时检查捕获组），
 * 不看整行——否则同一行里一个无关的 `${}` 就能把真实密钥降级。
 */
function looksPlaceholder(match, capturePlaceholderIndex) {
  const captured = capturePlaceholderIndex !== undefined ? match[capturePlaceholderIndex] : undefined
  const scope = captured !== undefined && captured !== null ? captured : match[0]
  return PLACEHOLDER.test(scope)
}

function scanText(relPath, text) {
  const findings = []
  const lines = text.split(/\r?\n/)

  for (const rule of RULES) {
    const re = new RegExp(rule.test.source, rule.test.flags)
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.length > 4000) continue
      re.lastIndex = 0
      let match
      while ((match = re.exec(line)) !== null) {
        if (match[0].length === 0) {
          re.lastIndex += 1
          continue
        }
        const severity = looksPlaceholder(match, rule.capturePlaceholderIndex) ? 'low' : rule.severity
        findings.push({
          rule: rule.id,
          severity,
          message: rule.message,
          file: relPath,
          line: i + 1,
          excerpt: redact(match[0]),
        })
      }
    }
  }
  return findings
}

/** 报告里不回显完整凭据。 */
function redact(value) {
  const trimmed = value.trim()
  if (trimmed.length <= 12) return trimmed
  return `${trimmed.slice(0, 8)}…<redacted>`
}

/* ------------------------------------------------------------------ *
 * 结构检查（与隐私无直接关系，但属于交付前必查）
 * ------------------------------------------------------------------ */

function pushNote(notes, rule, severity, message, file, line = 0) {
  notes.push({ rule, severity, message, file, line, excerpt: '' })
}

async function structureChecks(root, byPath) {
  const notes = []

  const pkgRaw = byPath.get('package.json')
  if (pkgRaw === undefined) {
    pushNote(notes, 'structure', 'medium', '缺少 package.json，不是有效 bundle', 'package.json')
    return notes
  }

  let pkg
  try {
    pkg = JSON.parse(pkgRaw)
  } catch (error) {
    pushNote(notes, 'structure', 'high', `package.json 无法解析：${error.message}`, 'package.json')
    return notes
  }

  if (!pkg?.dsh?.bundle?.patch) {
    pushNote(notes, 'structure', 'medium', 'package.json 缺少 dsh.bundle.patch，DSH 不会把它当 bundle', 'package.json')
  }
  if (pkg?.type !== 'module') {
    pushNote(notes, 'structure', 'low', 'package.json 未声明 "type": "module"', 'package.json')
  }
  if (pkg?.private !== true) {
    pushNote(notes, 'structure', 'low', 'package.json 未标记 "private": true（发布到 npm 前请确认有意为之）', 'package.json')
  }

  const name = typeof pkg?.name === 'string' ? pkg.name : ''
  if (!/^dsh-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    pushNote(notes, 'naming', 'medium', `插件名 "${name}" 不符合 dsh-xxx-xxx 规范`, 'package.json')
  }

  const patchPath = pkg?.dsh?.bundle?.patch
  if (typeof patchPath === 'string') {
    const normalized = normalize(patchPath).replace(/^\.\//, '')
    const patch = byPath.get(normalized)
    if (patch === undefined) {
      pushNote(notes, 'structure', 'high', `dsh.bundle.patch 指向不存在的文件 ${patchPath}`, 'package.json')
    } else if (typeof name === 'string' && name !== '' && !patch.includes(name)) {
      pushNote(notes, 'structure', 'medium', `patch 文件里没有出现包名 ${name}，行 name 与包名可能不一致`, normalized)
    }
  }

  const clientEntry = pkg?.exports?.['./client']
  if (typeof clientEntry === 'string') {
    const normalized = normalize(clientEntry).replace(/^\.\//, '')
    const source = byPath.get(normalized)
    if (source === undefined) {
      pushNote(notes, 'structure', 'high', `exports["./client"] 指向不存在的文件 ${clientEntry}`, 'package.json')
    } else {
      const idMatch = /__ModuleLoader__\s*\.\s*load\s*\(\s*\{[^}]*?id\s*:\s*['"`]([^'"`]+)['"`]/.exec(source)
      if (idMatch === null) {
        pushNote(notes, 'structure', 'medium', 'client 文件里找不到 __ModuleLoader__.load({ id }) 注册', normalized, 1)
      } else if (idMatch[1] !== name) {
        pushNote(notes, 'structure', 'high', `Client 模块 id "${idMatch[1]}" 与包名 "${name}" 不一致`, normalized, 1)
      }
    }
  }

  for (const locale of ['locale/en.json', 'locale/zh.json']) {
    const raw = byPath.get(locale)
    if (raw === undefined) {
      pushNote(notes, 'structure', 'low', `缺少 ${locale}，插件管理器只能回退到 package.json 文案`, locale)
      continue
    }
    try {
      const parsed = JSON.parse(raw)
      if (!parsed?.meta?.title || !parsed?.meta?.description) {
        pushNote(notes, 'structure', 'low', `${locale} 缺少 meta.title 或 meta.description`, locale)
      }
    } catch (error) {
      pushNote(notes, 'structure', 'high', `${locale} 不是合法 JSON：${error.message}`, locale)
    }
  }

  if (!byPath.has('README.md')) {
    pushNote(notes, 'structure', 'low', '缺少 README.md', 'README.md')
  }
  if (!byPath.has('LICENSE')) {
    pushNote(notes, 'structure', 'low', '缺少 LICENSE，发布前需补齐', 'LICENSE')
  }

  return notes
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { target: '.', json: false, strict: false }
  for (const token of argv) {
    if (token === '--json') args.json = true
    else if (token === '--strict') args.strict = true
    else if (token.startsWith('-')) throw new Error(`未知参数 ${token}`)
    else args.target = token
  }
  return args
}

/**
 * 对外可导入的核心扫描入口：返回结构化结果，不打印、不退出。
 * CLI 用 main() 包一层；测试直接调用这个函数，避免 spawn 子进程。
 */
export async function scanDirectory(root, { strict = false } = {}) {
  let info
  try {
    info = await stat(root)
  } catch {
    return { ok: false, error: 'missing', root, scanned: 0, counts: { high: 0, medium: 0, low: 0 }, findings: [] }
  }
  if (!info.isDirectory()) {
    return { ok: false, error: 'not-a-directory', root, scanned: 0, counts: { high: 0, medium: 0, low: 0 }, findings: [] }
  }

  const findings = []
  const byPath = new Map()
  let scanned = 0

  for await (const { full, rel } of walk(root, root)) {
    let text
    try {
      text = await readFile(full, 'utf8')
    } catch {
      continue
    }
    scanned += 1
    const normalized = normalize(rel)
    byPath.set(normalized, text)
    findings.push(...scanText(normalized, text))
  }

  findings.push(...(await structureChecks(root, byPath)))

  const order = { high: 0, medium: 1, low: 2 }
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line,
  )

  const counts = { high: 0, medium: 0, low: 0 }
  for (const finding of findings) counts[finding.severity] += 1

  return {
    ok: true,
    root,
    scanned,
    counts,
    findings,
    failed: counts.high > 0 || (strict && counts.medium > 0),
  }
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
  const result = await scanDirectory(root, { strict: args.strict })
  if (!result.ok) {
    console.error(result.error === 'not-a-directory' ? `不是目录：${root}` : `目录不存在：${root}`)
    return 2
  }

  const { scanned, counts, findings } = result

  if (args.json) {
    console.log(JSON.stringify({ root, scanned, counts, findings }, null, 2))
  } else {
    const label = { high: '高危', medium: '中危', low: '提示' }
    console.log(`\n审计扫描：${root}`)
    console.log(`扫描文件：${scanned}`)
    console.log(`高危：${counts.high}    中危：${counts.medium}    提示：${counts.low}\n`)

    if (findings.length === 0) {
      console.log('未发现匹配项。注意：扫描通过不等于安全，仍需人工审计。')
    }

    let lastSeverity = null
    for (const finding of findings) {
      if (finding.severity !== lastSeverity) {
        console.log(`── ${label[finding.severity]} ──`)
        lastSeverity = finding.severity
      }
      const where = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file
      console.log(`  [${finding.rule}] ${where}`)
      console.log(`    ${finding.message}`)
      if (finding.excerpt) console.log(`    命中：${finding.excerpt}`)
    }

    console.log('\n提醒：高危项必须处理（删除/占位符/环境变量）后才能交付；')
    console.log('      提示项需人工判断是否可接受，并写入审计报告。')
  }

  const failed = result.failed
  return failed ? 1 : 0
}

/** 只在作为 CLI 直接运行时执行；被 import 时只导出 scanDirectory。 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`扫描失败：${error?.stack ?? error}`)
      process.exit(2)
    },
  )
}
