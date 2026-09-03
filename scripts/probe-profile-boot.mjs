#!/usr/bin/env node

import { createRequire } from 'node:module'
import { realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const TIMEOUT_MS = 45_000
const OUTPUT_LIMIT = 64_000

function fail(message) {
  throw new Error(message)
}

async function assertTemporaryDshHome() {
  const value = process.env.DSH_HOME
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail('DSH_HOME must be an existing absolute temporary path')
  const actual = await realpath(value)
  const temporary = await realpath(os.tmpdir())
  if (actual !== temporary && !actual.startsWith(`${temporary}${path.sep}`)) fail('DSH_HOME must remain under the operating-system temporary directory')
  return actual
}

function dshBin() {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
  const manifest = require(manifestPath)
  if (manifest.version !== '0.1.1-rc.2' || typeof manifest.bin?.dsh !== 'string') {
    fail('installed DSH CLI metadata differs from the frozen baseline')
  }
  return path.resolve(path.dirname(manifestPath), manifest.bin.dsh)
}

async function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DSH did not exit after SIGTERM')), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

await assertTemporaryDshHome()
const child = spawn(process.execPath, [
  dshBin(),
  'web',
  '--no-open',
  '--host',
  '127.0.0.1',
  '--port',
  '0',
], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
let ready
const readyPromise = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('DSH web readiness timed out')), TIMEOUT_MS)
  const inspect = (chunk) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT)
    const match = /dsh web: http:\/\/127\.0\.0\.1:(\d+)/u.exec(output)
    if (match) {
      clearTimeout(timer)
      ready = Number(match[1])
      resolve(ready)
    }
  }
  child.stdout.on('data', inspect)
  child.stderr.on('data', inspect)
  child.once('exit', (code, signal) => {
    if (ready === undefined) {
      clearTimeout(timer)
      reject(new Error(`DSH exited before readiness (code ${String(code)}, signal ${String(signal)})`))
    }
  })
  child.once('error', (error) => {
    clearTimeout(timer)
    reject(error)
  })
})

try {
  const port = await readyPromise
  const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) fail(`DSH web readiness request returned HTTP ${response.status}`)
  child.kill('SIGTERM')
  const exited = await waitForExit(child, 15_000)
  if (exited.code !== 0 || exited.signal !== null) fail('DSH did not complete a graceful zero-exit shutdown')
  console.log(JSON.stringify({
    profile: 'web',
    host: '127.0.0.1',
    portAssigned: Number.isInteger(port) && port > 0,
    httpStatus: response.status,
    gracefulSigterm: true,
  }))
} catch (error) {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  throw error
}
