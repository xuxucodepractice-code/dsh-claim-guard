import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_FAILURE_CODE_UNITS,
  MAX_REPORT_CODE_UNITS,
  renderReport,
  safeFailureMessage,
} from '../lib/report.js'

function hit(index, overrides = {}) {
  return {
    ruleId: `rule-${index}`,
    kind: 'blocked',
    coverage: 'full',
    match: 'submitted',
    matchedText: 'submitted',
    offset: index,
    excerpt: `synthetic submitted excerpt ${index}`,
    message: 'Synthetic boundary.',
    ruleOrder: index,
    ...overrides,
  }
}

test('renderReport emits stable pass and partial messages', () => {
  assert.match(renderReport({ status: 'pass', coverage: 'full', hitCount: 0, hits: [] }), /^✅/)
  assert.match(renderReport({ status: 'partial', coverage: 'fragment', hitCount: 0, hits: [] }), /fragment/)
})

test('renderReport includes bounded context without copying an entire document', () => {
  const result = { status: 'review_required', coverage: 'full', hitCount: 1, hits: [hit(7, { kind: 'bounded' })] }
  const report = renderReport(result, { toolName: 'write', relativePath: 'docs/demo.md' })
  assert.ok(report.includes('rule\\-7'))
  assert.match(report, /bounded/)
  assert.match(report, /offset 7/)
  assert.ok(report.includes('docs/demo\\.md'))
  assert.ok(report.length < MAX_REPORT_CODE_UNITS)
})

test('renderReport escapes Markdown, HTML, and control characters', () => {
  const malicious = hit(0, {
    ruleId: '`id`',
    excerpt: '<script>bad()</script> **bold**',
    message: '[click](https://example.invalid)\u0000',
  })
  const report = renderReport({ status: 'review_required', coverage: 'full', hitCount: 1, hits: [malicious] })
  assert.doesNotMatch(report, /<script>/)
  assert.doesNotMatch(report, /\*\*bold\*\*/)
  assert.doesNotMatch(report, /\[click\]\(https:/)
  assert.doesNotMatch(report, /\u0000/)
})

test('fragment review is prominently labelled', () => {
  const result = { status: 'review_required', coverage: 'fragment', hitCount: 1, hits: [hit(0, { coverage: 'fragment' })] }
  assert.match(renderReport(result), /fragment only/)
})

test('report caps displayed hits and total length without truncating the scan count', () => {
  const hits = Array.from({ length: 30 }, (_, index) => hit(index, { message: 'm'.repeat(400) }))
  const report = renderReport({ status: 'review_required', coverage: 'full', hitCount: hits.length, hits })
  assert.ok(report.length <= MAX_REPORT_CODE_UNITS)
  assert.match(report, /additional match/)
  assert.match(report, /30 matches/)
})

test('safeFailureMessage maps known codes and never leaks arbitrary error data', () => {
  const error = new Error(`/private/claim-guard-fixture/secret.json ${'x'.repeat(2000)}`)
  error.code = 'RULE_FILE_JSON'
  error.stack = `token=secret ${error.stack}`
  const message = safeFailureMessage(error)
  assert.match(message, /^\[RULE_FILE_JSON\]/)
  assert.doesNotMatch(message, /Users|secret|token/)
  assert.ok(message.length <= MAX_FAILURE_CODE_UNITS)
})

test('safeFailureMessage sanitizes unknown error codes', () => {
  const message = safeFailureMessage({ code: 'bad/path', message: '/private/value' })
  assert.doesNotMatch(message, /private|bad\/path/)
  assert.ok(message.length <= MAX_FAILURE_CODE_UNITS)
})

test('renderReport rejects malformed result objects', () => {
  assert.throws(() => renderReport(null), { code: 'REPORT_RESULT_INVALID' })
})
