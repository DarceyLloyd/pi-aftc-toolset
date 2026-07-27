/**
 * pi-aftc-toolset — providers folder entry.
 *
 * Home of every LLM-provider feature in the toolset. Today that is
 * qwencloud.ts (Alibaba Qwen Cloud + Coding Plan); future providers get
 * their own self-contained module here and are wired in below.
 *
 * The main orchestrator (../index.ts) calls createProviders(pi) — this
 * is the only function the rest of the extension knows about.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createQwenCloud } from "./qwencloud";

export function createProviders(pi: ExtensionAPI): void {
    createQwenCloud(pi);
}
