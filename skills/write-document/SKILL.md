---
name: write-document
description: Write, organize, and sync high-integrity technical documents. Ensures every document is coherent, well-structured, and consistent. Use when the user asks to write a doc, when creating new technical documentation, or when a topic deserves a proper document.
---

# Write Document

Create high-signal technical documentation that serves as an expert collaborator for both humans and AI. This skill enforces the BMAD principles to prevent context rot and ensure architectural durability.

> **HARD GATE** - Every document must have a clear "Reason for Existence." If a document doesn't provide actionable leverage for a caller or test, do not create it.

## The BMAD Principles

| Principle | Execution |
| :--- | :--- |
| **B**old | Make strong assertions. Define clear boundaries and "Never" rules. No "it might" or "usually." |
| **M**inimal | High-density, low-filler. Circuit Breaker: If the file exceeds 300 lines or the session exceeds 20 turns, you MUST run `terse-mode` and compact state before saving. |
| **D**urable | Design for the long-term. Scalability: Use "Nested Indexing"-root files link to module-level `GEMINI.md` indexes; do not list individual sub-files in the root. |

## Process

### 1. Identify the Artifact Type & Scope

Choose the correct BMAD-BigPowers artifact:
- Technical Guide: For "How-to" with verification (saved to `<module>/REFERENCE.md`).
- Project README: Project-facing documentation (saved to `README.md` at project root).

Cross-Cutting Concerns: If a doc affects multiple modules, place the authoritative source in the lowest common ancestor directory and use "Delegates" (one-line pointers) in sub-directories to maintain the Single Source of Truth without violating the Stepdown Rule.

### 2. Draft with Semantic Velocity

> STREAM CONTINUITY - When writing file content, output in continuous chunks of ~200 lines. Do not pause. Continue immediately until complete. If you need time, emit a placeholder comment rather than going silent.

Write the document focusing on "Expert Collaboration":
- Instructions over Descriptions: Tell the reader (human or AI) exactly how to interact with the system.
- Provenance Links: Link to ADRs, Issues, or Commits to preserve intent.
- The Stepdown Rule: Information should descend exactly one level of abstraction. If a root doc needs to explain a leaf-level detail, it must point to a sub-index first.

### Quick README (Project READMEs only)

1. Ask: "Project name? One-sentence description?"
2. Generate `README.md` at project root using the template in [REFERENCE.md](REFERENCE.md) - no TOC, no second interview round.
3. Fill gaps from `CLAUDE.md` commands if available; use `TODO` markers otherwise.

→ verify: `grep -c "^## " README.md | awk '{if($1>=7) print "OK"}'`

### 3. Apply the 94% Quality Gate

Before finalizing, audit the document against these red flags:
- [ ] Filler Language: Are there pleasantries or "I hope this helps"? (Delete them).
- [ ] Ambiguity: Are there "usually," "often," or "it depends" without specific conditions?
- [ ] Dead Ends: Does the document end without a "Next Step" or "Verification" command?
- [ ] Shallow Content: Does it restate the code without explaining the intent or contracts?

### 4. Sync and Organize

- Nested Indexing: If adding a module-level doc, ensure the module's `GEMINI.md` is updated. If the module's index is new, add it to the root `GEMINI.md`.
- Sync: Run `scripts/sync-skills.sh` if the document is a `SKILL.md` or affects generated artifacts.

## Rules

- Minimalism is a requirement: If a document can be a 5-line table, do not make it a 5-line essay.
- Verifiable outcomes: Every technical document must include at least one `verify:` command. For architecture, this can be a `grep` or `run_shell_command` that validates the existence of required files or patterns.
