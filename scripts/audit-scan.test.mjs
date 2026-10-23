/**
 * audit-scan.mjs 的行为测试。
 *
 * 直接导入扫描器的 scanDirectory()，在进程内跑——不 spawn 子进程，
 * 因此在禁止 spawn 的受限沙箱里也能用 `node audit-scan.test.mjs` 直接运行。
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { scanDirectory } from './audit-scan.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** 建一个临时插件目录，返回路径与清理函数。 */
async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'pb-scan-'))
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

const BASE = {
  'package.json': JSON.stringify({
    name: 'dsh-test-case',
    type: 'module',
    private: true,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    exports: { '.': './index.js' },
  }),
  'cordis.patch.yml': "- insert:\n    - id: dsh-test-case\n      name: 'dsh-test-case'\n      config: {}\n",
  'README.md': '# test\n',
  LICENSE: 'MIT\n',
  'locale/en.json': JSON.stringify({ meta: { title: 'T', description: 'D' } }),
  'locale/zh.json': JSON.stringify({ meta: { title: 'T', description: 'D' } }),
}

async function scan(files, options) {
  const { root, cleanup } = await fixture(files)
  try {
    return await scanDirectory(root, options)
  } finally {
    await cleanup()
  }
}

/** 便于断言：把 findings 压成 `rule@file` 字符串数组。 */
function rules(result) {
  return result.findings.map((f) => `${f.rule}@${f.file}`)
}

test('干净项目：无命中', async () => {
  const result = await scan({ ...BASE, 'index.js': 'export function apply() {}\n' })
  assert.equal(result.ok, true)
  assert.equal(result.counts.high, 0)
  assert.equal(result.counts.medium, 0)
  assert.equal(result.findings.length, 0)
  assert.equal(result.failed, false)
})

/**
 * 测试用的"假凭据"在运行时拼出来。
 *
 * 目的有二：
 *   1. 避免本文件自身被本 Skill 的扫描器报成真实泄露（skill 目录必须无高危项）；
 *   2. 顺带证明扫描器匹配的是字面值，而不是这些源码行的上下文。
 */
const FAKE = {
  // 标记行必须保持在一行内（扫描器按行匹配），所以拼的是"空格"而不是换行。
  privateKey: ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ') + '\nMIIEow...\n' + ['-----END RSA', 'PRIVATE KEY-----'].join(' ') + '\n',
  skKey: ['sk', 'abcdefghijklmnopqrstuvwxyz012345'].join('-'),
  awsKey: ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
}

test('私钥块被判高危', async () => {
  const result = await scan({ ...BASE, 'key.pem': FAKE.privateKey })
  assert.equal(result.counts.high, 1)
  assert.match(result.findings[0].rule, /private-key/)
  assert.equal(result.failed, true)
})

test('sk- 前缀密钥被判高危', async () => {
  const result = await scan({ ...BASE, 'index.js': `const k = "${FAKE.skKey}"\n` })
  assert.ok(rules(result).includes('openai-style-key@index.js'))
  assert.equal(result.failed, true)
})

test('占位符与环境变量不被判高危', async () => {
  const result = await scan({
    ...BASE,
    'index.js': 'const k = "<YOUR_API_KEY>"\nconst t = process.env.API_TOKEN\nconst s = "your-secret-here"\n',
  })
  assert.equal(result.counts.high, 0)
})

test('Windows 绝对用户路径被识别为中危', async () => {
  const result = await scan({ ...BASE, 'index.js': 'const p = "C:\\\\Users\\\\someone\\\\project"\n' })
  assert.ok(rules(result).includes('absolute-win-user-path@index.js'))
  assert.equal(result.counts.high, 0)
})

test('POSIX 家目录路径被识别', async () => {
  const result = await scan({ ...BASE, 'index.js': 'const p = "/home/someone/project"\n' })
  assert.ok(rules(result).includes('absolute-posix-home@index.js'))
})

test('innerHTML 赋值被判中危（不被普通 HTML 标签误降级）', async () => {
  const result = await scan({ ...BASE, 'index.js': 'el.innerHTML = "<div>x</div>"\n' })
  assert.ok(rules(result).includes('html-injection@index.js'))
  assert.ok(result.counts.medium >= 1)
})

test('eval 被判中危', async () => {
  const result = await scan({ ...BASE, 'index.js': 'eval("1+1")\n' })
  assert.ok(rules(result).includes('dynamic-exec@index.js'))
})

test('Client 模块 id 与包名不一致被判高危', async () => {
  const result = await scan({
    ...BASE,
    'package.json': JSON.stringify({
      name: 'dsh-test-case',
      type: 'module',
      private: true,
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      exports: { '.': './index.js', './client': './client.js' },
    }),
    'client.js': "window.__ModuleLoader__.load({ id: 'other-name', factory() { return {} } })\n",
  })
  assert.equal(result.counts.high, 1)
  assert.match(result.findings[0].message, /不一致/)
})

test('Client id 与包名一致时不报错', async () => {
  const result = await scan({
    ...BASE,
    'package.json': JSON.stringify({
      name: 'dsh-test-case',
      type: 'module',
      private: true,
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      exports: { '.': './index.js', './client': './client.js' },
    }),
    'client.js': "window.__ModuleLoader__.load({ id: 'dsh-test-case', factory() { return {} } })\n",
  })
  assert.equal(result.counts.high, 0)
})

test('缺少 dsh.bundle.patch 被判中危', async () => {
  const result = await scan({ ...BASE, 'package.json': JSON.stringify({ name: 'dsh-test-case', type: 'module' }) })
  assert.match(result.findings.map((f) => f.message).join('\n'), /缺少 dsh\.bundle\.patch/)
})

test('不合规插件名被判中危', async () => {
  const result = await scan({
    ...BASE,
    'package.json': JSON.stringify({
      name: 'ChatBeautify',
      type: 'module',
      private: true,
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  })
  assert.ok(rules(result).includes('naming@package.json'))
})

test('损坏的 locale JSON 被判高危', async () => {
  const result = await scan({ ...BASE, 'locale/zh.json': '{ not json' })
  assert.ok(result.counts.high >= 1)
})

test('SVG 命名空间不被误报为明文 HTTP', async () => {
  const result = await scan({
    ...BASE,
    'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"></svg>\n',
  })
  assert.ok(!rules(result).some((r) => r.startsWith('insecure-url')))
})

test('--strict 让中危也算失败', async () => {
  const files = { ...BASE, 'index.js': 'el.innerHTML = "x"\n' }
  const normal = await scan(files)
  const strict = await scan(files, { strict: true })
  assert.equal(normal.failed, false)
  assert.equal(strict.failed, true)
})

test('目录不存在返回 ok:false', async () => {
  const result = await scanDirectory(join(tmpdir(), 'pb-definitely-missing-dir'))
  assert.equal(result.ok, false)
  assert.equal(result.error, 'missing')
})

test('node_modules 不被扫描', async () => {
  const result = await scan({
    ...BASE,
    'node_modules/evil/index.js': `const k = "${FAKE.skKey}"\n`,
  })
  assert.equal(result.counts.high, 0)
})

test('报告中的凭据片段被截断', async () => {
  const result = await scan({ ...BASE, 'index.js': `const k = "${FAKE.skKey}"\n` })
  const key = result.findings.find((f) => f.rule === 'openai-style-key')
  assert.ok(key !== undefined)
  assert.match(key.excerpt, /<redacted>/)
  assert.ok(!key.excerpt.includes('abcdefghijklmnopqrstuvwxyz012345'))
})

test('本 Skill 自带的 bundle-skeleton 不产生高危项', async () => {
  const result = await scanDirectory(join(here, '..', 'templates', 'bundle-skeleton'))
  assert.equal(result.ok, true)
  assert.equal(result.counts.high, 0)
})
