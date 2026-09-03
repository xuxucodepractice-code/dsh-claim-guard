# Contributing

Thanks for helping improve this non-official DSH community plugin.

## Local checks

Use the frozen toolchain and dependency graph:

```sh
test "$(node --version)" = "v22.19.0" || test "$(node --version)" = "v24.15.0"
test "$(npm --version)" = "11.12.1"
test "$(pnpm --version)" = "11.7.0"
pnpm install --ignore-scripts --frozen-lockfile --strict-peer-dependencies
pnpm peers check
pnpm test
pnpm benchmark
```

Pull requests must keep logic, mutation adaptation, report rendering, and the
DSH hook separated. Add tests for every behavior change, including return values
and file-world state when a tool execution is involved. Do not weaken a failure
into warning-and-continue behavior.

## Synthetic fixtures only

Never commit real résumés, papers, applications, employer or university data,
personal rule sets, session logs, profile dumps, credentials, tokens, private
paths, or screenshots of private material. Tests and documentation must use
invented names, values, paths, and claims. Redaction is not a substitute for a
synthetic fixture.

Before opening a pull request, inspect the full diff locally and run the release
audit. Do not paste private diffs or full profile dumps into CI logs or issues.

## Compatibility changes

Changes to DSH versions, hook signatures, tool schemas, approval semantics,
Node versions, dependencies, or rule behavior require immutable upstream source
evidence, an updated compatibility record, adapter tests, real-runtime
integration tests, and a changelog entry. Floating `latest` evidence is not
accepted.

## Scope

Version 1 intentionally does not perform semantic fact checking, network calls,
automatic rewriting, YAML parsing, or full-file reconstruction for incremental
edits. Discuss scope changes before implementing them.
