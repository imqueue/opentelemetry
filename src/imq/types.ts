/*!
 * Copyright (c) 2023, imqueue.com <support@imqueue.com>
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
import { type Span } from '@opentelemetry/api';

/**
 * The parts of an `@imqueue/rpc` client or service this instrumentation reads
 * when naming a span. Structurally compatible with the real types, declared
 * locally so tracing does not force a dependency on a particular `rpc` version.
 */
export interface IMQClient {
    /** Service name as a service knows itself — used for SERVER spans. */
    name: string;

    /** Name of the service being called — used for CLIENT spans. */
    serviceName: string;
}

/**
 * The parts of an IMQ request this instrumentation reads, plus the two fields it
 * adds.
 */
export interface IMQRPCRequest {
    /** Remote method being invoked. */
    method: string;

    /** Identifier of the calling client. */
    from: string;

    /**
     * Serialisation hook. Replaced while the request is in flight so the live
     * `span` is dropped from the wire payload rather than being serialised.
     */
    toJSON: () => any;

    /** The span covering this request, attached by the instrumentation. */
    span?: Span;

    /**
     * Free-form envelope travelling with the request. The instrumentation stores
     * the injected trace context under a `clientSpan` key, which is how a trace
     * survives the hop between processes.
     */
    metadata?: any;
}

/** The parts of an IMQ response this instrumentation reads. */
export interface IMQRPCResponse {
    /** Successful result, if the call succeeded. */
    data?: any;

    /**
     * Failure, if the call failed. Its presence marks the client span `ERROR` —
     * accepted as either a string or an `Error`.
     */
    error?: any;

    /** The request this responds to. */
    request?: IMQRPCRequest;
}

/**
 * The subset of `@imqueue/rpc`'s default option singletons this instrumentation
 * mutates. `beforeCall`/`afterCall` are used on the client; `wrapCall` (the
 * around-hook) is used on the service so the handler runs inside the span's
 * OpenTelemetry context.
 */
export interface IMQCallHooks {
    /**
     * Runs before a client sends a request. Starts the CLIENT span and injects
     * its trace context into the request metadata.
     */
    beforeCall?: Function;

    /**
     * Runs after a client receives a response. Marks the span `ERROR` if the
     * response carries one, then ends it.
     */
    afterCall?: Function;

    /**
     * Wraps a service's handling of a request — an around-hook receiving a
     * `next` callback. Used instead of a before/after pair so the handler can run
     * INSIDE the SERVER span's context, which is what makes spans created
     * downstream nest under it.
     */
    wrapCall?: Function;
}
