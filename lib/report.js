export const MAX_REPORT_HITS = 20
export const MAX_REPORT_CODE_UNITS = 6000
export const MAX_FAILURE_CODE_UNITS = 1000

const SAFE_FAILURES = Object.freeze({
  CONFIG_ROOT_TYPE: 'Claim Guard configuration is invalid.',
  CONFIG_UNKNOWN_FIELD: 'Claim Guard configuration contains an unknown field.',
  CONFIG_RULES_PATH_TYPE: 'Claim Guard rulesPath is invalid.',
  CONFIG_RULES_PATH_EMPTY: 'Claim Guard rulesPath is empty.',
  CONFIG_TYPE: 'Claim Guard path filter configuration is invalid.',
  CONFIG_PATTERN_TYPE: 'Claim Guard path filter contains a non-string pattern.',
  CONFIG_PATTERN_EMPTY: 'Claim Guard path filter contains an empty pattern.',
  CONFIG_PATTERN_INVALID: 'Claim Guard path filter contains an invalid glob.',
  WORKSPACE_UNAVAILABLE: 'Claim Guard cannot determine a trusted workspace.',
  TARGET_PATH_INVALID: 'Claim Guard received an invalid target path.',
  RULES_PATH_UNRESOLVED: 'Claim Guard cannot resolve the rule file path.',
  RULE_FILE_PATH_INVALID: 'Claim Guard rule file path is invalid.',
  RULE_FILE_UNREADABLE: 'Claim Guard rule file is missing or unreadable.',
  RULE_FILE_NOT_REGULAR: 'Claim Guard rule path is not a regular file.',
  RULE_FILE_TOO_LARGE: 'Claim Guard rule file exceeds the configured safety limit.',
  RULE_FILE_ENCODING: 'Claim Guard rule file is not valid UTF-8.',
  RULE_FILE_JSON: 'Claim Guard rule file is not valid strict JSON.',
  RULE_OBJECT_TYPE: 'Claim Guard rule structure is invalid.',
  RULE_UNKNOWN_FIELD: 'Claim Guard rule file contains an unknown field.',
  RULE_VERSION_UNSUPPORTED: 'Claim Guard rule version is unsupported.',
  RULE_WINDOW_INVALID: 'Claim Guard window is outside the supported range.',
  RULE_CASE_SENSITIVE_TYPE: 'Claim Guard caseSensitive option is invalid.',
  RULE_ARRAY_TYPE: 'Claim Guard rule collection is invalid.',
  RULE_STRING_TYPE: 'Claim Guard rule contains a non-string field.',
  RULE_STRING_EMPTY: 'Claim Guard rule contains an empty required field.',
  RULE_STRING_TOO_LONG: 'Claim Guard rule contains a field above the safety limit.',
  RULE_ID_DUPLICATE: 'Claim Guard rule identifiers are not unique.',
  RULE_COMPANIONS_TYPE: 'Claim Guard bounded companions are invalid.',
  RULE_COMPANIONS_COUNT: 'Claim Guard bounded companion count is invalid.',
  RULE_COMPANION_DUPLICATE: 'Claim Guard bounded companions contain duplicates.',
  RULE_COUNT_INVALID: 'Claim Guard rule count is outside the supported range.',
  SCAN_TEXT_TYPE: 'Claim Guard received non-text content.',
  SCAN_TEXT_TOO_LARGE: 'Claim Guard text exceeds the configured safety limit.',
  SCAN_COVERAGE_INVALID: 'Claim Guard received an invalid coverage mode.',
  REPORT_RESULT_INVALID: 'Claim Guard could not render a safe review report.',
  OPERATION_ABORTED: 'Claim Guard stopped because the operation was cancelled.',
})

function escapeMarkdown(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|\-])/g, '\\$1')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '�')
}

function shortContext(value, maximum = 200) {
  if (typeof value !== 'string') return null
  const singleLine = value.replace(/[\n\r\t]/g, ' ').trim()
  if (singleLine.length <= maximum) return singleLine
  return `${singleLine.slice(0, maximum - 1)}…`
}

function hitBlock(hit, index) {
  return [
    `${index}. ${escapeMarkdown(hit.ruleId)} · ${hit.kind} · ${hit.coverage} · offset ${hit.offset}`,
    `   > ${escapeMarkdown(hit.excerpt)}`,
    `   Reason: ${escapeMarkdown(hit.message)}`,
  ].join('\n')
}

export function renderReport(result, context = {}) {
  if (!result || !Array.isArray(result.hits) || typeof result.hitCount !== 'number') {
    const error = new Error('$.result: invalid scan result')
    error.code = 'REPORT_RESULT_INVALID'
    throw error
  }

  if (result.status === 'pass') return '✅ No configured claim boundary was matched.'
  if (result.status === 'partial') {
    return 'ℹ️ Only the inserted or replacement fragment was checked for blocked rules; the full file and bounded rules were not verified.'
  }
  if (result.status !== 'review_required') {
    return `ℹ️ Claim Guard did not evaluate this operation as a complete text write (${escapeMarkdown(result.status)}).`
  }

  const headerLines = [`⚠️ Claim Guard requires review: ${result.hitCount} match${result.hitCount === 1 ? '' : 'es'}.`]
  const toolName = shortContext(context.toolName)
  const relativePath = shortContext(context.relativePath)
  if (toolName) headerLines.push(`Tool: ${escapeMarkdown(toolName)}`)
  if (relativePath) headerLines.push(`Path: ${escapeMarkdown(relativePath)}`)
  if (result.coverage === 'fragment') {
    headerLines.push('Coverage: inserted/replacement fragment only; full-file and bounded checks were not performed.')
  }

  const header = headerLines.join('\n')
  const blocks = []
  let shown = 0
  const candidateHits = result.hits.slice(0, MAX_REPORT_HITS)

  for (const hit of candidateHits) {
    const block = hitBlock(hit, shown + 1)
    const omittedAfter = result.hitCount - (shown + 1)
    const footer = omittedAfter > 0 ? `\n\n${omittedAfter} additional match${omittedAfter === 1 ? '' : 'es'} omitted.` : ''
    const candidate = `${header}\n\n${[...blocks, block].join('\n\n')}${footer}`
    if (candidate.length > MAX_REPORT_CODE_UNITS) break
    blocks.push(block)
    shown += 1
  }

  const omitted = result.hitCount - shown
  const footer = omitted > 0 ? `\n\n${omitted} additional match${omitted === 1 ? '' : 'es'} omitted.` : ''
  const report = `${header}${blocks.length > 0 ? `\n\n${blocks.join('\n\n')}` : ''}${footer}`
  if (report.length > MAX_REPORT_CODE_UNITS) {
    return `${header.slice(0, Math.max(0, MAX_REPORT_CODE_UNITS - 80))}\n\nMatches omitted because the safe report limit was reached.`
  }
  return report
}

export function safeFailureMessage(error) {
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR'
  const message = SAFE_FAILURES[code] ?? 'Claim Guard could not safely complete the check.'
  const safeCode = /^[A-Z0-9_]+$/.test(code) ? code : 'INTERNAL_ERROR'
  const result = `[${safeCode}] ${message}`
  return result.slice(0, MAX_FAILURE_CODE_UNITS)
}
