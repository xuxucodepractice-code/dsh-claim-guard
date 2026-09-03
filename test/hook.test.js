import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  apply,
  Config,
  createPreExecuteHook,
  inject,
  name,
} from '../index.js'
import { validateConfig } from '../lib/config.js'

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

async function workspaceFixture(t, rules = RULES) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'dsh-claim-guard-hook-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  await writeFile(path.join(workspace, 'claims.json'), JSON.stringify(rules), 'utf8')
  return workspace
}

function execution(workspace, name, args, signal = new AbortController().signal) {
  return {
    name,
    arguments: args,
    signal,
    agent: { session: { header: { cwd: workspace } } },
  }
}

function writeExec(workspace, content, target = 'docs/demo.md', signal) {
  return execution(workspace, 'write', { file_path: target, content }, signal)
}

function captureApply(rawConfig) {
  let registered
  const ctx = {
    on(event, listener) {
      registered = { event, listener }
      return () => {}
    },
  }
  apply(ctx, rawConfig)
  return registered
}

function nextRecorder(result = { kind: 'allow' }) {
  let count = 0
  return {
    next: async () => {
      count += 1
      return result
    },
    get count() {
      return count
    },
  }
}

test('plugin exports the frozen name, injection, and Standard Schema Config', () => {
  assert.equal(name, 'claim-guard')
  assert.deepEqual(inject, ['tools'])
  assert.equal(Config['~standard'].version, 1)
  assert.equal(Config['~standard'].vendor, 'schemastery')
  assert.deepEqual(Config['~standard'].validate({ include: [], exclude: [] }), {
    value: { include: [], exclude: [] },
  })
  assert.deepEqual(Config['~standard'].validate(null), { value: null })
})

test('apply validates configuration before registering exactly one pre-execute listener', () => {
  const registered = captureApply(undefined)
  assert.equal(registered.event, 'tools/pre-execute')
  assert.equal(typeof registered.listener, 'function')

  for (const invalid of [null, [], 'config', 1, true, { typo: true }, { rulesPath: null }, { include: null }, { exclude: null }, { include: [' '] }]) {
    let registrations = 0
    assert.throws(() => apply({ on() { registrations += 1 } }, invalid))
    assert.equal(registrations, 0)
  }
})

test('unsupported tools and editor view delegate exactly once', async (t) => {
  const workspace = await workspaceFixture(t)
  const hook = captureApply({}).listener

  for (const exec of [
    execution(workspace, 'custom_write', {}),
    execution(workspace, 'str_replace_editor', { command: 'view', path: path.join(workspace, 'docs/demo.md') }),
  ]) {
    const recorder = nextRecorder({ kind: 'deny', reason: 'downstream policy' })
    assert.deepEqual(await hook(exec, recorder.next), { kind: 'deny', reason: 'downstream policy' })
    assert.equal(recorder.count, 1)
  }
})

test('clean full and fragment mutations preserve downstream waterfall decisions', async (t) => {
  const workspace = await workspaceFixture(t)
  const hook = captureApply({}).listener
  const cases = [
    writeExec(workspace, 'synthetic clean text'),
    execution(workspace, 'str_replace_editor', {
      command: 'create', path: path.join(workspace, 'created.md'), file_text: 'synthetic clean text',
    }),
    execution(workspace, 'edit', {
      file_path: 'docs/demo.md', old_string: 'old', new_string: 'synthetic clean text',
    }),
    execution(workspace, 'str_replace_editor', {
      command: 'str_replace', path: path.join(workspace, 'docs/demo.md'), old_str: 'old', new_str: 'synthetic clean text',
    }),
    execution(workspace, 'str_replace_editor', {
      command: 'insert', path: path.join(workspace, 'docs/demo.md'), insert_line: 0, new_str: 'synthetic clean text',
    }),
  ]

  for (const exec of cases) {
    const downstream = { kind: 'ask', reason: 'another guard' }
    const recorder = nextRecorder(downstream)
    assert.strictEqual(await hook(exec, recorder.next), downstream)
    assert.equal(recorder.count, 1)
  }
})

test('full blocked and bounded hits ask without calling next', async (t) => {
  const workspace = await workspaceFixture(t)
  const hook = captureApply({}).listener
  for (const content of ['This was submitted.', 'Improved by 35%.']) {
    const recorder = nextRecorder()
    const result = await hook(writeExec(workspace, content), recorder.next)
    assert.equal(result.kind, 'ask')
    assert.match(result.reason, /Claim Guard requires review/)
    assert.equal(recorder.count, 0)
  }
})

test('fragment blocked hits ask, while bounded-only fragments remain partial and delegate', async (t) => {
  const workspace = await workspaceFixture(t)
  const hook = captureApply({}).listener

  for (const exec of [
    execution(workspace, 'edit', { file_path: 'demo.md', old_string: 'old', new_string: 'submitted' }),
    execution(workspace, 'str_replace_editor', {
      command: 'str_replace', path: path.join(workspace, 'demo.md'), old_str: 'old', new_str: 'submitted',
    }),
    execution(workspace, 'str_replace_editor', {
      command: 'insert', path: path.join(workspace, 'demo.md'), insert_line: 0, new_str: 'submitted',
    }),
  ]) {
    const recorder = nextRecorder()
    const result = await hook(exec, recorder.next)
    assert.equal(result.kind, 'ask')
    assert.match(result.reason, /fragment only/)
    assert.equal(recorder.count, 0)
  }

  const recorder = nextRecorder({ kind: 'allow' })
  assert.deepEqual(await hook(execution(workspace, 'edit', {
    file_path: 'demo.md', old_string: 'old', new_string: '35%',
  }), recorder.next), { kind: 'allow' })
  assert.equal(recorder.count, 1)
})

test('create is full coverage and enforces bounded rules', async (t) => {
  const workspace = await workspaceFixture(t)
  const hook = captureApply({}).listener
  const recorder = nextRecorder()
  const result = await hook(execution(workspace, 'str_replace_editor', {
    command: 'create', path: path.join(workspace, 'demo.md'), file_text: 'Improved by 35%.',
  }), recorder.next)
  assert.equal(result.kind, 'ask')
  assert.match(result.reason, /bounded/)
  assert.equal(recorder.count, 0)
})

test('include, exclude, rule self-repair, and outside-workspace paths delegate', async (t) => {
  const workspace = await workspaceFixture(t)
  const hook = captureApply({ include: ['docs/**'], exclude: ['docs/private/**'] }).listener
  for (const exec of [
    writeExec(workspace, 'submitted', 'notes/demo.md'),
    writeExec(workspace, 'submitted', 'docs/private/demo.md'),
    writeExec(workspace, 'submitted', 'claims.json'),
    writeExec(workspace, 'submitted', '../outside.md'),
  ]) {
    const recorder = nextRecorder()
    assert.deepEqual(await hook(exec, recorder.next), { kind: 'allow' })
    assert.equal(recorder.count, 1)
  }
})

test('missing, malformed JSON, and schema-invalid rules fail closed', async (t) => {
  const workspace = await workspaceFixture(t)
  const hook = captureApply({}).listener
  const rulesPath = path.join(workspace, 'claims.json')
  const cases = [
    ['missing.json', null],
    ['claims.json', '{'],
    ['claims.json', JSON.stringify({ version: 1, blocked: [] })],
  ]

  for (const [configuredPath, replacement] of cases) {
    if (replacement !== null) await writeFile(rulesPath, replacement, 'utf8')
    const caseHook = configuredPath === 'claims.json' ? hook : captureApply({ rulesPath: configuredPath }).listener
    const recorder = nextRecorder()
    const result = await caseHook(writeExec(workspace, 'clean text'), recorder.next)
    assert.equal(result.kind, 'deny')
    assert.equal(recorder.count, 0)
  }
})

test('known malformed mutations and missing trusted workspace fail closed', async (t) => {
  const workspace = await workspaceFixture(t)
  const hook = captureApply({}).listener
  for (const exec of [
    execution(workspace, 'write', { file_path: 'demo.md' }),
    { name: 'write', arguments: { file_path: 'demo.md', content: 'clean' }, signal: new AbortController().signal },
  ]) {
    const recorder = nextRecorder()
    const result = await hook(exec, recorder.next)
    assert.equal(result.kind, 'deny')
    assert.equal(recorder.count, 0)
  }
})

test('rules are reloaded for every included mutation', async (t) => {
  const workspace = await workspaceFixture(t)
  const hook = captureApply({}).listener
  const first = nextRecorder()
  assert.equal((await hook(writeExec(workspace, 'submitted'), first.next)).kind, 'ask')
  assert.equal(first.count, 0)

  await writeFile(path.join(workspace, 'claims.json'), JSON.stringify({
    ...RULES,
    blocked: [{ id: 'replacement', match: 'different phrase', message: 'Replacement rule.' }],
  }), 'utf8')
  const second = nextRecorder()
  assert.deepEqual(await hook(writeExec(workspace, 'submitted'), second.next), { kind: 'allow' })
  assert.equal(second.count, 1)
})

test('cancellation before work and after read, scan, or report always denies without delegation', async (t) => {
  const workspace = await workspaceFixture(t)
  const config = validateConfig({})
  const baseExec = (controller) => writeExec(workspace, 'submitted', 'demo.md', controller.signal)

  const before = new AbortController()
  before.abort(new Error('/private/secret-before'))
  const beforeRecorder = nextRecorder()
  const beforeResult = await createPreExecuteHook(config)(baseExec(before), beforeRecorder.next)
  assert.equal(beforeResult.kind, 'deny')
  assert.match(beforeResult.reason, /^\[OPERATION_ABORTED\]/)
  assert.doesNotMatch(beforeResult.reason, /private|secret/)
  assert.equal(beforeRecorder.count, 0)

  for (const checkpoint of ['read', 'scan', 'report']) {
    const controller = new AbortController()
    const overrides = {}
    if (checkpoint === 'read') {
      overrides.loadRules = async () => {
        controller.abort(new Error('/private/secret-read'))
        return RULES
      }
    }
    if (checkpoint === 'scan') {
      overrides.scan = () => {
        controller.abort(new Error('/private/secret-scan'))
        return { status: 'pass', coverage: 'full', hitCount: 0, hits: [] }
      }
    }
    if (checkpoint === 'report') {
      overrides.scan = () => ({
        status: 'review_required', coverage: 'full', hitCount: 1, hits: [{}],
      })
      overrides.renderReport = () => {
        controller.abort(new Error('/private/secret-report'))
        return 'unsafe'
      }
    }
    const recorder = nextRecorder()
    const result = await createPreExecuteHook(config, overrides)(baseExec(controller), recorder.next)
    assert.equal(result.kind, 'deny')
    assert.match(result.reason, /^\[OPERATION_ABORTED\]/)
    assert.doesNotMatch(result.reason, /private|secret/)
    assert.equal(recorder.count, 0)
  }
})

test('report generation failures return a bounded non-disclosing deny', async (t) => {
  const workspace = await workspaceFixture(t)
  const hook = createPreExecuteHook(validateConfig({}), {
    scan: () => ({ status: 'review_required', coverage: 'full', hitCount: 1, hits: [{}] }),
    renderReport: () => {
      const error = new Error(`/private/secret.json ${'x'.repeat(5000)}`)
      error.stack = 'token=secret'
      throw error
    },
  })
  const recorder = nextRecorder()
  const result = await hook(writeExec(workspace, 'submitted'), recorder.next)
  assert.equal(result.kind, 'deny')
  assert.match(result.reason, /^\[INTERNAL_ERROR\]/)
  assert.doesNotMatch(result.reason, /private|secret|token/)
  assert.ok(result.reason.length <= 1000)
  assert.equal(recorder.count, 0)
})
