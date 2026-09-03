import Schema from '@deepseek-ai/schemastery'

import {
  classifyTargetPath,
  resolveRulesPath,
  resolveWorkspace,
  validateConfig,
} from './lib/config.js'
import { extractMutation } from './lib/mutation.js'
import { renderReport, safeFailureMessage } from './lib/report.js'
import { loadRules } from './lib/rules.js'
import { scan } from './lib/scan.js'

export const name = 'claim-guard'
export const inject = ['tools']

const optionalStringArray = () => Schema.union([
  Schema.array(Schema.string()).required(),
])

const ConfigShape = Schema.object({
  rulesPath: Schema.string(),
  include: optionalStringArray(),
  exclude: optionalStringArray(),
}).required()

export const Config = Schema.union([ConfigShape])

const DEFAULT_INTERNALS = Object.freeze({
  classifyTargetPath,
  extractMutation,
  loadRules,
  renderReport,
  resolveRulesPath,
  resolveWorkspace,
  safeFailureMessage,
  scan,
})

function checkCancelled(signal) {
  signal?.throwIfAborted()
}

export function createPreExecuteHook(config, overrides = {}) {
  const internals = { ...DEFAULT_INTERNALS, ...overrides }

  return async function claimGuardPreExecute(exec, next) {
    try {
      checkCancelled(exec?.signal)

      const extracted = internals.extractMutation(exec)
      if (extracted.kind === 'skip') {
        checkCancelled(exec?.signal)
        return next()
      }
      if (extracted.kind === 'deny') return extracted

      const workspace = internals.resolveWorkspace(config, exec)
      const rulesPath = internals.resolveRulesPath(config, workspace)
      const target = internals.classifyTargetPath(
        extracted.targetPath,
        workspace,
        rulesPath,
        config,
      )
      if (target.status !== 'included') {
        checkCancelled(exec?.signal)
        return next()
      }

      const rules = await internals.loadRules(rulesPath, { signal: exec?.signal })
      checkCancelled(exec?.signal)
      const result = internals.scan(extracted.text, rules, {
        coverage: extracted.coverage,
      })
      checkCancelled(exec?.signal)

      if (result.status !== 'review_required') {
        checkCancelled(exec?.signal)
        return next()
      }

      const reason = internals.renderReport(result, {
        toolName: extracted.toolName,
        relativePath: target.relativePath,
      })
      checkCancelled(exec?.signal)
      return { kind: 'ask', reason }
    } catch (error) {
      const failure = exec?.signal?.aborted
        ? { code: 'OPERATION_ABORTED' }
        : error
      return {
        kind: 'deny',
        reason: internals.safeFailureMessage(failure),
      }
    }
  }
}

export function apply(ctx, rawConfig = {}) {
  const config = validateConfig(rawConfig)
  ctx.on('tools/pre-execute', createPreExecuteHook(config))
}
