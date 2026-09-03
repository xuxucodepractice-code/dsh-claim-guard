# Security policy

## Supported versions

Until `v0.1.0` is published, there is no supported public release. After the
release, the latest `0.1.x` patch will receive security fixes when practical.
Older versions and untagged branches are not supported security boundaries.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, private rules, target text, session
logs, credentials, or local paths in a public issue.

Prefer GitHub private vulnerability reporting if it is enabled for this
repository. If it is unavailable, email `xuxucodepractice@gmail.com` with a
minimal, synthetic reproduction and the affected release version. Do not attach
real personal documents or secrets.

Receipt and remediation depend on maintainer availability. This project does
not promise a response or fix SLA. A report may be closed if it concerns an
explicitly documented non-goal, but reproducible boundary failures are welcome.

## Trust boundary

This is a non-official community plugin. It runs in the same process as DSH and
can observe the supported tool arguments delivered to its hook. Review the
source, pin a release and checksum, and test it in a dedicated profile before
using it with important workspaces. The plugin is not a sandbox, DLP system, or
protection against a malicious host or plugin.

Repository hardening planned for the public repository includes private
vulnerability reporting as a release requirement, plus secret scanning, push
protection, branch protection, and immutable releases where the account and
platform make them available. These controls are not claimed as enabled until
their remote state is verified.
