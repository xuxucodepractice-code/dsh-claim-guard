import path from 'node:path'

const SUPPORTED_TOOLS = new Set(['write', 'edit', 'str_replace_editor'])

const DENY_MESSAGES = Object.freeze({
  MUTATION_EXEC_INVALID: 'Claim Guard received an invalid tool execution envelope.',
  MUTATION_ARGUMENTS_INVALID: 'Claim Guard received invalid tool arguments.',
  MUTATION_PATH_INVALID: 'Claim Guard received an invalid target path.',
  MUTATION_TEXT_INVALID: 'Claim Guard received invalid text content.',
  MUTATION_EDIT_INVALID: 'Claim Guard received an invalid edit operation.',
  MUTATION_COMMAND_INVALID: 'Claim Guard received an unsupported editor command shape.',
  MUTATION_INSERT_LINE_INVALID: 'Claim Guard received an invalid insertion line.',
})

function deny(code) {
  return {
    kind: 'deny',
    reason: `[${code}] ${DENY_MESSAGES[code]}`,
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasString(value, key) {
  return Object.hasOwn(value, key) && typeof value[key] === 'string'
}

function hasNonEmptyString(value, key) {
  return hasString(value, key) && value[key].trim().length > 0
}

function mutation(toolName, targetPath, text, coverage) {
  return {
    kind: 'mutation',
    toolName,
    targetPath,
    text,
    coverage,
  }
}

function extractWrite(args) {
  if (!hasNonEmptyString(args, 'file_path')) return deny('MUTATION_PATH_INVALID')
  if (!hasString(args, 'content')) return deny('MUTATION_TEXT_INVALID')
  return mutation('write', args.file_path, args.content, 'full')
}

function extractEdit(args) {
  if (!hasNonEmptyString(args, 'file_path')) return deny('MUTATION_PATH_INVALID')
  if (!hasNonEmptyString(args, 'old_string') || !hasString(args, 'new_string')) {
    return deny('MUTATION_EDIT_INVALID')
  }
  if (args.old_string === args.new_string) return deny('MUTATION_EDIT_INVALID')
  if (Object.hasOwn(args, 'replace_all') && typeof args.replace_all !== 'boolean') {
    return deny('MUTATION_EDIT_INVALID')
  }
  return mutation('edit', args.file_path, args.new_string, 'fragment')
}

function extractEditor(args) {
  if (!hasNonEmptyString(args, 'path') || !path.isAbsolute(args.path)) {
    return deny('MUTATION_PATH_INVALID')
  }
  if (!hasString(args, 'command')) return deny('MUTATION_COMMAND_INVALID')

  if (args.command === 'view') {
    return { kind: 'skip', status: 'not_applicable' }
  }

  if (args.command === 'create') {
    if (!hasString(args, 'file_text')) return deny('MUTATION_TEXT_INVALID')
    return mutation('str_replace_editor', args.path, args.file_text, 'full')
  }

  if (args.command === 'str_replace') {
    if (!hasNonEmptyString(args, 'old_str')) return deny('MUTATION_EDIT_INVALID')
    if (!Object.hasOwn(args, 'new_str')) {
      return mutation('str_replace_editor', args.path, '', 'fragment')
    }
    if (typeof args.new_str !== 'string') return deny('MUTATION_TEXT_INVALID')
    return mutation('str_replace_editor', args.path, args.new_str, 'fragment')
  }

  if (args.command === 'insert') {
    if (!Object.hasOwn(args, 'insert_line') || !Number.isInteger(args.insert_line) || args.insert_line < 0) {
      return deny('MUTATION_INSERT_LINE_INVALID')
    }
    if (!hasString(args, 'new_str')) return deny('MUTATION_TEXT_INVALID')
    return mutation('str_replace_editor', args.path, args.new_str, 'fragment')
  }

  return deny('MUTATION_COMMAND_INVALID')
}

export function extractMutation(exec) {
  if (!isPlainObject(exec) || typeof exec.name !== 'string' || exec.name.trim().length === 0) {
    return deny('MUTATION_EXEC_INVALID')
  }
  if (!isPlainObject(exec.arguments)) return deny('MUTATION_ARGUMENTS_INVALID')
  if (!SUPPORTED_TOOLS.has(exec.name)) return { kind: 'skip', status: 'unsupported' }

  if (exec.name === 'write') return extractWrite(exec.arguments)
  if (exec.name === 'edit') return extractEdit(exec.arguments)
  return extractEditor(exec.arguments)
}
