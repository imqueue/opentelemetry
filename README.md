<h1 align="center">@imqueue/opentelemetry</h1>
<hr>
<p align="center">
    <strong>This module provides automatic opentelemetry instrumentation for the @imqueue</strong>
</p>
<hr>

## What Is This?

This library provides a clean way to integrate
[@imqueue/rpc](https://github.com/imqueue/rpc) with 
[OpenTelemetry](https://github.com/open-telemetry).

## Renamed

This package was called `@imqueue/opentelemetry-instrumentation-imqueue` up to
and including 3.3.1. The old name is deprecated on npm and receives no further
releases; there is no compatibility shim. To migrate, change the dependency and
every import specifier — nothing else in the API moved.

One thing to check before upgrading: the OpenTelemetry **instrumentation scope
name** follows the package name, so `otel.scope.name` on the `imq.request` and
`imq.response` spans changes from
`@imqueue/opentelemetry-instrumentation-imqueue` to `@imqueue/opentelemetry`.
Any dashboard, saved query, sampling rule or alert that filters on it needs
updating. Spans from `traceStart()`/`traceEnd()` and `@traced()` are unaffected
— those use their own tracer name (`basic` by default).

Do not install both packages at once: they patch the same `@imqueue/rpc` option
singletons, and whichever is enabled last wins, silently.

## Install

~~~bash
npm i --save @imqueue/opentelemetry
~~~ 

## Usage & API

OpenTelemetry Imqueue Instrumentation allows the user to automatically collect trace data and export them to their backend of choice, to give observability to distributed systems.

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import {
    ImqueueInstrumentation,
} from '@imqueue/opentelemetry';

const provider = new NodeTracerProvider();

provider.register();

registerInstrumentations({
  instrumentations: [
    new ImqueueInstrumentation(),
  ],
});
```

## Contributing

Any contributions are greatly appreciated. Feel free to fork, propose PRs, open
issues, do whatever you think may be helpful to this project. PRs which passes
all tests and do not brake tslint rules are first-class candidates to be
accepted!

## License

This project is licensed under the GNU General Public License v3.0.
See the [LICENSE](LICENSE)

Happy Coding!