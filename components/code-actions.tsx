"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Check,
  Copy,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  Square,
  Terminal,
} from "lucide-react";
import { CodeEditor } from "@/components/code-editor";
import { usePathname } from "next/navigation";
import { useProgress } from "@/components/progress-provider";
import { runPython, stopPython } from "@/lib/pyodide-client";

type CodeActionsProps = {
  language?: string;
  snippetId?: string;
  originalSource?: string;
};

type OutputLine = {
  kind: "stdout" | "stderr" | "result" | "error" | "status";
  text: string;
};

export function CodeActions({ language, snippetId, originalSource }: CodeActionsProps) {
  const pathname = usePathname();
  const { hydrated, drafts, saveDraft, deleteDraft, storageStatus } = useProgress();
  const draftKey = `snippet:${pathname}:${snippetId}`;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "running">("idle");
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const normalizedLanguage = (language ?? "").toLowerCase();
  const runnable = normalizedLanguage.startsWith("python");
  const active = editing || editedCode !== null;

  const codeText = useCallback(() => {
    const frame = frameRef.current?.closest("[data-code-frame]");
    return frame?.querySelector(":scope > pre code")?.textContent ?? "";
  }, []);

  useEffect(() => {
    if (!hydrated || snippetId === undefined) return;
    setEditedCode(drafts[draftKey]?.files.main ?? null);
  }, [hydrated, snippetId, draftKey, drafts]);

  const updateDraft = useCallback((value: string) => {
    setDraft(value);
    if (snippetId !== undefined) saveDraft(draftKey, {
      files: { main: value }, answer: "", activeFile: "main", entrypoint: "main", stdin: "",
      sourceRevision: drafts[draftKey]?.sourceRevision ?? codeText(), updatedAt: Date.now(),
    });
  }, [snippetId, saveDraft, draftKey, drafts, codeText]);

  const readCode = useCallback(() => {
    if (editing) {
      return draft;
    }
    return editedCode ?? codeText();
  }, [codeText, draft, editedCode, editing]);

  useEffect(() => {
    const frame = frameRef.current?.closest("[data-code-frame]");
    if (!frame) {
      return;
    }

    if (active) {
      frame.setAttribute("data-code-active", "true");
    } else {
      frame.removeAttribute("data-code-active");
    }
  }, [active]);

  const startEditing = useCallback(() => {
    setDraft(editedCode ?? codeText());
    setOutput([]);
    setEditing(true);
  }, [codeText, editedCode]);

  const finishEditing = useCallback(() => {
    setEditedCode(draft === codeText() ? null : draft);
    setEditing(false);
  }, [codeText, draft]);

  const resetCode = useCallback(() => {
    setEditing(false);
    setEditedCode(null);
    setDraft("");
    setOutput([]);
    deleteDraft(draftKey);
  }, [deleteDraft, draftKey]);

  const copy = useCallback(async () => {
    const text = readCode();
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }, [readCode]);

  const run = useCallback(() => {
    if (running) {
      stopPython();
      return;
    }

    const code = readCode();
    if (!code.trim()) {
      return;
    }

    setOutput([]);
    setRunning(true);
    setStatus("loading");

    const started = runPython(code, {
      onStatus: (nextStatus) => setStatus(nextStatus),
      onStdout: (text) =>
        setOutput((current) => [...current, { kind: "stdout", text }]),
      onStderr: (text) =>
        setOutput((current) => [...current, { kind: "stderr", text }]),
      onResult: (result) => {
        setRunning(false);
        setStatus("idle");
        setOutput((current) => {
          if (result) {
            return [...current, { kind: "result" as const, text: result }];
          }
          if (current.length === 0) {
            return [
              {
                kind: "status" as const,
                text: "Ran successfully with no output.",
              },
            ];
          }
          return current;
        });
      },
      onError: (error) => {
        setRunning(false);
        setStatus("idle");
        setOutput((current) => [
          ...current,
          { kind: "error", text: error },
        ]);
      },
    });

    if (!started) {
      setRunning(false);
      setStatus("idle");
    }
  }, [readCode, running]);

  const hasOutput = output.length > 0;
  const statusText = useMemo(() => {
    if (status === "loading") {
      return "Loading Python runtime (first run only)…";
    }
    if (status === "running") {
      return "Running…";
    }
    return "";
  }, [status]);

  return (
    <div ref={frameRef} className="code-actions">
      <div className="code-toolbar">
        {runnable ? (
          <button
            type="button"
            className={clsx(
              "code-toolbar-button",
              running && "code-toolbar-button-active",
            )}
            onClick={run}
            aria-label={
              running ? "Stop Python execution" : "Run this Python snippet"
            }
            title={running ? "Stop execution" : "Run in browser"}
          >
            {status === "loading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : running ? (
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{running ? "Stop" : "Run"}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="code-toolbar-button"
          onClick={copy}
          aria-label={copied ? "Copied code" : "Copy code"}
          title={copied ? "Copied" : "Copy"}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
        <button
          type="button"
          className="code-toolbar-button"
          onClick={editing ? finishEditing : startEditing}
          disabled={!hydrated}
          aria-label={editing ? "Finish editing code" : "Edit code"}
          title={editing ? "Done editing" : "Edit code"}
        >
          {editing ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>{editing ? "Done" : "Edit"}</span>
        </button>
        {active ? (
          <button
            type="button"
            className="code-toolbar-button"
            onClick={resetCode}
            aria-label="Reset code"
            title="Reset to the original snippet"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset</span>
          </button>
        ) : null}
      </div>

      {active ? (
        <>
        {drafts[draftKey]?.sourceRevision !== undefined && drafts[draftKey].sourceRevision !== originalSource ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">The original snippet changed. Your saved draft is preserved; Reset loads the new original.</p>
        ) : null}
        <CodeEditor
          value={editing ? draft : editedCode ?? ""}
          language={normalizedLanguage}
          editing={editing}
          onChange={updateDraft}
          onFinish={finishEditing}
          onRun={runnable ? run : undefined}
        />
        <p className="mt-1 text-xs text-slate-500" role="status">{storageStatus}</p>
        </>
      ) : null}

      {runnable && (hasOutput || statusText) ? (
        <div className="code-output" aria-live="polite">
          <div className="code-output-header">
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Python output</span>
          </div>
          {statusText ? (
            <p className="code-output-status">{statusText}</p>
          ) : null}
          {output.map((line, index) => (
            <pre
              key={`${line.kind}-${index}`}
              className={clsx(
                "code-output-line",
                line.kind === "stderr" && "code-output-stderr",
                line.kind === "error" && "code-output-error",
                line.kind === "result" && "code-output-result",
                line.kind === "status" && "code-output-muted",
              )}
            >
              {line.text}
            </pre>
          ))}
        </div>
      ) : null}
    </div>
  );
}
