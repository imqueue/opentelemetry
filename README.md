<h1 align="center">@imqueue/opentelemetry-instrumentation-imqueue</h1>
<hr>
<p align="center">
    <strong>This module provides automatic opentelemetry instrumentation for the @imqueue</strong>
</p>
<hr>

## What Is This?

This library provides a clean way to integrate
[@imqueue/rpc](https://github.com/imqueue/rpc) with 
[OpenTelemetry](https://github.com/open-telemetry).

## Install

~~~bash
npm i --save @imqueue/opentelemtry-instrumentation-imqueue
~~~ 

## Usage & API

OpenTelemetry Imqueue Instrumentation allows the user to automatically collect trace data and export them to their backend of choice, to give observability to distributed systems.

```js
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const {
    ImqueueInstrumentation,
} = require('@imqueue/opentelemetry-instrumentation-imqueue');

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