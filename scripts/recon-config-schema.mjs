import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import Schema from '@deepseek-ai/schemastery'

import { DEFAULT_CONFIG, validateConfig } from '../lib/config.js'

const require = createRequire(import.meta.url)
const { version: schemasteryVersion } = require('@deepseek-ai/schemastery/package.json')

const optionalStringArray = () => Schema.union([
  Schema.array(Schema.string()).required(),
])

const ConfigShape = Schema.object({
  rulesPath: Schema.string(),
  include: optionalStringArray(),
  exclude: optionalStringArray(),
}).required()

const Config = Schema.union([ConfigShape])

function schemaValue(input, label) {
  const result = Config['~standard'].validate(input)
  assert.equal(typeof result?.then, 'undefined', `${label}: validation must remain synchronous`)
  assert.equal(result.issues, undefined, `${label}: unexpected schema issues`)
  assert.ok(Object.hasOwn(result, 'value'), `${label}: Standard Schema result must contain value`)
  return result.value
}

function schemaIssues(input, label) {
  const result = Config['~standard'].validate(input)
  assert.equal(typeof result?.then, 'undefined', `${label}: validation must remain synchronous`)
  assert.ok(Array.isArray(result.issues) && result.issues.length > 0, `${label}: expected schema issues`)
}

assert.equal(schemasteryVersion, '3.18.1')
assert.equal(Config['~standard'].version, 1)
assert.equal(Config['~standard'].vendor, 'schemastery')

const omittedRoot = schemaValue(undefined, 'omitted root')
assert.equal(omittedRoot, undefined)
assert.deepEqual(validateConfig(omittedRoot), DEFAULT_CONFIG)

const omittedFields = schemaValue({}, 'omitted fields')
assert.deepEqual(omittedFields, {})
for (const key of ['rulesPath', 'include', 'exclude']) {
  assert.equal(Object.hasOwn(omittedFields, key), false, `${key}: omission must be preserved`)
}
assert.deepEqual(validateConfig(omittedFields), DEFAULT_CONFIG)

const explicitEmptyArrays = schemaValue({ include: [], exclude: [] }, 'explicit empty arrays')
assert.deepEqual(explicitEmptyArrays, { include: [], exclude: [] })
assert.deepEqual(validateConfig(explicitEmptyArrays), {
  rulesPath: DEFAULT_CONFIG.rulesPath,
  include: [],
  exclude: [],
})

const explicitNullRoot = schemaValue(null, 'explicit null root')
assert.equal(explicitNullRoot, null)
assert.throws(() => validateConfig(explicitNullRoot), { code: 'CONFIG_ROOT_TYPE' })

for (const key of ['rulesPath', 'include', 'exclude']) {
  const explicitNullField = schemaValue({ [key]: null }, `explicit null ${key}`)
  assert.equal(Object.hasOwn(explicitNullField, key), true)
  assert.equal(explicitNullField[key], null)
  assert.throws(() => validateConfig(explicitNullField))
}

const unknownField = schemaValue({ typo: true }, 'unknown field')
assert.deepEqual(unknownField, { typo: true })
assert.throws(() => validateConfig(unknownField), { code: 'CONFIG_UNKNOWN_FIELD' })

for (const invalidRoot of [[], 'text', 1, true]) {
  schemaIssues(invalidRoot, `invalid root ${JSON.stringify(invalidRoot)}`)
}
schemaIssues({ include: 'not-an-array' }, 'invalid include type')

console.log(JSON.stringify({
  status: 'passed',
  schemasteryVersion,
  standardSchemaVersion: Config['~standard'].version,
  vendor: Config['~standard'].vendor,
  verified: [
    'root omission preserved',
    'field omissions preserved',
    'explicit empty arrays preserved',
    'root null preserved for wrapper rejection',
    'field nulls preserved for wrapper rejection',
    'unknown fields preserved for wrapper rejection',
    'invalid non-null shapes rejected by Schemastery',
  ],
}))
