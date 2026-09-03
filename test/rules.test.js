import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { loadRules, MAX_RULE_FILE_BYTES, validateRules } from '../lib/rules.js'

function blocked(id = 'blocked-1', overrides = {}) {
  return { id, match: 'submitted', message: 'Synthetic boundary.', ...overrides }
}

function bounded(id = 'bounded-1', overrides = {}) {
  return {
    id,
    match: '42.5%',
    mustAccompany: ['synthetic benchmark'],
    message: 'Synthetic metric boundary.',
    ...overrides,
  }
}

function valid(overrides = {}) {
  return { version: 1, blocked: [blocked()], bounded: [bounded()], ...overrides }
}

test('validateRules normalizes defaults and trims without mutating input', () => {
  const raw = {
    version: 1,
    blocked: [{ id: ' id ', match: ' match ', message: ' message ' }],
  }
  const result = validateRules(raw)
  assert.deepEqual(result, {
    version: 1,
    options: { window: 60, caseSensitive: false },
    blocked: [{ id: 'id', match: 'match', message: 'message' }],
    bounded: [],
  })
  assert.equal(raw.blocked[0].id, ' id ')
})

test('validateRules accepts exact option boundaries', () => {
  assert.equal(validateRules(valid({ options: { window: 0, caseSensitive: true } })).options.window, 0)
  assert.equal(validateRules(valid({ options: { window: 4096, caseSensitive: false } })).options.window, 4096)
})

for (const raw of [null, [], 'rules']) {
  test(`validateRules rejects root ${JSON.stringify(raw)}`, () => {
    assert.throws(() => validateRules(raw), { code: 'RULE_OBJECT_TYPE' })
  })
}

test('validateRules rejects version, unknown fields, and invalid option fields', () => {
  assert.throws(() => validateRules({ blocked: [blocked()] }), { code: 'RULE_VERSION_UNSUPPORTED' })
  assert.throws(() => validateRules({ version: 2, blocked: [blocked()] }), { code: 'RULE_VERSION_UNSUPPORTED' })
  assert.throws(() => validateRules({ ...valid(), typo: true }), { code: 'RULE_UNKNOWN_FIELD' })
  assert.throws(() => validateRules(valid({ options: { typo: true } })), { code: 'RULE_UNKNOWN_FIELD' })
  assert.throws(() => validateRules(valid({ options: null })), { code: 'RULE_OBJECT_TYPE' })
  for (const window of [-1, 0.5, 4097, Infinity]) {
    assert.throws(() => validateRules(valid({ options: { window } })), { code: 'RULE_WINDOW_INVALID' })
  }
  assert.throws(() => validateRules(valid({ options: { caseSensitive: 'false' } })), {
    code: 'RULE_CASE_SENSITIVE_TYPE',
  })
})

test('validateRules rejects unknown nested fields and duplicate ids after trimming', () => {
  assert.throws(() => validateRules({ version: 1, blocked: [blocked('a', { typo: true })] }), {
    code: 'RULE_UNKNOWN_FIELD',
  })
  assert.throws(
    () => validateRules({ version: 1, blocked: [blocked('same')], bounded: [bounded(' same ')] }),
    { code: 'RULE_ID_DUPLICATE' },
  )
})

test('validateRules enforces required string types, trimming, and limits', () => {
  for (const field of ['id', 'match', 'message']) {
    assert.throws(() => validateRules({ version: 1, blocked: [blocked('id', { [field]: '' })] }), {
      code: 'RULE_STRING_EMPTY',
    })
    assert.throws(() => validateRules({ version: 1, blocked: [blocked('id', { [field]: null })] }), {
      code: 'RULE_STRING_TYPE',
    })
  }
  assert.doesNotThrow(() => validateRules({ version: 1, blocked: [blocked('i'.repeat(96))] }))
  assert.throws(() => validateRules({ version: 1, blocked: [blocked('i'.repeat(97))] }), {
    code: 'RULE_STRING_TOO_LONG',
  })
  assert.doesNotThrow(() => validateRules({ version: 1, blocked: [blocked('id', { match: 'm'.repeat(256) })] }))
  assert.throws(() => validateRules({ version: 1, blocked: [blocked('id', { match: 'm'.repeat(257) })] }), {
    code: 'RULE_STRING_TOO_LONG',
  })
  assert.doesNotThrow(() => validateRules({ version: 1, blocked: [blocked('id', { message: 'm'.repeat(768) })] }))
  assert.throws(() => validateRules({ version: 1, blocked: [blocked('id', { message: 'm'.repeat(769) })] }), {
    code: 'RULE_STRING_TOO_LONG',
  })
})

test('validateRules enforces bounded companion contract', () => {
  assert.throws(() => validateRules({ version: 1, bounded: [bounded('b', { mustAccompany: null })] }), {
    code: 'RULE_COMPANIONS_TYPE',
  })
  assert.throws(() => validateRules({ version: 1, bounded: [bounded('b', { mustAccompany: [] })] }), {
    code: 'RULE_COMPANIONS_COUNT',
  })
  assert.throws(
    () => validateRules({ version: 1, bounded: [bounded('b', { mustAccompany: Array.from({ length: 17 }, (_, i) => `c${i}`) })] }),
    { code: 'RULE_COMPANIONS_COUNT' },
  )
  assert.throws(() => validateRules({ version: 1, bounded: [bounded('b', { mustAccompany: ['x', ' x '] })] }), {
    code: 'RULE_COMPANION_DUPLICATE',
  })
  assert.throws(() => validateRules({ version: 1, bounded: [bounded('b', { mustAccompany: [1] })] }), {
    code: 'RULE_STRING_TYPE',
  })
  assert.throws(() => validateRules({ version: 1, bounded: [bounded('b', { mustAccompany: [' '] })] }), {
    code: 'RULE_STRING_EMPTY',
  })
})

test('validateRules enforces total rule count boundaries', () => {
  assert.throws(() => validateRules({ version: 1 }), { code: 'RULE_COUNT_INVALID' })
  const rules256 = Array.from({ length: 256 }, (_, index) => blocked(`id-${index}`))
  assert.equal(validateRules({ version: 1, blocked: rules256 }).blocked.length, 256)
  const rules257 = Array.from({ length: 257 }, (_, index) => blocked(`id-${index}`))
  assert.throws(() => validateRules({ version: 1, blocked: rules257 }), { code: 'RULE_COUNT_INVALID' })
})

test('loadRules accepts valid UTF-8 JSON and rejects missing, directory, malformed, invalid UTF-8, and oversized files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'claim-guard-rules-'))
  const validPath = path.join(directory, 'valid.json')
  await writeFile(validPath, JSON.stringify({ version: 1, blocked: [blocked()] }))
  assert.equal((await loadRules(validPath)).blocked.length, 1)

  await assert.rejects(loadRules(path.join(directory, 'missing.json')), { code: 'RULE_FILE_UNREADABLE' })
  const childDirectory = path.join(directory, 'child')
  await mkdir(childDirectory)
  await assert.rejects(loadRules(childDirectory), { code: 'RULE_FILE_NOT_REGULAR' })

  const malformedPath = path.join(directory, 'malformed.json')
  await writeFile(malformedPath, '{')
  await assert.rejects(loadRules(malformedPath), { code: 'RULE_FILE_JSON' })

  const invalidUtf8Path = path.join(directory, 'invalid-utf8.json')
  await writeFile(invalidUtf8Path, Buffer.from([0xff, 0xfe]))
  await assert.rejects(loadRules(invalidUtf8Path), { code: 'RULE_FILE_ENCODING' })

  const oversizedPath = path.join(directory, 'oversized.json')
  await writeFile(oversizedPath, Buffer.alloc(MAX_RULE_FILE_BYTES + 1, 0x20))
  await assert.rejects(loadRules(oversizedPath), { code: 'RULE_FILE_TOO_LARGE' })
})
