import type { SshConnection } from "./connection-store";
import { SshCarrierRequestError } from "./carrier";

const REDACTED = "[redacted]";

/** Redact arbitrary sensitive values without retaining them after use. */
export function redactSshValues(text: string, values: Iterable<string | undefined>): string {
    const unique = [...new Set([...values].filter((value): value is string => Boolean(value)))];
    return unique.sort((a, b) => b.length - a.length).reduce(
        (safe, value) => safe.split(value).join(REDACTED),
        text,
    );
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactCaseInsensitive(text: string, value: string | undefined): string {
    if (!value) return text;
    return text.replace(new RegExp(escapeRegExp(value), "gi"), REDACTED);
}

/** Remove local connection metadata from text that can leave the SSH module. */
export function redactSshText(text: string, connection: SshConnection): string {
    const exact = redactSshValues(text, [
        connection.username,
        connection.host,
        connection.port === undefined ? undefined : String(connection.port),
        connection.identityFile,
        connection.password,
    ]);
    return redactCaseInsensitive(redactCaseInsensitive(exact, connection.host), connection.identityFile);
}

/** A safe, non-diagnostic error for any failed carrier operation. */
export function sshSafeError(): Error {
    return new Error("SSH operation failed. Check the local connection configuration.");
}

// Carrier command-timeout and transfer-cancelled codes (see carrier errors.py).
// Numeric codes carry no endpoint or credential data, so they can be mapped to
// safe categories.
const SSH_COMMAND_TIMEOUT_CODE = -32010;
const SSH_TRANSFER_CANCELLED_CODE = -32060;

/**
 * Map any thrown error to a safe, non-diagnostic category message for the model
 * boundary. It never echoes host, user, port, key path, password, passphrase,
 * fingerprint, or carrier diagnostics; it only distinguishes safe outcomes
 * (timeout, cancellation, missing session, unavailable carrier) the model can
 * act on.
 */
export function sshSafeErrorMessage(error: unknown): string {
    if (error instanceof SshCarrierRequestError) {
        if (error.code === SSH_COMMAND_TIMEOUT_CODE) return "SSH command timed out.";
        if (error.code === SSH_TRANSFER_CANCELLED_CODE) return "SSH transfer was cancelled.";
        return "SSH operation failed. Check the local connection configuration.";
    }
    if (error instanceof Error) {
        const message = error.message;
        if (/cancelled/i.test(message)) return "SSH operation was cancelled.";
        if (/timed out/i.test(message)) return "SSH command timed out.";
        if (/session is not connected/i.test(message)) return "SSH session is not connected.";
        if (/carrier is unavailable/i.test(message)) return "SSH session is unavailable. Reconnect and try again.";
    }
    return "SSH operation failed. Check the local connection configuration.";
}
