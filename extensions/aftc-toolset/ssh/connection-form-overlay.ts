// Reusable overlay-based connection form for the SSH feature.
//
// Both helpers are thin wrappers over the AFTC UI suite (ui/aftcUi.ts):
// `connectionFormOverlay` maps to showForm() (with the auth method as a
// choice field) and `authMethodOverlay` maps to showMenu(). Outside the
// TUI both resolve their fallback values so the caller can continue with
// the per-field prompts in `connection-form.ts`.

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { showForm, showMenu, type AftcFormField } from "../../ui/aftcUi";

export type AuthMethod = "password" | "key";

export interface ConnectionFormResult {
    name: string;
    username: string;
    host: string;
    port: number;
    connectTimeoutMs: number;
    identityFile?: string;
}

interface ConnectionFormOptions {
    title: string;
    /** Existing values to pre-fill (edit) or omit for new connections. */
    initial?: Partial<ConnectionFormResult>;
    /** Show the identity file field. Defaults to true. */
    allowIdentityFile?: boolean;
}

const DEFAULT_PORT = 22;
const MIN_PORT = 1;
const MAX_PORT = 65535;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MIN_TIMEOUT_SECONDS = 1;
const MAX_TIMEOUT_SECONDS = 300;
const SECONDS_PER_UNIT = 1000;
const AUTH_CHOICE_PASSWORD = "Password";
const AUTH_CHOICE_KEY = "Private key";

/**
 * Show the connection form. Returns the collected values when the user
 * submits, or null when they cancel — and also null outside the TUI, so
 * the caller falls back to the per-field prompts in `connection-form.ts`.
 */
export async function connectionFormOverlay(
    ctx: ExtensionCommandContext,
    options: ConnectionFormOptions,
): Promise<ConnectionFormResult | null> {
    if (ctx.mode !== "tui") return null;

    const initial = options.initial ?? {};
    const showKeyField = options.allowIdentityFile !== false;
    const initialTimeoutSeconds = initial.connectTimeoutMs !== undefined
        ? Math.round(initial.connectTimeoutMs / SECONDS_PER_UNIT)
        : undefined;

    // Port and timeout start empty in create mode so typing replaces
    // rather than appends to a default; empty resolves the default below.
    // In edit mode the current value is pre-filled and named in the label.
    const fields: AftcFormField[] = [
        { id: "name", label: "Connection name", required: true, ...(initial.name ? { initial: initial.name } : {}) },
        { id: "username", label: "Server username", required: true, ...(initial.username ? { initial: initial.username } : {}) },
        { id: "host", label: "Server host", required: true, ...(initial.host ? { initial: initial.host } : {}) },
        {
            id: "port",
            label: initial.port !== undefined ? `Port (current: ${initial.port}; leave empty to keep)` : "Port (leave empty for 22)",
            type: "int",
            min: MIN_PORT,
            max: MAX_PORT,
            ...(initial.port !== undefined ? { initial: String(initial.port) } : {}),
        },
        {
            id: "timeout",
            label: initialTimeoutSeconds !== undefined ? `Timeout seconds (current: ${initialTimeoutSeconds}; leave empty to keep)` : "Connection timeout seconds (leave empty for 30)",
            type: "int",
            min: MIN_TIMEOUT_SECONDS,
            max: MAX_TIMEOUT_SECONDS,
            ...(initialTimeoutSeconds !== undefined ? { initial: String(initialTimeoutSeconds) } : {}),
        },
        ...(showKeyField
            ? [{ id: "key", label: "Private-key file path (leave empty for password auth)", ...(initial.identityFile ? { initial: initial.identityFile } : {}) } satisfies AftcFormField]
            : []),
        {
            id: "auth",
            label: "Auth method",
            type: "choice",
            options: showKeyField ? [AUTH_CHOICE_PASSWORD, AUTH_CHOICE_KEY] : [AUTH_CHOICE_PASSWORD],
            initial: initial.identityFile ? AUTH_CHOICE_KEY : AUTH_CHOICE_PASSWORD,
        },
    ];

    const values = await showForm(ctx, {
        title: options.title,
        submitLabel: "[ SAVE ]",
        fields,
        validate: (raw) => {
            if (raw.auth === AUTH_CHOICE_KEY && !(raw.key ?? "").trim()) {
                return { fieldId: "key", message: "A private-key file path is required for key auth." };
            }
            return null;
        },
    });
    if (!values) return null;

    const name = String(values.name ?? "").trim();
    const username = String(values.username ?? "").trim();
    const host = String(values.host ?? "").trim();
    const port = typeof values.port === "number" ? values.port : (initial.port ?? DEFAULT_PORT);
    const timeoutSeconds = typeof values.timeout === "number" ? values.timeout : (initialTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
    const keyText = showKeyField ? String(values.key ?? "").trim() : "";
    const identityFile = values.auth === AUTH_CHOICE_KEY && keyText ? keyText : undefined;

    return {
        name,
        username,
        host,
        port,
        connectTimeoutMs: timeoutSeconds * SECONDS_PER_UNIT,
        ...(identityFile ? { identityFile } : {}),
    };
}

/**
 * Show a single-question select overlay that picks the auth method. Used by
 * the saved-connection flow where only credentials are still missing.
 * Outside the TUI the initial method is returned (caller falls back).
 */
export async function authMethodOverlay(
    ctx: ExtensionCommandContext,
    title: string,
    initial: AuthMethod,
): Promise<AuthMethod | null> {
    if (ctx.mode !== "tui") {
        return initial;
    }
    const value = await showMenu(ctx, {
        title,
        items: [
            { value: "password", label: "Password" },
            { value: "key", label: "Private key" },
        ],
        initialIndex: initial === "key" ? 1 : 0,
    });
    if (value === "password" || value === "key") return value;
    return null;
}
