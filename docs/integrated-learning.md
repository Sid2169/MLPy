# Integrated learning

## Coverage and interaction

All 2,612 exercises across the 12 chapters have dedicated
`/practice/{chapterSlug}/{exerciseId}` pages. Existing Chapter 1 URLs and saved
draft keys are unchanged. Resume and previous/next navigation work across the
whole curriculum, including chapter boundaries.
Exercise prompts remain sourced from the original Markdown. `lib/exercises.ts`
extracts each exercise through its next label, heading, or horizontal rule; it
never borrows the next lesson's examples. It also collects fences nested inside
lists and preserves explicitly named source-file paths. Chapter 1 retains its
authored interaction overrides in `lib/chapter-one-exercises.ts`. Generalized
starter construction and prompt-based guidance live in
`lib/exercise-workspaces.ts`.

Learners record predictions/explanations, edit supplied examples or start blank,
and explicitly mark completion. There are no automated correctness checks.
TypeScript is reference material, not Python starter code. Named Python files
retain their paths so module imports work. Unnamed examples and conflicting
versions become separate files rather than overwriting each other. Shell, SQL,
JSON, TOML, YAML, and Dockerfile fences remain their own editable file types;
the Python runner does not execute them. Fence-free tasks get a blank scratchpad
and, when applicable, a command/configuration file rather than a fabricated
solution. Choose which Python file runs with the entrypoint selector.

For Chapters 2–12, the suggested practice mode is inferred from the prompt and
can be changed by the learner. Runtime profiles identify browser scratchpads,
prerequisite-dependent tasks, local/native-runtime tasks, and external-service
tasks. These are conservative guidance, not a claim that every exercise has been
individually validated against Pyodide. Data/model files and application-specific
fixtures are not invented or bundled. Imports, earlier definitions, datasets,
native tools, or service mocks may still need to be supplied by the learner.

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
  top-level await. Module mode runs the selected Python path as a dotted module
  using `runpy.run_module`, allowing package-relative imports. Notebook mode
  permits top-level await and displays the final expression. No mode grades an
  exercise. Async exercises that specifically test native script event-loop,
  threading, or process semantics should be run locally.
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
extraction boundaries, all 2,612 exercise IDs/routes/starter files, storage migration, language
highlighting, workspace payload validation, and worker lifecycle deadlines.
Browser integration additionally verifies real Pyodide imports, stdin, generated
files, namespace isolation, script/notebook semantics, Stop, pandas/NumPy table
output, matplotlib plots, draft restoration, manual completion, and mobile layout.
