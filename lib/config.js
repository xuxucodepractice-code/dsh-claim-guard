import path from 'node:path'

export const DEFAULT_CONFIG = Object.freeze({
  rulesPath: 'claims.json',
  include: Object.freeze(['**/*.md', '**/*.mdx', '**/*.txt']),
  exclude: Object.freeze([]),
})

const CONFIG_KEYS = new Set(['rulesPath', 'include', 'exclude'])

function configError(code, location, detail) {
  const error = new Error(`${location}: ${detail}`)
  error.name = 'ClaimGuardConfigError'
  error.code = code
  error.location = location
  return error
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validatePatternArray(value, location, fallback) {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value)) {
    throw configError('CONFIG_TYPE', location, 'must be an array')
  }

  const result = []
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value) || typeof value[index] !== 'string') {
      throw configError('CONFIG_PATTERN_TYPE', `${location}[${index}]`, 'must be a string')
    }
    const pattern = value[index].trim()
    if (pattern.length === 0) {
      throw configError('CONFIG_PATTERN_EMPTY', `${location}[${index}]`, 'must not be blank')
    }
    try {
      path.matchesGlob('claim-guard-probe.md', pattern)
    } catch {
      throw configError('CONFIG_PATTERN_INVALID', `${location}[${index}]`, 'is not a valid glob')
    }
    result.push(pattern)
  }
  return result
}

export function validateConfig(raw) {
  const value = raw === undefined ? {} : raw
  if (!isPlainObject(value)) {
    throw configError('CONFIG_ROOT_TYPE', '$', 'configuration must be a plain object')
  }

  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) {
      throw configError('CONFIG_UNKNOWN_FIELD', `$.${key}`, 'unknown field')
    }
  }

  let rulesPath = DEFAULT_CONFIG.rulesPath
  if (Object.hasOwn(value, 'rulesPath')) {
    if (typeof value.rulesPath !== 'string') {
      throw configError('CONFIG_RULES_PATH_TYPE', '$.rulesPath', 'must be a string')
    }
    rulesPath = value.rulesPath.trim()
    if (rulesPath.length === 0) {
      throw configError('CONFIG_RULES_PATH_EMPTY', '$.rulesPath', 'must not be blank')
    }
  }

  return {
    rulesPath,
    include: validatePatternArray(value.include, '$.include', DEFAULT_CONFIG.include),
    exclude: validatePatternArray(value.exclude, '$.exclude', DEFAULT_CONFIG.exclude),
  }
}

export function resolveWorkspace(_config, exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.trim().length === 0 || !path.isAbsolute(cwd)) {
    throw configError('WORKSPACE_UNAVAILABLE', '$.exec.agent.session.header.cwd', 'must be an absolute path')
  }
  return path.resolve(cwd)
}

export function resolveRulesPath(config, workspace) {
  if (!config || typeof config.rulesPath !== 'string') {
    throw configError('CONFIG_RULES_PATH_TYPE', '$.rulesPath', 'must be a string')
  }
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) {
    throw configError('WORKSPACE_UNAVAILABLE', '$.workspace', 'must be an absolute path')
  }
  return path.isAbsolute(config.rulesPath)
    ? path.resolve(config.rulesPath)
    : path.resolve(workspace, config.rulesPath)
}

function isOutsideWorkspace(relativePath) {
  return relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)
}

function matchesAny(relativePath, patterns) {
  return patterns.some((pattern) => path.matchesGlob(relativePath, pattern))
}

export function classifyTargetPath(targetPath, workspace, rulesPath, config) {
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    throw configError('TARGET_PATH_INVALID', '$.targetPath', 'must be a non-empty string')
  }
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) {
    throw configError('WORKSPACE_UNAVAILABLE', '$.workspace', 'must be an absolute path')
  }
  if (typeof rulesPath !== 'string' || !path.isAbsolute(rulesPath)) {
    throw configError('RULES_PATH_UNRESOLVED', '$.rulesPath', 'must be an absolute path')
  }

  const absoluteTarget = path.resolve(workspace, targetPath)
  const absoluteWorkspace = path.resolve(workspace)
  const absoluteRules = path.resolve(rulesPath)

  if (absoluteTarget === absoluteRules) {
    return { status: 'not_applicable' }
  }

  const relativeNative = path.relative(absoluteWorkspace, absoluteTarget)
  if (isOutsideWorkspace(relativeNative)) {
    return { status: 'unsupported' }
  }

  const relativePath = relativeNative.split(path.sep).join('/') || '.'
  if (matchesAny(relativePath, config.exclude)) {
    return { status: 'not_applicable' }
  }
  if (config.include.length > 0 && !matchesAny(relativePath, config.include)) {
    return { status: 'not_applicable' }
  }
  return { status: 'included', relativePath }
}
