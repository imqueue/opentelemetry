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
    InstrumentationConfig,
    InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import {
    IMQClient,
    IMQRPCRequest,
    IMQServiceOptions,
} from './imq/types';
import {
    context,
    propagation,
    SpanKind,
    trace,
    Tracer,
} from '@opentelemetry/api';
import { AttributeNames, SpanNames, TraceKind } from './enums';
import path from 'path';

let packageJson: { name: string; version: string };
let instrumentationName = '@imqueue/opentelemetry-instrumentation-imqueue';
let instrumentationVersion = '2.0.1';
const packageName = '@imqueue/rpc';
const versions = ['>=1.10'];
const componentName = 'imq';

try {
    packageJson = require(`${path.resolve('.')}${path.sep}package.json`);
    instrumentationName = packageJson.name;
    instrumentationVersion = packageJson.version;
} catch (err) {
    // Use fallback values if package.json cannot be read
}

type ServiceModule = {
    DEFAULT_IMQ_CLIENT_OPTIONS: IMQServiceOptions;
    DEFAULT_IMQ_SERVICE_OPTIONS: IMQServiceOptions;
};

export class ImqueueInstrumentation extends InstrumentationBase {
    private static thisTracer: Tracer;

    constructor(config: InstrumentationConfig = {}) {
        super(
            instrumentationName,
            instrumentationVersion,
            Object.assign({}, config),
        );
    }

    protected init() {
        const module = new InstrumentationNodeModuleDefinition(
            packageName,
            versions,
            moduleExports => {
                const { beforeCallClient, beforeCallService, afterCall } = this;

                Object.assign(
                    moduleExports.DEFAULT_IMQ_CLIENT_OPTIONS,
                    { beforeCall: beforeCallClient, afterCall },
                );

                Object.assign(
                    moduleExports.DEFAULT_IMQ_SERVICE_OPTIONS,
                    { beforeCall: beforeCallService, afterCall },
                );

                return moduleExports;
            },
            moduleExports => {
                ImqueueInstrumentation.unpatchClient(moduleExports);
                ImqueueInstrumentation.unpatchService(moduleExports);

                return moduleExports;
            },
        );

        ImqueueInstrumentation.thisTracer = this.tracer;

        return module;
    }

    private beforeCallClient = async function(
        this: IMQClient,
        req: IMQRPCRequest
    ): Promise<void> {
        req.toJSON = () => {
            const copy = Object.assign({}, req);
            delete copy.span;
            return copy;
        };

        try {
            const span = ImqueueInstrumentation.thisTracer.startSpan(
                SpanNames.IMQ_REQUEST,
                {
                    attributes: {
                        [AttributeNames.SPAN_KIND]: TraceKind.CLIENT,
                        [AttributeNames.RESOURCE_NAME]: `${ this.serviceName }.${
                            req.method }`,
                        [AttributeNames.SERVICE_NAME]: this.serviceName,
                        [AttributeNames.IMQ_CLIENT]: req.from,
                        [AttributeNames.COMPONENT]: componentName,
                    },
                    kind: SpanKind.CLIENT,
                },
            );

            req.metadata = req.metadata || {};
            req.metadata.clientSpan = {};

            propagation.inject(
                trace.setSpan(context.active(), span),
                req.metadata.clientSpan,
            );

            req.span = span;
        } catch (error) {
            // Silently handle the error
        }
    };

    private beforeCallService = async function(
        this: IMQClient,
        req: IMQRPCRequest
    ): Promise<void> {
        req.toJSON = () => {
            const copy = Object.assign({}, req);
            delete copy.span;
            return copy;
        };

        try {
            const carrier = (req.metadata || { clientSpan: null }).clientSpan;
            const parentContext = propagation.extract(context.active(), carrier);

            req.span = ImqueueInstrumentation.thisTracer.startSpan(
                SpanNames.IMQ_RESPONSE,
                {
                    attributes: {
                        [AttributeNames.SPAN_KIND]: TraceKind.SERVER,
                        [AttributeNames.RESOURCE_NAME]: `${ this.name }.${
                            req.method }`,
                        [AttributeNames.SERVICE_NAME]: this.name,
                        [AttributeNames.IMQ_CLIENT]: req.from,
                        [AttributeNames.COMPONENT]: componentName,
                    },
                    kind: SpanKind.SERVER,
                },
                parentContext,
            );
        } catch (error) {
            // Silently handle the error
        }
    };

    private afterCall = async function(
        this: IMQClient,
        req: IMQRPCRequest,
    ): Promise<void> {
        try {
            req.span?.end();
        } catch (error) {
            // Silently handle the error
        }
    };

    private static unpatchClient(serviceModule: ServiceModule): void {
        if (!serviceModule.DEFAULT_IMQ_CLIENT_OPTIONS) {
            return;
        }

        const {
            beforeCall,
            afterCall,
        } = serviceModule.DEFAULT_IMQ_CLIENT_OPTIONS;

        if (beforeCall) {
            delete serviceModule.DEFAULT_IMQ_CLIENT_OPTIONS.beforeCall;
        }

        if (afterCall) {
            delete serviceModule.DEFAULT_IMQ_CLIENT_OPTIONS.afterCall;
        }
    }

    private static unpatchService(serviceModule: ServiceModule): void {
        if (!serviceModule.DEFAULT_IMQ_SERVICE_OPTIONS) {
            return;
        }

        const {
            beforeCall,
            afterCall,
        } = serviceModule.DEFAULT_IMQ_SERVICE_OPTIONS;

        if (beforeCall) {
            delete serviceModule.DEFAULT_IMQ_SERVICE_OPTIONS.beforeCall;
        }

        if (afterCall) {
            delete serviceModule.DEFAULT_IMQ_SERVICE_OPTIONS.afterCall;
        }
    }
}
