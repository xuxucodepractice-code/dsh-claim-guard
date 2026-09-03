#!/usr/bin/env node

import { createRequire } from 'node:module'
import { lstat, readFile, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

function fail(message) {
  throw new Error(message)
}

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== '--profile' || argv[2] !== '--expect') {
    fail('Usage: verify-profile-state.mjs --profile <name> --expect <installed|absent>')
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(argv[1])) fail('invalid synthetic profile name')
  if (!['installed', 'absent'].includes(argv[3])) fail('invalid expected profile state')
  return { profile: argv[1], expect: argv[3] }
}

async function assertTemporaryProfile(profile) {
  const dshHome = process.env.DSH_HOME
  if (typeof dshHome !== 'string' || !path.isAbsolute(dshHome)) fail('DSH_HOME must be an absolute temporary path')
  const homeReal = await realpath(dshHome)
  const tempReal = await realpath(os.tmpdir())
  if (homeReal !== tempReal && !homeReal.startsWith(`${tempReal}${path.sep}`)) {
    fail('DSH_HOME must remain under the operating-system temporary directory')
  }
  const profileDir = path.join(homeReal, 'profiles', profile)
  const profileMetadata = await lstat(profileDir)
  if (profileMetadata.isSymbolicLink() || !profileMetadata.isDirectory()) fail('profile must be a real directory')
  const profileReal = await realpath(profileDir)
  if (!profileReal.startsWith(`${homeReal}${path.sep}`)) fail('profile escaped DSH_HOME')
  return profileReal
}

const options = parseArgs(process.argv.slice(2))
const profileDir = await assertTemporaryProfile(options.profile)
const manifestPath = path.join(profileDir, 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const dependencies = manifest.dependencies ?? {}
const bundles = manifest.dsh?.profile?.bundles
if (!Array.isArray(bundles)) fail('profile bundle list is missing')
if (dependencies['@deepseek-ai/dsh'] !== undefined) fail('profile must not install the DSH CLI as a plugin dependency')

const dependencyPresent = typeof dependencies['dsh-claim-guard'] === 'string'
const bundleCount = bundles.filter((name) => name === 'dsh-claim-guard').length
if (options.expect === 'installed') {
  if (!dependencyPresent || bundleCount !== 1) fail('installed package dependency and bundle must each appear exactly once')
  const fromProfile = createRequire(manifestPath)
  const installedManifest = fromProfile('dsh-claim-guard/package.json')
  if (installedManifest.name !== 'dsh-claim-guard' || installedManifest.version !== '0.1.0') {
    fail('resolved installed package identity is incorrect')
  }
  if (installedManifest.dsh?.bundle?.patch !== './cordis.patch.yml') fail('installed package has no valid DSH bundle patch')
} else {
  if (dependencyPresent || bundleCount !== 0) fail('removed package remains in the profile dependency or bundle list')
  const fromProfile = createRequire(manifestPath)
  try {
    fromProfile.resolve('dsh-claim-guard/package.json')
    fail('removed package still resolves from the profile')
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error
  }
}

console.log(JSON.stringify({
  profile: options.profile,
  state: options.expect,
  dependencyPresent,
  bundleCount,
  dshCliDependencyPresent: false,
}))
