/**
 * pi-aftc-toolset — usage report local server.
 *
 * Zero-dependency static file server for the usage report. Serves the
 * folder it lives in (index.html + includes/ + the generated data.json)
 * over http://localhost so ES modules and fetch() work (both are
 * blocked on file:// pages).
 *
 * Behaviour:
 *   - picks port 8713, then scans upwards for a free one
 *     (override with USAGE_REPORT_PORT)
 *   - opens the report in the default browser on startup
 *   - prints server info here; close this window (or Ctrl+C) to stop
 *   - idle watchdog: exits by itself after 30 minutes without a
 *     request (override with USAGE_REPORT_IDLE_MINUTES)
 *   - when started with USAGE_REPORT_STDIN_GUARD=1 (headless spawn),
 *     also exits on stdin EOF so a parent process can never leak it
 */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = __dirname;
const BASE_PORT = Number(process.env.USAGE_REPORT_PORT) || 8713;
const IDLE_MINUTES = Number(process.env.USAGE_REPORT_IDLE_MINUTES) || 30;
const IDLE_MS = IDLE_MINUTES * 60 * 1000;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".map": "application/json; charset=utf-8",
};

let lastRequest = Date.now();

function openBrowser(url) {
    const cmd = process.platform === "win32" ? "cmd.exe"
        : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    try {
        const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
        child.unref();
    } catch {
        console.log(`Could not open the browser automatically — open: ${url}`);
    }
}

function serve(req, res) {
    lastRequest = Date.now();
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
    }
    fs.readFile(file, (err, body) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found: " + rel);
            return;
        }
        res.writeHead(200, {
            "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
            "Cache-Control": "no-cache",
        });
        res.end(body);
    });
}

function tryListen(port) {
    const server = http.createServer(serve);
    server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && port < BASE_PORT + 50) {
            tryListen(port + 1);
            return;
        }
        console.error(`usage-report server failed to start: ${err.message}`);
        process.exit(1);
    });
    server.listen(port, "127.0.0.1", () => {
        const url = `http://127.0.0.1:${port}/`;
        console.log("==========================================================");
        console.log("  PI AFTC TOOLSET — USAGE REPORT SERVER");
        console.log("==========================================================");
        console.log(`  URL      : ${url}`);
        console.log(`  Serving  : ${ROOT}`);
        console.log(`  Idle exit: after ${IDLE_MINUTES} minutes without a request`);
        console.log("  Stop     : close this window or press Ctrl+C");
        console.log("==========================================================");
        openBrowser(url);

        // Idle watchdog — never linger in the background.
        const idle = setInterval(() => {
            if (Date.now() - lastRequest > IDLE_MS) {
                console.log(`Idle for ${IDLE_MINUTES} minutes — shutting down.`);
                clearInterval(idle);
                server.close(() => process.exit(0));
                setTimeout(() => process.exit(0), 2000).unref();
            }
        }, 60 * 1000);

        const stop = () => {
            console.log("Shutting down.");
            clearInterval(idle);
            server.close(() => process.exit(0));
            setTimeout(() => process.exit(0), 2000).unref();
        };
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
        // Optional headless guard (opt-in): exit on stdin EOF so a
        // parent process can tie the server's lifetime to its own.
        // Off by default — a piped/ignored stdin would EOF instantly and
        // kill the server at startup; the idle watchdog covers leaks.
        if (process.env.USAGE_REPORT_STDIN_GUARD === "1" && !process.stdin.isTTY) {
            try {
                process.stdin.resume();
                process.stdin.on("end", stop);
            } catch { /* no stdin — window-close / idle still cover it */ }
        }
    });
}

tryListen(BASE_PORT);
