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
 * Attribute keys this package sets on every span it creates.
 *
 * @remarks
 * These are the pre-OpenTelemetry Datadog-style keys (`resource.name`,
 * `service.name`, `component`) rather than the current OpenTelemetry semantic
 * conventions, which is what lets the spans land in a Datadog-shaped backend
 * unmodified. If your backend expects semantic-convention names instead, remap
 * them in a span processor — nothing here reads these keys back.
 */
export enum AttributeNames {
    /**
     * `'server'` or `'client'` — see {@link TraceKind}. Duplicates the
     * OpenTelemetry span kind as a plain attribute, for backends that only read
     * attributes.
     */
    SPAN_KIND = 'span.kind',

    /**
     * What ran, as `Name.method` — the IMQ service and method for an RPC span,
     * or `ClassName.methodName` for a `traced` method. This is the field to
     * group by; the span name only says which of the three kinds it is.
     */
    RESOURCE_NAME = 'resource.name',

    /** The IMQ service involved in the call, or the host package name. */
    SERVICE_NAME = 'service.name',

    /** Which client issued the request, taken from the IMQ request's `from`. */
    IMQ_CLIENT = 'imq.client',

    /** Always `'imq'`, marking the span as produced by this instrumentation. */
    COMPONENT = 'component',

    /** Failure detail, set alongside an `ERROR` span status. */
    ERROR_MESSAGE = 'error.message',
}
