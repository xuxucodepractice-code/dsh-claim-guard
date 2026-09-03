# dsh-claim-guard compatibility recon

> Status: P0 baseline, P1B source contracts, and P1C dependency freeze passed
> Recorded at: 2026-09-03T13:16:43Z
> Public-data rule: this file contains versions and public source references only. Private paths, credentials, rules, documents, and raw session output belong in ignored private artifacts.

## Frozen candidate baseline

| Item | Recorded value | Evidence |
|---|---|---|
| DSH npm package | `@deepseek-ai/dsh@0.1.1-rc.2` | npm registry returned the exact version and integrity during P0 |
| DSH Git tag | `dsh-v0.1.1-rc.2` | official tag-scoped source links below |
| DSH commit | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` | official GitHub commit URL resolves and its root `package.json` reports version `0.1.1-rc.2` |
| Node | `v24.15.0` locally; CI candidates `22.19.0` and `24.15.0` | local command plus frozen DSH root `engines.node` |
| npm | `11.12.1` | local command |
| PATH pnpm inside this package | `/usr/local/bin/pnpm`, version `11.7.0` | Corepack selects this repository's `packageManager` while the cwd is inside the project |
| Corepack default outside a package | `11.25.0` at the P4A profile probe | a generated DSH profile has no `packageManager`, so this default does not match the frozen baseline |
| Required task pnpm | `11.7.0` | frozen DSH root `packageManager` |
| Config schema candidate | `@deepseek-ai/schemastery@3.18.1` | npm registry returned exact version, MIT license, and integrity |

Current toolchain state: `toolchain-ready: true` for task-scoped P5 profile commands. The original P0 probe found `11.25.0`; P1C's project and clean-copy checks selected exact `11.7.0` because both directories contained this package's `packageManager` field. A later disposable DSH profile probe showed that the generated profile has no `packageManager`, so the external Corepack default remains `11.25.0` there. The authorized repository-local ignored task shim invokes exact `pnpm@11.7.0`; a repository-external temporary-directory probe resolved that shim and returned `11.7.0`. No global package-manager mutation has been performed.

### Exact registry metadata

The following exact-version registry records were resolved during P0/P1B. Every package reports the MIT license. P1C must reproduce these versions and integrity values from the lockfile and installed tree; this table is source metadata, not installation evidence.

| Package | Version | Registry integrity |
|---|---:|---|
| `@deepseek-ai/dsh` | `0.1.1-rc.2` | `sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==` |
| `@deepseek-ai/dsh-tools` | `0.1.1-rc.2` | `sha512-0GGL4D55MwYDepzZMOI3L0ycu5b2qr96GL0Y7snwhAnpK2Di61rbX3fJE+PB3ZrovGX0csIRdt9n3iJZDVtDrw==` |
| `@deepseek-ai/dsh-system-prompt` | `0.1.1-rc.2` | `sha512-on4hjAlYI5uX9q7Sf95YkMMBVe6heywtA/H50ksrIMUub8U2B98hO9iQpHhjwIO1F1vu+5pLcPvRr6yUGGmtXQ==` |
| `@deepseek-ai/dsh-user-approval` | `0.1.1-rc.2` | `sha512-SdsO4Rs+NeJFoertkVilXBACREOLfkKPJJznYKqDhJxeRo38RJ56dtj0Xd0/6rERmsQiMck4Bwdrzg1ubUqPNA==` |
| `@deepseek-ai/cordis` | `4.0.1` | `sha512-YBdskTU2Po1kru3GgcUWUbkTsPMA9LkSQDAY8rBkFJeajdgcQad3QPJZE26JyK99Xb6HaASvoXg2DSUTeN/0Nw==` |
| `@deepseek-ai/schemastery` | `3.18.1` | `sha512-Qn0FCSwCQnpnj6SB31I6i2sIKgKWnkbJM8O0EU91Gv2UsYVvtZTl6IA0sCwk2e2MZf5S8w5hpq9QkeVvK9qwxg==` |

The complete production dependency closure is exactly three MIT-licensed packages:

| Production package | Version | Registry/lockfile integrity |
|---|---:|---|
| `@deepseek-ai/schemastery` | `3.18.1` | `sha512-Qn0FCSwCQnpnj6SB31I6i2sIKgKWnkbJM8O0EU91Gv2UsYVvtZTl6IA0sCwk2e2MZf5S8w5hpq9QkeVvK9qwxg==` |
| `@deepseek-ai/cosmokit` | `1.8.3` | `sha512-qBo+ronVM6Eu2WNVJXi8JcMiqZ19T9BRIpV+5qJUFPXjGH/Z0QKcQMC/IZJ7L394YTOtJgcovbk9qP0w2GsBXQ==` |
| `@standard-schema/spec` | `1.1.0` | `sha512-l2aFy5jALhniG5HgqrD6jXLi/rUWrKvqN/qJx6yoJsgKhblVd+iqqU4RCXavm/jPityDo5TCvKMnpjKnOriy0w==` |

### Frozen-commit closure overrides

The published `0.1.1-rc.2` packages contain compatible ranges. A fresh 2026 registry resolution initially selected later Cordis plugins and React 19, producing unmet peers against frozen Cordis `4.0.1`. The repository-level `pnpm-workspace.yaml` therefore pins the versions present in the frozen DSH source tree and its React 18 baseline. This is a reproducibility correction, not a compatibility expansion.

| Override | Frozen version | Registry/lockfile integrity | Frozen-source anchor |
|---|---:|---|---|
| `@deepseek-ai/cordis-plugin-group` | `1.0.1` | `sha512-E1NThkFB3jn3TCqa6Oc++1zQHqLejF3W2wDwv2BlL3UEmgtBXL1K1j1koc+j676RuiOXtJkUJlPcOntRGKLWBQ==` | [`vendor/group/package.json`, L1–4](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/group/package.json#L1-L4) |
| `@deepseek-ai/cordis-plugin-hmr` | `1.0.16` | `sha512-S7VHfylDg1+Y5O6fdYYZu0KFRAj/snHywcFPnX3KmQYa/qv2Q8IXi4zAt9ABq0BJYqhNoqRlbpGMfIjabgXjKA==` | [`vendor/hmr/package.json`, L1–4](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/hmr/package.json#L1-L4) |
| `@deepseek-ai/cordis-plugin-include` | `1.0.6` | `sha512-i1VXrZCbv6tk/iUgedCNjrxxArbWT3IvRZGB5sdqJ3ectnihivXXQbRZ8JJ73DSmAPvlMGmrbtjFAfm10yvXRg==` | [`vendor/include/package.json`, L1–4](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/include/package.json#L1-L4) |
| `@deepseek-ai/cordis-plugin-loader` | `1.0.2` | `sha512-RIW9hoVyhYDWdCI9BsvtZccPde1ECLC4OAxupwowGTak78vwVTVdb3HezTSOK1Y1/Ax3Ru0LA1pYOB04CnTxIQ==` | [`vendor/loader/package.json`, L1–4](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/loader/package.json#L1-L4) |
| `@deepseek-ai/cordis-plugin-timer` | `1.1.3` | `sha512-IOkey1VNmJwYa5U8bksyMOnM7mtirqjjbWLr3xA8QybLMK0sMooG3a6iJwtvd8P3MFwo3FQibEg+JPixp37MEw==` | [`vendor/timer/package.json`, L1–4](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/timer/package.json#L1-L4) |
| `react` | `18.3.1` | `sha512-wS+hAgJShR0KhEvPJArfuPVN1+Hz1t0Y6n5jLrGQbkb4urgPE/0Rve+1kMB1v/oWgHgm4WIcV+i7F2pTVj+2iQ==` | [`apps/web` importer in frozen lockfile, L396–401](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/pnpm-lock.yaml#L396-L401) |
| `react-dom` | `18.3.1` | `sha512-5m4nQKp+rZRb09LNH59GM4BxTh9251/ylbKIbpe7TpGxfJ+9kv6BLkLBXIjjspbgbnIBNqlI23tRnTWT0snUIw==` | [`apps/web` importer in frozen lockfile, L396–401](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/pnpm-lock.yaml#L396-L401) |

All seven override packages report the MIT license. pnpm 11 reads resolution settings from `pnpm-workspace.yaml`, so the override set is stored there rather than in the deprecated `package.json#pnpm` field.

## Immutable official references

- Root package and Node/pnpm baseline:
  <https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/package.json>
- Tool runtime and `tools/pre-execute`:
  <https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/core/tools/src/index.ts>
- `write`:
  <https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/fs/tool-fs/src/write.ts>
- `edit`:
  <https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/fs/tool-fs/src/edit.ts>
- `str_replace_editor`:
  <https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/fs/tool-str-replace-editor/src/index.ts>
- Plugin packaging and installation:
  <https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/docs/user/develop/basic/publish.md>
- Plugin configuration:
  <https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/docs/user/develop/basic/config.md>

## P0 observations

- The starting directory was not a Git repository.
- The starting public workspace contained only `Instruction/` and `.DS_Store`; both are excluded by `.gitignore`.
- No symbolic links were present within the inspected project depth.
- Exact npm registry metadata for DSH and Schemastery resolved successfully.
- The earlier `11.7.0` revalidation was project-scoped through `packageManager`; a later probe from a generated profile directory correctly distinguished the external Corepack default `11.25.0`. Profile add/remove gates remain blocked until an authorized ignored task shim makes bare `pnpm` exact in that cwd.
- A prior CLI probe established that `dsh plugin --profile <name> --help` can initialize the named profile before forwarding help to pnpm. Future CLI probes must use a disposable `DSH_HOME` and a dedicated temporary profile.

## P1B verification matrix

Every source link below is pinned to commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. Line fragments are the audited ranges; snippets are deliberately short and are not substitutes for the linked source.

| ID | Result | Immutable source evidence |
|---|---|---|
| S1 | Passed: a pre-execute listener receives `(exec, next)`. | [`packages/core/tools/src/index.ts`, L127–141](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/core/tools/src/index.ts#L127-L141): `'tools/pre-execute'(... exec, next ...)`. |
| S2 | Passed: the runtime input exposes `name`, `arguments`, optional `agent`, and required `signal` (also `callId`, optional `rootCallId` and `parent`). | [`packages/core/tools/src/index.ts`, L298–321](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/core/tools/src/index.ts#L298-L321): `name`, `arguments`, `agent?`, `signal: AbortSignal`. |
| S3 | Passed: the decision union is exactly allow, deny-with-reason, or ask-with-optional-reason. | [`packages/core/tools/src/index.ts`, L548–556](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/core/tools/src/index.ts#L548-L556): `{ kind: 'allow' } \| { kind: 'deny'; reason: string } \| { kind: 'ask'; reason?: string }`. |
| S4 | Passed: `next()` advances the waterfall to the next listener/final callback; omitting it vetoes downstream execution. | [`vendor/cordis/src/events.ts`, L72–83](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/events.ts#L72-L83) documents the rule; [`vendor/cordis/src/events.ts`, L209–227](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/events.ts#L209-L227) composes listeners around the final callback. |
| S5 | Passed: ToolRuntime converts `ask` into an approval-service request carrying agent, tool name, call id, optional reason, and abort signal. | [`packages/core/tools/src/index.ts`, L1586–1638](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/core/tools/src/index.ts#L1586-L1638): `approval.request({ agent, toolName, callId, reason, signal })`. |
| S6 | Passed, fail closed: only `allowed-once` becomes allow; rejected, cancelled, unavailable, missing approval service, and missing agent become deny. | [`packages/interaction/user-approval/src/index.ts`, L221–238](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/interaction/user-approval/src/index.ts#L221-L238) defines the grant rule; [`packages/interaction/user-approval/src/index.ts`, L282–307](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/interaction/user-approval/src/index.ts#L282-L307) supplies cancelled/rejected/unavailable outcomes; ToolRuntime handling is in the S5 range. |
| S7 | Passed: names and schemas are frozen. `write` requires `file_path` and `content`; `edit` requires `file_path`, `old_string`, `new_string` and optionally accepts `replace_all`; `str_replace_editor` requires `command` and absolute `path`, with command-specific `file_text`, `insert_line`, `new_str`, `old_str`, and `view_range`. | [`packages/fs/tool-fs/src/write.ts`, L62–68](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/fs/tool-fs/src/write.ts#L62-L68); [`packages/fs/tool-fs/src/edit.ts`, L75–82](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/fs/tool-fs/src/edit.ts#L75-L82); [`packages/fs/tool-str-replace-editor/src/index.ts`, L397–435](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/fs/tool-str-replace-editor/src/index.ts#L397-L435). |
| S8 | Passed: the workspace is the optional absolute `cwd` at `exec.agent.session.header.cwd`. | [`packages/core/session/src/types.ts`, L56–68](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/core/session/src/types.ts#L56-L68): `cwd?: string`; combined with the `agent?` field in S2. The plugin must fail closed when this chain is absent. |
| S9 | Passed: the frozen tree itself declares `export const inject = ['tools']`. | [`packages/todo/tool-todo/src/index.ts`, L19–20](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/todo/tool-todo/src/index.ts#L19-L20). |
| S10 | Passed: `ctx.on` registers an effect-owned disposer, and fiber unload executes its disposables in reverse order. | [`vendor/cordis/src/events.ts`, L230–243](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/events.ts#L230-L243); [`vendor/cordis/src/fiber.ts`, L63–68](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/fiber.ts#L63-L68) and [`vendor/cordis/src/fiber.ts`, L632–643](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/fiber.ts#L632-L643). |
| S11 | Passed at source-contract level: Cordis calls Standard Schema `~standard.validate`; Schemastery implements that contract. Frozen versions are Cordis `4.0.1` and Schemastery `3.18.1`. | [`vendor/cordis/src/fiber.ts`, L38–56](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/src/fiber.ts#L38-L56); [`vendor/schemastery/src/index.ts`, L258–275](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/schemastery/src/index.ts#L258-L275); [`vendor/cordis/package.json`, L1–4](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cordis/package.json#L1-L4); [`vendor/schemastery/package.json`, L1–4](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/schemastery/package.json#L1-L4). Schemastery treats null/undefined as nullable/defaultable ([L441–454](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/schemastery/src/index.ts#L441-L454)) and supplies collection defaults ([L761–803](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/schemastery/src/index.ts#L761-L803)); therefore P1C must microtest omitted values, explicit `[]`, and rejected `null` through the plugin wrapper. |
| S12 | Passed: profiles live under `$DSH_HOME/profiles/<name>`; initialization writes a private profile manifest with dependencies and `dsh.profile.bundles`, plus `cordis.patch.yml`; successful `dsh plugin` forwarding reconciles bundle membership. `--dump-config` composes/prints configuration without booting/evaluating plugins. | [`packages/boot/app-boot/src/profile.ts`, L32–63](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/boot/app-boot/src/profile.ts#L32-L63), [L89–114](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/boot/app-boot/src/profile.ts#L89-L114), and [L131–153](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/boot/app-boot/src/profile.ts#L131-L153); [`apps/cli/src/plugin.ts`, L55–86](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/apps/cli/src/plugin.ts#L55-L86) and [L114–139](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/apps/cli/src/plugin.ts#L114-L139); [`apps/cli/src/dump-config.ts`, L1–48](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/apps/cli/src/dump-config.ts#L1-L48). |
| S13 | Passed at source-contract level: web startup exposes `--no-open`, host and port flags; the CLI rejects `0.0.0.0`; the bundled default is `127.0.0.1`; readiness follows Loader settlement; SIGTERM performs graceful shutdown. A patch row is toggled with the same `id` plus `disabled: true`. | [`packages/bundle/web-app/src/startup.ts`, L41–79](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/bundle/web-app/src/startup.ts#L41-L79); [`packages/bundle/web-app/cordis.patch.yml`, L109–130](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/bundle/web-app/cordis.patch.yml#L109-L130) and [L19–21](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/bundle/web-app/cordis.patch.yml#L19-L21); [`packages/boot/app-boot/src/index.ts`, L696–769](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/boot/app-boot/src/index.ts#L696-L769); [`packages/bundle/web-app/src/index.ts`, L236–271](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/bundle/web-app/src/index.ts#L236-L271); [`apps/cli/src/profile-boot.ts`, L193–245](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/apps/cli/src/profile-boot.ts#L193-L245). The actual disposable-profile boot/settle/exit probe belongs to P1C/P5, not this source-only gate. |

### P1C runtime microtests frozen by P1B

- Validate root config omitted versus root `null`; omitted must use plugin defaults and `null` must be rejected by the plugin wrapper.
- Validate every optional field omitted versus `null`; omission must preserve the documented default and `null` must be rejected.
- Validate `include: []` and `exclude: []` remain explicit empty arrays rather than receiving schema collection defaults.
- Run DSH only with a fresh mode-`0700` temporary `DSH_HOME`, a dedicated profile, `--no-open`, loopback host, and an ephemeral port; wait for post-Loader readiness, then send SIGTERM and require a clean exit.
- Verify enable/disable uses the same profile patch row id and changes only its `disabled` field; verify uninstall/reinstall manifest and bundle reconciliation in the disposable profile.

P1B conclusion: all S1–S13 source contracts pass for the frozen commit. P1B deliberately did not claim installed-package behavior; dependency and lockfile evidence is recorded by P1C below, while profile mutation round trips and real boot evidence remain P3/P5 gates.

## P1C installed dependency verification

P1C ran with bare and Corepack pnpm both selecting exact `11.7.0` from the copied project manifest and kept the bootstrap package at `private: true`, version `0.0.0-development`. This proves package installation reproducibility but does not override the later finding that a DSH-generated profile without `packageManager` selects the external Corepack default.

- Direct dependencies resolved exactly to Schemastery `3.18.1`, Cordis `4.0.1`, and the four requested DSH packages at `0.1.1-rc.2`; installed manifests and registry metadata all report MIT.
- Every one of the 188 `@deepseek-ai/dsh*` package entries in the locked DSH development closure resolves to `0.1.1-rc.2`; Schemastery and Cordis have no second locked version.
- The seven frozen-commit overrides eliminate the registry-time drift. `pnpm peers check` reports no peer dependency issues.
- A fresh mode-`0700` temporary directory, containing only copies of `package.json`, `pnpm-lock.yaml`, and the required `pnpm-workspace.yaml` before installation, reproduced all six direct dependencies with `--ignore-scripts --frozen-lockfile --strict-peer-dependencies` and zero peer issues.
- The installed `@deepseek-ai/schemastery@3.18.1` Standard Schema v1 adapter was microtested. Root and field omissions remain omitted; explicit empty arrays remain empty; explicit root/field nulls and unknown fields remain visible so the plugin wrapper rejects them; invalid non-null shapes are rejected by Schemastery.
- Source import audit found only Node built-ins and declared `@deepseek-ai/schemastery`. All pnpm-managed links resolve inside this repository's own `node_modules`; no external/manual package symlink is used.

P1C conclusion: dependency freezing and clean-install reproducibility pass. Runtime hook and disposable-profile behavior remain P2/P3/P5 gates.
