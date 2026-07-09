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
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { propagation, trace } from '@opentelemetry/api';
import { type IMQClient, type IMQRPCRequest } from '../src/imq/types.js';
import { ImqueueInstrumentation } from '../index.js';

const self = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

const client: IMQClient = {
    name: 'client-name',
    serviceName: 'service-name',
};
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
    };
}

// the instrumentation captures its tracer statically at init() time from
// InstrumentationBase, which resolves it with trace.getTracer() during
// construction — so the tracer mock must be installed before constructing
function makeInstrumentation(t: TestContext, tracer: any): any {
    t.mock.method(trace, 'getTracer', () => tracer);

    return new ImqueueInstrumentation() as any;
}

function makeModuleExports(): any {
    return {
        DEFAULT_IMQ_CLIENT_OPTIONS: {},
        DEFAULT_IMQ_SERVICE_OPTIONS: {},
    };
}

describe('ImqueueInstrumentation', () => {
    describe('constructor', () => {
        it('should initialize with default config', () => {
            assert.ok(
                new ImqueueInstrumentation() instanceof ImqueueInstrumentation,
            );
        });

        it('should initialize with custom config', () => {
            const instrumentation = new ImqueueInstrumentation({
                enabled: false,
            });

            assert.ok(instrumentation instanceof ImqueueInstrumentation);
        });

        it('should use name and version from package.json', () => {
            const instrumentation = new ImqueueInstrumentation();

            assert.equal(instrumentation.instrumentationName, self.name);
            assert.equal(instrumentation.instrumentationVersion, self.version);
        });

        it('should fall back to defaults when no package.json exists', async () => {
            const cwd = process.cwd();

            process.chdir(tmpdir());

            try {
                // a fresh, query-busted copy evaluates from a directory
                // without package.json, exercising the fallback branch (the
                // ES module registry is immutable, hence the unique URL)
                const href = new URL(
                    '../src/instrumentation.js',
                    import.meta.url,
                ).href;
                const { ImqueueInstrumentation: Fallback } = await import(
                    `${href}?fallback=1`
                );

                assert.ok(new Fallback() instanceof Fallback);
            } finally {
                process.chdir(cwd);
            }
        });
    });

    describe('init()', () => {
        it('should define instrumentation for supported @imqueue/rpc', () => {
            const instrumentation: any = new ImqueueInstrumentation();
            const definition = instrumentation.init();

            assert.equal(definition.name, '@imqueue/rpc');
            assert.deepEqual(definition.supportedVersions, ['>=1.10']);
            assert.equal(typeof definition.patch, 'function');
            assert.equal(typeof definition.unpatch, 'function');
        });
    });

    describe('patching', () => {
        it('should patch client and service default options', () => {
            const instrumentation: any = new ImqueueInstrumentation();
            const moduleExports = makeModuleExports();
            const result = instrumentation.init().patch(moduleExports);

            for (const key of [
                'DEFAULT_IMQ_CLIENT_OPTIONS',
                'DEFAULT_IMQ_SERVICE_OPTIONS',
            ]) {
                assert.equal(typeof result[key].beforeCall, 'function');
                assert.equal(typeof result[key].afterCall, 'function');
            }
        });
    });

    describe('unpatching', () => {
        it('should unpatch client and service default options', () => {
            const instrumentation: any = new ImqueueInstrumentation();
            const definition = instrumentation.init();
            const moduleExports = definition.patch(makeModuleExports());
            const result = definition.unpatch(moduleExports);

            for (const key of [
                'DEFAULT_IMQ_CLIENT_OPTIONS',
                'DEFAULT_IMQ_SERVICE_OPTIONS',
            ]) {
                assert.equal(result[key].beforeCall, undefined);
                assert.equal(result[key].afterCall, undefined);
            }
        });

        it('should handle empty client and service options', () => {
            const instrumentation: any = new ImqueueInstrumentation();
            const result = instrumentation.init().unpatch(makeModuleExports());

            assert.deepEqual(result, makeModuleExports());
        });

        it('should handle undefined client options', () => {
            const instrumentation: any = new ImqueueInstrumentation();
            const moduleExports = { DEFAULT_IMQ_SERVICE_OPTIONS: {} };
            const result = instrumentation.init().unpatch(moduleExports);

            assert.deepEqual(result, { DEFAULT_IMQ_SERVICE_OPTIONS: {} });
        });

        it('should handle undefined service options', () => {
            const instrumentation: any = new ImqueueInstrumentation();
            const moduleExports = { DEFAULT_IMQ_CLIENT_OPTIONS: {} };
            const result = instrumentation.init().unpatch(moduleExports);

            assert.deepEqual(result, { DEFAULT_IMQ_CLIENT_OPTIONS: {} });
        });
    });

    describe('beforeCallClient', () => {
        it('should create a client span on the request', async (t: TestContext) => {
            const span = makeSpan(t);
            const startSpan = t.mock.fn(() => span);
            const instrumentation = makeInstrumentation(t, { startSpan });
            const request = makeRequest();

            await instrumentation.beforeCallClient.call(client, request);

            assert.equal(request.span, span);
            assert.ok(request.metadata);
            assert.ok(request.metadata.clientSpan);
            assert.equal(startSpan.mock.calls.length, 1);

            const [, options] = startSpan.mock.calls[0].arguments as any[];

            assert.equal(
                options.attributes['resource.name'],
                'service-name.test-method',
            );
        });

        it('should inject context into request metadata', async (t: TestContext) => {
            const span = makeSpan(t);
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => span,
            });
            const inject = t.mock.method(propagation, 'inject');
            const request = makeRequest();

            await instrumentation.beforeCallClient.call(client, request);

            assert.equal(inject.mock.calls.length, 1);
            assert.equal(request.span, span);
        });

        it('should override toJSON to exclude span', async (t: TestContext) => {
            const span = makeSpan(t);
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => span,
            });
            const request = makeRequest();

            await instrumentation.beforeCallClient.call(client, request);

            assert.equal(request.toJSON().span, undefined);
        });

        it('should silently handle tracer errors', async (t: TestContext) => {
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => {
                    throw new Error('Test error');
                },
            });
            const request = makeRequest();

            await instrumentation.beforeCallClient.call(client, request);

            assert.equal(request.span, undefined);
        });
    });

    describe('beforeCallService', () => {
        it('should create a service span from client context', async (t: TestContext) => {
            const span = makeSpan(t);
            const startSpan = t.mock.fn(() => span);
            const instrumentation = makeInstrumentation(t, { startSpan });
            const extract = t.mock.method(propagation, 'extract');
            const request = makeRequest({ clientSpan: {} });

            await instrumentation.beforeCallService.call(service, request);

            assert.equal(request.span, span);
            assert.equal(extract.mock.calls.length, 1);

            const [, options] = startSpan.mock.calls[0].arguments as any[];

            assert.equal(
                options.attributes['resource.name'],
                'service-name.test-method',
            );
        });

        it('should handle missing metadata', async (t: TestContext) => {
            const span = makeSpan(t);
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => span,
            });
            const extract = t.mock.method(propagation, 'extract');
            const request = makeRequest();

            await instrumentation.beforeCallService.call(service, request);

            assert.equal(extract.mock.calls.length, 1);
            assert.equal(request.span, span);
        });

        it('should override toJSON to exclude span', async (t: TestContext) => {
            const span = makeSpan(t);
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => span,
            });
            const request = makeRequest({ clientSpan: {} });

            await instrumentation.beforeCallService.call(service, request);

            assert.equal(request.toJSON().span, undefined);
        });

        it('should silently handle tracer errors', async (t: TestContext) => {
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => {
                    throw new Error('Test error');
                },
            });
            const request = makeRequest({ clientSpan: {} });

            await instrumentation.beforeCallService.call(service, request);

            assert.equal(request.span, undefined);
        });
    });

    describe('afterCall', () => {
        it('should end the request span', async (t: TestContext) => {
            const span = makeSpan(t);
            const instrumentation = makeInstrumentation(t, {
                startSpan: () => span,
            });
            const request = makeRequest();

            request.span = span;

            await instrumentation.afterCall.call(client, request);

            assert.equal(span.end.mock.calls.length, 1);
        });

        it('should handle a missing span', async () => {
            const instrumentation: any = new ImqueueInstrumentation();
            const request = makeRequest();

            await assert.doesNotReject(
                instrumentation.afterCall.call(client, request),
            );
        });

        it('should silently handle span errors', async (t: TestContext) => {
            const span = makeSpan(t);

            span.end = t.mock.fn(() => {
                throw new Error('Test error');
            });

            const instrumentation: any = new ImqueueInstrumentation();
            const request = makeRequest();

            request.span = span;

            await assert.doesNotReject(
                instrumentation.afterCall.call(client, request),
            );
            assert.equal(span.end.mock.calls.length, 1);
        });
    });
});
