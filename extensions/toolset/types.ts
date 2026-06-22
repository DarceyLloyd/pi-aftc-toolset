/**
 * Shared types for cross-module communication.
 *
 * Per rules.md §2.3, feature modules must not import each other directly.
 * Both core.ts and thinking.ts need to agree on the shape of a per-turn
 * record and the surface of the recorder they pass to each other via
 * the orchestrator (index.ts), so those types live here in a neutral
 * utility file.
 *
 * Structural typing handles the rest: the ThinkingModule class in
 * thinking.ts satisfies TurnRecorder as long as its method signatures
 * match. No "import the other module" needed.
 */

export interface TurnRecord {
    /** Session-scoped turn counter (matches acc.turns in core.ts). */
    turn: number;
    /** ms since epoch at message_end time. */
    timestamp: number;
    /** e.g. "MiniMax-M3" — captured from the model that produced the turn. */
    modelName: string;
    /** e.g. "high", "low", "off" — captured from the active thinking level. */
    thinkingLevel: string;
    /** Time to first text or tool-call output (ms). */
    thinkingMs: number;
    /** Total turn duration (ms) — request-sent → message-end. */
    responseMs: number;
    /** Cost of this turn in USD. */
    costUsd: number;
    /** New prompt tokens for this turn. */
    inputTokens: number;
    /** Output tokens for this turn. */
    outputTokens: number;
    /** Cache-read tokens for this turn. */
    cacheRead: number;
    /** Cache-write tokens for this turn. */
    cacheWrite: number;
    /** True when this is the first assistant turn after a user message
     * (not an automated tool-call continuation). */
    isUserPrompt: boolean;
    /** Stable-ish ID for the active runtime session; used with promptIndex
     * so per-prompt grouping does not collide across sessions. */
    sessionId: string;
    /** 1-based user prompt number within the session. Automated continuation
     * turns share the same prompt index as the user prompt that caused them. */
    promptIndex: number;
    /** True for top-level prompts used as the projection baseline. */
    isBasePrompt: boolean;
    /** True when this is any follow-up/refinement prompt under an existing task. */
    isSubPrompt: boolean;
    /** True when pi classified this user input as an active mid-stream steer. */
    isSteeringPrompt: boolean;
    /** True when pi classified this user input as an active queued follow-up. */
    isFollowupPrompt: boolean;
    /** True for idle follow-up/refinement prompts that continue the task. */
    isContinuationPrompt: boolean;
    /** Readable classification: base | steer | followup | continuation | auto. */
    promptKind: string;
}

/**
 * Surface that core.ts relies on from the thinking module.
 *
 * Only recordTurn remains — /show-thinking / /hide-thinking were removed
 * (pi's built-in Ctrl+T + hideThinkingBlock setting cover thinking-block
 * visibility), so there is no longer a "is timing visible?" flag to query.
 */
export interface TurnRecorder {
    recordTurn(record: TurnRecord): void;
}