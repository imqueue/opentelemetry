# Changelog

Notable changes to `@imqueue/opentelemetry`.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2026-08-01

The package is renamed from `@imqueue/opentelemetry-instrumentation-imqueue` to
`@imqueue/opentelemetry`. No API changed — every export keeps its name and
signature — but the move is published as a major because it changes an identifier
your observability backend sees.

`@imqueue/opentelemetry-instrumentation-imqueue` is deprecated on npm and will
receive no further releases. There is no compatibility shim: the last version
published under the old name, 3.3.1, stays installable indefinitely and stays
frozen.

### Changed

- **Renamed on npm.** `npm i @imqueue/opentelemetry`, and update every import
  specifier. That is the whole migration.

- **The OpenTelemetry instrumentation scope name changed**, because it follows
  the package name. `otel.scope.name` on `imq.request` and `imq.response` spans
  is now `@imqueue/opentelemetry` where it was
  `@imqueue/opentelemetry-instrumentation-imqueue`, and `otel.scope.version`
  moves with the package version. Anything filtering or grouping on either —
  dashboards, saved queries, monitors, span processors, sampling rules — needs
  updating before you upgrade.

  Spans from `traceStart()`/`traceEnd()` and the `@traced()` decorator are
  **not** affected: they use their own tracer name, `basic` unless you pass
  `tracerName`.

  The scope name is now pinned by a literal assertion in
  `test/instrumentation.spec.ts`. It previously compared the runtime value
  against `package.json`, which is where that value is read from — so it agreed
  with itself for any name and could not have caught this.

- **`repository` and `bugs` URLs** point at `github.com/imqueue/opentelemetry`,
  and `repository.url` moved off the `git://` scheme GitHub disabled in 2022.

- **`publishConfig.access` is now set explicitly**, so a first publish under a
  new scoped name cannot land as a restricted package.

### Note

Do not install `@imqueue/opentelemetry` and
`@imqueue/opentelemetry-instrumentation-imqueue` at the same time. Both patch the
same `@imqueue/rpc` default-option singletons and `patch()` overwrites rather
than chains, so whichever is enabled last wins and the other's hooks are dropped
— silently, and dependent on module load order.
