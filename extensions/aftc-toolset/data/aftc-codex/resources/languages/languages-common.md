# Languages Common (All Languages)

## Rules

- [Tf3r7X] Match classification keywords at word boundaries - 'ui' as a plain substring also hits buildup/guitar/audio; support a word-boundary marker for short ambiguous tokens.

- [6X7G8b] For path-based classification the NEAREST folder's signal wins and a folder's own name leads its chain - taking the global max weight across all ancestors lets a generic parent keyword (drums) outvote the specific child (one shots).

- [uddGJe] Normalize separators before keyword matching: lowercase, replace underscores and hyphens with spaces, and also match space-phrases against the space-collapsed text - so "drum_loop", "DRUM-FULL" and "drumloop" all hit the "drum loop" keyword.

- [atWihk] Put every input policy (password rules, profanity filters, size caps) in ONE shared server-side function called from EVERY path that mutates the value - enforcing it on only the newest form leaves the older paths (register vs password-reset vs account-change) wide open.

## Gotchyas

- [EHm7AF] CSV written with f-strings or join() silently corrupts columns the moment any field contains a comma (filenames are full of them) - always write CSV through the csv module, which quotes fields.

- [D3eoMz] Inferring directory-ness from the name ("." not in name) misclassifies real directories that contain dots ("Vol. 1", "1. Drums", "Pt. 1") as files - generated tree listings must mark directories explicitly (e.g. a trailing separator) instead of leaving type inference to consumers.

- [dx18VQ] An idempotent mover that skips when the destination exists silently loses a second source mapping to the same destination - distinguish "already moved" (source gone) from a genuine collision (source still present) and rename the latter Windows-style ("name (1)") instead of skipping; never merge or overwrite folders.

- [1yGIeB] Word-boundary keyword matching misses plurals and compounds - 'drum' does not match 'drums' and 'dron' does not match 'droner'; match plural forms explicitly and use a leading-only boundary for patterns >= 3 chars so prefixes still hit, keeping full boundaries for 2-char shorthands.

- [ZdhhJW] Dotted-ID prefix filter - `startswith('1.1')` also matches sibling IDs '1.10'..'1.18' (they literally begin with '1.1'); match the exact ID or `startswith('1.1.')` with the trailing dot so sub-IDs match but siblings do not.

- [dUTDfo] A rules/layout/config module that is written but never imported silently does nothing - there is no error for dead config, so generated output ignores its rules without any sign; after writing such a module, grep the processing path for its symbols to confirm it is actually wired in before trusting the output.

## Issues & Solutions
