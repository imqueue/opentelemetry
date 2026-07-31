/*!
 * traceStart/traceEnd/traced Unit Tests
 *
 * Copyright (c) 2026, imqueue.com <support@imqueue.com>
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
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trace } from '@opentelemetry/api';
import {
    AttributeNames,
    SpanNames,
    TraceKind,
    traced,
    traceEnd,
    traceStart,
} from '../index.js';

const self = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

function makeSpan(t: TestContext): any {
    return {
        end: t.mock.fn(),
        setAttribute: t.mock.fn(),
        setStatus: t.mock.fn(),
        recordException: t.mock.fn(),
    };
}

// Records every startSpan(name, options) so the attributes can be asserted.
function makeTracer(t: TestContext, span: any) {
    const calls: { name: string; options?: any }[] = [];

    t.mock.method(trace, 'getTracer', () => ({
        startSpan(name: string, options?: any) {
            calls.push({ name, options });

            return span;
        },
    }));

    return calls;
}

// `traced()` targets legacy decorators, which this tsconfig does not enable —
// apply the returned decorator by hand instead of using decorator syntax.
function decorate(
    t: TestContext,
    span: any,
    body: (...args: any[]) => any,
    options?: Parameters<typeof traced>[0],
    className = 'Reports',
) {
    const calls = makeTracer(t, span);
    const descriptor: any = { value: body };
    const target = { constructor: { name: className } };

    traced(options)(target, 'rebuild', descriptor);

    return {
        calls,
        call: (...args: any[]) => descriptor.value.apply(target, args),
    };
}

describe('traceStart()/traceEnd()', () => {
    it('applies the tags it was given as span attributes', (t: TestContext) => {
        const span = makeSpan(t);
        const calls = makeTracer(t, span);

        traceStart('tagged', { 'batch.size': '42' });
        traceEnd('tagged');

        assert.equal(calls.length, 1);
        assert.equal(calls[0].name, 'tagged');
        assert.deepEqual(calls[0].options, {
            attributes: { 'batch.size': '42' },
        });
    });

    it('omits the options argument when no tags are given', (t: TestContext) => {
        const span = makeSpan(t);
        const calls = makeTracer(t, span);

        traceStart('untagged');
        traceEnd('untagged');

        assert.equal(calls[0].options, undefined);
    });

    it('refuses a second span under a live name', (t: TestContext) => {
        makeTracer(t, makeSpan(t));

        traceStart('busy');

        assert.throws(() => traceStart('busy'), TypeError);

        traceEnd('busy');
    });

    it('ends the span and frees the name for reuse', (t: TestContext) => {
        const span = makeSpan(t);
        const calls = makeTracer(t, span);

        traceStart('reused');
        traceEnd('reused');

        assert.equal(span.end.mock.callCount(), 1);

        traceStart('reused');
        traceEnd('reused');

        assert.equal(calls.length, 2);
        assert.equal(span.end.mock.callCount(), 2);
    });

    it('ignores an unknown name instead of throwing', (t: TestContext) => {
        makeTracer(t, makeSpan(t));

        assert.doesNotThrow(() => traceEnd('never-started'));
    });
});

describe('traced()', () => {
    it('names the resource after the class and method', (t: TestContext) => {
        const span = makeSpan(t);
        const { calls, call } = decorate(t, span, () => 'done');

        assert.equal(call(), 'done');
        assert.equal(calls[0].name, SpanNames.METHOD_CALL);

        const attributes = calls[0].options.attributes;

        // The host package name identifies the SERVICE; it must not overwrite
        // the resource name, which is what distinguishes one traced method from
        // another in the same process.
        assert.equal(
            attributes[AttributeNames.RESOURCE_NAME],
            'Reports.rebuild',
        );
        assert.equal(attributes[AttributeNames.SERVICE_NAME], self.name);
        assert.equal(attributes[AttributeNames.COMPONENT], 'imq');
        assert.equal(attributes[AttributeNames.SPAN_KIND], TraceKind.SERVER);
    });

    it('keeps two traced methods distinguishable', (t: TestContext) => {
        const span = makeSpan(t);
        const a = decorate(t, span, () => null, undefined, 'Invoices');
        const b = decorate(t, span, () => null, undefined, 'Reports');

        a.call();
        b.call();

        assert.equal(
            a.calls[0].options.attributes[AttributeNames.RESOURCE_NAME],
            'Invoices.rebuild',
        );
        assert.equal(
            b.calls[0].options.attributes[AttributeNames.RESOURCE_NAME],
            'Reports.rebuild',
        );
    });

    it('lets caller tags override the automatic attributes', (t: TestContext) => {
        const span = makeSpan(t);
        const { calls, call } = decorate(t, span, () => null, {
            kind: TraceKind.CLIENT,
            tags: { [AttributeNames.RESOURCE_NAME]: 'custom' },
        });

        call();

        assert.equal(
            calls[0].options.attributes[AttributeNames.RESOURCE_NAME],
            'custom',
        );
        assert.equal(
            calls[0].options.attributes[AttributeNames.SPAN_KIND],
            TraceKind.CLIENT,
        );
    });

    it('holds the span open until the returned promise settles', async (t: TestContext) => {
        const span = makeSpan(t);
        let release: (v: unknown) => void = () => undefined;
        const { call } = decorate(
            t,
            span,
            () => new Promise(resolve => (release = resolve)),
        );

        const pending = call();

        assert.equal(span.end.mock.callCount(), 0);

        release('ok');

        assert.equal(await pending, 'ok');
        assert.equal(span.end.mock.callCount(), 1);
    });

    it('fails the span and rethrows a rejection', async (t: TestContext) => {
        const span = makeSpan(t);
        const boom = new Error('boom');
        const { call } = decorate(t, span, () => Promise.reject(boom));

        await assert.rejects(() => call(), /boom/);
        assert.equal(span.end.mock.callCount(), 1);
        assert.equal(span.setStatus.mock.callCount(), 1);
    });

    it('fails the span and rethrows a synchronous error', (t: TestContext) => {
        const span = makeSpan(t);
        const { call } = decorate(t, span, () => {
            throw new Error('sync boom');
        });

        assert.throws(() => call(), /sync boom/);
        assert.equal(span.end.mock.callCount(), 1);
    });
});
