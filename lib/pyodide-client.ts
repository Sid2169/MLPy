type RunnerHandlers = {
  onStatus?: (status: "loading" | "running") => void;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  onResult?: (result: string) => void;
  onError?: (error: string) => void;
};

type ActiveRun = RunnerHandlers & {
  id: number;
  timer: number;
};

let worker: Worker | null = null;
let activeRun: ActiveRun | null = null;
let nextId = 1;

function ensureWorker(): Worker {
  if (worker) {
    return worker;
  }

  worker = new Worker("/pyodide-worker.js");

  worker.onmessage = (event: MessageEvent) => {
    const message = event.data as {
      type?: string;
      id?: number;
      status?: "loading" | "running";
      text?: string;
      result?: string;
      error?: string;
    };

    if (!activeRun || message.id !== activeRun.id) {
      return;
    }

    if (message.type === "status" && message.status) {
      activeRun.onStatus?.(message.status);
      return;
    }

    if (message.type === "stdout" && message.text !== undefined) {
      activeRun.onStdout?.(message.text);
      return;
    }

    if (message.type === "stderr" && message.text !== undefined) {
      activeRun.onStderr?.(message.text);
      return;
    }

    if (message.type === "result") {
      const run = activeRun;
      finishRun();
      run.onResult?.(message.result ?? "");
      return;
    }

    if (message.type === "error") {
      const run = activeRun;
      finishRun();
      run.onError?.(message.error ?? "Unknown Python error");
    }
  };

  worker.onerror = (event) => {
    const run = activeRun;
    resetWorker();
    run?.onError?.(
      event.message || "The browser Python runtime failed to start.",
    );
  };

  return worker;
}

function finishRun() {
  if (activeRun) {
    window.clearTimeout(activeRun.timer);
    activeRun = null;
  }
}

function resetWorker() {
  finishRun();
  worker?.terminate();
  worker = null;
}

export function runPython(code: string, handlers: RunnerHandlers): boolean {
  if (activeRun) {
    handlers.onError?.(
      "Another snippet is already running. Wait for it to finish or stop it first.",
    );
    return false;
  }

  const id = nextId;
  nextId += 1;
  const timer = window.setTimeout(() => {
    const run = activeRun;
    resetWorker();
    run?.onError?.(
      "Execution timed out after 30 seconds. The Python runtime was reset.",
    );
  }, 30_000);

  activeRun = { id, timer, ...handlers };
  ensureWorker().postMessage({ type: "run", id, code });
  return true;
}

export function stopPython() {
  if (!activeRun) {
    return;
  }

  const run = activeRun;
  resetWorker();
  run.onError?.("Execution stopped.");
}
