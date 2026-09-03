import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import { validateRules } from '../lib/rules.js'
import { scan } from '../lib/scan.js'

const BENCHMARK_VERSION = 1
const FIXTURE_CODE_UNITS = 262_144
const BLOCKED_RULES = 64
const BOUNDED_RULES = 64
const WINDOW = 60
const WARMUP_RUNS = 3
const MEASURE_RUNS = 7
const HARD_MAX_MS = 5_000
const TARGET_MEDIAN_MS = 750
const TARGET_MAX_MS = 2_500
const TARGET_RSS_DELTA_BYTES = 128 * 1024 * 1024
const FIXED_SEED = 0x5eedc0de

function makeFixture() {
  let state = FIXED_SEED >>> 0
  const chunks = []
  let length = 0
  while (length < FIXTURE_CODE_UNITS) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    const index = state % (BLOCKED_RULES + BOUNDED_RULES)
    const chunk = `claim-guard-benchmark-token-${String(index).padStart(3, '0')}-Y|`
    chunks.push(chunk)
    length += chunk.length
  }
  return chunks.join('').slice(0, FIXTURE_CODE_UNITS)
}

function makeRules() {
  const blocked = Array.from({ length: BLOCKED_RULES }, (_, index) => ({
    id: `blocked-${String(index).padStart(3, '0')}`,
    match: `claim-guard-benchmark-token-${String(index).padStart(3, '0')}-Z`,
    message: 'Synthetic benchmark blocked rule.',
  }))
  const bounded = Array.from({ length: BOUNDED_RULES }, (_, index) => {
    const fixtureIndex = BLOCKED_RULES + index
    return {
      id: `bounded-${String(index).padStart(3, '0')}`,
      match: `claim-guard-benchmark-token-${String(fixtureIndex).padStart(3, '0')}-Z`,
      mustAccompany: ['synthetic benchmark', '合成示例'],
      message: 'Synthetic benchmark bounded rule.',
    }
  })
  return validateRules({
    version: 1,
    options: { window: WINDOW, caseSensitive: false },
    blocked,
    bounded,
  })
}

function runOnce(text, rules) {
  const started = performance.now()
  const result = scan(text, rules)
  const durationMs = performance.now() - started
  if (result.status !== 'pass' || result.hitCount !== 0) {
    throw new Error('Benchmark fixture unexpectedly produced a match.')
  }
  return durationMs
}

function round(value) {
  return Math.round(value * 1_000) / 1_000
}

const fixture = makeFixture()
const rules = makeRules()
if (fixture.length !== FIXTURE_CODE_UNITS) throw new Error('Benchmark fixture length drifted.')
if (rules.blocked.length + rules.bounded.length !== BLOCKED_RULES + BOUNDED_RULES) {
  throw new Error('Benchmark rule count drifted.')
}

for (let index = 0; index < WARMUP_RUNS; index += 1) runOnce(fixture, rules)

global.gc?.()
const rssBeforeBytes = process.memoryUsage().rss
let peakRssBytes = rssBeforeBytes
const durationsMs = []
for (let index = 0; index < MEASURE_RUNS; index += 1) {
  durationsMs.push(runOnce(fixture, rules))
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
}

const sortedDurations = [...durationsMs].sort((left, right) => left - right)
const medianMs = sortedDurations[Math.floor(sortedDurations.length / 2)]
const maxMs = Math.max(...durationsMs)
const rssDeltaBytes = Math.max(0, peakRssBytes - rssBeforeBytes)
const hardLimitPass = maxMs <= HARD_MAX_MS
const targetPass = medianMs <= TARGET_MEDIAN_MS
  && maxMs <= TARGET_MAX_MS
  && rssDeltaBytes <= TARGET_RSS_DELTA_BYTES

const output = {
  benchmarkVersion: BENCHMARK_VERSION,
  nodeVersion: process.version,
  fixedSeed: FIXED_SEED,
  fixtureHash: createHash('sha256').update(fixture).digest('hex'),
  fixtureCodeUnits: fixture.length,
  ruleCount: rules.blocked.length + rules.bounded.length,
  blockedRuleCount: rules.blocked.length,
  boundedRuleCount: rules.bounded.length,
  window: WINDOW,
  warmupRuns: WARMUP_RUNS,
  measureRuns: MEASURE_RUNS,
  durationsMs: durationsMs.map(round),
  medianMs: round(medianMs),
  maxMs: round(maxMs),
  rssDeltaBytes,
  hardMaxMs: HARD_MAX_MS,
  targetMedianMs: TARGET_MEDIAN_MS,
  targetMaxMs: TARGET_MAX_MS,
  targetRssDeltaBytes: TARGET_RSS_DELTA_BYTES,
  hardLimitPass,
  targetPass,
}

process.stdout.write(`${JSON.stringify(output)}\n`)
if (!hardLimitPass) process.exitCode = 1
