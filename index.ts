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
import {
    Span,
    trace,
    SpanKind,
    SpanStatusCode,
} from '@opentelemetry/api';
import * as path from 'path';
import {
    SpanNames,
    TraceKind,
    TracedOptions,
    AttributeNames,
    TraceAttributes,
} from './src';

export * from './src/instrumentation';

const traces: { [name: string]: Span } = {};
const componentName = 'imq';
const defaultTracerName = 'basic';

// noinspection JSUnusedGlobalSymbols
/**
 * Shorthand for making in-code traces. Starts datadog trace span with the
 * given name, and assigns it given tags (if passed).
 *
 * @example
 * ```typescript
 * import {
 *  trace,
 *  traceEnd,
 * } from '@imqueue/opentelemetry-instrumentation-imqueue';
 *
 * trace('my-trace');
 * // ... do some work
 * traceEnd('my-trace');
 * ```
 *
 * @param {string} name - trace name (datadog span name
 * @param {TraceAttributes} [tags] - datadog trace span tags, if passed
 * @param {string} tracerName
 */
export function traceStart(
    name: string,
    tags?: TraceAttributes,
    tracerName?: string,
) {
    if (traces[name]) {
        throw new TypeError(
            `Trace with name ${ name } has been already started!`,
        );
    }

    traces[name] = trace.getTracer(
        tracerName || defaultTracerName,
    ).startSpan(name);
}

// noinspection JSUnusedGlobalSymbols
/**
 * Shorthand for finishing datadog trace span.
 *
 * @param {string} name
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
    pkgName = require(`${ path.resolve('.') }${ path.sep }package.json`).name;
} catch (err) { /* ignore */ }

// noinspection JSUnusedGlobalSymbols
/**
 * Decorator factory, which return decorator function allowing to add tracing to
 * decorated method calls.
 */
export function traced(options?: Partial<TracedOptions>) {
    return (
        target: any,
        methodName: string | symbol,
        descriptor: TypedPropertyDescriptor<(...args: any[]) => any>,
    ) => {
        const original = descriptor.value;
        const opts: TracedOptions = Object.assign(
            {}, DEFAULT_TRACED_OPTIONS, options || {},
        );
        const tracerInstance = trace.getTracer(
            opts.tracerName || defaultTracerName,
        );

        descriptor.value = function<T>(...args: any[]) {
            const className = this.constructor.name;
            const attributes = Object.assign({
                [AttributeNames.SPAN_KIND]: opts.kind,
                [AttributeNames.RESOURCE_NAME]: `${ className }.${
                    String(methodName) }`,
                ...(pkgName ? { [AttributeNames.RESOURCE_NAME]: pkgName } : {}),
                [AttributeNames.COMPONENT]: componentName,
            }, opts.tags || {});
            const span = tracerInstance.startSpan(SpanNames.METHOD_CALL, {
                attributes,
                kind: opts.kind === TraceKind.CLIENT
                    ? SpanKind.CLIENT
                    : SpanKind.SERVER,
            });

            try {
                const result: any = original && original.apply(this, args);

                if (result && result.then) {
                    // noinspection CommaExpressionJS
                    return result.then((res: any) => (span.end(), res))
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
 * Handles error gracefully, finishing tracing span before throwing
 *
 * @param {Span} span
 * @param {any} err
 * @throws {any}
 */
function handleError(span: Span, err: any) {
    span.setAttribute(AttributeNames.ERROR_MESSAGE, err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.end();

    throw err;
}