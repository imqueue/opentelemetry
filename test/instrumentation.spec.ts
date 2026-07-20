/*!
 * ImqueueInstrumentation Unit Tests
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
import { before, describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { type IMQClient, type IMQRPCRequest } from '../src/imq/types.js';
import { ImqueueInstrumentation } from '../index.js';

const self = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

// A real context manager so `context.with(...)` actually propagates — required
// to prove the service `wrapCall` runs the handler inside the span's context.
before(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager());
});

const client: IMQClient = { name: 'client-name', serviceName: 'service-name' };
const service: IMQClient = {
    name: 'service-name',
    serviceName: 'service-name',
};

function makeRequest(metadata?: any): IMQRPCRequest {
    return {
        method: 'test-method',
        from: 'client-id',
        toJSON: () => ({}),
        ...(metadata !== undefined ? { metadata } : {}),
    };
}

function makeSpan(t: TestContext): any {
    return {
        end: t.mock.fn(),
        setAttribute: t.mock.fn(),
        setStatus: t.mock.fn(),
        recordException: t.mock.fn(),
        spanContext: () => ({
            traceId: '0'.repeat(32),
            spanId: '0'.repeat(16),
            traceFlags: 1,
        }),
    };
}

// Install a tracer mock BEFORE constructing — the base captures the tracer via
// trace.getTracer() at construction time.
function makeInstrumentation(t: TestContext, tracer: any): any {
    t.mock.method(trace, 'getTracer', () => tracer);

    return new ImqueueInstrumentation() as any;
}

const emptyModule = () => ({
    DEFAULT_IMQ_CLIENT_OPTIONS: {},
    DEFAULT_IMQ_SERVICE_OPTIONS: {},
});

describe('ImqueueInstrumentation', () => {
    describe('constructor', () => {
        it('constructs and reads name/version from package.json', () => {
            const instrumentation = new ImqueueInstrumentation();

            assert.ok(instrumentation instanceof ImqueueInstrumentation);
            assert.equal(instrumentation.instrumentationName, self.name);
            assert.equal(instrumentation.instrumentationVersion, self.version);
        });

        it('honours a custom (disabled) config', () => {
            assert.ok(
                new ImqueueInstrumentation({ enabled: false }) instanceof
                    ImqueueInstrumentation,
            );
        });
    });

    describe('init()', () => {
        it('registers no module-load hook (patches singletons directly)', () => {
            const instrumentation: any = new ImqueueInstrumentation();

            assert.deepEqual(instrumentation.init(), []);
        });
    });

    describe('patch()/unpatch()', () => {
        it('patches client before/after and service wrapCall', (t: TestContext) => {
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => makeSpan(t),
            });
            const rpc = instrumentation.patch(emptyModule());

            assert.equal(
                typeof rpc.DEFAULT_IMQ_CLIENT_OPTIONS.beforeCall,
                'function',
            );
            assert.equal(
                typeof rpc.DEFAULT_IMQ_CLIENT_OPTIONS.afterCall,
                'function',
            );
            assert.equal(
                typeof rpc.DEFAULT_IMQ_SERVICE_OPTIONS.wrapCall,
                'function',
            );
            // the service uses the around-hook, not before/after
            assert.equal(rpc.DEFAULT_IMQ_SERVICE_OPTIONS.beforeCall, undefined);
        });

        it('unpatch removes every hook it added', (t: TestContext) => {
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => makeSpan(t),
            });
            const rpc = instrumentation.unpatch(
                instrumentation.patch(emptyModule()),
            );

            assert.equal(rpc.DEFAULT_IMQ_CLIENT_OPTIONS.beforeCall, undefined);
            assert.equal(rpc.DEFAULT_IMQ_CLIENT_OPTIONS.afterCall, undefined);
            assert.equal(rpc.DEFAULT_IMQ_SERVICE_OPTIONS.wrapCall, undefined);
        });

        it('tolerates missing client/service option objects', (t: TestContext) => {
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => makeSpan(t),
            });

            assert.doesNotThrow(() => instrumentation.patch({}));
            assert.doesNotThrow(() => instrumentation.unpatch({}));
        });
    });

    describe('client beforeCall/afterCall', () => {
        it('starts a client span and injects context into metadata', async (t: TestContext) => {
            const span = makeSpan(t);
            const startSpan = t.mock.fn(() => span);
            const instrumentation = makeInstrumentation(t, { startSpan });
            const rpc = instrumentation.patch(emptyModule());
            const req = makeRequest();

            await rpc.DEFAULT_IMQ_CLIENT_OPTIONS.beforeCall.call(client, req);

            assert.equal(req.span, span);
            assert.ok(req.metadata && req.metadata.clientSpan);
            assert.equal(startSpan.mock.calls.length, 1);
        });

        it('ends the span and flags errors on afterCall', async (t: TestContext) => {
            const span = makeSpan(t);
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => span,
            });
            const rpc = instrumentation.patch(emptyModule());
            const req = makeRequest();

            await rpc.DEFAULT_IMQ_CLIENT_OPTIONS.beforeCall.call(client, req);
            await rpc.DEFAULT_IMQ_CLIENT_OPTIONS.afterCall.call(client, req, {
                error: { message: 'boom' },
            });

            assert.equal(span.end.mock.calls.length, 1);
            assert.equal(span.setStatus.mock.calls.length, 1);
        });

        it('afterCall is a no-op when no span was attached', async (t: TestContext) => {
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => makeSpan(t),
            });
            const rpc = instrumentation.patch(emptyModule());

            await assert.doesNotReject(
                rpc.DEFAULT_IMQ_CLIENT_OPTIONS.afterCall.call(
                    client,
                    makeRequest(),
                ),
            );
        });
    });

    describe('service wrapCall', () => {
        it('runs the handler INSIDE the server span context (nesting works)', async (t: TestContext) => {
            const span = makeSpan(t);
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => span,
            });
            const rpc = instrumentation.patch(emptyModule());
            const req = makeRequest();

            let activeInsideHandler: unknown;
            const next = async () => {
                activeInsideHandler = trace.getSpan(context.active());

                return 'result';
            };

            const result = await rpc.DEFAULT_IMQ_SERVICE_OPTIONS.wrapCall.call(
                service,
                req,
                {},
                next,
            );

            assert.equal(result, 'result');
            assert.equal(activeInsideHandler, span, 'handler sees the span');
            assert.equal(req.span, span);
            assert.equal(span.end.mock.calls.length, 1);
        });

        it('records the exception, ends the span, and rethrows', async (t: TestContext) => {
            const span = makeSpan(t);
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => span,
            });
            const rpc = instrumentation.patch(emptyModule());
            const boom = new Error('handler failed');

            await assert.rejects(
                rpc.DEFAULT_IMQ_SERVICE_OPTIONS.wrapCall.call(
                    service,
                    makeRequest(),
                    {},
                    async () => {
                        throw boom;
                    },
                ),
                boom,
            );

            assert.equal(span.recordException.mock.calls.length, 1);
            assert.equal(span.setStatus.mock.calls.length, 1);
            assert.equal(span.end.mock.calls.length, 1);
        });
    });
});
