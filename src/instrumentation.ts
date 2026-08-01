/*!
 * Copyright (c) 2022, imqueue.com <support@imqueue.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */
import {
    InstrumentationBase,
    type InstrumentationConfig,
} from '@opentelemetry/instrumentation';
import {
    context,
    propagation,
    SpanKind,
    SpanStatusCode,
    trace,
    type Tracer,
} from '@opentelemetry/api';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AttributeNames, SpanNames, TraceKind } from './enums/index.js';
import {
    type IMQCallHooks,
    type IMQClient,
    type IMQRPCRequest,
    type IMQRPCResponse,
} from './imq/types.js';

const PACKAGE_NAME = '@imqueue/rpc';
const COMPONENT_NAME = 'imq';

// This is the OpenTelemetry instrumentation SCOPE NAME, not just a label: it
// reaches `otel.scope.name` on every span this instrumentation emits (see the
// `super()` call below). It follows the package name, so renaming the package
// renames the scope — keep this literal in step with package.json's `name` or a
// deployment that cannot read package.json reports a different scope than the
// rest. `test/instrumentation.spec.ts` pins the expected value.
let instrumentationName = '@imqueue/opentelemetry';
let instrumentationVersion = '0.0.0';

try {
    const pkg = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    instrumentationName = pkg.name;
    instrumentationVersion = pkg.version;
} catch {
    // Keep the fallback name/version if the package.json can't be read.
}

/**
 * The `@imqueue/rpc` default option singletons this instrumentation patches.
 *
 * @remarks
 * Both are optional because the resolved `rpc` module may predate them, or may
 * not be the module the app actually uses. A missing singleton is skipped rather
 * than treated as an error, so patching is best-effort: tracing goes quiet, the
 * application keeps working.
 */
export interface RpcModule {
    /** Default options every `IMQClient` starts from — the CLIENT-side hooks. */
    DEFAULT_IMQ_CLIENT_OPTIONS?: IMQCallHooks;

    /** Default options every `IMQService` starts from — the SERVER-side hook. */
    DEFAULT_IMQ_SERVICE_OPTIONS?: IMQCallHooks;
}

/**
 * OpenTelemetry instrumentation for `@imqueue/rpc`.
 *
 * `@imqueue/rpc` exposes its default client/service options as mutable
 * singletons and calls their `beforeCall`/`afterCall`/`wrapCall` hooks around
 * every RPC. Rather than intercepting module loading (which, for an ESM package,
 * needs import-in-the-middle and rewrites the whole module graph), this patches
 * those singletons directly on `enable()` — robust and free of ESM-hook
 * fragility.
 *
 * - Client calls use `beforeCall`/`afterCall`: a CLIENT span is started as a
 *   child of the active context and its trace context is injected into the
 *   request metadata for propagation, then ended on response.
 * - Service calls use `wrapCall` (the around-hook): the SERVER span is started
 *   from the propagated parent and the handler is run **inside** that span's
 *   context (`context.with`), so any spans it or its downstream calls create
 *   nest correctly.
 *
 * Two consequences of patching singletons rather than intercepting imports.
 * Clients and services constructed BEFORE `enable()` copy the defaults at
 * construction time and are not traced — so register the instrumentation before
 * building any of them, which `registerInstrumentations` at start-up does
 * naturally. And if the `@imqueue/rpc` this resolves is a different copy from the
 * one the application imported (duplicate installs at different tree depths),
 * the patch lands on the wrong singletons and no spans appear.
 *
 * @example
 * ```typescript
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 * import { registerInstrumentations } from '@opentelemetry/instrumentation';
 * import { ImqueueInstrumentation } from '@imqueue/opentelemetry';
 *
 * new NodeTracerProvider().register();
 *
 * registerInstrumentations({
 *     instrumentations: [new ImqueueInstrumentation()],
 * });
 * ```
 */
export class ImqueueInstrumentation extends InstrumentationBase {
    /**
     * @param config - standard OpenTelemetry instrumentation config. Note that
     *                 `enabled` is honoured by `registerInstrumentations`, which
     *                 calls {@link ImqueueInstrumentation.enable} for you; there
     *                 are no options specific to this instrumentation.
     */
    constructor(config: InstrumentationConfig = {}) {
        super(instrumentationName, instrumentationVersion, config);
    }

    /**
     * No module-load hook: we patch `@imqueue/rpc`'s mutable default options
     * directly (see the class docs), so there is nothing to intercept at import.
     */
    protected init(): [] {
        return [];
    }

    /**
     * Starts tracing: resolves the live `@imqueue/rpc` and attaches the hooks to
     * its default options.
     *
     * @remarks
     * A no-op if `@imqueue/rpc` cannot be resolved — nothing throws, so an app
     * that registers this instrumentation without using IMQ still starts. That
     * also means a silent failure looks identical to success from here; if no
     * spans appear, an unresolvable or duplicated `rpc` install is the first
     * thing to check.
     */
    public override enable(): void {
        const rpc = this.resolveRpc();

        if (rpc) {
            this.patch(rpc);
        }
    }

    /**
     * Stops tracing by removing the hooks again. Clients and services already
     * constructed keep the hooks they copied at construction time, so spans from
     * them may continue after this returns.
     */
    public override disable(): void {
        const rpc = this.resolveRpc();

        if (rpc) {
            this.unpatch(rpc);
        }
    }

    /**
     * Attaches the tracing hooks to a module's default client/service options.
     *
     * @remarks
     * Called by {@link ImqueueInstrumentation.enable} with the resolved module.
     * It is public so a test, or an app whose `rpc` copy this cannot resolve, can
     * pass the module in explicitly.
     *
     * @param rpc - module whose default option singletons should be hooked
     * @returns the same object, hooks applied in place
     */
    public patch(rpc: RpcModule): RpcModule {
        const { client, service } = this.hooks();

        if (rpc.DEFAULT_IMQ_CLIENT_OPTIONS) {
            Object.assign(rpc.DEFAULT_IMQ_CLIENT_OPTIONS, client);
        }

        if (rpc.DEFAULT_IMQ_SERVICE_OPTIONS) {
            Object.assign(rpc.DEFAULT_IMQ_SERVICE_OPTIONS, service);
        }

        return rpc;
    }

    /**
     * Removes the tracing hooks previously attached by
     * {@link ImqueueInstrumentation.patch}.
     *
     * @remarks
     * Deletes the three hook properties outright rather than restoring whatever
     * was there before, so a `beforeCall` the application had set itself is lost
     * too. In practice the defaults are empty, but do not use this to toggle
     * tracing on a module you also hook yourself.
     *
     * @param rpc - module to remove the hooks from
     * @returns the same object, hooks removed in place
     */
    public unpatch(rpc: RpcModule): RpcModule {
        for (const options of [
            rpc.DEFAULT_IMQ_CLIENT_OPTIONS,
            rpc.DEFAULT_IMQ_SERVICE_OPTIONS,
        ]) {
            if (options) {
                delete options.beforeCall;
                delete options.afterCall;
                delete options.wrapCall;
            }
        }

        return rpc;
    }

    /**
     * Resolve the live `@imqueue/rpc` module (shared with the app's import).
     * Tries this package's own location first (the normal hoisted install),
     * then the app's working directory — so a symlinked/`npm link`ed dev setup,
     * where resolution from this package can't see the app's deps, still works.
     */
    private resolveRpc(): RpcModule | undefined {
        const bases = [
            import.meta.url,
            pathToFileURL(join(process.cwd(), 'noop.js')).href,
        ];

        for (const base of bases) {
            try {
                return createRequire(base)(PACKAGE_NAME) as RpcModule;
            } catch {
                // try the next resolution base
            }
        }

        return undefined;
    }

    /**
     * Build the client (`beforeCall`/`afterCall`) and service (`wrapCall`)
     * hooks. They read the current tracer lazily, so a tracer provider
     * registered after construction is still honoured.
     */
    private hooks(): { client: IMQCallHooks; service: IMQCallHooks } {
        const tracer = (): Tracer => this.tracer;

        const beforeCall = async function (
            this: IMQClient,
            req: IMQRPCRequest,
        ): Promise<void> {
            keepSpanUnserialized(req);

            const span = tracer().startSpan(SpanNames.IMQ_REQUEST, {
                kind: SpanKind.CLIENT,
                attributes: {
                    [AttributeNames.SPAN_KIND]: TraceKind.CLIENT,
                    [AttributeNames.RESOURCE_NAME]: `${this.serviceName}.${
                        req.method
                    }`,
                    [AttributeNames.SERVICE_NAME]: this.serviceName,
                    [AttributeNames.IMQ_CLIENT]: req.from,
                    [AttributeNames.COMPONENT]: COMPONENT_NAME,
                },
            });

            // Propagate the client span downstream via the request metadata.
            req.metadata = req.metadata || {};
            req.metadata.clientSpan = {};
            propagation.inject(
                trace.setSpan(context.active(), span),
                req.metadata.clientSpan,
            );
            req.span = span;
        };

        const afterCall = async function (
            this: IMQClient,
            req: IMQRPCRequest,
            res?: IMQRPCResponse,
        ): Promise<void> {
            const span = req.span;

            if (!span) {
                return;
            }

            if (res?.error) {
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: errorMessage(res.error),
                });
            }

            span.end();
        };

        const wrapCall = async function (
            this: IMQClient,
            req: IMQRPCRequest,
            _res: IMQRPCResponse,
            next: () => Promise<unknown>,
        ): Promise<unknown> {
            keepSpanUnserialized(req);

            const parent = propagation.extract(
                context.active(),
                (req.metadata || {}).clientSpan || {},
            );
            const span = tracer().startSpan(
                SpanNames.IMQ_RESPONSE,
                {
                    kind: SpanKind.SERVER,
                    attributes: {
                        [AttributeNames.SPAN_KIND]: TraceKind.SERVER,
                        [AttributeNames.RESOURCE_NAME]: `${this.name}.${
                            req.method
                        }`,
                        [AttributeNames.SERVICE_NAME]: this.name,
                        [AttributeNames.IMQ_CLIENT]: req.from,
                        [AttributeNames.COMPONENT]: COMPONENT_NAME,
                    },
                },
                parent,
            );

            req.span = span;

            try {
                // Run the handler INSIDE the span's context so anything it (or
                // its downstream calls) traces nests under this server span.
                return await context.with(trace.setSpan(parent, span), next);
            } catch (err: any) {
                span.recordException(err);
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: err?.message,
                });

                throw err;
            } finally {
                span.end();
            }
        };

        return {
            client: { beforeCall, afterCall },
            service: { wrapCall },
        };
    }
}

/** Keep the live span object out of serialized request payloads. */
function keepSpanUnserialized(req: IMQRPCRequest): void {
    req.toJSON = () => {
        const copy: any = Object.assign({}, req);

        delete copy.span;

        return copy;
    };
}

function errorMessage(error: any): string {
    return typeof error === 'string' ? error : error?.message;
}
