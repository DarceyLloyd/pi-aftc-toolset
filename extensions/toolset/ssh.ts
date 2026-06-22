/**
 * pi-aftc-toolset — SSH feature module.
 *
 * Provides SSH terminal access via a local Python GUI (PyQt6 + Flask).
 * Registers five tools (ssh_status, ssh_connect, ssh_run, ssh_peek,
 * ssh_interrupt) and five slash commands (/ssh-connect, /ssh-disconnect,
 * /ssh-status, /ssh-gui, /ssh-run).
 *
 * The Python GUI is auto-launched when needed via `uv run python main.py`.
 * Communication goes through the GUI's HTTP API at http://127.0.0.85:8564.
 * Terminal output is also persisted in internal-python-gui/std/out.txt
 * (plain text, ANSI-stripped) for file-based peeking.
 */

import fs from "fs";
import path from "path";
import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { getGuiDir as getPackageGuiDir } from "./paths";

// ---------------------------------------------------------------------------
// Config — resolves the internal-python-gui directory relative to this
// extension's location inside the pi-aftc-toolset package.
// ---------------------------------------------------------------------------

const API_BASE = "http://127.0.0.85:8564/api/v1";

function getGuiDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "internal-python-gui");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return getPackageGuiDir();
}

function getStdDir(): string {
  if (process.env.AFTC_SSH_STD_DIR) return process.env.AFTC_SSH_STD_DIR;
  return path.join(getGuiDir(), "std");
}

function getApiUrl(endpoint: string): string {
  return `${API_BASE}${endpoint}`;
}

/**
 * Resolve the uv executable to use. Prefer the bundled copy in
 * internal-python-gui/bin/uv.exe (shipped with the package so users
 * don't need Python or uv on PATH). Fall back to system uv if the
 * bundled copy is missing.
 */
function getUvExe(): string {
  const bundled = path.join(getGuiDir(), "bin", "uv.exe");
  if (fs.existsSync(bundled)) return bundled;
  return "uv";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let guiProcess: ReturnType<typeof spawn> | null = null;

async function apiRequest(
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function readStdFile(filename: string): string {
  const filePath = path.join(getStdDir(), filename);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function tailLines(text: string, n: number): string {
  const lines = text.split("\n");
  return lines.slice(-n).join("\n");
}

async function isApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(getApiUrl("/status"), {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function launchGui(): void {
  if (guiProcess) return;
  const guiDir = getGuiDir();
  const mainPy = path.join(guiDir, "main.py");
  if (!fs.existsSync(mainPy)) {
    throw new Error(`Python GUI not found at ${mainPy}`);
  }
  const uvExe = getUvExe();
  guiProcess = spawn(uvExe, ["run", "python", "main.py"], {
    cwd: guiDir,
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  guiProcess.on("exit", () => {
    guiProcess = null;
  });
  guiProcess.on("error", () => {
    guiProcess = null;
  });
}

async function waitForApi(maxMs: number = 15_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isApiReachable()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function ensureGui(
  onUpdate?: (update: { content: { type: "text"; text: string }[] }) => void,
): Promise<boolean> {
  if (await isApiReachable()) return true;

  onUpdate?.({
    content: [{ type: "text", text: "SSH GUI not running. Launching..." }],
  });

  try {
    launchGui();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    onUpdate?.({
      content: [{ type: "text", text: `Failed to launch GUI: ${msg}` }],
    });
    return false;
  }

  onUpdate?.({
    content: [{ type: "text", text: "Waiting for GUI to start..." }],
  });

  const ready = await waitForApi();
  if (!ready) {
    onUpdate?.({
      content: [{ type: "text", text: "GUI did not start within 15 seconds." }],
    });
    return false;
  }

  onUpdate?.({
    content: [{ type: "text", text: "GUI is running." }],
  });
  return true;
}

async function connectSsh(
  host: string,
  username: string,
  password: string,
  port: number = 22,
  maxMs: number = 15_000,
  onUpdate?: (update: { content: { type: "text"; text: string }[] }) => void,
): Promise<boolean> {
  onUpdate?.({
    content: [{ type: "text", text: `Connecting to ${username}@${host}:${port}...` }],
  });

  try {
    await apiRequest(getApiUrl("/connect"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, username, password, port }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    onUpdate?.({
      content: [{ type: "text", text: `Connect request failed: ${msg}` }],
    });
    return false;
  }

  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const data = (await apiRequest(getApiUrl("/status"))) as { connected: boolean };
      if (data.connected) {
        onUpdate?.({
          content: [{ type: "text", text: "Connected!" }],
        });
        return true;
      }
    } catch {
      // status check failed, keep waiting
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  onUpdate?.({
    content: [{ type: "text", text: "Connection timed out waiting for SSH handshake." }],
  });
  return false;
}

// ---------------------------------------------------------------------------
// Feature module
// ---------------------------------------------------------------------------

export function createSshModule(pi: ExtensionAPI): void {

  // -- ssh_status ----------------------------------------------------------

  pi.registerTool({
    name: "ssh_status",
    label: "SSH Status",
    description:
      "Check if the AFTC SSH Python GUI is running and connected to a server.",
    promptSnippet: "Check the SSH GUI connection status.",
    promptGuidelines: [
      "Run ssh_status before ssh_run to confirm the GUI is connected.",
      "If not connected, tell the user to open the GUI and connect to their server first.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, onUpdate) {
      try {
        const reachable = await ensureGui(onUpdate);
        if (!reachable) {
          return {
            content: [
              {
                type: "text" as const,
                text: "GUI not reachable. Could not launch it. Make sure uv and python are available.",
              },
            ],
            isError: true,
          };
        }

        const data = (await apiRequest(getApiUrl("/status"))) as {
          connected: boolean;
        };
        const stdDir = getStdDir();
        const hasStd = fs.existsSync(path.join(stdDir, "out.txt"));
        return {
          content: [
            {
              type: "text" as const,
              text: `GUI reachable: yes\nSSH connected: ${data.connected}\nstd/ dir: ${stdDir} (${hasStd ? "exists" : "missing"})`,
            },
          ],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `GUI not reachable: ${msg}\nMake sure the Python GUI is running at http://127.0.0.85:8564`,
            },
          ],
          isError: true,
        };
      }
    },
  });

  // -- ssh_connect ---------------------------------------------------------

  pi.registerTool({
    name: "ssh_connect",
    label: "SSH Connect",
    description:
      "Launch the AFTC SSH GUI, connect to a remote server, and optionally run " +
      "a command (default: ls) after connecting. " +
      "Parses host in formats like 'user@host', 'host', 'user@host:port'.",
    promptSnippet: "Connect to a VM via SSH, auto-starting the GUI if needed.",
    promptGuidelines: [
      "Use ssh_connect when the user asks to connect to a server, VM, or remote machine.",
      "If the user provides a host like 'user@host', parse username and host from it. Default username is 'root'.",
      "If the user does not provide a password, ask them for it before calling ssh_connect.",
      "After a successful connection, the output includes a directory listing from `ls`.",
    ],
    parameters: Type.Object({
      host: Type.String({ description: "Hostname or IP to connect to." }),
      username: Type.Optional(Type.String({ description: "SSH username. Default: 'root'." })),
      password: Type.String({ description: "SSH password." }),
      port: Type.Optional(Type.Number({ description: "SSH port. Default: 22.", minimum: 1, maximum: 65535 })),
      initialCommand: Type.Optional(
        Type.String({ description: "Command to run after connecting. Default: 'ls -la'." }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate) {
      let { host, username, password, port, initialCommand } = params;
      username = username || "root";
      port = port || 22;
      initialCommand = initialCommand || "ls -la";

      if (host.includes("@")) {
        const parts = host.split("@");
        username = parts[0];
        host = parts[1];
      }
      if (host.includes(":")) {
        const parts = host.split(":");
        host = parts[0];
        port = parseInt(parts[1], 10);
      }

      const guiReady = await ensureGui(onUpdate);
      if (!guiReady) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Failed to launch the SSH GUI. Make sure uv and python are available.",
            },
          ],
          isError: true,
        };
      }

      try {
        const data = (await apiRequest(getApiUrl("/status"))) as { connected: boolean };
        if (data.connected) {
          onUpdate?.({
            content: [{ type: "text", text: "Already connected. Running command..." }],
          });
        } else {
          const connected = await connectSsh(host, username, password, port, 15_000, onUpdate);
          if (!connected) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Failed to connect to ${username}@${host}:${port}. Check credentials and network.`,
                },
              ],
              isError: true,
            };
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `ssh_connect failed: ${msg}`,
            },
          ],
          isError: true,
        };
      }

      await new Promise((r) => setTimeout(r, 1000));

      try {
        const data = (await apiRequest(getApiUrl("/send"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: initialCommand, timeout: 10 }),
        })) as { output: string; connected: boolean };

        return {
          content: [
            {
              type: "text" as const,
              text: `Connected to ${username}@${host}:${port}\n\n${data.output || "(no output)"}`,
            },
          ],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Connected, but initial command failed: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  });

  // -- ssh_run -------------------------------------------------------------

  pi.registerTool({
    name: "ssh_run",
    label: "SSH Run",
    description:
      "Send a command to the connected SSH server via the AFTC SSH Python GUI and return the terminal output. " +
      "Output is also persisted in std/out.txt (plain text, ANSI-stripped) which can be read by ssh_peek.",
    promptSnippet:
      "Execute a shell command on the connected SSH server via the AFTC SSH Python GUI.",
    promptGuidelines: [
      "Use ssh_run for one-shot commands like `ls`, `df -h`, `docker ps`, `systemctl status nginx`.",
      "Commands run in the user's shell — interactive programs (vim, nano, top) will HANG because they need user keystrokes. Use non-interactive alternatives instead.",
      "For long output or to see full terminal scrollback, use ssh_peek to read std/out.txt directly.",
      "The output returned is plain text (ANSI escape codes already stripped).",
      "If you get 'Not connected', ask the user to connect in the Python GUI first.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute on the SSH server." }),
      timeout: Type.Optional(
        Type.Number({
          description:
            "Max seconds to wait for output (default 15). Increase for slow commands like apt install.",
          minimum: 1,
          maximum: 120,
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate) {
      const guiReady = await ensureGui(onUpdate);
      if (!guiReady) {
        return {
          content: [
            {
              type: "text" as const,
              text: "GUI is not running and could not be started.",
            },
          ],
          isError: true,
        };
      }

      try {
        const data = (await apiRequest(getApiUrl("/send"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: params.command,
            timeout: params.timeout ?? 15,
          }),
        })) as { output: string; connected: boolean };

        return {
          content: [
            {
              type: "text" as const,
              text: data.output || "(no output)",
            },
          ],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `ssh_run failed: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  });

  // -- ssh_peek ------------------------------------------------------------

  pi.registerTool({
    name: "ssh_peek",
    label: "SSH Peek",
    description:
      "Read recent terminal output. Two modes:\n" +
      "  • api (default): reads the Python GUI's in-memory buffer (since last ssh_run).\n" +
      "  • file: reads std/out.txt directly — includes all output from the current SSH session " +
      "(both from the user typing in the GUI and from ssh_run commands).",
    promptSnippet:
      "Read recent SSH terminal output from the buffer or from std/out.txt.",
    promptGuidelines: [
      "Use ssh_peek with mode='file' to see what happened during the current SSH session — useful for reviewing context after ssh_run calls.",
      "Use ssh_peek with mode='api' to re-read the last ssh_run output without resending anything.",
      "Use ssh_peek to diagnose state — e.g. after running `docker ps` to see container status, or `journalctl` for logs.",
      "Use `lines` parameter to control how much scrollback you get (default 50).",
    ],
    parameters: Type.Object({
      mode: Type.Optional(
        StringEnum(["api", "file"] as const, {
          description:
            "'api' = Python GUI in-memory buffer (since last ssh_run). 'file' = std/out.txt (full session). Default: api.",
        }),
      ),
      lines: Type.Optional(
        Type.Number({
          description: "Number of tail lines to return. Default 50.",
          minimum: 1,
          maximum: 2000,
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const lines = params.lines ?? 50;

      if (params.mode === "file") {
        const fileContent = readStdFile("out.txt");
        if (!fileContent) {
          return {
            content: [
              {
                type: "text" as const,
                text: "std/out.txt is empty or doesn't exist. No session output captured yet.",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: tailLines(fileContent, lines),
            },
          ],
        };
      }

      try {
        const data = (await apiRequest(
          getApiUrl(`/output?lines=${lines}`),
        )) as { output: string; connected: boolean };
        return {
          content: [
            {
              type: "text" as const,
              text: data.output || "(buffer is empty)",
            },
          ],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const fileContent = readStdFile("out.txt");
        if (fileContent) {
          return {
            content: [
              {
                type: "text" as const,
                text: `(API unreachable: ${msg}, falling back to std/out.txt)\n\n` +
                  tailLines(fileContent, lines),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `ssh_peek failed: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  });

  // -- ssh_interrupt -------------------------------------------------------

  pi.registerTool({
    name: "ssh_interrupt",
    label: "SSH Interrupt",
    description:
      "Send Ctrl+C (5x) then Ctrl+D (5x) to the SSH session to break out of " +
      "a runaway command or feedback loop that's flooding the terminal.",
    promptSnippet: "Break a hung SSH command by sending Ctrl+C/Ctrl+D.",
    promptGuidelines: [
      "Use ssh_interrupt when a previous ssh_run is stuck, or when the terminal is flooded with output from a runaway build/process.",
      "After interrupting, use ssh_peek to check if the shell prompt returned.",
    ],
    parameters: Type.Object({
      count: Type.Optional(
        Type.Number({
          description: "Number of Ctrl+C and Ctrl+D signals to send (default 5).",
          minimum: 1,
          maximum: 20,
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      try {
        const data = (await apiRequest(getApiUrl("/interrupt"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ count: params.count ?? 5 }),
        })) as { ok?: boolean; sent_ctrl_c?: number; sent_ctrl_d?: number; error?: string };

        if (data.error) {
          return {
            content: [{ type: "text" as const, text: `Interrupt failed: ${data.error}` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Sent ${data.sent_ctrl_c}x Ctrl+C and ${data.sent_ctrl_d}x Ctrl+D to the SSH session.`,
            },
          ],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `ssh_interrupt failed: ${msg}` }],
          isError: true,
        };
      }
    },
  });

  // -----------------------------------------------------------------------
  // Slash commands
  // -----------------------------------------------------------------------

  pi.registerCommand("ssh-connect", {
    description: "Connect to a remote server: /ssh-connect user@host [password]",
    handler: async (args, ctx) => {
      if (!args || !args.trim()) {
        ctx.ui.notify("Usage: /ssh-connect user@host [password]", "warning");
        return;
      }

      const parts = args.trim().split(/\s+/);
      let hostPart = parts[0];
      let password = parts[1] || "";
      let username = "root";
      let host = hostPart;
      let port = 22;

      if (hostPart.includes("@")) {
        [username, host] = hostPart.split("@");
      }
      if (host.includes(":")) {
        const colonIdx = host.indexOf(":");
        port = parseInt(host.slice(colonIdx + 1), 10);
        host = host.slice(0, colonIdx);
      }

      if (!password) {
        const input = await ctx.ui.input("SSH password:");
        if (!input) {
          ctx.ui.notify("Cancelled.", "info");
          return;
        }
        password = input;
      }

      const guiReady = await ensureGui();
      if (!guiReady) {
        ctx.ui.notify("SSH GUI could not be launched.", "error");
        return;
      }

      try {
        const status = (await apiRequest(getApiUrl("/status"))) as { connected: boolean };
        if (status.connected) {
          ctx.ui.notify("Already connected to a server.", "warning");
          return;
        }
      } catch (e) {
        ctx.ui.notify(`GUI unreachable: ${e}`, "error");
        return;
      }

      const connected = await connectSsh(host, username, password, port);
      if (connected) {
        ctx.ui.notify(`Connected to ${username}@${host}:${port}`, "info");
      } else {
        ctx.ui.notify(`Connection to ${username}@${host}:${port} failed.`, "error");
      }
    },
  });

  pi.registerCommand("ssh-disconnect", {
    description: "Disconnect from the current SSH session",
    handler: async (_args, ctx) => {
      try {
        await apiRequest(getApiUrl("/disconnect"), { method: "POST" });
        ctx.ui.notify("Disconnected from SSH session.", "info");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.ui.notify(`Disconnect failed: ${msg}`, "warning");
      }
    },
  });

  pi.registerCommand("ssh-status", {
    description: "Show SSH GUI and connection status",
    handler: async (_args, ctx) => {
      const reachable = await isApiReachable();
      if (!reachable) {
        ctx.ui.notify("SSH GUI: not reachable", "warning");
        return;
      }
      try {
        const data = (await apiRequest(getApiUrl("/status"))) as { connected: boolean };
        ctx.ui.notify(
          `SSH GUI: running · Connected: ${data.connected ? "yes" : "no"}`,
          data.connected ? "info" : "warning",
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.ui.notify(`Status check failed: ${msg}`, "error");
      }
    },
  });

  pi.registerCommand("ssh-gui", {
    description: "Launch the AFTC SSH GUI window if not already running",
    handler: async (_args, ctx) => {
      if (await isApiReachable()) {
        ctx.ui.notify("SSH GUI is already running.", "info");
        return;
      }
      try {
        launchGui();
        const ready = await waitForApi();
        if (ready) {
          ctx.ui.notify("SSH GUI launched.", "info");
        } else {
          ctx.ui.notify("SSH GUI did not start within 15 seconds.", "error");
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.ui.notify(`Failed to launch GUI: ${msg}`, "error");
      }
    },
  });

  pi.registerCommand("ssh-run", {
    description: "Run a command on the connected server: /ssh-run <command>",
    handler: async (args, ctx) => {
      if (!args || !args.trim()) {
        ctx.ui.notify("Usage: /ssh-run <command>", "warning");
        return;
      }
      try {
        const data = (await apiRequest(getApiUrl("/send"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: args.trim(), timeout: 15 }),
        })) as { output: string };
        ctx.ui.notify(data.output || "(no output)", "info");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.ui.notify(`ssh_run failed: ${msg}`, "error");
      }
    },
  });

  // -- Cleanup on shutdown -------------------------------------------------

  pi.on("session_shutdown", async () => {
    if (guiProcess) {
      try {
        process.kill(-guiProcess.pid!);
      } catch {
        // already dead
      }
      guiProcess = null;
    }
  });
}
