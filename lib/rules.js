import { readFile, stat } from 'node:fs/promises'

export const MAX_RULE_FILE_BYTES = 262_144
export const MAX_RULES = 256

const ROOT_KEYS = new Set(['version', 'options', 'blocked', 'bounded'])
const OPTION_KEYS = new Set(['window', 'caseSensitive'])
const BLOCKED_KEYS = new Set(['id', 'match', 'message'])
const BOUNDED_KEYS = new Set(['id', 'match', 'mustAccompany', 'message'])

function rulesError(code, location, detail) {
  const error = new Error(`${location}: ${detail}`)
  error.name = 'ClaimGuardRulesError'
  error.code = code
  error.location = location
  return error
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertObject(value, location) {
  if (!isPlainObject(value)) {
    throw rulesError('RULE_OBJECT_TYPE', location, 'must be a plain object')
  }
}

function rejectUnknownKeys(value, allowed, location) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw rulesError('RULE_UNKNOWN_FIELD', `${location}.${key}`, 'unknown field')
    }
  }
}

function cleanString(value, location, maximum) {
  if (typeof value !== 'string') {
    throw rulesError('RULE_STRING_TYPE', location, 'must be a string')
  }
  const cleaned = value.trim()
  if (cleaned.length === 0) {
    throw rulesError('RULE_STRING_EMPTY', location, 'must not be blank')
  }
  if (cleaned.length > maximum) {
    throw rulesError('RULE_STRING_TOO_LONG', location, `must not exceed ${maximum} UTF-16 code units`)
  }
  return cleaned
}

function validateOptions(raw) {
  if (raw === undefined) return { window: 60, caseSensitive: false }
  assertObject(raw, '$.options')
  rejectUnknownKeys(raw, OPTION_KEYS, '$.options')

  let window = 60
  if (Object.hasOwn(raw, 'window')) {
    if (!Number.isInteger(raw.window) || raw.window < 0 || raw.window > 4096) {
      throw rulesError('RULE_WINDOW_INVALID', '$.options.window', 'must be an integer from 0 through 4096')
    }
    window = raw.window
  }

  let caseSensitive = false
  if (Object.hasOwn(raw, 'caseSensitive')) {
    if (typeof raw.caseSensitive !== 'boolean') {
      throw rulesError('RULE_CASE_SENSITIVE_TYPE', '$.options.caseSensitive', 'must be a boolean')
    }
    caseSensitive = raw.caseSensitive
  }
  return { window, caseSensitive }
}

function validateRuleArray(raw, kind, seenIds) {
  if (raw === undefined) return []
  const location = `$.${kind}`
  if (!Array.isArray(raw)) {
    throw rulesError('RULE_ARRAY_TYPE', location, 'must be an array')
  }

  return raw.map((entry, index) => {
    const itemLocation = `${location}[${index}]`
    assertObject(entry, itemLocation)
    rejectUnknownKeys(entry, kind === 'blocked' ? BLOCKED_KEYS : BOUNDED_KEYS, itemLocation)

    const id = cleanString(entry.id, `${itemLocation}.id`, 96)
    if (seenIds.has(id)) {
      throw rulesError('RULE_ID_DUPLICATE', `${itemLocation}.id`, 'must be globally unique after trimming')
    }
    seenIds.add(id)

    const result = {
      id,
      match: cleanString(entry.match, `${itemLocation}.match`, 256),
      message: cleanString(entry.message, `${itemLocation}.message`, 768),
    }

    if (kind === 'bounded') {
      if (!Array.isArray(entry.mustAccompany)) {
        throw rulesError('RULE_COMPANIONS_TYPE', `${itemLocation}.mustAccompany`, 'must be an array')
      }
      if (entry.mustAccompany.length < 1 || entry.mustAccompany.length > 16) {
        throw rulesError('RULE_COMPANIONS_COUNT', `${itemLocation}.mustAccompany`, 'must contain 1 through 16 items')
      }
      const companions = entry.mustAccompany.map((item, companionIndex) =>
        cleanString(item, `${itemLocation}.mustAccompany[${companionIndex}]`, 256),
      )
      if (new Set(companions).size !== companions.length) {
        throw rulesError('RULE_COMPANION_DUPLICATE', `${itemLocation}.mustAccompany`, 'must not contain duplicate values after trimming')
      }
      result.mustAccompany = companions
    }
    return result
  })
}

export function validateRules(raw) {
  assertObject(raw, '$')
  rejectUnknownKeys(raw, ROOT_KEYS, '$')

  if (raw.version !== 1) {
    throw rulesError('RULE_VERSION_UNSUPPORTED', '$.version', 'must equal 1')
  }

  const seenIds = new Set()
  const blocked = validateRuleArray(raw.blocked, 'blocked', seenIds)
  const bounded = validateRuleArray(raw.bounded, 'bounded', seenIds)
  const count = blocked.length + bounded.length
  if (count < 1 || count > MAX_RULES) {
    throw rulesError('RULE_COUNT_INVALID', '$', `must contain 1 through ${MAX_RULES} total rules`)
  }

  return {
    version: 1,
    options: validateOptions(raw.options),
    blocked,
    bounded,
  }
}

export async function loadRules(filePath, options = {}) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw rulesError('RULE_FILE_PATH_INVALID', '$.rulesPath', 'must be a non-empty string')
  }
  options.signal?.throwIfAborted()

  let metadata
  try {
    metadata = await stat(filePath)
  } catch {
    throw rulesError('RULE_FILE_UNREADABLE', '$.rulesPath', 'rule file is missing or unreadable')
  }
  if (!metadata.isFile()) {
    throw rulesError('RULE_FILE_NOT_REGULAR', '$.rulesPath', 'must refer to a regular file')
  }
  if (metadata.size > MAX_RULE_FILE_BYTES) {
    throw rulesError('RULE_FILE_TOO_LARGE', '$.rulesPath', `must not exceed ${MAX_RULE_FILE_BYTES} bytes`)
  }

  let buffer
  try {
    buffer = await readFile(filePath, { signal: options.signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw rulesError('RULE_FILE_UNREADABLE', '$.rulesPath', 'rule file is missing or unreadable')
  }
  options.signal?.throwIfAborted()
  if (buffer.byteLength > MAX_RULE_FILE_BYTES) {
    throw rulesError('RULE_FILE_TOO_LARGE', '$.rulesPath', `must not exceed ${MAX_RULE_FILE_BYTES} bytes`)
  }

  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw rulesError('RULE_FILE_ENCODING', '$.rulesPath', 'must be valid UTF-8')
  }

  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw rulesError('RULE_FILE_JSON', '$.rulesPath', 'must contain valid strict JSON')
  }
  return validateRules(raw)
}
