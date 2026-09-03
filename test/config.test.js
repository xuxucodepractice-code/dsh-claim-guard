import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  classifyTargetPath,
  DEFAULT_CONFIG,
  resolveRulesPath,
  resolveWorkspace,
  validateConfig,
} from '../lib/config.js'

test('validateConfig supplies defaults without sharing mutable arrays', () => {
  const first = validateConfig()
  const second = validateConfig({})
  assert.deepEqual(first, DEFAULT_CONFIG)
  assert.deepEqual(second, DEFAULT_CONFIG)
  assert.notStrictEqual(first.include, second.include)
})

test('validateConfig preserves explicit empty arrays and trims values', () => {
  const raw = { rulesPath: ' rules/custom.json ', include: [], exclude: [' private/** '] }
  const result = validateConfig(raw)
  assert.deepEqual(result, {
    rulesPath: 'rules/custom.json',
    include: [],
    exclude: ['private/**'],
  })
  assert.deepEqual(raw, { rulesPath: ' rules/custom.json ', include: [], exclude: [' private/** '] })
})

for (const value of [null, [], 'text', 1, true]) {
  test(`validateConfig rejects non-object root ${JSON.stringify(value)}`, () => {
    assert.throws(() => validateConfig(value), { code: 'CONFIG_ROOT_TYPE' })
  })
}

test('validateConfig rejects unknown fields and explicit nulls', () => {
  assert.throws(() => validateConfig({ typo: true }), { code: 'CONFIG_UNKNOWN_FIELD' })
  assert.throws(() => validateConfig({ rulesPath: null }), { code: 'CONFIG_RULES_PATH_TYPE' })
  assert.throws(() => validateConfig({ include: null }), { code: 'CONFIG_TYPE' })
  assert.throws(() => validateConfig({ exclude: null }), { code: 'CONFIG_TYPE' })
})

test('validateConfig rejects blank and non-string patterns, including sparse arrays', () => {
  assert.throws(() => validateConfig({ rulesPath: '  ' }), { code: 'CONFIG_RULES_PATH_EMPTY' })
  assert.throws(() => validateConfig({ include: [' '] }), { code: 'CONFIG_PATTERN_EMPTY' })
  assert.throws(() => validateConfig({ include: [1] }), { code: 'CONFIG_PATTERN_TYPE' })
  const sparse = new Array(1)
  assert.throws(() => validateConfig({ include: sparse }), { code: 'CONFIG_PATTERN_TYPE' })
})

test('workspace and rule paths resolve from the agent session cwd', () => {
  const workspace = path.resolve('/tmp/claim-guard-workspace')
  const config = validateConfig({ rulesPath: 'policy/claims.json' })
  assert.equal(resolveWorkspace(config, { agent: { session: { header: { cwd: workspace } } } }), workspace)
  assert.equal(resolveRulesPath(config, workspace), path.join(workspace, 'policy/claims.json'))
  assert.equal(resolveRulesPath({ rulesPath: '/tmp/external-claims.json' }, workspace), '/tmp/external-claims.json')
  assert.throws(() => resolveWorkspace(config, {}), { code: 'WORKSPACE_UNAVAILABLE' })
  assert.throws(
    () => resolveWorkspace(config, { agent: { session: { header: { cwd: 'relative' } } } }),
    { code: 'WORKSPACE_UNAVAILABLE' },
  )
})

test('classifyTargetPath applies rule self-exclusion, workspace boundary, exclude, and include', () => {
  const workspace = path.resolve('/tmp/claim-guard-workspace')
  const rulesPath = path.join(workspace, 'claims.json')
  const config = validateConfig({ include: ['**/*.md'], exclude: ['private/**'] })

  assert.deepEqual(classifyTargetPath('claims.json', workspace, rulesPath, config), { status: 'not_applicable' })
  assert.deepEqual(classifyTargetPath('../outside.md', workspace, rulesPath, config), { status: 'unsupported' })
  assert.deepEqual(classifyTargetPath('private/note.md', workspace, rulesPath, config), { status: 'not_applicable' })
  assert.deepEqual(classifyTargetPath('notes/data.json', workspace, rulesPath, config), { status: 'not_applicable' })
  assert.deepEqual(classifyTargetPath('notes/readme.md', workspace, rulesPath, config), {
    status: 'included',
    relativePath: 'notes/readme.md',
  })
})

test('include [] includes every workspace target while exclude still wins', () => {
  const workspace = path.resolve('/tmp/claim-guard-workspace')
  const rulesPath = path.join(workspace, 'claims.json')
  const config = validateConfig({ include: [], exclude: ['tmp/**'] })
  assert.equal(classifyTargetPath('data.json', workspace, rulesPath, config).status, 'included')
  assert.equal(classifyTargetPath('tmp/data.json', workspace, rulesPath, config).status, 'not_applicable')
})
