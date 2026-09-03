import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, realpath, rm, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { defineContentToolFixture, ToolRuntime } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'

const requiredEnvironment = ['DSH_HOME', 'CLAIM_GUARD_PROFILE', 'CLAIM_GUARD_WORKSPACE']
const active = requiredEnvironment.every((name) => typeof process.env[name] === 'string' && process.env[name].length > 0)

function rules() {
  return {
    version: 1,
    options: { window: 60, caseSensitive: false },
    blocked: [
      { id: 'synthetic-blocked', match: 'submitted', message: 'Synthetic draft status requires review.' },
    ],
    bounded: [
      { id: 'synthetic-metric', match: '42.5%', mustAccompany: ['synthetic benchmark'], message: 'Label the invented metric.' },
    ],
  }
}

async function pathExists(filePath) {
  try {
    await readFile(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function loadInstalledPlugin() {
  const dshHome = await realpath(process.env.DSH_HOME)
  const profileDir = await realpath(path.join(dshHome, 'profiles', process.env.CLAIM_GUARD_PROFILE))
  if (!profileDir.startsWith(`${dshHome}${path.sep}`)) throw new Error('profile escaped DSH_HOME')
  const profileManifest = path.join(profileDir, 'package.json')
  const fromProfile = createRequire(profileManifest)
  const entry = await realpath(fromProfile.resolve('dsh-claim-guard'))
  if (!entry.startsWith(`${profileDir}${path.sep}`)) throw new Error('consumer resolved the plugin outside the temporary profile')
  const manifest = fromProfile('dsh-claim-guard/package.json')
  assert.equal(manifest.name, 'dsh-claim-guard')
  assert.equal(manifest.version, '0.1.0')
  return import(`${pathToFileURL(entry).href}?consumer-smoke=${Date.now()}`)
}

function makeAgent(workspace) {
  const events = [{ type: 'turn/start', data: {} }]
  return {
    events,
    agent: {
      session: {
        header: { cwd: workspace },
        events,
        append(type, data) {
          events.push({ type, data })
        },
      },
    },
  }
}

async function runWrite(plugin, workspace, options) {
  const ctx = new Context()
  const fibers = []
  const disposers = []
  const { agent, events } = makeAgent(workspace)
  let bodies = 0
  try {
    fibers.push(await ctx.plugin(SystemPrompt, {}))
    fibers.push(await ctx.plugin(ToolRuntime, { mode: 'native' }))
    fibers.push(await ctx.plugin(ApprovalService, { policy: 'ask' }))
    if (options.pluginEnabled) fibers.push(await ctx.plugin(plugin, {}))
    disposers.push(ctx.tools.register(defineContentToolFixture({
      name: 'write',
      description: 'Installed-package consumer smoke fixture.',
      parameters: {
        file_path: { type: 'string', required: true },
        content: { type: 'string', required: true },
      },
      async execute(args, exec) {
        bodies += 1
        const target = path.resolve(exec.agent.session.header.cwd, args.file_path)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, args.content, 'utf8')
        return [{ type: 'text', text: 'consumer fixture completed' }]
      },
    })))
    if (options.outcome !== undefined) {
      disposers.push(ctx.on('approval/request', async () => options.outcome))
    }
    const result = await ctx.tools.execute({
      callId: options.callId,
      name: 'write',
      arguments: { file_path: options.file, content: options.text },
      agent,
      signal: new AbortController().signal,
    })
    return { result, bodies, events }
  } finally {
    for (const disposer of disposers.reverse()) disposer()
    for (const fiber of fibers.reverse()) await fiber.dispose()
  }
}

test('consumer smoke is dormant without an explicit temporary profile contract', async () => {
  if (!active) {
    assert.ok(requiredEnvironment.every((name) => process.env[name] === undefined))
    return
  }

  const workspace = await realpath(process.env.CLAIM_GUARD_WORKSPACE)
  const expectedState = process.env.CLAIM_GUARD_EXPECT ?? 'enabled'
  assert.ok(['enabled', 'disabled'].includes(expectedState))
  const scenario = process.env.CLAIM_GUARD_SCENARIO ?? 'full'
  assert.ok(['full', 'missing-rules'].includes(scenario))
  const plugin = await loadInstalledPlugin()

  if (expectedState === 'disabled') {
    const target = path.join(workspace, 'consumer-disabled.md')
    const observed = await runWrite(plugin, workspace, {
      pluginEnabled: false,
      callId: 'consumer-disabled',
      file: 'consumer-disabled.md',
      text: 'submitted synthetic text',
    })
    assert.equal(observed.result.isError, false)
    assert.equal(observed.bodies, 1)
    assert.equal(await readFile(target, 'utf8'), 'submitted synthetic text')
    assert.equal(observed.events.length, 1)
    return
  }

  const rulesPath = path.join(workspace, 'claims.json')
  if (scenario === 'missing-rules') {
    await rm(rulesPath, { force: true })
    const target = path.join(workspace, 'consumer-missing-rules.md')
    const missing = await runWrite(plugin, workspace, {
      pluginEnabled: true,
      callId: 'consumer-missing-only',
      file: 'consumer-missing-rules.md',
      text: 'clean synthetic text',
    })
    assert.equal(missing.result.isError, true)
    assert.equal(missing.bodies, 0)
    assert.equal(await pathExists(target), false)
    return
  }

  await writeFile(rulesPath, JSON.stringify(rules()), 'utf8')

  const cleanTarget = path.join(workspace, 'consumer-clean.md')
  const clean = await runWrite(plugin, workspace, {
    pluginEnabled: true,
    callId: 'consumer-clean',
    file: 'consumer-clean.md',
    text: 'clean synthetic text',
  })
  assert.equal(clean.result.isError, false)
  assert.equal(clean.bodies, 1)
  assert.equal(await readFile(cleanTarget, 'utf8'), 'clean synthetic text')

  const allowedTarget = path.join(workspace, 'consumer-allowed.md')
  const allowed = await runWrite(plugin, workspace, {
    pluginEnabled: true,
    outcome: 'allowed-once',
    callId: 'consumer-allowed',
    file: 'consumer-allowed.md',
    text: 'submitted synthetic text',
  })
  assert.equal(allowed.result.isError, false)
  assert.equal(allowed.bodies, 1)
  assert.equal(await readFile(allowedTarget, 'utf8'), 'submitted synthetic text')

  const rejectedTarget = path.join(workspace, 'consumer-rejected.md')
  const rejected = await runWrite(plugin, workspace, {
    pluginEnabled: true,
    outcome: 'rejected',
    callId: 'consumer-rejected',
    file: 'consumer-rejected.md',
    text: 'submitted synthetic text',
  })
  assert.equal(rejected.result.isError, true)
  assert.equal(rejected.bodies, 0)
  assert.equal(await pathExists(rejectedTarget), false)

  const unavailableTarget = path.join(workspace, 'consumer-unavailable.md')
  const unavailable = await runWrite(plugin, workspace, {
    pluginEnabled: true,
    callId: 'consumer-unavailable',
    file: 'consumer-unavailable.md',
    text: 'submitted synthetic text',
  })
  assert.equal(unavailable.result.isError, true)
  assert.equal(unavailable.bodies, 0)
  assert.equal(await pathExists(unavailableTarget), false)
  assert.equal(unavailable.events.at(-1).data.outcome, 'unavailable')

  const backupPath = path.join(workspace, 'claims.consumer-backup.json')
  await rename(rulesPath, backupPath)
  try {
    const missingTarget = path.join(workspace, 'consumer-missing-rules.md')
    const missing = await runWrite(plugin, workspace, {
      pluginEnabled: true,
      callId: 'consumer-missing',
      file: 'consumer-missing-rules.md',
      text: 'clean synthetic text',
    })
    assert.equal(missing.result.isError, true)
    assert.equal(missing.bodies, 0)
    assert.equal(await pathExists(missingTarget), false)
  } finally {
    await rename(backupPath, rulesPath)
  }
})
