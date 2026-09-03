import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { defineContentToolFixture, ToolRuntime } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'

import * as claimGuard from '../index.js'

const require = createRequire(import.meta.url)

const FROZEN_VERSIONS = Object.freeze({
  '@deepseek-ai/cordis': '4.0.1',
  '@deepseek-ai/dsh': '0.1.1-rc.2',
  '@deepseek-ai/dsh-system-prompt': '0.1.1-rc.2',
  '@deepseek-ai/dsh-tools': '0.1.1-rc.2',
  '@deepseek-ai/dsh-user-approval': '0.1.1-rc.2',
  '@deepseek-ai/schemastery': '3.18.1',
})

const RULES = Object.freeze({
  version: 1,
  options: { window: 60, caseSensitive: false },
  blocked: [
    { id: 'blocked-claim', match: 'submitted', message: 'Use a bounded description.' },
  ],
  bounded: [
    { id: 'bounded-metric', match: '35%', mustAccompany: ['internal test'], message: 'Add the test boundary.' },
  ],
})

function packageVersion(packageName) {
  try {
    return require(require.resolve(`${packageName}/package.json`)).version
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND' && error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
  }
  const entry = require.resolve(packageName)
  let directory = path.dirname(entry)
  while (directory !== path.dirname(directory)) {
    try {
      return require(path.join(directory, 'package.json')).version
    } catch (error) {
      if (error?.code !== 'MODULE_NOT_FOUND') throw error
      directory = path.dirname(directory)
    }
  }
  throw new Error(`Could not locate package metadata for ${packageName}`)
}

async function exists(filePath) {
  try {
    await readFile(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function content(text) {
  return [{ type: 'text', text }]
}

function resolveFixturePath(exec, targetPath) {
  return path.resolve(exec.agent.session.header.cwd, targetPath)
}

async function replaceText(filePath, oldText, newText, replaceAll = false) {
  const original = await readFile(filePath, 'utf8')
  const updated = replaceAll
    ? original.split(oldText).join(newText)
    : original.replace(oldText, newText)
  await writeFile(filePath, updated, 'utf8')
}

function makeFixtureDefinitions(counts) {
  return [
    defineContentToolFixture({
      name: 'write',
      description: 'P3 write fixture.',
      parameters: {
        file_path: { type: 'json' },
        content: { type: 'json' },
      },
      async execute(args, exec) {
        counts.write += 1
        const target = resolveFixturePath(exec, args.file_path)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, args.content, 'utf8')
        return content('write fixture completed')
      },
    }),
    defineContentToolFixture({
      name: 'edit',
      description: 'P3 edit fixture.',
      parameters: {
        file_path: { type: 'json' },
        old_string: { type: 'json' },
        new_string: { type: 'json' },
        replace_all: { type: 'json' },
      },
      async execute(args, exec) {
        counts.edit += 1
        await replaceText(
          resolveFixturePath(exec, args.file_path),
          args.old_string,
          args.new_string,
          args.replace_all,
        )
        return content('edit fixture completed')
      },
    }),
    defineContentToolFixture({
      name: 'str_replace_editor',
      description: 'P3 editor fixture.',
      parameters: {
        command: { type: 'json' },
        path: { type: 'json' },
        file_text: { type: 'json' },
        old_str: { type: 'json' },
        new_str: { type: 'json' },
        insert_line: { type: 'json' },
      },
      async execute(args) {
        counts.str_replace_editor += 1
        if (args.command === 'create') {
          await mkdir(path.dirname(args.path), { recursive: true })
          await writeFile(args.path, args.file_text, 'utf8')
        } else if (args.command === 'str_replace') {
          await replaceText(args.path, args.old_str, args.new_str ?? '')
        } else if (args.command === 'insert') {
          const original = await readFile(args.path, 'utf8')
          const lines = original.split('\n')
          lines.splice(args.insert_line, 0, args.new_str)
          await writeFile(args.path, lines.join('\n'), 'utf8')
        }
        return content('editor fixture completed')
      },
    }),
    defineContentToolFixture({
      name: 'custom_write',
      description: 'P3 unsupported custom writer fixture.',
      parameters: {
        path: { type: 'json' },
        content: { type: 'json' },
      },
      async execute(args, exec) {
        counts.custom_write += 1
        const target = resolveFixturePath(exec, args.path)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, args.content, 'utf8')
        return content('custom writer fixture completed')
      },
    }),
  ]
}

async function createHarness(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-claim-guard-p3-'))
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace)
  if (options.rules !== false) {
    await writeFile(path.join(workspace, 'claims.json'), JSON.stringify(options.rules ?? RULES), 'utf8')
  }

  const ctx = new Context()
  const fibers = []
  const disposers = []
  const counts = { write: 0, edit: 0, str_replace_editor: 0, custom_write: 0, downstream: 0 }
  const approvalRequests = []
  const events = [{ type: 'turn/start', data: {} }]
  const session = {
    header: { cwd: workspace },
    events,
    append(type, data) {
      events.push({ type, data })
    },
  }
  const agent = { session }

  try {
    fibers.push(await ctx.plugin(SystemPrompt, {}))
    fibers.push(await ctx.plugin(ToolRuntime, { mode: 'native' }))
    fibers.push(await ctx.plugin(ApprovalService, { policy: options.policy ?? 'ask' }))
    fibers.push(await ctx.plugin(claimGuard, options.config ?? {}))

    for (const definition of makeFixtureDefinitions(counts)) {
      disposers.push(ctx.tools.register(definition))
    }

    if (options.approver) {
      disposers.push(ctx.on('approval/request', async (request) => {
        approvalRequests.push(request)
        return options.approver(request, approvalRequests.length)
      }))
    }

    if (options.downstream) {
      disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
        counts.downstream += 1
        return options.downstream(exec, next)
      }))
    }
  } catch (error) {
    for (const disposer of disposers.reverse()) disposer()
    for (const fiber of fibers.reverse()) await fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }

  t.after(async () => {
    for (const disposer of disposers.reverse()) disposer()
    for (const fiber of fibers.reverse()) await fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  let call = 0
  return {
    agent,
    approvalRequests,
    counts,
    ctx,
    events,
    root,
    workspace,
    async execute(name, args) {
      call += 1
      return ctx.tools.execute({
        callId: `p3-call-${call}`,
        name,
        arguments: args,
        agent,
        signal: new AbortController().signal,
      })
    },
  }
}

function writeArgs(text, filePath = 'docs/demo.md') {
  return { file_path: filePath, content: text }
}

test('P3 metadata uses only the frozen direct runtime versions', () => {
  for (const [packageName, expected] of Object.entries(FROZEN_VERSIONS)) {
    assert.equal(packageVersion(packageName), expected, packageName)
  }
})

test('I01 clean full write runs downstream and body once', async (t) => {
  const harness = await createHarness(t, {
    downstream: async (_exec, next) => next(),
  })
  const target = path.join(harness.workspace, 'docs/demo.md')
  const result = await harness.execute('write', writeArgs('clean synthetic text'))
  assert.equal(result.isError, false)
  assert.equal(harness.counts.downstream, 1)
  assert.equal(harness.counts.write, 1)
  assert.equal(await readFile(target, 'utf8'), 'clean synthetic text')
})

test('I02 blocked write allowed once runs body once', async (t) => {
  const harness = await createHarness(t, { approver: async () => 'allowed-once' })
  const target = path.join(harness.workspace, 'docs/demo.md')
  const result = await harness.execute('write', writeArgs('submitted'))
  assert.equal(result.isError, false)
  assert.equal(harness.approvalRequests.length, 1)
  assert.equal(harness.counts.write, 1)
  assert.equal(await readFile(target, 'utf8'), 'submitted')
})

for (const [id, outcome] of [['I03', 'rejected'], ['I04', 'cancelled']]) {
  test(`${id} blocked write with ${outcome} leaves no file`, async (t) => {
    const harness = await createHarness(t, { approver: async () => outcome })
    const target = path.join(harness.workspace, `${id}.md`)
    const result = await harness.execute('write', writeArgs('submitted', `${id}.md`))
    assert.equal(result.isError, true)
    assert.equal(harness.approvalRequests.length, 1)
    assert.equal(harness.counts.write, 0)
    assert.equal(await exists(target), false)
  })
}

test('I05 no approval responder fails closed without calling the body', async (t) => {
  const harness = await createHarness(t)
  const target = path.join(harness.workspace, 'I05.md')
  const result = await harness.execute('write', writeArgs('submitted', 'I05.md'))
  assert.equal(result.isError, true)
  assert.equal(harness.counts.write, 0)
  assert.equal(await exists(target), false)
  assert.deepEqual(harness.events.map((event) => event.type), [
    'turn/start', 'approval/asked', 'approval/decided',
  ])
  assert.equal(harness.events.at(-1).data.outcome, 'unavailable')
})

test('I06 approval policy never rejects without dispatching an answerer or body', async (t) => {
  const harness = await createHarness(t, {
    policy: 'never',
    approver: async () => 'allowed-once',
  })
  const target = path.join(harness.workspace, 'I06.md')
  const result = await harness.execute('write', writeArgs('submitted', 'I06.md'))
  assert.equal(result.isError, true)
  assert.equal(harness.approvalRequests.length, 0)
  assert.equal(harness.counts.write, 0)
  assert.equal(await exists(target), false)
})

test('I07 allowed-once is not reused by the second identical hit', async (t) => {
  const harness = await createHarness(t, {
    approver: async (_request, ordinal) => ordinal === 1 ? 'allowed-once' : 'rejected',
  })
  const target = path.join(harness.workspace, 'I07.md')
  const first = await harness.execute('write', writeArgs('submitted', 'I07.md'))
  const second = await harness.execute('write', writeArgs('submitted again', 'I07.md'))
  assert.equal(first.isError, false)
  assert.equal(second.isError, true)
  assert.equal(harness.approvalRequests.length, 2)
  assert.equal(harness.counts.write, 1)
  assert.equal(await readFile(target, 'utf8'), 'submitted')
})

test('I08 missing rules deny a clean-looking write', async (t) => {
  const harness = await createHarness(t, { rules: false })
  const target = path.join(harness.workspace, 'I08.md')
  const result = await harness.execute('write', writeArgs('clean synthetic text', 'I08.md'))
  assert.equal(result.isError, true)
  assert.equal(harness.counts.write, 0)
  assert.equal(await exists(target), false)
})

test('I09 rules corrupted after startup deny the next write', async (t) => {
  const harness = await createHarness(t)
  await writeFile(path.join(harness.workspace, 'claims.json'), '{', 'utf8')
  const target = path.join(harness.workspace, 'I09.md')
  const result = await harness.execute('write', writeArgs('clean synthetic text', 'I09.md'))
  assert.equal(result.isError, true)
  assert.equal(harness.counts.write, 0)
  assert.equal(await exists(target), false)
})

test('I10 schema-invalid rules deny and invalid Config prevents plugin load', async (t) => {
  const invalidRules = { version: 1, blocked: [] }
  const harness = await createHarness(t, { rules: invalidRules })
  const target = path.join(harness.workspace, 'I10.md')
  const result = await harness.execute('write', writeArgs('clean synthetic text', 'I10.md'))
  assert.equal(result.isError, true)
  assert.equal(harness.counts.write, 0)
  assert.equal(await exists(target), false)

  await assert.rejects(createHarness(t, { config: { include: null } }))
})

test('I11 malformed known-tool arguments do not reach fixture bodies', async (t) => {
  const harness = await createHarness(t)
  const cases = [
    ['write', { file_path: 'I11-write.md' }],
    ['edit', { file_path: 'I11-edit.md', old_string: 'old', new_string: 7 }],
    ['str_replace_editor', { command: 'insert', path: 'relative.md', insert_line: -1, new_str: 'clean' }],
  ]
  for (const [name, args] of cases) {
    const result = await harness.execute(name, args)
    assert.equal(result.isError, true)
  }
  assert.deepEqual(
    { write: harness.counts.write, edit: harness.counts.edit, editor: harness.counts.str_replace_editor },
    { write: 0, edit: 0, editor: 0 },
  )
})

test('I12 clean edit, replace, and insert each run once with real effects', async (t) => {
  const harness = await createHarness(t)
  const editTarget = path.join(harness.workspace, 'edit.md')
  const replaceTarget = path.join(harness.workspace, 'replace.md')
  const insertTarget = path.join(harness.workspace, 'insert.md')
  await writeFile(editTarget, 'old edit', 'utf8')
  await writeFile(replaceTarget, 'old replace', 'utf8')
  await writeFile(insertTarget, 'line one', 'utf8')

  assert.equal((await harness.execute('edit', {
    file_path: 'edit.md', old_string: 'old', new_string: 'clean',
  })).isError, false)
  assert.equal((await harness.execute('str_replace_editor', {
    command: 'str_replace', path: replaceTarget, old_str: 'old', new_str: 'clean',
  })).isError, false)
  assert.equal((await harness.execute('str_replace_editor', {
    command: 'insert', path: insertTarget, insert_line: 1, new_str: 'clean inserted',
  })).isError, false)

  assert.equal(harness.counts.edit, 1)
  assert.equal(harness.counts.str_replace_editor, 2)
  assert.equal(await readFile(editTarget, 'utf8'), 'clean edit')
  assert.equal(await readFile(replaceTarget, 'utf8'), 'clean replace')
  assert.equal(await readFile(insertTarget, 'utf8'), 'line one\nclean inserted')
})

test('I13 blocked fragments rejected for edit, replace, and insert never run bodies', async (t) => {
  const harness = await createHarness(t, { approver: async () => 'rejected' })
  const target = path.join(harness.workspace, 'I13.md')
  await writeFile(target, 'old text', 'utf8')
  const cases = [
    ['edit', { file_path: 'I13.md', old_string: 'old', new_string: 'submitted' }],
    ['str_replace_editor', { command: 'str_replace', path: target, old_str: 'old', new_str: 'submitted' }],
    ['str_replace_editor', { command: 'insert', path: target, insert_line: 0, new_str: 'submitted' }],
  ]
  for (const [name, args] of cases) {
    const result = await harness.execute(name, args)
    assert.equal(result.isError, true)
  }
  assert.equal(harness.approvalRequests.length, 3)
  assert.ok(harness.approvalRequests.every((request) => request.reason.includes('fragment only')))
  assert.equal(harness.counts.edit, 0)
  assert.equal(harness.counts.str_replace_editor, 0)
  assert.equal(await readFile(target, 'utf8'), 'old text')
})

test('I14 bounded-only fragment executes without approval', async (t) => {
  const harness = await createHarness(t, { approver: async () => 'rejected' })
  const target = path.join(harness.workspace, 'I14.md')
  await writeFile(target, 'old text', 'utf8')
  const result = await harness.execute('edit', {
    file_path: 'I14.md', old_string: 'old', new_string: '35%',
  })
  assert.equal(result.isError, false)
  assert.equal(harness.approvalRequests.length, 0)
  assert.equal(harness.counts.edit, 1)
  assert.equal(await readFile(target, 'utf8'), '35% text')
})

test('I15 create full bounded hit rejected leaves no file', async (t) => {
  const harness = await createHarness(t, { approver: async () => 'rejected' })
  const target = path.join(harness.workspace, 'I15.md')
  const result = await harness.execute('str_replace_editor', {
    command: 'create', path: target, file_text: 'Improved by 35%.',
  })
  assert.equal(result.isError, true)
  assert.equal(harness.approvalRequests.length, 1)
  assert.equal(harness.counts.str_replace_editor, 0)
  assert.equal(await exists(target), false)
})

test('I16 include mismatch, exclude match, and rules self-write bypass approval and execute', async (t) => {
  const harness = await createHarness(t, {
    config: { include: ['docs/**'], exclude: ['docs/private/**'] },
    approver: async () => 'rejected',
  })
  const cases = [
    ['notes/demo.md', 'submitted outside include'],
    ['docs/private/demo.md', 'submitted in exclude'],
    ['claims.json', JSON.stringify(RULES)],
  ]
  for (const [filePath, text] of cases) {
    const result = await harness.execute('write', writeArgs(text, filePath))
    assert.equal(result.isError, false)
    assert.equal(await readFile(path.join(harness.workspace, filePath), 'utf8'), text)
  }
  assert.equal(harness.approvalRequests.length, 0)
  assert.equal(harness.counts.write, 3)
})

test('I17 a target outside the workspace remains an explicit known bypass', async (t) => {
  const harness = await createHarness(t, { approver: async () => 'rejected' })
  const target = path.join(harness.root, 'outside.md')
  const result = await harness.execute('write', writeArgs('submitted outside', '../outside.md'))
  assert.equal(result.isError, false)
  assert.equal(harness.approvalRequests.length, 0)
  assert.equal(harness.counts.write, 1)
  assert.equal(await readFile(target, 'utf8'), 'submitted outside')
})

test('I18 unknown custom writer is unchanged and remains unsupported, not pass', async (t) => {
  const harness = await createHarness(t, { approver: async () => 'rejected' })
  const target = path.join(harness.workspace, 'I18.md')
  const result = await harness.execute('custom_write', { path: 'I18.md', content: 'submitted' })
  assert.equal(result.isError, false)
  assert.equal(harness.approvalRequests.length, 0)
  assert.equal(harness.counts.custom_write, 1)
  assert.equal(await readFile(target, 'utf8'), 'submitted')
})

test('I19 downstream denial of a clean write is preserved', async (t) => {
  const harness = await createHarness(t, {
    downstream: async () => ({ kind: 'deny', reason: 'synthetic downstream policy' }),
  })
  const target = path.join(harness.workspace, 'I19.md')
  const result = await harness.execute('write', writeArgs('clean synthetic text', 'I19.md'))
  assert.equal(result.isError, true)
  assert.equal(harness.counts.downstream, 1)
  assert.equal(harness.counts.write, 0)
  assert.equal(await exists(target), false)
})

test('I20 relative rulesPath is reloaded and absolute rulesPath resolves independently', async (t) => {
  const relative = await createHarness(t, { approver: async () => 'rejected' })
  const relativeTarget = path.join(relative.workspace, 'relative.md')
  const first = await relative.execute('write', writeArgs('submitted', 'relative.md'))
  assert.equal(first.isError, true)
  assert.equal(await exists(relativeTarget), false)
  await writeFile(path.join(relative.workspace, 'claims.json'), JSON.stringify({
    ...RULES,
    blocked: [{ id: 'replacement', match: 'different phrase', message: 'Replacement rule.' }],
  }), 'utf8')
  const second = await relative.execute('write', writeArgs('submitted', 'relative.md'))
  assert.equal(second.isError, false)
  assert.equal(await readFile(relativeTarget, 'utf8'), 'submitted')

  const absoluteRules = path.join(relative.root, 'absolute-claims.json')
  await writeFile(absoluteRules, JSON.stringify(RULES), 'utf8')
  const absolute = await createHarness(t, {
    config: { rulesPath: absoluteRules },
    approver: async () => 'rejected',
  })
  const absoluteTarget = path.join(absolute.workspace, 'absolute.md')
  const third = await absolute.execute('write', writeArgs('submitted', 'absolute.md'))
  assert.equal(third.isError, true)
  assert.equal(absolute.counts.write, 0)
  assert.equal(await exists(absoluteTarget), false)
})
