#!/usr/bin/env node

import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const HEADER = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
`
const ENABLED = `${HEADER}[]\n`
const DISABLED = `${HEADER}- id: dsh-claim-guard\n  disabled: true\n`

function fail(message) {
  throw new Error(message)
}

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== '--profile' || argv[2] !== '--state') {
    fail('Usage: set-smoke-profile-state.mjs --profile <name> --state <enabled|disabled>')
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(argv[1])) fail('invalid synthetic profile name')
  if (!['enabled', 'disabled'].includes(argv[3])) fail('invalid state')
  return { profile: argv[1], state: argv[3] }
}

const options = parseArgs(process.argv.slice(2))
const dshHome = process.env.DSH_HOME
if (typeof dshHome !== 'string' || !path.isAbsolute(dshHome)) fail('DSH_HOME must be an absolute temporary path')
const homeReal = await realpath(dshHome)
const tempReal = await realpath(os.tmpdir())
if (homeReal !== tempReal && !homeReal.startsWith(`${tempReal}${path.sep}`)) fail('DSH_HOME must be under the temporary directory')
const profileDir = await realpath(path.join(homeReal, 'profiles', options.profile))
if (!profileDir.startsWith(`${homeReal}${path.sep}`)) fail('profile escaped DSH_HOME')
const patchPath = path.join(profileDir, 'cordis.patch.yml')
const patchMetadata = await lstat(patchPath)
if (patchMetadata.isSymbolicLink() || !patchMetadata.isFile()) fail('profile patch must be a regular file')
const current = await readFile(patchPath, 'utf8')
if (current !== ENABLED && current !== DISABLED) fail('refusing to replace a profile patch outside the smoke-test shape')

const temporary = path.join(profileDir, `.cordis.patch.yml.${process.pid}.tmp`)
await writeFile(temporary, options.state === 'disabled' ? DISABLED : ENABLED, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
await rename(temporary, patchPath)
console.log(JSON.stringify({ id: 'dsh-claim-guard', state: options.state }))
