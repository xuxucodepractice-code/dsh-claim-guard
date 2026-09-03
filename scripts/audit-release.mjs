#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const PUBLIC_FILES = Object.freeze([
  '.gitattributes',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/workflows/ci.yml',
  '.gitignore',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'RECON.md',
  'SECURITY.md',
  'claims.example.json',
  'cordis.patch.yml',
  'docs/demo-synthetic.png',
  'index.js',
  'lib/config.js',
  'lib/mutation.js',
  'lib/report.js',
  'lib/rules.js',
  'lib/scan.js',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts/audit-release.mjs',
  'scripts/benchmark.mjs',
  'scripts/probe-profile-boot.mjs',
  'scripts/recon-config-schema.mjs',
  'scripts/set-smoke-profile-state.mjs',
  'scripts/verify-profile-state.mjs',
  'scripts/verify-profile.mjs',
  'test/config.test.js',
  'test/consumer-smoke.test.js',
  'test/hook.test.js',
  'test/integration.test.js',
  'test/mutation.test.js',
  'test/report.test.js',
  'test/rules.test.js',
  'test/scan.test.js',
])

const TARBALL_FILES = Object.freeze([
  'package/LICENSE',
  'package/README.md',
  'package/claims.example.json',
  'package/cordis.patch.yml',
  'package/index.js',
  'package/lib/config.js',
  'package/lib/mutation.js',
  'package/lib/report.js',
  'package/lib/rules.js',
  'package/lib/scan.js',
  'package/package.json',
])

const EXPECTED_PACKAGE_FILES = Object.freeze([
  'index.js',
  'lib/',
  'claims.example.json',
  'cordis.patch.yml',
])

const BINARY_PUBLIC_FILES = new Set(['docs/demo-synthetic.png'])
const FORBIDDEN_PATH_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/u,
  /(^|\/)Instruction(?:\/|$)/u,
  /(^|\/)artifacts\/private(?:\/|$)/u,
  /(^|\/)private(?:\/|$)/u,
  /(^|\/)claims(?:\.real)?\.json$/u,
  /(^|\/)(?:session|profile-dump)(?:[._-]|\/|$)/iu,
  /\.log$/iu,
]

const FORBIDDEN_CONTENT_PATTERNS = [
  { label: 'private key header', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u },
  { label: 'GitHub classic token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u },
  { label: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/u },
  { label: 'npm access token', pattern: /\bnpm_[A-Za-z0-9]{30,}\b/u },
  { label: 'OpenAI-style secret', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/u },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { label: 'macOS user-home path', pattern: /\/Users\/[^/\s"']+/u },
  { label: 'Linux user-home path', pattern: /\/home\/[^/\s"']+/u },
  { label: 'Windows user-home path', pattern: /[A-Za-z]:\\Users\\[^\\\s"']+/u },
]

function fail(message) {
  throw new Error(message)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    fail(`${command} failed with exit code ${result.status}`)
  }
  return result.stdout
}

function frozenDshBin() {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
  const manifest = require(manifestPath)
  if (manifest.version !== '0.1.1-rc.2' || typeof manifest.bin?.dsh !== 'string') {
    fail('installed DSH CLI metadata differs from the frozen baseline')
  }
  return path.resolve(path.dirname(manifestPath), manifest.bin.dsh)
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'))
}

function assertExactList(actual, expected, label) {
  const actualSorted = sorted(actual)
  const expectedSorted = sorted(expected)
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    const missing = expectedSorted.filter((entry) => !actualSorted.includes(entry))
    const extra = actualSorted.filter((entry) => !expectedSorted.includes(entry))
    fail(`${label} mismatch (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
  }
}

function assertSafePath(filePath, label) {
  if (filePath.length === 0 || filePath.includes('\0') || path.posix.isAbsolute(filePath)) {
    fail(`${label} contains an unsafe path`)
  }
  const normalized = path.posix.normalize(filePath)
  if (normalized !== filePath || normalized === '..' || normalized.startsWith('../')) {
    fail(`${label} contains a non-canonical or parent path`)
  }
  for (const pattern of FORBIDDEN_PATH_PATTERNS) {
    if (pattern.test(filePath)) fail(`${label} contains a forbidden path`)
  }
}

function assertSafeText(text, label) {
  for (const { label: finding, pattern } of FORBIDDEN_CONTENT_PATTERNS) {
    if (pattern.test(text)) fail(`${label} contains a forbidden ${finding}`)
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--staged') return { mode: 'staged' }
  if (argv[0] === '--tarball' && typeof argv[1] === 'string' && argv[2] === '--commit' && typeof argv[3] === 'string' && argv.length === 4) {
    return { mode: 'tarball', tarball: argv[1], commit: argv[3] }
  }
  fail('Usage: audit-release.mjs --staged | --tarball <file.tgz> --commit <commit>')
}

async function auditStaged() {
  const raw = run('git', ['ls-files', '--stage', '-z'], { encoding: 'buffer' })
  const entries = raw.toString('utf8').split('\0').filter(Boolean).map((record) => {
    const tab = record.indexOf('\t')
    if (tab < 0) fail('git staged entry could not be parsed')
    const [mode, object, stage] = record.slice(0, tab).split(' ')
    const filePath = record.slice(tab + 1)
    return { mode, object, stage, path: filePath }
  })

  assertExactList(entries.map((entry) => entry.path), PUBLIC_FILES, 'staged public file allowlist')
  for (const entry of entries) {
    assertSafePath(entry.path, 'staged tree')
    if (entry.stage !== '0') fail('staged tree contains an unresolved merge entry')
    if (entry.mode !== '100644' && entry.mode !== '100755') fail('staged tree contains a symlink or special file')
    if (entry.object.length !== 40 && entry.object.length !== 64) fail('staged tree contains an invalid object id')
    if (!BINARY_PUBLIC_FILES.has(entry.path)) {
      const contents = run('git', ['show', `:${entry.path}`])
      assertSafeText(contents, `staged ${entry.path}`)
    }
  }

  console.log(JSON.stringify({ mode: 'staged', files: entries.length, result: 'passed' }))
}

function tarEntries(tarball) {
  const lines = run('tar', ['-tvzf', tarball]).split('\n').filter(Boolean)
  return lines.map((line) => {
    const type = line[0]
    const parts = line.trim().split(/\s+/u)
    const filePath = parts.at(-1)
    if (!filePath) fail('tar entry could not be parsed')
    return { type, path: filePath.replace(/\/$/u, '') }
  }).filter((entry) => entry.type !== 'd')
}

async function verifiedTemporaryDirectory(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  await chmod(directory, 0o700)
  const resolved = await realpath(directory)
  const resolvedTmp = await realpath(os.tmpdir())
  if (path.dirname(resolved) !== resolvedTmp || !path.basename(resolved).startsWith(prefix)) {
    fail('temporary directory escaped the operating-system temporary root')
  }
  return resolved
}

function gitBytes(commit, filePath) {
  return run('git', ['show', `${commit}:${filePath}`], { encoding: 'buffer' })
}

function assertPackageManifest(manifest) {
  if (manifest.name !== 'dsh-claim-guard' || manifest.version !== '0.1.0') {
    fail('tarball package identity is not dsh-claim-guard@0.1.0')
  }
  if (manifest.private !== undefined) fail('tarball package must not contain private')
  if (manifest.license !== 'MIT') fail('tarball package license must be MIT')
  if (manifest.author !== 'xuxucodepractice-code <xuxucodepractice@gmail.com>') {
    fail('tarball package author does not match the confirmed identity')
  }
  assertExactList(manifest.files ?? [], EXPECTED_PACKAGE_FILES, 'package.json files allowlist')
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) {
    if (manifest.scripts?.[lifecycle] !== undefined) fail(`forbidden lifecycle script: ${lifecycle}`)
  }
  const dependencies = manifest.dependencies ?? {}
  if (JSON.stringify(dependencies) !== JSON.stringify({ '@deepseek-ai/schemastery': '3.18.1' })) {
    fail('runtime dependency set differs from the audited Schemastery-only closure')
  }
  if (manifest.peerDependencies !== undefined || manifest.optionalDependencies !== undefined) {
    fail('unexpected peer or optional dependency set')
  }
  if (manifest.repository?.url !== 'git+https://github.com/xuxucodepractice-code/dsh-claim-guard.git') {
    fail('repository URL does not match the confirmed public repository')
  }
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
    fail('DSH bundle patch metadata is missing or incorrect')
  }
}

async function auditTarball(tarballInput, commit) {
  const tarball = path.resolve(tarballInput)
  const metadata = await stat(tarball)
  if (!metadata.isFile() || path.extname(tarball) !== '.tgz') fail('tarball must be a regular .tgz file')

  const head = run('git', ['rev-parse', 'HEAD']).trim()
  const resolvedCommit = run('git', ['rev-parse', `${commit}^{commit}`]).trim()
  if (head !== resolvedCommit) fail('requested commit does not equal the current HEAD')

  const entries = tarEntries(tarball)
  assertExactList(entries.map((entry) => entry.path), TARBALL_FILES, 'tarball file allowlist')
  for (const entry of entries) {
    assertSafePath(entry.path, 'tarball')
    if (entry.type !== '-') fail('tarball contains a symlink or special file')
  }

  const temporary = await verifiedTemporaryDirectory('dsh-claim-guard-audit-')
  try {
    run('tar', ['-xzf', tarball, '-C', temporary])
    for (const tarPath of TARBALL_FILES) {
      const extracted = path.join(temporary, ...tarPath.split('/'))
      const extractedReal = await realpath(extracted)
      if (!extractedReal.startsWith(`${temporary}${path.sep}`)) fail('extracted tarball path escaped its temporary root')
      const fileMetadata = await stat(extractedReal)
      if (!fileMetadata.isFile()) fail('tarball contains a non-regular allowlisted entry')
      const bytes = await readFile(extractedReal)
      assertSafeText(bytes.toString('utf8'), `tarball ${tarPath}`)

      const repositoryPath = tarPath.slice('package/'.length)
      const committed = gitBytes(resolvedCommit, repositoryPath)
      if (!bytes.equals(committed)) {
        fail(`tarball content differs from commit for ${repositoryPath}`)
      }
    }

    const manifest = JSON.parse(await readFile(path.join(temporary, 'package/package.json'), 'utf8'))
    assertPackageManifest(manifest)
  } finally {
    const stillResolved = await realpath(temporary)
    const resolvedTmp = await realpath(os.tmpdir())
    if (path.dirname(stillResolved) !== resolvedTmp || !path.basename(stillResolved).startsWith('dsh-claim-guard-audit-')) {
      fail('refusing to clean an unverified audit directory')
    }
    await rm(stillResolved, { recursive: true, force: false })
  }

  await smokeTarball(tarball)

  console.log(JSON.stringify({
    mode: 'tarball',
    commit: resolvedCommit,
    file: path.basename(tarball),
    files: entries.length,
    sha256: sha256(await readFile(tarball)),
    result: 'passed',
  }))
}

async function smokeTarball(tarball) {
  const smokeRoot = await verifiedTemporaryDirectory('dsh-claim-guard-smoke-')
  const dshHome = path.join(smokeRoot, 'dsh-home')
  const workspace = path.join(smokeRoot, 'workspace')
  const profile = 'claim-guard-smoke'
  const environment = {
    ...process.env,
    DSH_HOME: dshHome,
    CLAIM_GUARD_PROFILE: profile,
    CLAIM_GUARD_WORKSPACE: workspace,
  }
  const dshBin = frozenDshBin()
  const script = (name) => path.resolve('scripts', name)
  const consumer = path.resolve('test/consumer-smoke.test.js')
  const runDsh = (args) => run(process.execPath, [dshBin, ...args], { env: environment })
  const runNode = (args, extraEnvironment = {}) => run(process.execPath, args, {
    env: { ...environment, ...extraEnvironment },
  })

  try {
    await mkdir(dshHome, { recursive: true, mode: 0o700 })
    await mkdir(workspace, { recursive: true, mode: 0o700 })
    await writeFile(path.join(workspace, 'claims.json'), await readFile('claims.example.json'), { mode: 0o600 })

    const outsideProjectPnpm = run('pnpm', ['--version'], { cwd: smokeRoot }).trim()
    if (outsideProjectPnpm !== '11.7.0') {
      fail(`bare pnpm outside the project must be 11.7.0, found ${outsideProjectPnpm}`)
    }

    runDsh(['plugin', '--profile', profile, 'add', tarball])
    runNode([script('verify-profile-state.mjs'), '--profile', profile, '--expect', 'installed'])

    const enabledDump = path.join(smokeRoot, 'enabled.txt')
    await writeFile(enabledDump, runDsh(['--profile', profile, '--dump-config']), { mode: 0o600 })
    runNode([script('verify-profile.mjs'), enabledDump, '--expect', 'enabled', '--count', '1'])
    runNode(['--test', consumer], { CLAIM_GUARD_EXPECT: 'enabled', CLAIM_GUARD_SCENARIO: 'full' })

    runNode([script('set-smoke-profile-state.mjs'), '--profile', profile, '--state', 'disabled'])
    const disabledDump = path.join(smokeRoot, 'disabled.txt')
    await writeFile(disabledDump, runDsh(['--profile', profile, '--dump-config']), { mode: 0o600 })
    runNode([script('verify-profile.mjs'), disabledDump, '--expect', 'disabled', '--count', '1'])
    runNode(['--test', consumer], { CLAIM_GUARD_EXPECT: 'disabled', CLAIM_GUARD_SCENARIO: 'full' })

    runNode([script('set-smoke-profile-state.mjs'), '--profile', profile, '--state', 'enabled'])
    runNode(['--test', consumer], { CLAIM_GUARD_EXPECT: 'enabled', CLAIM_GUARD_SCENARIO: 'missing-rules' })

    runDsh(['plugin', '--profile', profile, 'remove', 'dsh-claim-guard'])
    runNode([script('verify-profile-state.mjs'), '--profile', profile, '--expect', 'absent'])
    const removedDump = path.join(smokeRoot, 'removed.txt')
    await writeFile(removedDump, runDsh(['--profile', profile, '--dump-config']), { mode: 0o600 })
    runNode([script('verify-profile.mjs'), removedDump, '--expect', 'absent', '--count', '0'])

    runDsh(['plugin', '--profile', profile, 'add', tarball])
    runNode([script('verify-profile-state.mjs'), '--profile', profile, '--expect', 'installed'])
    const reinstalledDump = path.join(smokeRoot, 'reinstalled.txt')
    await writeFile(reinstalledDump, runDsh(['--profile', profile, '--dump-config']), { mode: 0o600 })
    runNode([script('verify-profile.mjs'), reinstalledDump, '--expect', 'enabled', '--count', '1'])
    runNode(['--test', consumer], { CLAIM_GUARD_EXPECT: 'enabled', CLAIM_GUARD_SCENARIO: 'full' })

    runNode([script('probe-profile-boot.mjs')])
  } finally {
    const stillResolved = await realpath(smokeRoot)
    const resolvedTmp = await realpath(os.tmpdir())
    if (path.dirname(stillResolved) !== resolvedTmp || !path.basename(stillResolved).startsWith('dsh-claim-guard-smoke-')) {
      fail('refusing to clean an unverified smoke directory')
    }
    await rm(stillResolved, { recursive: true, force: false })
  }
}

const options = parseArgs(process.argv.slice(2))
if (options.mode === 'staged') {
  await auditStaged()
} else {
  await auditTarball(options.tarball, options.commit)
}
