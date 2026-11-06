# Integrated learning

## Coverage and interaction

Chapter 1's 213 exercises have dedicated `/practice/fundamentals/ch1-…` pages.
Exercise prompts remain sourced from the original Markdown. `lib/exercises.ts`
extracts each exercise through its next label, heading, or horizontal rule; it
never borrows the next lesson's examples. Authored interaction overrides and
starter construction live in `lib/chapter-one-exercises.ts`.

Learners record predictions/explanations, edit supplied examples or start blank,
and explicitly mark completion. There are no automated correctness checks.
TypeScript is reference material, not Python starter code. Multiple examples are
separate files; choose which one runs with the entrypoint selector.

## Persistence

`ProgressProvider` stores version 2 learning state in IndexedDB
(`mlpy-learning`, store `state`, key `current`). This includes legacy completion
and notes, snippet drafts, exercise files, written answers, input, execution
settings, in-progress markers, and the most recently opened exercise.

The old `mlpy:progress:v1` localStorage value is migrated on first load and kept
as a legacy backup. Writes are serialized. If IndexedDB fails, version 2 state
falls back to `mlpy:learning:v2` localStorage; timestamps select the newer state
on the next load. The UI reports saving, success, and storage failure.

Workspace Reset clears its code/answer draft while preserving notes/completion.
Chapter Reset clears the chapter's drafts, progress, notes, and resume position.
Data is browser- and origin-local, not account-synchronized. Open tabs do not
merge edits; avoid editing the same learning state in several tabs concurrently.

## Exercise runtime

`runWorkspace` creates a **new worker for every attempt**. Stop, navigation,
timeout, completion, and output overflow terminate that worker. Globals,
imports, monkey patches, and virtual filesystem changes cannot accidentally
carry over through a reused interpreter. Saved text files are intentionally
restored into `/workspace` on the next attempt.

- Pyodide 0.29.5, pinned to the same CDN as lesson snippets.
- Runtime/package initialization: 120-second deadline; execution: 30 seconds.
- Up to 50 relative-path UTF-8 text files, totaling 1 MB; stdin up to 100,000
  characters; text output up to 100,000 characters.
- `input()` reads supplied lines; exhaustion raises EOFError. Imports in all
  `.py` files trigger compatible Pyodide package loading. Explicit package names
  can be entered; arbitrary pip/native packages are not supported.
- Script mode uses `runpy.run_path` with `__name__ == '__main__'` and rejects
  top-level await. Notebook mode permits top-level await and displays the final
  expression. Neither mode automatically grades an exercise.
- `display(value)` (also `from learning import display`) renders DataFrames,
  2D arrays, and lists of records as tables, bounded to 100 rows / 20 columns.
- Matplotlib uses the non-interactive Agg backend. Up to 10 open figures are
  captured as PNG after execution, including after Python exceptions.
- Created/updated/deleted UTF-8 files under `/workspace` are saved after execution,
  including after ordinary Python exceptions. Binary/oversized files are not
  persisted, and interrupted runs cannot collect unsaved runtime-generated files.

Browser execution is not a native Python environment. Listening servers, OS
processes, Docker, CUDA, native PyTorch, and many networking/tooling workflows
require a local or future remote environment. Browser requests remain subject
to browser networking restrictions. The legacy lesson snippet runner remains
separate; these strong per-attempt guarantees apply to exercise workspaces.

## Verification

`npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` check the site,
extraction boundaries, all Chapter 1 exercise IDs, storage migration, language
highlighting, workspace payload validation, and worker lifecycle deadlines.
Browser integration additionally verifies real Pyodide imports, stdin, generated
files, namespace isolation, script/notebook semantics, Stop, pandas/NumPy table
output, matplotlib plots, draft restoration, manual completion, and mobile layout.
