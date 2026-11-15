# anthropics/skills fixture

A byte-identical subset of https://github.com/anthropics/skills, pinned at
commit `2c5958ecac7cee2b583967a2c4981d0f4a75c579` (the commit recorded in the
GitHub archive of the default branch, fetched 2026-11-14).

Used by `tests/unit/utils/skills/corpus-benign.spec.ts`: a regression guard
for the skill highlight rules (BES-389). Do not edit, reformat or "fix" any
file here: the guard reads exact line numbers.

## License

Each skill folder keeps the `LICENSE.txt` it ships with, the Apache License,
Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0). The files are
unmodified.

## What is in the subset

- 18 of the 19 skill folders of the commit. `doc-coauthoring` is left out: it
  ships no license file and no `license` field.
- Only files with an extension a Besidka skill may hold (`SKILL_ALLOWED_EXTENSIONS`):
  258 files. Fonts, PDFs, archives, `.xsd` schemas and `.mjs` files are not
  copied.
- Six large files without a medium or high highlight are left out to keep the
  repository small: `claude-api/shared/model-migration.md`,
  `claude-api/shared/preserved-thinking-migration.md`,
  `claude-api/shared/preserved-thinking-migration/prefix_diff.py`,
  `claude-api/shared/preserved-thinking-migration/drop_block_probe.py`,
  `claude-api/shared/evals/eval-hillclimb.md` and
  `claude-api/shared/managed-agents-multiagent.md`.

The guard measured on this subset: 0 high, 27 medium
and 1,294 low highlights.
