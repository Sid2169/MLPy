"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Check,
  Copy,
  Loader2,
  Play,
  Square,
  Terminal,
} from "lucide-react";
import { runPython, stopPython } from "@/lib/pyodide-client";

type CodeActionsProps = {
  language?: string;
};

type OutputLine = {
  kind: "stdout" | "stderr" | "result" | "error" | "status";
  text: string;
};

export function CodeActions({ language }: CodeActionsProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "running">("idle");
  const [output, setOutput] = useState<OutputLine[]>([]);
  const normalizedLanguage = (language ?? "").toLowerCase();
  const runnable = normalizedLanguage.startsWith("python");

  const codeText = useCallback(() => {
    const frame = frameRef.current?.closest("[data-code-frame]");
    return frame?.querySelector("code")?.textContent ?? "";
  }, []);

  const copy = useCallback(async () => {
    const text = codeText();
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
  }, [codeText]);

  const run = useCallback(() => {
    if (running) {
      stopPython();
      return;
    }

    const code = codeText();
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
  }, [codeText, running]);

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
      </div>

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
