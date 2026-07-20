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

let instrumentationName = '@imqueue/opentelemetry-instrumentation-imqueue';
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

/** The `@imqueue/rpc` default option singletons this instrumentation patches. */
export interface RpcModule {
    DEFAULT_IMQ_CLIENT_OPTIONS?: IMQCallHooks;
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
 */
export class ImqueueInstrumentation extends InstrumentationBase {
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

    public override enable(): void {
        const rpc = this.resolveRpc();

        if (rpc) {
            this.patch(rpc);
        }
    }

    public override disable(): void {
        const rpc = this.resolveRpc();

        if (rpc) {
            this.unpatch(rpc);
        }
    }

    /** Attach the tracing hooks to a module's default client/service options. */
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

    /** Remove the tracing hooks previously attached by {@link patch}. */
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
