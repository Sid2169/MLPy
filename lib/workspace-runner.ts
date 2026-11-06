import { validateWorkspaceRun, type WorkspaceArtifact, type WorkspaceRun } from "./workspace-runtime";

type Handlers = {
  onStatus: (status: string) => void;
  onOutput: (text: string) => void;
  onArtifact: (artifact: WorkspaceArtifact) => void;
  onFiles: (files: Record<string, string>, deleted: string[]) => void;
  onFinish: () => void;
};

// A fresh worker per execution isolates globals, imports, builtins and files.
// Packages still benefit from the browser's HTTP cache between executions.
export function runWorkspace(run: WorkspaceRun, handlers: Handlers): () => void {
  const error = validateWorkspaceRun(run);
  if (error) {
    handlers.onOutput(error);
    handlers.onFinish();
    return () => {};
  }
  const worker = new Worker("/exercise-worker.js");
  let done = false;
  let outputSize = 0;
  let timer: ReturnType<typeof setTimeout>;
  const finish = (message?: string) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    worker.terminate();
    if (message) handlers.onOutput(message);
    handlers.onFinish();
  };
  const deadline = (milliseconds: number, message: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => finish(message), milliseconds);
  };
  deadline(120_000, "Python or its packages could not load within 120 seconds. Try again with fewer dependencies.");
  worker.onmessage = ({ data }) => {
    if (done) return;
    switch (data.type) {
      case "status":
        handlers.onStatus(data.text);
        if (data.phase === "running") deadline(30_000, "Execution timed out after 30 seconds. This isolated runtime was stopped.");
        break;
      case "output":
        outputSize += data.text.length;
        if (outputSize > 100_000) finish("Output limit reached (100,000 characters). Execution stopped.");
        else handlers.onOutput(data.text);
        break;
      case "artifact": handlers.onArtifact(data.artifact); break;
      case "files": handlers.onFiles(data.files, data.deleted); break;
      case "error": handlers.onOutput(data.text); break;
      case "done": finish(); break;
    }
  };
  worker.onerror = (event) => finish(event.message || "The isolated Python runtime could not start.");
  worker.postMessage(run);
  return () => finish("Execution stopped.");
}
