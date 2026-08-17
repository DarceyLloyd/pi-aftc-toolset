# Thought & Action Guidance

How to think, verify and finish. Applies on top of the per-topic resource
files. Lead line = the greppable symptom; then Cause / Fix.

- harness green but the feature is actually broken / "verified" != "working"
  Cause: compile + DOM presence + zero console errors cannot see a canvas that does not fill its band, dead scroll, or 50 recolours of one design.
  Fix: for visual/interactive work: open it in a real browser, screenshot at the user's viewports (down to ~393px, ask if not given), LOOK at each shot against the brief, drive real input (trusted clicks - not programmatic .click() - plus scroll, resize, theme toggle) and confirm the claimed behaviour. A node in the DOM is not the feature working. (2026-07)
- "should work but doesn't" with NO console error
  Cause: the bug lives in the computed reality, not in the source you are reading.
  Fix: observe computed state first: getComputedStyle (overflow, display, visibility, pointer-events, which element is the scroll container), elementFromPoint at the click coordinate, the real scroll target - THEN reason. The recurring CSS traps are catalogued in css.md. (2026-07)
- negative brief constraints silently violated / "the header must NOT react to scroll"
  Cause: "X must NOT do Y" requirements produce no error when broken, so a green suite still ships them broken.
  Fix: before coding, extract EVERY constraint (positives AND negatives) into a checklist with a test or screenshot check each; re-read the brief verbatim and tick every line before declaring done - an unchecked negative is a shipped bug. (2026-07)
- generated variants that "all look the same"
  Cause: unique signature tuples != perceptible variety; shallow pools collapse to the same design in different skins.
  Fix: audit the RENDERED spread, not the signatures; make every axis change structure (composition, section order, density, motion), and deepen pools until N outputs visibly differ. If the user says "too many look the same", deepen - do not just re-seed. (2026-07)
- reporting done without using it as the user / "works in the test but looks wrong"
  Cause: the suite sees structure; the user sees the rendered, resized, clicked experience at their screen sizes.
  Fix: before "done", use the deliverable the way they will and fix what looks or feels wrong even when no test fails. Green tests are necessary, not sufficient - the final reviewer is the rendered result. (2026-07)
- theorising instead of reading the log / the answer is already on screen
  Cause: the log or the last tool output IS the answer; page-long theory or re-searching wastes time and often ends wrong.
  Fix: add the log, have it reproduced, READ the output, then reason (file-based logging if the console floods). If a grep/command output already shows the answer, answer from it immediately. If a tool failed, switch to the working alternative now and diagnose later only if it still matters. (2026-07)
- a hard-won fix is repeated as a mistake in a later turn or session
  Cause: the model is stateless; an insight held "in mind" is already gone next turn.
  Fix: write durable lessons to the knowledge base / plan file the MOMENT they are found, while cause and fix are in context. Took >2-3 attempts, or a future session could hit it = write it now, not "at the end". (2026-07)
- shipped to many users and an update or edge case breaks their data or sessions
  Cause: convenience overriding safety destroys user data and sessions.
  Fix: safety first: never destroy data (copy-only seeding, back up before destructive ops), fail soft, off-by-default opt-ins, idempotent + resumable ops, value-preserving config migrations, a reversible path for every significant action. (2026-07)
- built on an assumed API shape that turned out wrong
  Cause: guessing payloads or copying from memory builds the design on a wrong assumption.
  Fix: verify event fields, return shapes and available methods against official docs/source/examples BEFORE designing on them. An hour reading source beats a day rebuilding. (2026-07)
- implemented the user's flawed plan as-is to be agreeable
  Cause: silent agreement ships the flaw; the user wants the gap flagged and the smarter path taken.
  Fix: be a critical collaborator: check the given design for gaps and better ways, surface them honestly, then adapt. Defer on genuine preferences - no contrarianism. (2026-07)
- a new mid-task message derails the in-progress task (or you ploughed through a real STOP)
  Cause: pivoting abandons the first task mid-flight; the stateless model never comes back to it.
  Fix: triage the message: urgent STOP/correction ("STOP", "DON'T", "wait"...) -> drop everything and address it now. Not urgent -> finish the current task to its done-criterion first, queue the new request in the plan doc, then take queued work in order. (2026-07)
- re-deliberating a settled decision / agonising over an ambiguous style choice
  Cause: no commit discipline; reversible calls treated as if they must be optimal.
  Fix: weigh once, commit, act - re-deliberation is the signal to stop thinking. For ambiguous format/style, match the nearest existing example and move on; flag the doc gap to the maintainer once, do not block on it. (2026-07)
- adding reminders for a mistake that keeps recurring
  Cause: a warning only fires if recalled at the moment of the mistake; under pressure it is forgotten.
  Fix: prefer a STRUCTURAL fix - guardrail, validation, safe default, a tool that does the thing - so the safe path is the easy or only path. (2026-07)
- a row you intended is silently absent from a derived list or report
  Cause: one global filter plus "render only if the value exists" erases rows, and absence leaves no trace.
  Fix: treat absence as a finding: decide each row's data source and empty state independently, and surface uncomputable values as N/A with the reason instead of omitting the row. (2026-07)
- "no remaining X" was false after a bulk edit
  Cause: the search matched one syntax variant (notify( misses notify?.(; double quotes miss template literals).
  Fix: search the BROAD token first to enumerate every variant, then narrow; after the edit, re-verify with the broad pattern, not the narrow one you just changed. (2026-07)
- a deletion silently ate an adjacent line
  Cause: the replacement's old text spanned the target plus a neighbour and the new text kept only one.
  Fix: after any deletion, grep for the entries you did NOT mean to touch and confirm they survived. A deletion is proven by what survives. (2026-08)
- off on an unasked exploratory side mission
  Cause: every noticed issue or "while I'm here" treated as an implicit task derails the requested work.
  Fix: do exactly what was asked and nothing more; report other findings and let the user decide. (2026-08)
