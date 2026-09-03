import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_TEXT_CODE_UNITS, scan } from '../lib/scan.js'

function rules({ blocked = [], bounded = [], window = 3, caseSensitive = false } = {}) {
  return { version: 1, options: { window, caseSensitive }, blocked, bounded }
}

const submitted = { id: 'status', match: 'submitted', message: 'Synthetic status boundary.' }
const metric = {
  id: 'metric',
  match: '42.5%',
  mustAccompany: ['synthetic benchmark', '合成示例'],
  message: 'Synthetic metric boundary.',
}

test('T01/T02 full blocked scan reports exact offset and every occurrence', () => {
  const text = 'submitted then submitted'
  const result = scan(text, rules({ blocked: [submitted] }))
  assert.equal(result.status, 'review_required')
  assert.equal(result.coverage, 'full')
  assert.deepEqual(result.hits.map((hit) => hit.offset), [0, 15])
  assert.equal(result.hits[0].matchedText, 'submitted')
})

test('T03 overlapping occurrences are retained', () => {
  const overlap = { id: 'overlap', match: 'ana', message: 'Synthetic overlap.' }
  const result = scan('banana', rules({ blocked: [overlap] }))
  assert.deepEqual(result.hits.map((hit) => hit.offset), [1, 3])
})

test('T04/T05 case sensitivity preserves original excerpt', () => {
  const insensitive = scan('It was SUBMITTED.', rules({ blocked: [submitted], caseSensitive: false }))
  assert.equal(insensitive.hitCount, 1)
  assert.equal(insensitive.hits[0].matchedText, 'SUBMITTED')
  assert.match(insensitive.hits[0].excerpt, /SUBMITTED/)
  const sensitive = scan('It was SUBMITTED.', rules({ blocked: [submitted], caseSensitive: true }))
  assert.equal(sensitive.status, 'pass')
})

test('T06/T07 Unicode before a hit does not corrupt the original UTF-16 offset', () => {
  const text = `İ中文😀 ${submitted.match}`
  const result = scan(text, rules({ blocked: [submitted] }))
  assert.equal(result.hits[0].offset, text.indexOf('submitted'))
  assert.equal(text.slice(result.hits[0].offset, result.hits[0].offset + 9), 'submitted')
})

test('case-insensitive matching with an expanding lowercase form keeps original offsets', () => {
  const expanding = { id: 'unicode', match: 'İ', message: 'Synthetic Unicode boundary.' }
  const result = scan('aİbİ', rules({ blocked: [expanding] }))
  assert.deepEqual(result.hits.map((hit) => hit.offset), [1, 3])
})

test('T08 bounded match without a companion requires review', () => {
  const result = scan('Score: 42.5%', rules({ bounded: [metric], window: 20 }))
  assert.equal(result.status, 'review_required')
  assert.equal(result.hits[0].kind, 'bounded')
})

test('T09 any companion in the window satisfies bounded OR semantics', () => {
  const result = scan('合成示例 42.5%', rules({ bounded: [metric], window: 20 }))
  assert.equal(result.status, 'pass')
})

test('T10 bounded slice edge is exact before and after the match', () => {
  const localMetric = { ...metric, match: 'X', mustAccompany: ['C'] }
  assert.equal(scan('CaaX', rules({ bounded: [localMetric], window: 3 })).status, 'pass')
  assert.equal(scan('CaaaX', rules({ bounded: [localMetric], window: 3 })).status, 'review_required')
  assert.equal(scan('XaaC', rules({ bounded: [localMetric], window: 3 })).status, 'pass')
  assert.equal(scan('XaaaC', rules({ bounded: [localMetric], window: 3 })).status, 'review_required')
})

test('T11 each bounded occurrence is evaluated independently', () => {
  const result = scan('合成示例 42.5%....................42.5%', rules({ bounded: [metric], window: 10 }))
  assert.equal(result.hitCount, 1)
  assert.equal(result.hits[0].offset, '合成示例 42.5%....................'.length)
})

test('T12 window zero is valid and only sees the match itself', () => {
  const localMetric = { ...metric, match: 'XC', mustAccompany: ['C'] }
  assert.equal(scan('XC', rules({ bounded: [localMetric], window: 0 })).status, 'pass')
  assert.equal(scan('C X', rules({ bounded: [{ ...localMetric, match: 'X' }], window: 0 })).status, 'review_required')
})

test('T13 same-offset rules retain file order', () => {
  const result = scan('submitted', rules({
    blocked: [submitted, { id: 'second', match: 'submitted', message: 'Second synthetic rule.' }],
  }))
  assert.deepEqual(result.hits.map((hit) => hit.ruleId), ['status', 'second'])
})

test('T14 full clean input passes', () => {
  assert.equal(scan('manuscript in preparation', rules({ blocked: [submitted] })).status, 'pass')
})

test('T15 excerpts normalize whitespace and mark truncation', () => {
  const prefix = 'a'.repeat(50)
  const suffix = 'b'.repeat(50)
  const result = scan(`${prefix}\nsubmitted\t${suffix}`, rules({ blocked: [submitted] }))
  assert.doesNotMatch(result.hits[0].excerpt, /[\n\t]/)
  assert.ok(result.hits[0].excerpt.startsWith('…'))
  assert.ok(result.hits[0].excerpt.endsWith('…'))
})

test('T16 plain substring matching catches resubmitted', () => {
  const result = scan('resubmitted', rules({ blocked: [submitted] }))
  assert.equal(result.hitCount, 1)
  assert.equal(result.hits[0].offset, 2)
})

test('T17/T18/T19 fragment coverage runs blocked only and never reports pass', () => {
  const hit = scan('submitted', rules({ blocked: [submitted], bounded: [metric] }), { coverage: 'fragment' })
  assert.equal(hit.status, 'review_required')
  assert.equal(hit.hits[0].coverage, 'fragment')

  const boundedOnly = scan('42.5%', rules({ bounded: [metric] }), { coverage: 'fragment' })
  assert.equal(boundedOnly.status, 'partial')
  assert.equal(boundedOnly.hitCount, 0)

  const deletion = scan('', rules({ blocked: [submitted] }), { coverage: 'fragment' })
  assert.equal(deletion.status, 'partial')
})

test('T20 full mixed hits sort by offset and then global rule order', () => {
  const localMetric = { ...metric, match: 'submitted', mustAccompany: ['context'] }
  const result = scan('submitted', rules({ blocked: [submitted], bounded: [localMetric], window: 0 }))
  assert.deepEqual(result.hits.map((hit) => hit.kind), ['blocked', 'bounded'])
})

test('T22 repeated calls produce deeply equal results', () => {
  const configured = rules({ blocked: [submitted], bounded: [metric], window: 20 })
  assert.deepEqual(scan('submitted and 42.5%', configured), scan('submitted and 42.5%', configured))
})

test('T23 non-ASCII case behavior follows ECMAScript lowercase semantics', () => {
  const accent = { id: 'accent', match: 'ÉTUDE', message: 'Synthetic accent boundary.' }
  assert.equal(scan('étude', rules({ blocked: [accent] })).hitCount, 1)
  assert.equal(scan('étude', rules({ blocked: [accent], caseSensitive: true })).hitCount, 0)
})

test('T25 many hits remain fully represented in the scan result', () => {
  const result = scan('x'.repeat(30), rules({ blocked: [{ id: 'x', match: 'x', message: 'Synthetic.' }] }))
  assert.equal(result.hitCount, 30)
  assert.equal(result.hits.length, 30)
})

test('T26 scan enforces the exact text safety boundary', () => {
  assert.doesNotThrow(() => scan('x'.repeat(MAX_TEXT_CODE_UNITS), rules({ blocked: [submitted] })))
  assert.throws(() => scan('x'.repeat(MAX_TEXT_CODE_UNITS + 1), rules({ blocked: [submitted] })), {
    code: 'SCAN_TEXT_TOO_LARGE',
  })
})

test('scan rejects invalid input and coverage mode', () => {
  assert.throws(() => scan(null, rules()), { code: 'SCAN_TEXT_TYPE' })
  assert.throws(() => scan('', rules(), { coverage: 'unknown' }), { code: 'SCAN_COVERAGE_INVALID' })
})
