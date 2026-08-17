# File-and-dir-sorting

## Rules

- [4SxcAo] For file-organising tools, folders whose names are generic content types (one shots, kicks, loops, fx, drums) are mixed-content CONTAINERS, not coherent units - dissolve them so each file classifies individually; the folder's own context still routes every file, so the classification survives the dissolve.

- [zohZ4q] When merging same-named folders, log each file's origin - a '(n)'-suffixed duplicate can stand for several identical-named originals with only one physical copy, making later reversal by name ambiguous; the merge log is the undo map.

- [IC3h8X] Before an irreversible reorganization, snapshot the full source listing plus the src->dst mapping, and keep the execution log (actual moves including collision renames) - a dry-run plan cannot show run-time collision renames (duplicate destinations render as a single tree node), so the log is the only ground truth for reversal.

- [h67pHI] Plugin presets resolve asset references (wavetables, noise samples) against the plugin's FIXED data folders, not relative to the preset file's own location (unlike HTML/CSS) - when relocating a preset collection, rewrite the internal refs to each asset's future location under those fixed folders and keep companion assets in matching subfolders there.

## Gotchyas

- [AoxtJT] Substring keyword matching misclassifies text that merely contains a keyword inside a longer word (a short 'organ' keyword matches 'organic', 'strum' matches 'instrument'). Match short keywords at word boundaries and add plural/derived forms as separate entries; keep substring matching only for unambiguous or multi-word terms.

- [pgRjIe] For plugin preset and sample-pack files the in-file 'vendor'/'author'/'bank' fields often hold only the tool's OWN maker (a constant), not the pack's vendor/product — extract the real vendor/product from the filename ('Vendor - Product.ext') and treat in-file metadata as unreliable for organisation.

- [IoJHCA] An unrecognised file extension is silently skipped/left in place with no error - when a file type isn't routing, first grep the recognised-extension map for that extension (a missing entry drops the file without any sign) before debugging the classifier.

- [itrcij] Parsing vendor/product from third-party pack folder names fails on a single separator ('Vendor - Product') because packs also use spaces and underscores - build a known-vendor list from the data's own vendor folders and split each name on the longest known-vendor prefix, so 'Vendor Product Foo' groups under 'Vendor' instead of becoming its own pseudo-vendor.

- [mDwjwJ] A typo-correction map for a rename-suggestion pass false-flags correct names when a misspelling key is a substring of the correct spelling ('trombon' matches 'trombone') - test each candidate key against the real corpus and drop any that also matches the correct word.

## Issues & Solutions
