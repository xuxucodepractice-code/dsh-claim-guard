#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

function fail(message) {
  throw new Error(message)
}

function parseArgs(argv) {
  if (argv.length !== 5 || argv[1] !== '--expect' || argv[3] !== '--count') {
    fail('Usage: verify-profile.mjs <dump.txt> --expect <enabled|disabled|absent> --count <n>')
  }
  const count = Number(argv[4])
  if (!Number.isInteger(count) || count < 0) fail('count must be a non-negative integer')
  if (!['enabled', 'disabled', 'absent'].includes(argv[2])) fail('invalid expected state')
  return { dump: argv[0], expect: argv[2], count }
}

function targetRows(text) {
  const lines = text.split(/\r?\n/u)
  const rows = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== '- id: dsh-claim-guard') continue
    const block = [lines[index]]
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].startsWith('- id: ') || lines[cursor].startsWith('# == ')) break
      block.push(lines[cursor])
    }
    rows.push(block)
  }
  return rows
}

const options = parseArgs(process.argv.slice(2))
const text = await readFile(options.dump, 'utf8')
if (text.length > 2_000_000) fail('profile dump exceeds the verification limit')
const rows = targetRows(text)
if (rows.length !== options.count) fail(`expected ${options.count} target row(s), found ${rows.length}`)

let state = 'absent'
if (rows.length > 0) {
  if (rows.length !== 1) fail('target row must be unique')
  const block = rows[0]
  if (!block.includes('  name: dsh-claim-guard')) fail('target row has an unexpected package name')
  const disabled = block.includes('  disabled: true')
  state = disabled ? 'disabled' : 'enabled'
  if (!block.includes('    rulesPath: claims.json')) fail('target row does not contain the expected rulesPath')
}

if (state !== options.expect) fail(`expected target row state ${options.expect}, found ${state}`)
console.log(JSON.stringify({ id: 'dsh-claim-guard', count: rows.length, state }))
