/* tslint:disable */
/* eslint-disable */

/**
 * The Open-Meteo ensemble-API URL for a point. `models` is a comma-separated list such as
 * `icon_seamless`; fetching it is up to the caller.
 */
export function ensembleUrl(latitude: number, longitude: number, forecast_days: number, models: string): string;

/**
 * The metric vocabulary as JSON: `[{"name", "unit", "description"}]`.
 */
export function listMetrics(): string;

/**
 * Built-in presets as JSON: `[{"name": ..., "description": ...}]`.
 */
export function listPresets(): string;

/**
 * The Open-Meteo multi-model forecast URL for a point. `models` is a comma-separated list such as
 * `ecmwf_ifs025,gfs_seamless`; fetching it is up to the caller.
 */
export function multiModelUrl(latitude: number, longitude: number, forecast_days: number, models: string): string;

/**
 * The Open-Meteo forecast URL for a point; fetching it is up to the caller.
 */
export function openMeteoUrl(latitude: number, longitude: number, forecast_days: number): string;

/**
 * Parses CSV text (see `adapters::csv`) into series JSON.
 */
export function parseCsv(text: string): string;

/**
 * Parses an Open-Meteo forecast response into series JSON.
 */
export function parseOpenMeteo(response: string): string;

/**
 * Parses an Open-Meteo multi-model or ensemble response into ensemble JSON
 * (`{"members": [{"name", "series"}]}`).
 */
export function parseOpenMeteoEnsemble(response: string): string;

/**
 * A preset's plan as JSON, for an operation lasting `hours`.
 */
export function presetPlan(name: string, hours: number): string;

/**
 * Version of the JSON shape of results (the `schema_version` field they carry).
 */
export function schemaVersion(): number;

/**
 * Runs a window search. `series_json` and `plan_json` use the CLI formats
 * (including `units` / `unit` conversion); returns the result as JSON.
 */
export function search(series_json: string, plan_json: string): string;

/**
 * Searches every member of an ensemble and returns per-window agreement as JSON. `min_agreement`
 * and `min_coverage` are shares in (0, 1]; agreement is a count of forecast versions, not a
 * probability.
 */
export function searchEnsemble(ensemble_json: string, plan_json: string, min_agreement: number, min_coverage: number): string;

/**
 * Library version.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly ensembleUrl: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly listMetrics: (a: number) => void;
    readonly listPresets: (a: number) => void;
    readonly multiModelUrl: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly openMeteoUrl: (a: number, b: number, c: number, d: number) => void;
    readonly parseCsv: (a: number, b: number, c: number) => void;
    readonly parseOpenMeteo: (a: number, b: number, c: number) => void;
    readonly parseOpenMeteoEnsemble: (a: number, b: number, c: number) => void;
    readonly presetPlan: (a: number, b: number, c: number, d: number) => void;
    readonly schemaVersion: () => number;
    readonly search: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly searchEnsemble: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly version: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
