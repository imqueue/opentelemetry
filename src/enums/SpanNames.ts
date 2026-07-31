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
 * The span names this package emits. There are only three, and they identify the
 * KIND of operation, not which method ran — the specific method is carried by
 * the `resource.name` attribute ({@link AttributeNames.RESOURCE_NAME}).
 *
 * @remarks
 * That split is what makes the traces groupable: a backend can aggregate all
 * `imq.request` spans as "outbound RPC" and still break them down by resource.
 * It also means filtering a dashboard by span name alone will never isolate a
 * single method.
 */
export enum SpanNames {
    /** A service handling an inbound RPC — the SERVER side. */
    IMQ_RESPONSE = 'imq.response',

    /** A client issuing an RPC and awaiting the reply — the CLIENT side. */
    IMQ_REQUEST = 'imq.request',

    /** A method wrapped with the `traced` decorator. */
    METHOD_CALL = 'method.call',
}
