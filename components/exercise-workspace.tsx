"use client";

import { useEffect, useRef, useState } from "react";
import { CodeEditor } from "@/components/code-editor";
import { useProgress } from "@/components/progress-provider";
import { exerciseDraftKey, type WorkspaceDraft } from "@/lib/learning-state";
import { interactionGuidance, interactions, languageForFile, type Interaction, type WorkspaceProfile } from "@/lib/exercise-workspaces";
import { runWorkspace } from "@/lib/workspace-runner";
import { validWorkspacePath, type WorkspaceArtifact } from "@/lib/workspace-runtime";

type Props = { exerciseId: string; label: string; chapterSlug: string; initial: WorkspaceDraft; interaction: Interaction; profile: WorkspaceProfile };

export function ExerciseWorkspace({ exerciseId, label, chapterSlug, initial, interaction: suggestedInteraction, profile }: Props) {
  const { hydrated, drafts, saveDraft, deleteDraft, storageStatus, startExercise, visitExercise, isExerciseComplete, toggleExercise } = useProgress();
  const key = exerciseDraftKey(chapterSlug, exerciseId);
  const draft = drafts[key] ?? initial;
  const interaction = interactions.includes(draft.interaction as Interaction) ? draft.interaction as Interaction : suggestedInteraction;
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(true);
  const [status, setStatus] = useState("");
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([]);
  const [newFile, setNewFile] = useState("");
  const [fileError, setFileError] = useState("");
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { stopRef.current?.(); }, []);

  useEffect(() => {
    if (hydrated) visitExercise(chapterSlug, exerciseId, label);
  }, [hydrated, chapterSlug, exerciseId, label, visitExercise]);

  const update = (changes: Partial<WorkspaceDraft>) => {
    saveDraft(key, { ...draft, ...changes });
    startExercise(chapterSlug, exerciseId);
  };
  const run = () => {
    if (running) { stopRef.current?.(); return; }
    startExercise(chapterSlug, exerciseId);
    setOutput("");
    setArtifacts([]);
    setRunning(true);
    stopRef.current = runWorkspace({
      files: draft.files, entrypoint: draft.entrypoint, stdin: draft.stdin,
      packages: (draft.packageInput ?? draft.packages?.join(",") ?? "").split(",").map((name) => name.trim()).filter(Boolean),
      mode: draft.mode ?? "script",
    }, {
      onStatus: setStatus,
      onOutput: (text) => setOutput((current) => `${current}${text}\n`),
      onArtifact: (artifact) => setArtifacts((current) => current.length < 20 ? [...current, artifact] : current),
      onFiles: (files, deleted) => {
        const nextFiles = { ...draft.files, ...files };
        for (const name of deleted) delete nextFiles[name];
        if (!Object.keys(nextFiles).length) nextFiles["main.py"] = "";
        const activeFile = Object.hasOwn(nextFiles, draft.activeFile) ? draft.activeFile : Object.keys(nextFiles)[0];
        const entrypoint = Object.hasOwn(nextFiles, draft.entrypoint) ? draft.entrypoint : Object.keys(nextFiles).find((name) => name.endsWith(".py")) ?? "";
        saveDraft(key, { ...draft, files: nextFiles, activeFile, entrypoint });
      },
      onFinish: () => { setRunning(false); setStatus("Execution finished. Completion is self-assessed."); stopRef.current = null; },
    });
  };

  if (!hydrated) return <p>Loading your saved workspace…</p>;
  return <section className="learning-workspace" aria-label={`Workspace for exercise ${label}`}>
    <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-300" data-environment={profile.environment}>{profile.label}</p>
    <p className="text-sm text-slate-600 dark:text-slate-300">{profile.guidance}</p>
    {profile.notes.map((note) => <p key={note} className="text-xs text-slate-500">{note}</p>)}
    <div className="workspace-toolbar"><button onClick={run}>{running ? "Stop" : profile.environment === "local" || profile.environment === "external" ? "Run Python scratchpad" : "Run Python"}</button><span role="status">{status}</span></div>
    <fieldset disabled={running} className="contents">
    <label className="workspace-label">Practice mode
      <select aria-label="Practice mode" className="workspace-input" value={interaction} onChange={(event) => update({ interaction: event.target.value })}>
        {interactions.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
    </label>
    <p className="text-sm text-slate-600 dark:text-slate-300">{interactionGuidance[interaction]}</p>
    <label className="workspace-label" htmlFor="exercise-answer">{interaction === "predict" ? "Your prediction and reasoning" : "Your written answer and reasoning"}</label>
    <textarea id="exercise-answer" className="workspace-input" rows={5} value={draft.answer} onChange={(event) => update({ answer: event.target.value })} />
    {draft.sourceRevision !== initial.sourceRevision ? <p className="text-sm text-amber-700 dark:text-amber-300">The prompt changed. Your saved work is preserved. Reset workspace loads the updated starter.</p> : null}
    <div className="workspace-toolbar">
      <label>File <select aria-label="Active file" value={draft.activeFile} onChange={(event) => update({ activeFile: event.target.value })}>
        {Object.keys(draft.files).map((file) => <option key={file}>{file}</option>)}
      </select></label>
      <button onClick={() => setEditing(!editing)}>{editing ? "Preview code" : "Edit code"}</button>
      <button disabled={running} onClick={() => {
        if (window.confirm("Reset this workspace's code and written answer? Your completion and notes are kept.")) { deleteDraft(key); setOutput(""); }
      }}>Reset workspace</button>
    </div>
    <div className="workspace-toolbar">
      <input className="workspace-input" aria-label="New file path" placeholder="helpers.py or data/input.csv" value={newFile} onChange={(event) => setNewFile(event.target.value)} />
      <button onClick={() => {
        if (!validWorkspacePath(newFile) || Object.hasOwn(draft.files, newFile)) { setFileError("Choose a new relative path using letters, numbers, _, -, / and .; no .. segments."); return; }
        update({ files: { ...draft.files, [newFile]: "" }, activeFile: newFile }); setNewFile(""); setFileError(""); setEditing(true);
      }}>Add file</button>
      <button disabled={Object.keys(draft.files).length <= 1} onClick={() => {
        if (!window.confirm(`Delete ${draft.activeFile}?`)) return;
        const files = { ...draft.files }; delete files[draft.activeFile];
        const activeFile = Object.keys(files)[0];
        update({ files, activeFile, entrypoint: draft.entrypoint === draft.activeFile ? Object.keys(files).find((name) => name.endsWith(".py")) ?? "" : draft.entrypoint });
      }}>Delete file</button>
      <button onClick={() => {
        const url = URL.createObjectURL(new Blob([draft.files[draft.activeFile] ?? ""], { type: "text/plain" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = draft.activeFile.split("/").pop() ?? "file.txt"; anchor.click(); URL.revokeObjectURL(url);
      }}>Download file</button>
    </div>
    <label className="workspace-label">Upload text file
      <input className="workspace-input" type="file" aria-label="Upload text file" onChange={async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 1_000_000 || !validWorkspacePath(file.name) || Object.hasOwn(draft.files, file.name)) { setFileError("Upload a new text filename under 1 MB; existing files are never overwritten."); return; }
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
          if (text.includes("\0")) throw new Error("Binary file");
          update({ files: { ...draft.files, [file.name]: text }, activeFile: file.name }); setFileError("");
        } catch { setFileError("Only UTF-8 text files are supported."); }
      }} />
    </label>
    {fileError ? <p role="alert" className="text-sm text-red-600 dark:text-red-300">{fileError}</p> : null}
    <CodeEditor language={languageForFile(draft.activeFile)} value={draft.files[draft.activeFile] ?? ""} editing={editing && !running} onChange={(value) => update({ files: { ...draft.files, [draft.activeFile]: value } })} onFinish={() => setEditing(false)} onRun={draft.activeFile.endsWith(".py") ? run : undefined} />
    <div className="workspace-toolbar">
      <label>Entrypoint <select aria-label="Python entrypoint" value={draft.entrypoint} onChange={(event) => update({ entrypoint: event.target.value })}>
        {Object.keys(draft.files).filter((name) => name.endsWith(".py")).map((name) => <option key={name}>{name}</option>)}
      </select></label>
      <label>Execution mode <select aria-label="Execution mode" value={draft.mode ?? "script"} onChange={(event) => update({ mode: event.target.value as "script" | "notebook" | "module" })}>
        <option value="script">Python script</option><option value="module">Python module (package-relative imports)</option><option value="notebook">Notebook (top-level await / expression output)</option>
      </select></label>
    </div>
    <label className="workspace-label" htmlFor="workspace-stdin">Standard input (one input() response per line)</label>
    <textarea id="workspace-stdin" className="workspace-input" rows={3} value={draft.stdin} onChange={(event) => update({ stdin: event.target.value })} />
    <label className="workspace-label" htmlFor="workspace-packages">Additional Pyodide packages (comma-separated)</label>
    <input id="workspace-packages" className="workspace-input" placeholder="numpy, pandas, matplotlib" value={draft.packageInput ?? draft.packages?.join(", ") ?? ""} onChange={(event) => update({ packageInput: event.target.value })} />
    <p className="text-xs text-slate-500">Supported imports are loaded automatically, including those in your other .py files. Every Run starts fresh with your saved files (30s execution limit). Use display(data) for tables; matplotlib figures appear after execution. Files generated under /workspace are saved as text (up to 50 files / 1 MB total). input() raises EOFError if supplied input runs out.</p>
    <p className="text-xs text-slate-500">This is browser Python, not a terminal or server: Docker, listening HTTP servers, OS processes, native PyTorch/CUDA and arbitrary pip packages are not supported. Network requests depend on browser restrictions. Use a local environment for those tasks.</p>
    </fieldset>
    {Object.keys(initial.files).length > 1 ? <p className="text-xs text-slate-500">Named source files keep their paths; unnamed examples are separate files. Choose the Python entrypoint explicitly. Configuration and commands are editable text, not executed by Run Python.</p> : null}
    <p role="status" className="text-xs text-slate-500">{storageStatus}</p>
    {output ? <pre className="workspace-output" aria-label="Python output" aria-live="polite">{output}</pre> : null}
    {artifacts.map((artifact, index) => artifact.kind === "plot" ? <figure key={index}>
      {/* The worker supplies a PNG data URL rather than executable HTML. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`data:image/png;base64,${artifact.png}`} alt={`Python plot ${index + 1}`} className="max-w-full rounded-lg" />
    </figure> : <div key={index} className="overflow-auto" aria-label="Python table output">
      <table className="w-full text-left text-xs"><thead><tr>{artifact.columns.map((column, i) => <th className="border p-2" key={i}>{column}</th>)}</tr></thead>
        <tbody>{artifact.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td className="border p-2" key={j}>{cell}</td>)}</tr>)}</tbody>
      </table>{artifact.truncated ? <p className="text-xs">Showing up to 100 rows and 20 columns.</p> : null}
    </div>)}
    <label className="flex items-center gap-2 text-sm font-semibold">
      <input type="checkbox" checked={isExerciseComplete(chapterSlug, exerciseId)} onChange={() => toggleExercise(chapterSlug, exerciseId)} />
      I have completed this exercise
    </label>
    <p className="text-xs text-slate-500">No automatic grading. Your written answer, code, and completion are saved in this browser.</p>
  </section>;
}
