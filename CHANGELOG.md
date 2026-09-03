# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

Initial release candidate for the non-official community plugin.

### Added

- Deterministic `tools/pre-execute` checks for the verified `write`, `edit`, and
  `str_replace_editor` argument shapes in DeepSeek Harness `0.1.1-rc.2`.
- Strict UTF-8 JSON rules with `blocked` and `bounded` checks.
- Native DSH `ask` decisions for matches and fail-closed handling for missing,
  unreadable, malformed, or schema-invalid rule files.
- Unit, adapter, hook, and real ToolRuntime/ApprovalService integration tests.
- A synthetic example rules file and synthetic demonstration only.

### Compatibility

- Frozen DSH package/tag: `@deepseek-ai/dsh@0.1.1-rc.2` / `dsh-v0.1.1-rc.2`.
- Frozen upstream commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- CI candidates: Node `22.19.0` and `24.15.0`; compatibility becomes `verified`
  only when the same release commit passes the required remote CI and release
  artifact checks.

### Known limitations

- Incremental `edit`, replace, and insert operations inspect only the new
  fragment and do not evaluate `bounded` rules against the reconstructed file.
- Shells, scripts, MCP tools, custom or future write tools, host-internal writes,
  and paths outside the session workspace are not covered.
- Matching is literal substring matching, not fact checking or semantic analysis.

[0.1.0]: https://github.com/xuxucodepractice-code/dsh-claim-guard/releases/tag/v0.1.0
