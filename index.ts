/*!
 * I'm Queue Software Project
 * Copyright (C) 2025  imqueue.com <support@imqueue.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * If you want to use this code in a closed source (commercial) project, you can
 * purchase a proprietary commercial license. Please contact us at
 * <support@imqueue.com> to get commercial licensing options.
 */
/**
 * OpenTelemetry instrumentation for `@imqueue/rpc` — distributed traces across
 * IMQ service calls, with no changes to service or client code.
 *
 * Register {@link ImqueueInstrumentation} once at start-up and every RPC made
 * through `@imqueue/rpc` produces a CLIENT span on the calling side and a SERVER
 * span on the handling side, linked into one trace. For anything the automatic
 * spans do not cover there are two manual tools: the {@link traced} method
 * decorator, and the {@link traceStart}/{@link traceEnd} pair for an arbitrary
 * block of code.
 *
 * @remarks
 * Trace context travels in the IMQ request metadata, so a call chain stays a
 * single trace across processes and queues. The instrumentation works by
 * mutating `@imqueue/rpc`'s exported default option singletons rather than by
 * hooking module loading — see {@link ImqueueInstrumentation} for why that
 * matters and what it implies.
 *
 * This package only *produces* spans. Exporting them is the host application's
 * job: register a tracer provider from the OpenTelemetry SDK, or the spans go
 * nowhere.
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
 *
 * @packageDocumentation
 */
// KEEP THIS IMPORT FIRST. A `@packageDocumentation` comment only reaches
// api-extractor if it survives into the emitted index.d.ts, and tsc carries a
// leading comment only as far as the statement it is attached to. This import
// has `type` members, so it is emitted; the other three are value-only and are
// elided, which silently drops the comment with them. That is not a
// hypothetical: the block above went missing from 3.3.0's declarations exactly
// this way, leaving the published API-reference landing page with a generated
// "opentelemetry package" description instead of this summary.
import {
    SpanNames,
    TraceKind,
    type TracedOptions,
    AttributeNames,
    type TraceAttributes,
} from './src/index.js';
import { readFileSync } from 'node:fs';
import { type Span, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import * as path from 'path';

export * from './src/index.js';
export { type IMQCallHooks } from './src/imq/types.js';

const traces: { [name: string]: Span } = {};
const componentName = 'imq';
const defaultTracerName = 'basic';

// noinspection JSUnusedGlobalSymbols
/**
 * Starts a named span for tracing a block of code that no decorator can wrap,
 * to be closed later by {@link traceEnd} with the same name.
 *
 * @remarks
 * Spans started here are held in a module-level registry keyed by `name`, which
 * is what lets {@link traceEnd} find one from an unrelated call site. Two
 * consequences follow, and both matter:
 *
 * - A name may have only ONE span open at a time. Starting a second under a
 *   live name throws rather than silently replacing it, since replacing would
 *   leak the first span forever.
 * - A span left unclosed is never exported. Prefer {@link traced}, or a
 *   `try`/`finally` around the {@link traceEnd} call, wherever the block can
 *   throw.
 *
 * The span is created standalone, NOT as a child of whatever span is currently
 * active, and it is not made active for the code in between. Use it to time a
 * region, not to parent the spans that region creates.
 *
 * @example
 * ```typescript
 * import {
 *     traceStart,
 *     traceEnd,
 * } from '@imqueue/opentelemetry';
 *
 * traceStart('import-batch', { 'batch.size': String(rows.length) });
 *
 * try {
 *     await importRows(rows);
 * } finally {
 *     traceEnd('import-batch');
 * }
 * ```
 *
 * @param name - span name, and the key {@link traceEnd} will close it by
 * @param tags - attributes to set on the span at creation; values must be
 *               strings
 * @param tracerName - tracer to create the span with, `'basic'` by default
 * @throws TypeError if a span under this name is already open
 */
export function traceStart(
    name: string,
    tags?: TraceAttributes,
    tracerName?: string,
) {
    if (traces[name]) {
        throw new TypeError(
            `Trace with name ${name} has been already started!`,
        );
    }

    traces[name] = trace
        .getTracer(tracerName || defaultTracerName)
        .startSpan(name, tags ? { attributes: tags } : undefined);
}

// noinspection JSUnusedGlobalSymbols
/**
 * Ends the span {@link traceStart} opened under this name and releases it, so
 * the name can be reused.
 *
 * @remarks
 * An unknown or already-closed name is a silent no-op, not an error — safe to
 * call from a `finally` block without first checking whether the span was ever
 * started. The flip side is that a misspelled name fails silently and leaves the
 * real span open and unexported.
 *
 * @param name - the name the span was started under
 */
export function traceEnd(name: string) {
    if (traces[name]) {
        traces[name].end();
        delete traces[name];
    }
}

const DEFAULT_TRACED_OPTIONS: TracedOptions = {
    kind: TraceKind.SERVER,
};

let pkgName = '';

try {
    pkgName = JSON.parse(
        readFileSync(`${path.resolve('.')}${path.sep}package.json`, 'utf8'),
    ).name;
} catch {
    /* ignore */
}

// noinspection JSUnusedGlobalSymbols
/**
 * Builds a method decorator that wraps each call to the decorated method in its
 * own span, ending it when the method returns — or when the promise it returned
 * settles.
 *
 * @remarks
 * Use this for work worth seeing in a trace that is not itself an RPC, so the
 * automatic client/server spans do not already cover it: a cache rebuild, a
 * report query, a third-party call.
 *
 * Async methods are handled: a returned thenable keeps the span open until it
 * settles, so the span duration reflects the real work rather than the time to
 * return a promise. A rejection, or a synchronous throw, records the error on
 * the span, marks it `ERROR`, ends it, and re-throws — the decorator never
 * swallows a failure.
 *
 * Every span it creates is named `method.call`; the decorated method is
 * identified by the `resource.name` attribute (`ClassName.methodName`), not by
 * the span name. The span is not made the active context, so spans created
 * *inside* the method do not nest under it — for nesting, rely on
 * {@link ImqueueInstrumentation}, which does establish context for RPC handlers.
 *
 * @example
 * ```typescript
 * import { traced, TraceKind } from '@imqueue/opentelemetry';
 *
 * class Reports {
 *     @traced()
 *     public async rebuild(day: string): Promise<void> {
 *         // span stays open until this promise settles
 *     }
 *
 *     @traced({ kind: TraceKind.CLIENT, tags: { 'peer.service': 'billing' } })
 *     public async fetchInvoices(userId: string): Promise<Invoice[]> {
 *         return this.http.get(`/invoices/${ userId }`);
 *     }
 * }
 * ```
 *
 * @param options - span kind, extra attributes and tracer name. `kind` defaults
 *                  to {@link TraceKind.SERVER}; `tracerName` defaults to
 *                  `'basic'`. Attributes given in `tags` are applied last, so
 *                  they override the ones set automatically.
 * @returns a method decorator to apply to the methods you want traced
 */
export function traced(options?: Partial<TracedOptions>) {
    return (
        target: any,
        methodName: string | symbol,
        descriptor: TypedPropertyDescriptor<(...args: any[]) => any>,
    ) => {
        const original = descriptor.value;
        const opts: TracedOptions = Object.assign(
            {},
            DEFAULT_TRACED_OPTIONS,
            options || {},
        );
        const tracerInstance = trace.getTracer(
            opts.tracerName || defaultTracerName,
        );

        descriptor.value = function (...args: any[]) {
            const className = this.constructor.name;
            const attributes = Object.assign(
                {
                    [AttributeNames.SPAN_KIND]: opts.kind,
                    [AttributeNames.RESOURCE_NAME]: `${className}.${String(
                        methodName,
                    )}`,
                    // The host package name identifies the SERVICE. It used to
                    // be written to RESOURCE_NAME instead, as a second key in
                    // this same literal — so it silently overwrote the
                    // ClassName.methodName above and every traced method in a
                    // process reported the same resource.
                    ...(pkgName
                        ? { [AttributeNames.SERVICE_NAME]: pkgName }
                        : {}),
                    [AttributeNames.COMPONENT]: componentName,
                },
                opts.tags || {},
            );
            const span = tracerInstance.startSpan(SpanNames.METHOD_CALL, {
                attributes,
                kind:
                    opts.kind === TraceKind.CLIENT
                        ? SpanKind.CLIENT
                        : SpanKind.SERVER,
            });

            try {
                const result: any = original && original.apply(this, args);

                if (result && result.then) {
                    // noinspection CommaExpressionJS
                    return result
                        .then((res: any) => (span.end(), res))
                        .catch((err: any) => handleError(span, err));
                }

                span.end();

                return result;
            } catch (err) {
                handleError(span, err);
            }
        };
    };
}

/**
 * Records an error on a span, marks the span failed, ends it, and re-throws the
 * original error unchanged — so tracing never alters what the caller sees.
 *
 * @param span - the span to fail and close
 * @param err - the error to record and re-throw
 * @throws the `err` it was given, always
 */
function handleError(span: Span, err: any) {
    span.setAttribute(AttributeNames.ERROR_MESSAGE, err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.end();

    throw err;
}
