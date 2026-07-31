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
import { TraceKind } from './enums/index.js';

/**
 * Options for the `traced` method decorator. Every field is optional at the call
 * site — `traced()` takes a `Partial` of this and fills the rest in.
 */
export interface TracedOptions {
    /**
     * Whether the decorated method represents work this process serves or work
     * it calls out for. Decides the OpenTelemetry span kind, and is also
     * recorded as the `span.kind` attribute. Defaults to
     * {@link TraceKind.SERVER}.
     */
    kind: TraceKind;

    /**
     * Extra attributes to set on every span the decorator creates. Applied
     * after the automatic ones, so a key used here overrides the automatic
     * value — including `resource.name`, if you want to name the operation
     * yourself.
     */
    tags?: TraceAttributes;

    /**
     * Name of the tracer to create spans with, `'basic'` when omitted. Only
     * worth setting to separate one subsystem's spans from another's; it does
     * not affect where spans are exported.
     */
    tracerName?: string;
}

/**
 * Span attributes as a flat string map.
 *
 * @remarks
 * Values are `string` only — deliberately narrower than OpenTelemetry's own
 * attribute type, which also permits numbers, booleans and arrays. Convert
 * before passing: `{ 'batch.size': String(rows.length) }`.
 */
export interface TraceAttributes {
    [name: string]: string;
}
