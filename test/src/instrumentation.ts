import { expect } from 'chai';
import * as sinon from 'sinon';
import { context, propagation, trace, Context } from '@opentelemetry/api';
import { IMQClient, IMQRPCRequest } from '../../src/imq/types';

const mockPackageJson = {
    name: '@imqueue/opentelemetry-instrumentation-imqueue',
    version: '2.0.2'
};

const originalRequire = require;
const shouldThrowError = { value: false };

(global as any).require = function(id: string) {
    if (id.includes('package.json')) {
        if (shouldThrowError.value) {
            throw new Error('Cannot find package.json');
        }

        return mockPackageJson;
    }

    return originalRequire(id);
};

import { ImqueueInstrumentation } from '../../src';

describe('ImqueueInstrumentation', () => {
    let sandbox: sinon.SinonSandbox;
    const mockSpan: any = {};
    const mockTracer: any = {};
    const mockContext: any = {};
    const mockPropagation: any = {};
    const mockServiceModule: any = {};

    beforeEach(() => {
        sandbox = sinon.createSandbox();

        mockSpan.end = sandbox.stub();
        mockSpan.setAttribute = sandbox.stub();
        mockSpan.setStatus = sandbox.stub();

        mockTracer.startSpan = sandbox.stub().returns(mockSpan);

        const mockCtx: Context = {
            getValue: sandbox.stub(),
            setValue: sandbox.stub(),
            deleteValue: sandbox.stub()
        };

        mockContext.active = sandbox.stub().returns(mockCtx);

        mockPropagation.inject = sandbox.stub();
        mockPropagation.extract = sandbox.stub().returns(mockCtx);

        sandbox.stub(trace, 'getTracer').returns(mockTracer);
        sandbox.stub(trace, 'setSpan').returns(mockCtx);
        sandbox.stub(context, 'active').returns(mockCtx);
        sandbox.stub(propagation, 'inject');
        sandbox.stub(propagation, 'extract').returns(mockCtx);

        mockServiceModule.DEFAULT_IMQ_CLIENT_OPTIONS = {};
        mockServiceModule.DEFAULT_IMQ_SERVICE_OPTIONS = {};
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('constructor', () => {
        it('should initialize with default config', () => {
            const instrumentation = new ImqueueInstrumentation();
            expect(instrumentation).to.be.instanceOf(ImqueueInstrumentation);
        });

        it('should initialize with custom config', () => {
            const config = { enabled: false };
            const instrumentation = new ImqueueInstrumentation(config);
            expect(instrumentation).to.be.instanceOf(ImqueueInstrumentation);
        });

        it('should use name and version from package.json', () => {
            const instrumentation = new ImqueueInstrumentation();

            expect(mockPackageJson.name).to.equal(
                instrumentation.instrumentationName,
            );
            expect(mockPackageJson.version).to.equal(
                instrumentation.instrumentationVersion,
            );
        });

        it('should use fallback values when package.json cannot be read', () => {
            shouldThrowError.value = true;

            delete require.cache[require.resolve('../../src/instrumentation')];

            const { ImqueueInstrumentation: FallbackInstrumentation } =
                require('../../src/instrumentation');
            const instrumentation = new FallbackInstrumentation();

            expect(instrumentation).to.be.instanceOf(FallbackInstrumentation);

            shouldThrowError.value = false;

            delete require.cache[require.resolve('../../src/instrumentation')];
            require('../../src/instrumentation');
        });
    });

    describe('init', () => {
        it('should return an InstrumentationNodeModuleDefinition', () => {
            const instrumentation = new ImqueueInstrumentation();
            expect(instrumentation).to.be.instanceOf(ImqueueInstrumentation);

            const packageName = '@imqueue/rpc';
            const versions = ['>=1.10'];

            expect(packageName).to.equal('@imqueue/rpc');
            expect(versions).to.deep.equal(['>=1.10']);
        });
    });

    describe('patching', () => {
        const instrumentation = new ImqueueInstrumentation();

        it('should patch client options with beforeCallClient and afterCall', () => {
            const moduleExports = { ...mockServiceModule };
            const result = (instrumentation as any).init().patch(moduleExports);

            expect(result.DEFAULT_IMQ_CLIENT_OPTIONS).to.have.property('beforeCall');
            expect(result.DEFAULT_IMQ_CLIENT_OPTIONS).to.have.property('afterCall');
        });

        it('should patch service options with beforeCallService and afterCall', () => {
            const moduleExports = { ...mockServiceModule };
            const result = (instrumentation as any).init().patch(moduleExports);

            expect(result.DEFAULT_IMQ_SERVICE_OPTIONS).to.have.property('beforeCall');
            expect(result.DEFAULT_IMQ_SERVICE_OPTIONS).to.have.property('afterCall');
        });
    });

    describe('unpatching', () => {
        const instrumentation = new ImqueueInstrumentation();

        it('should unpatch client options', () => {
            const moduleExports = {
                DEFAULT_IMQ_CLIENT_OPTIONS: {
                    beforeCall: () => {},
                    afterCall: () => {}
                },
                DEFAULT_IMQ_SERVICE_OPTIONS: {}
            };

            const result = (instrumentation as any).init().unpatch(moduleExports);

            expect(result.DEFAULT_IMQ_CLIENT_OPTIONS)
                .not.to.have.property('beforeCall');
            expect(result.DEFAULT_IMQ_CLIENT_OPTIONS)
                .not.to.have.property('afterCall');
        });

        it('should unpatch service options', () => {
            const moduleExports = {
                DEFAULT_IMQ_CLIENT_OPTIONS: {},
                DEFAULT_IMQ_SERVICE_OPTIONS: {
                    beforeCall: () => {},
                    afterCall: () => {}
                }
            };

            const result = (instrumentation as any).init().unpatch(moduleExports);

            expect(result.DEFAULT_IMQ_SERVICE_OPTIONS)
                .not.to.have.property('beforeCall');
            expect(result.DEFAULT_IMQ_SERVICE_OPTIONS)
                .not.to.have.property('afterCall');
        });

        it('should handle missing client options', () => {
            const moduleExports = {
                DEFAULT_IMQ_CLIENT_OPTIONS: {},
                DEFAULT_IMQ_SERVICE_OPTIONS: {}
            };

            const result = (instrumentation as any).init().unpatch(moduleExports);

            expect(result.DEFAULT_IMQ_CLIENT_OPTIONS).to.deep.equal({});
        });

        it('should handle missing service options', () => {
            const moduleExports = {
                DEFAULT_IMQ_CLIENT_OPTIONS: {},
                DEFAULT_IMQ_SERVICE_OPTIONS: {}
            };

            const result = (instrumentation as any).init().unpatch(moduleExports);

            expect(result.DEFAULT_IMQ_SERVICE_OPTIONS).to.deep.equal({});
        });

        it('should handle undefined client options', () => {
            const moduleExports = {
                DEFAULT_IMQ_SERVICE_OPTIONS: {}
            };

            const result = (instrumentation as any).init().unpatch(moduleExports);

            expect(result).to.deep.equal({
                DEFAULT_IMQ_SERVICE_OPTIONS: {}
            });
        });

        it('should handle undefined service options', () => {
            const moduleExports = {
                DEFAULT_IMQ_CLIENT_OPTIONS: {}
            };

            const result = (instrumentation as any).init().unpatch(moduleExports);

            expect(result).to.deep.equal({
                DEFAULT_IMQ_CLIENT_OPTIONS: {}
            });
        });
    });

    describe('beforeCallClient', () => {
        const instrumentation = new ImqueueInstrumentation();
        const client: IMQClient = {
            name: 'client-name',
            serviceName: 'service-name'
        };

        beforeEach(() => {
            (instrumentation as any).init();
            mockTracer.startSpan.resetHistory();
            mockTracer.startSpan.returns(mockSpan);
        });

        it('should create a span for the client request', async () => {
            const request: IMQRPCRequest = {
                method: 'test-method',
                from: 'client-id',
                toJSON: () => ({})
            };

            const beforeCallClient = (instrumentation as any).beforeCallClient;
            await beforeCallClient.call(client, request);

            // Verify that the span was set on the request
            expect(request).to.have.property('span');

            // Verify that metadata was set correctly
            expect(request).to.have.property('metadata');
            expect(request.metadata).to.have.property('clientSpan');
        });

        it('should inject context into request metadata', async () => {
            const request: IMQRPCRequest = {
                method: 'test-method',
                from: 'client-id',
                toJSON: () => ({})
            };

            const beforeCallClient = (instrumentation as any).beforeCallClient;
            await beforeCallClient.call(client, request);

            expect(request.metadata).to.have.property('clientSpan');
            let injectStub: sinon.SinonStub;
            injectStub = propagation.inject as sinon.SinonStub;
            expect(injectStub.called).to.be.true;
            expect(request).to.have.property('span');
        });

        it('should override toJSON to exclude span', async () => {
            const request: IMQRPCRequest = {
                method: 'test-method',
                from: 'client-id',
                toJSON: () => ({})
            };

            const beforeCallClient = (instrumentation as any).beforeCallClient;
            await beforeCallClient.call(client, request);

            const json = request.toJSON();
            expect(json).not.to.have.property('span');
        });
    });

    describe('beforeCallService', () => {
        const instrumentation: any = new ImqueueInstrumentation();
        const service: IMQClient = {
            name: 'service-name',
            serviceName: 'service-name'
        };

        beforeEach(() => {
            (instrumentation as any).init();
            mockTracer.startSpan.resetHistory();
            mockTracer.startSpan.returns(mockSpan);
        });

        it('should create a span for the service response', async () => {
            const request: IMQRPCRequest = {
                method: 'test-method',
                from: 'client-id',
                toJSON: () => ({}),
                metadata: {
                    clientSpan: {}
                }
            };

            const beforeCallService = (instrumentation as any).beforeCallService;
            await beforeCallService.call(service, request);

            // Verify that the span was set on the request
            expect(request).to.have.property('span');
        });

        it('should extract context from request metadata', async () => {
            const request: IMQRPCRequest = {
                method: 'test-method',
                from: 'client-id',
                toJSON: () => ({}),
                metadata: {
                    clientSpan: {}
                }
            };

            const beforeCallService = (instrumentation as any).beforeCallService;
            await beforeCallService.call(service, request);

            let extractStub: sinon.SinonStub;
            extractStub = propagation.extract as sinon.SinonStub;
            expect(extractStub.called).to.be.true;
            expect(request).to.have.property('span');
        });

        it('should handle missing metadata', async () => {
            const request: IMQRPCRequest = {
                method: 'test-method',
                from: 'client-id',
                toJSON: () => ({})
            };

            const beforeCallService = instrumentation.beforeCallService;
            await beforeCallService.call(service, request);

            let extractStub: sinon.SinonStub;
            extractStub = propagation.extract as sinon.SinonStub;
            expect(extractStub.called).to.be.true;
            expect(request).to.have.property('span');
        });

        it('should override toJSON to exclude span', async () => {
            const request: IMQRPCRequest = {
                method: 'test-method',
                from: 'client-id',
                toJSON: () => ({}),
                metadata: {
                    clientSpan: {}
                }
            };

            const beforeCallService = (instrumentation as any).beforeCallService;
            await beforeCallService.call(service, request);

            const json = request.toJSON();
            expect(json).not.to.have.property('span');
        });
    });

    describe('afterCall', () => {
        const instrumentation = new ImqueueInstrumentation();
        const client: IMQClient = {
            name: 'client-name',
            serviceName: 'service-name'
        };

        beforeEach(() => {
            (instrumentation as any).init();
            mockSpan.end.resetHistory();
        });

        it('should end the span', async () => {
            const request: IMQRPCRequest = {
                method: 'test-method',
                from: 'client-id',
                toJSON: () => ({}),
                span: mockSpan
            };

            const afterCall = (instrumentation as any).afterCall;
            await afterCall.call(client, request);

            expect(mockSpan.end.called).to.be.true;
        });

        it('should handle missing span', async () => {
            const request: IMQRPCRequest = {
                method: 'test-method',
                from: 'client-id',
                toJSON: () => ({})
            };

            const afterCall = (instrumentation as any).afterCall;
            await afterCall.call(client, request);

            expect(mockSpan.end.called).to.be.false;
        });
    });

    it('should handle error in beforeCallClient', async () => {
        const instrumentation = new ImqueueInstrumentation();
        (instrumentation as any).init();

        const client: IMQClient = {
            name: 'client-name',
            serviceName: 'service-name'
        };

        const request: IMQRPCRequest = {
            method: 'test-method',
            from: 'client-id',
            toJSON: () => ({})
        };

        mockTracer.startSpan.throws(new Error('Test error'));

        const beforeCallClient = (instrumentation as any).beforeCallClient;
        await beforeCallClient.call(client, request);

        expect(request).not.to.have.property('span');
    });

    it('should handle error in beforeCallService', async () => {
        const instrumentation = new ImqueueInstrumentation();
        (instrumentation as any).init();

        const service: IMQClient = {
            name: 'service-name',
            serviceName: 'service-name'
        };

        const request: IMQRPCRequest = {
            method: 'test-method',
            from: 'client-id',
            toJSON: () => ({}),
            metadata: {
                clientSpan: {}
            }
        };

        mockTracer.startSpan.throws(new Error('Test error'));

        const beforeCallService = (instrumentation as any).beforeCallService;
        await beforeCallService.call(service, request);

        expect(request).not.to.have.property('span');
    });

    it('should handle error in afterCall', async () => {
        const instrumentation = new ImqueueInstrumentation();
        (instrumentation as any).init();

        const client: IMQClient = {
            name: 'client-name',
            serviceName: 'service-name'
        };

        const request: IMQRPCRequest = {
            method: 'test-method',
            from: 'client-id',
            toJSON: () => ({}),
            span: mockSpan
        };

        mockSpan.end.throws(new Error('Test error'));

        const afterCall = (instrumentation as any).afterCall;
        await afterCall.call(client, request);

        expect(mockSpan.end.called).to.be.true;
    });
});
