export const MAX_TEXT_CODE_UNITS = 1_000_000
export const EXCERPT_CONTEXT = 40

function scanError(code, location, detail) {
  const error = new Error(`${location}: ${detail}`)
  error.name = 'ClaimGuardScanError'
  error.code = code
  error.location = location
  return error
}

function findOccurrences(text, needle, caseSensitive) {
  const offsets = []
  if (needle.length === 0 || needle.length > text.length) return offsets

  if (caseSensitive) {
    let offset = text.indexOf(needle)
    while (offset !== -1) {
      offsets.push(offset)
      offset = text.indexOf(needle, offset + 1)
    }
    return offsets
  }

  const foldedText = text.toLowerCase()
  const foldedNeedle = needle.toLowerCase()
  if (foldedText.length === text.length && foldedNeedle.length === needle.length) {
    let offset = foldedText.indexOf(foldedNeedle)
    while (offset !== -1) {
      offsets.push(offset)
      offset = foldedText.indexOf(foldedNeedle, offset + 1)
    }
    return offsets
  }

  for (let offset = 0; offset <= text.length - needle.length; offset += 1) {
    const candidate = text.slice(offset, offset + needle.length)
    if (candidate.toLowerCase() === foldedNeedle) offsets.push(offset)
  }
  return offsets
}

function includesLiteral(text, needle, caseSensitive) {
  return findOccurrences(text, needle, caseSensitive).length > 0
}

function excerptFor(text, offset, length) {
  const start = Math.max(0, offset - EXCERPT_CONTEXT)
  const end = Math.min(text.length, offset + length + EXCERPT_CONTEXT)
  const normalized = text.slice(start, end).replace(/[\n\r\t]/g, ' ')
  return `${start > 0 ? '…' : ''}${normalized}${end < text.length ? '…' : ''}`
}

function makeHit(text, rule, kind, offset, coverage, ruleOrder) {
  return {
    ruleId: rule.id,
    kind,
    coverage,
    match: rule.match,
    matchedText: text.slice(offset, offset + rule.match.length),
    offset,
    excerpt: excerptFor(text, offset, rule.match.length),
    message: rule.message,
    ruleOrder,
  }
}

export function scan(text, rules, options = {}) {
  if (typeof text !== 'string') {
    throw scanError('SCAN_TEXT_TYPE', '$.text', 'must be a string')
  }
  if (text.length > MAX_TEXT_CODE_UNITS) {
    throw scanError('SCAN_TEXT_TOO_LARGE', '$.text', `must not exceed ${MAX_TEXT_CODE_UNITS} UTF-16 code units`)
  }

  const coverage = options.coverage ?? 'full'
  if (coverage !== 'full' && coverage !== 'fragment') {
    throw scanError('SCAN_COVERAGE_INVALID', '$.coverage', 'must be full or fragment')
  }

  const caseSensitive = rules.options.caseSensitive
  const hits = []
  let ruleOrder = 0

  for (const rule of rules.blocked) {
    for (const offset of findOccurrences(text, rule.match, caseSensitive)) {
      hits.push(makeHit(text, rule, 'blocked', offset, coverage, ruleOrder))
    }
    ruleOrder += 1
  }

  if (coverage === 'full') {
    for (const rule of rules.bounded) {
      for (const offset of findOccurrences(text, rule.match, caseSensitive)) {
        const start = Math.max(0, offset - rules.options.window)
        const end = Math.min(text.length, offset + rule.match.length + rules.options.window)
        const windowText = text.slice(start, end)
        const accompanied = rule.mustAccompany.some((companion) =>
          includesLiteral(windowText, companion, caseSensitive),
        )
        if (!accompanied) {
          hits.push(makeHit(text, rule, 'bounded', offset, coverage, ruleOrder))
        }
      }
      ruleOrder += 1
    }
  }

  hits.sort((left, right) => left.offset - right.offset || left.ruleOrder - right.ruleOrder)

  const status = hits.length > 0
    ? 'review_required'
    : coverage === 'full'
      ? 'pass'
      : 'partial'

  return {
    status,
    coverage,
    hitCount: hits.length,
    hits,
  }
}
