"use client";

import { useEffect, useState } from "react";
import { CodeEditor } from "@/components/code-editor";
import { useProgress } from "@/components/progress-provider";
import { exerciseDraftKey, type WorkspaceDraft } from "@/lib/learning-state";
import { interactionGuidance, type Interaction } from "@/lib/chapter-one-exercises";
import { runPython, stopPython } from "@/lib/pyodide-client";

type Props = { exerciseId: string; label: string; chapterSlug: string; initial: WorkspaceDraft; interaction: Interaction };

export function ExerciseWorkspace({ exerciseId, label, chapterSlug, initial, interaction }: Props) {
  const { hydrated, drafts, saveDraft, deleteDraft, storageStatus, startExercise, visitExercise, isExerciseComplete, toggleExercise } = useProgress();
  const key = exerciseDraftKey(chapterSlug, exerciseId);
  const draft = drafts[key] ?? initial;
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(true);

  useEffect(() => {
    if (hydrated) visitExercise(chapterSlug, exerciseId, label);
  }, [hydrated, chapterSlug, exerciseId, label, visitExercise]);

  const update = (changes: Partial<WorkspaceDraft>) => {
    saveDraft(key, { ...draft, ...changes });
    startExercise(chapterSlug, exerciseId);
  };
  const run = () => {
    if (running) { stopPython(); return; }
    startExercise(chapterSlug, exerciseId);
    setOutput("");
    setRunning(true);
    const started = runPython(draft.files[draft.activeFile] ?? "", {
      onStatus: (status) => setOutput(status === "loading" ? "Loading Python…" : "Running…"),
      onStdout: (text) => setOutput((current) => `${current}\n${text}`),
      onStderr: (text) => setOutput((current) => `${current}\n${text}`),
      onResult: (result) => { setRunning(false); setOutput((current) => `${current}\n${result || "Execution finished. Completion is self-assessed."}`); },
      onError: (error) => { setRunning(false); setOutput((current) => `${current}\n${error}`); },
    });
    if (!started) setRunning(false);
  };

  if (!hydrated) return <p>Loading your saved workspace…</p>;
  return <section className="learning-workspace" aria-label={`Workspace for exercise ${label}`}>
    <p className="text-sm text-slate-600 dark:text-slate-300">{interactionGuidance[interaction]}</p>
    <label className="workspace-label" htmlFor="exercise-answer">{interaction === "predict" ? "Your prediction and reasoning" : "Your written answer and reasoning"}</label>
    <textarea id="exercise-answer" className="workspace-input" rows={5} value={draft.answer} onChange={(event) => update({ answer: event.target.value })} />
    {draft.sourceRevision !== initial.sourceRevision ? <p className="text-sm text-amber-700 dark:text-amber-300">The prompt changed. Your saved work is preserved. Reset workspace loads the updated starter.</p> : null}
    <div className="workspace-toolbar">
      <label>File <select aria-label="Active file" value={draft.activeFile} onChange={(event) => update({ activeFile: event.target.value })}>
        {Object.keys(draft.files).map((file) => <option key={file}>{file}</option>)}
      </select></label>
      <button onClick={() => setEditing(!editing)}>{editing ? "Preview code" : "Edit code"}</button>
      <button onClick={run}>{running ? "Stop" : "Run Python"}</button>
      <button disabled={running} onClick={() => {
        if (window.confirm("Reset this workspace's code and written answer? Your completion and notes are kept.")) { deleteDraft(key); setOutput(""); }
      }}>Reset workspace</button>
    </div>
    <CodeEditor language="python" value={draft.files[draft.activeFile] ?? ""} editing={editing} onChange={(value) => update({ files: { ...draft.files, [draft.activeFile]: value } })} onFinish={() => setEditing(false)} onRun={run} />
    {Object.keys(initial.files).length > 1 ? <p className="text-xs text-slate-500">Each provided example has its own file. Select one to investigate independently.</p> : null}
    <p role="status" className="text-xs text-slate-500">{storageStatus}</p>
    {output ? <pre className="workspace-output" aria-label="Python output" aria-live="polite">{output}</pre> : null}
    <label className="flex items-center gap-2 text-sm font-semibold">
      <input type="checkbox" checked={isExerciseComplete(chapterSlug, exerciseId)} onChange={() => toggleExercise(chapterSlug, exerciseId)} />
      I have completed this exercise
    </label>
    <p className="text-xs text-slate-500">No automatic grading. Your written answer, code, and completion are saved in this browser.</p>
  </section>;
}
