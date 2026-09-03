import assert from 'node:assert/strict'
import test from 'node:test'

import { extractMutation } from '../lib/mutation.js'

const absolutePath = '/tmp/claim-guard-workspace/document.md'

function exec(name, args) {
  return { name, arguments: args }
}

function assertDeny(result, code) {
  assert.equal(result.kind, 'deny')
  assert.match(result.reason, new RegExp(`^\\[${code}\\]`))
  assert.ok(result.reason.length < 300)
}

test('write extracts a full mutation without changing arguments', () => {
  const args = { file_path: 'docs/demo.md', content: '' }
  const before = structuredClone(args)
  assert.deepEqual(extractMutation(exec('write', args)), {
    kind: 'mutation',
    toolName: 'write',
    targetPath: 'docs/demo.md',
    text: '',
    coverage: 'full',
  })
  assert.deepEqual(args, before)
})

test('write rejects every missing, empty, and wrong-type required field', () => {
  const invalid = [
    [{ content: 'safe' }, 'MUTATION_PATH_INVALID'],
    [{ file_path: undefined, content: 'safe' }, 'MUTATION_PATH_INVALID'],
    [{ file_path: null, content: 'safe' }, 'MUTATION_PATH_INVALID'],
    [{ file_path: 1, content: 'safe' }, 'MUTATION_PATH_INVALID'],
    [{ file_path: '', content: 'safe' }, 'MUTATION_PATH_INVALID'],
    [{ file_path: '  ', content: 'safe' }, 'MUTATION_PATH_INVALID'],
    [{ file_path: 'docs/demo.md' }, 'MUTATION_TEXT_INVALID'],
    [{ file_path: 'docs/demo.md', content: undefined }, 'MUTATION_TEXT_INVALID'],
    [{ file_path: 'docs/demo.md', content: null }, 'MUTATION_TEXT_INVALID'],
    [{ file_path: 'docs/demo.md', content: 0 }, 'MUTATION_TEXT_INVALID'],
  ]
  for (const [args, code] of invalid) assertDeny(extractMutation(exec('write', args)), code)
})

test('edit extracts fragment writes including an empty deletion', () => {
  for (const replaceAll of [undefined, false, true]) {
    const args = { file_path: 'docs/demo.md', old_string: 'old', new_string: '' }
    if (replaceAll !== undefined) args.replace_all = replaceAll
    assert.deepEqual(extractMutation(exec('edit', args)), {
      kind: 'mutation',
      toolName: 'edit',
      targetPath: 'docs/demo.md',
      text: '',
      coverage: 'fragment',
    })
  }
})

test('edit rejects invalid paths, old/new fields, equal values, and replace_all types', () => {
  const base = { file_path: 'docs/demo.md', old_string: 'old', new_string: 'new' }
  const invalid = [
    { old_string: 'old', new_string: 'new' },
    { ...base, file_path: '' },
    { ...base, file_path: null },
    { ...base, old_string: '' },
    { ...base, old_string: '  ' },
    { ...base, old_string: undefined },
    { ...base, old_string: null },
    { file_path: base.file_path, new_string: base.new_string },
    { file_path: base.file_path, old_string: base.old_string },
    { ...base, new_string: undefined },
    { ...base, new_string: null },
    { ...base, new_string: 0 },
    { ...base, new_string: 'old' },
    { ...base, replace_all: undefined },
    { ...base, replace_all: 0 },
  ]
  for (const args of invalid) assertDeny(extractMutation(exec('edit', args)), args.file_path ? 'MUTATION_EDIT_INVALID' : 'MUTATION_PATH_INVALID')
})

test('str_replace_editor view is not applicable and still requires an absolute non-empty path', () => {
  assert.deepEqual(extractMutation(exec('str_replace_editor', { command: 'view', path: absolutePath })), {
    kind: 'skip',
    status: 'not_applicable',
  })
  for (const value of [undefined, null, 1, '', 'relative.md']) {
    assertDeny(
      extractMutation(exec('str_replace_editor', { command: 'view', path: value })),
      'MUTATION_PATH_INVALID',
    )
  }
  assertDeny(
    extractMutation(exec('str_replace_editor', { command: 'view' })),
    'MUTATION_PATH_INVALID',
  )
})

test('str_replace_editor create extracts full text and permits an empty file', () => {
  assert.deepEqual(extractMutation(exec('str_replace_editor', {
    command: 'create',
    path: absolutePath,
    file_text: '',
  })), {
    kind: 'mutation',
    toolName: 'str_replace_editor',
    targetPath: absolutePath,
    text: '',
    coverage: 'full',
  })
  for (const value of [undefined, null, 1]) {
    assertDeny(
      extractMutation(exec('str_replace_editor', {
        command: 'create',
        path: absolutePath,
        file_text: value,
      })),
      'MUTATION_TEXT_INVALID',
    )
  }
  assertDeny(
    extractMutation(exec('str_replace_editor', { command: 'create', path: absolutePath })),
    'MUTATION_TEXT_INVALID',
  )
})

test('str_replace treats only an absent new_str as the optional empty replacement', () => {
  const absent = { command: 'str_replace', path: absolutePath, old_str: 'old' }
  assert.deepEqual(extractMutation(exec('str_replace_editor', absent)), {
    kind: 'mutation',
    toolName: 'str_replace_editor',
    targetPath: absolutePath,
    text: '',
    coverage: 'fragment',
  })
  assert.equal(Object.hasOwn(absent, 'new_str'), false)

  assert.deepEqual(extractMutation(exec('str_replace_editor', { ...absent, new_str: '' })), {
    kind: 'mutation',
    toolName: 'str_replace_editor',
    targetPath: absolutePath,
    text: '',
    coverage: 'fragment',
  })
  for (const value of [undefined, null, 0]) {
    assertDeny(
      extractMutation(exec('str_replace_editor', { ...absent, new_str: value })),
      'MUTATION_TEXT_INVALID',
    )
  }
})

test('str_replace requires a present non-empty old_str', () => {
  for (const value of [undefined, null, 1, '', '  ']) {
    assertDeny(
      extractMutation(exec('str_replace_editor', {
        command: 'str_replace',
        path: absolutePath,
        old_str: value,
        new_str: 'new',
      })),
      'MUTATION_EDIT_INVALID',
    )
  }
  assertDeny(
    extractMutation(exec('str_replace_editor', {
      command: 'str_replace',
      path: absolutePath,
      new_str: 'new',
    })),
    'MUTATION_EDIT_INVALID',
  )
})

test('insert distinguishes line zero, empty text, missing fields, and invalid lines', () => {
  assert.deepEqual(extractMutation(exec('str_replace_editor', {
    command: 'insert',
    path: absolutePath,
    insert_line: 0,
    new_str: '',
  })), {
    kind: 'mutation',
    toolName: 'str_replace_editor',
    targetPath: absolutePath,
    text: '',
    coverage: 'fragment',
  })

  for (const value of [undefined, null, -1, 1.5, '0']) {
    assertDeny(
      extractMutation(exec('str_replace_editor', {
        command: 'insert',
        path: absolutePath,
        insert_line: value,
        new_str: 'text',
      })),
      'MUTATION_INSERT_LINE_INVALID',
    )
  }
  assertDeny(
    extractMutation(exec('str_replace_editor', { command: 'insert', path: absolutePath, new_str: 'text' })),
    'MUTATION_INSERT_LINE_INVALID',
  )
  for (const value of [undefined, null, 0]) {
    assertDeny(
      extractMutation(exec('str_replace_editor', {
        command: 'insert',
        path: absolutePath,
        insert_line: 1,
        new_str: value,
      })),
      'MUTATION_TEXT_INVALID',
    )
  }
  assertDeny(
    extractMutation(exec('str_replace_editor', { command: 'insert', path: absolutePath, insert_line: 1 })),
    'MUTATION_TEXT_INVALID',
  )
})

test('unknown editor commands deny while unknown tools remain unsupported', () => {
  for (const command of [undefined, null, 1, '', 'replace']) {
    assertDeny(
      extractMutation(exec('str_replace_editor', { command, path: absolutePath })),
      'MUTATION_COMMAND_INVALID',
    )
  }
  assertDeny(
    extractMutation(exec('str_replace_editor', { path: absolutePath })),
    'MUTATION_COMMAND_INVALID',
  )
  assert.deepEqual(extractMutation(exec('custom_write', {})), { kind: 'skip', status: 'unsupported' })
})

test('malformed execution envelopes deny without reflecting payload contents', () => {
  const invalid = [
    undefined,
    null,
    [],
    {},
    { name: undefined, arguments: {} },
    { name: null, arguments: {} },
    { name: '', arguments: {} },
    { name: 'write' },
    { name: 'write', arguments: null },
    { name: 'write', arguments: [] },
    { name: 'write', arguments: 'private-secret' },
  ]
  for (const value of invalid) {
    const result = extractMutation(value)
    assert.equal(result.kind, 'deny')
    assert.doesNotMatch(result.reason, /private-secret/)
  }
})
