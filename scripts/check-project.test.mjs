/**
 * check-project.mjs 的行为测试。
 *
 * 进程内直接调用 checkProject()，不 spawn 子进程。
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { checkProject } from './check-project.mjs'

const here = dirname(fileURLToPath(import.meta.url))

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'pb-check-'))
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

function pkg(overrides = {}) {
  return JSON.stringify({
    name: 'dsh-test-case',
    type: 'module',
    private: true,
    icon: './icon.svg',
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', immediately: true } },
    exports: {
      '.': './index.js',
      './client': './client.js',
      './icon': './icon.svg',
    },
    ...overrides,
  })
}

const GOOD = {
  'package.json': pkg(),
  'cordis.patch.yml': "- insert:\n    - id: dsh-test-case\n      name: 'dsh-test-case'\n      config: {}\n",
  'index.js': 'export function apply(ctx, config) {}\n',
  'client.js': "window.__ModuleLoader__.load({ id: 'dsh-test-case', factory() { return { apply() {} } } })\n",
  'locale/en.json': JSON.stringify({ meta: { title: 'T', description: 'D' } }),
  'locale/zh.json': JSON.stringify({ meta: { title: 'T', description: 'D' } }),
  'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"></svg>\n',
  'README.md': '# t\n',
  LICENSE: 'MIT\n',
  '.gitignore': 'node_modules/\n',
}

async function check(files) {
  const { root, cleanup } = await fixture(files)
  try {
    return await checkProject(root)
  } finally {
    await cleanup()
  }
}

function named(result, name) {
  return result.checks.filter((c) => c.name === name)
}

test('完整项目全部通过', async () => {
  const result = await check(GOOD)
  const failures = result.checks.filter((c) => c.status === 'fail')
  assert.deepEqual(failures, [])
})

test('包名不合规判失败', async () => {
  const result = await check({ ...GOOD, 'package.json': pkg({ name: 'ChatBeautify' }) })
  assert.ok(named(result, '插件命名规范').some((c) => c.status === 'fail'))
})

test('缺少 type: module 判失败', async () => {
  const result = await check({ ...GOOD, 'package.json': pkg({ type: 'commonjs' }) })
  assert.ok(named(result, 'type: module').some((c) => c.status === 'fail'))
})

test('patch 路径不存在判失败', async () => {
  const result = await check({
    ...GOOD,
    'package.json': pkg({ dsh: { bundle: { patch: './missing.yml' }, client: { platform: 'web' } } }),
  })
  assert.ok(named(result, 'dsh.bundle.patch 指向的文件存在').some((c) => c.status === 'fail'))
})

test('patch 行 name 与包名不一致判失败', async () => {
  const result = await check({
    ...GOOD,
    'cordis.patch.yml': "- insert:\n    - id: other\n      name: 'other-name'\n      config: {}\n",
  })
  assert.ok(named(result, 'patch 中行 name 与包名一致').some((c) => c.status === 'fail'))
})

test('Host 入口缺少 apply 判失败', async () => {
  const result = await check({ ...GOOD, 'index.js': 'export const x = 1\n' })
  assert.ok(named(result, 'Host 入口导出形式').some((c) => c.status === 'fail'))
})

test('同时导出 apply 与默认 class 判失败', async () => {
  const result = await check({
    ...GOOD,
    'index.js': 'export function apply() {}\nexport default class X {}\n',
  })
  assert.ok(named(result, 'Host 入口导出形式').some((c) => c.status === 'fail'))
})

test('Client 模块 id 不匹配判失败', async () => {
  const result = await check({
    ...GOOD,
    'client.js': "window.__ModuleLoader__.load({ id: 'other', factory() { return {} } })\n",
  })
  assert.ok(named(result, 'Client 模块 id 与包名一致').some((c) => c.status === 'fail'))
})

test('注释里提到 __ModuleLoader__ 不误判为两次注册', async () => {
  const source = [
    '/**',
    ' * 浏览器会调用 window.__ModuleLoader__.load(...)',
    ' * 再次调用 __ModuleLoader__.load 是错的。',
    ' */',
    "window.__ModuleLoader__.load({ id: 'dsh-test-case', factory() { return { apply() {} } } })",
  ].join('\n')
  const result = await check({ ...GOOD, 'client.js': source })
  assert.ok(named(result, 'Client 只注册一次模块').some((c) => c.status === 'pass'))
})

test('引用 Harness Client 包判失败', async () => {
  const result = await check({
    ...GOOD,
    'client.js':
      "const p = require('@deepseek-ai/dsh-client-ui-primitives')\n" +
      "window.__ModuleLoader__.load({ id: 'dsh-test-case', factory() { return { apply() {} } } })\n",
  })
  assert.ok(named(result, '未引用 Harness Client 包').some((c) => c.status === 'fail'))
})

test('向 document.body 追加判失败', async () => {
  const result = await check({
    ...GOOD,
    'client.js':
      'document.body.appendChild(document.createElement("div"))\n' +
      "window.__ModuleLoader__.load({ id: 'dsh-test-case', factory() { return { apply() {} } } })\n",
  })
  assert.ok(named(result, '未向 document.body 追加节点').some((c) => c.status === 'fail'))
})

test('locale 缺少 meta 字段判失败', async () => {
  const result = await check({ ...GOOD, 'locale/zh.json': JSON.stringify({ meta: { title: 'T' } }) })
  assert.ok(named(result, 'locale/zh.json 元数据').some((c) => c.status === 'fail'))
})

test('损坏的 locale JSON 判失败', async () => {
  const result = await check({ ...GOOD, 'locale/en.json': '{ oops' })
  assert.ok(named(result, 'locale/en.json 可解析').some((c) => c.status === 'fail'))
})

test('超大图标判失败', async () => {
  const big = 'x'.repeat(256 * 1024 + 1)
  const result = await check({ ...GOOD, 'icon.svg': big })
  assert.ok(named(result, '图标大小').some((c) => c.status === 'fail'))
})

test('图标路径为绝对路径判失败', async () => {
  const result = await check({
    ...GOOD,
    'package.json': pkg({ icon: 'C:\\Users\\x\\icon.svg' }),
  })
  assert.ok(named(result, '图标路径为包内相对路径').some((c) => c.status === 'fail'))
})

test('缺失 README/LICENSE 仅提示不失败', async () => {
  const files = { ...GOOD }
  delete files['README.md']
  delete files.LICENSE
  delete files['.gitignore']
  const result = await check(files)
  assert.ok(named(result, 'README.md').every((c) => c.status === 'warn'))
  assert.ok(named(result, 'LICENSE').every((c) => c.status === 'warn'))
  assert.equal(result.checks.filter((c) => c.status === 'fail').length, 0)
})

test('package.json 无法解析时提前返回失败', async () => {
  const result = await check({ ...GOOD, 'package.json': '{ not json' })
  assert.ok(named(result, 'package.json 可解析').some((c) => c.status === 'fail'))
})

test('语法错误被检出（脚本级）', async () => {
  const result = await check({ ...GOOD, 'broken.js': 'function (\n' })
  assert.ok(named(result, '语法检查').some((c) => c.status === 'fail'))
})

test('ESM 文件无法校验时给出 warn 而不是 fail', async () => {
  const result = await check(GOOD)
  const syntax = named(result, '语法检查')
  assert.equal(syntax.length, 1)
  assert.notEqual(syntax[0].status, 'fail')
})

test('自带的 bundle-skeleton 无失败项', async () => {
  const result = await checkProject(join(here, '..', 'templates', 'bundle-skeleton'))
  assert.deepEqual(result.checks.filter((c) => c.status === 'fail'), [])
})
