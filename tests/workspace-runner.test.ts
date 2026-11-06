import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkspace } from "../lib/workspace-runner";

class FakeWorker {
  static latest: FakeWorker;
  onmessage?: (event: { data: Record<string, unknown> }) => void;
  onerror?: (event: { message: string }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.latest = this; }
  emit(data: Record<string, unknown>) { this.onmessage?.({ data }); }
}
const request = { files: { "main.py": "print('hi')" }, entrypoint: "main.py", stdin: "", packages: [], mode: "script" as const };
const handlers = () => ({ onStatus: vi.fn(), onOutput: vi.fn(), onArtifact: vi.fn(), onFiles: vi.fn(), onFinish: vi.fn() });

describe("isolated execution lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("Worker", FakeWorker); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("allows loading time separately from the execution deadline", () => {
    const callbacks = handlers();
    runWorkspace(request, callbacks);
    const worker = FakeWorker.latest;
    vi.advanceTimersByTime(119000);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emit({ type: "status", phase: "running", text: "Running" });
    vi.advanceTimersByTime(29999);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(callbacks.onOutput).toHaveBeenCalledWith(expect.stringContaining("30 seconds"));
    expect(callbacks.onFinish).toHaveBeenCalledOnce();
  });
  it("stops once, ignores late messages, and creates a fresh worker on the next attempt", () => {
    const callbacks = handlers();
    const stop = runWorkspace(request, callbacks);
    const first = FakeWorker.latest;
    stop(); stop();
    first.emit({ type: "output", text: "stale" });
    expect(callbacks.onFinish).toHaveBeenCalledOnce();
    expect(callbacks.onOutput).not.toHaveBeenCalledWith("stale");
    runWorkspace(request, handlers());
    expect(FakeWorker.latest).not.toBe(first);
  });
  it("forwards text-file changes and artifacts and terminates on output overflow", () => {
    const callbacks = handlers();
    runWorkspace(request, callbacks);
    const worker = FakeWorker.latest;
    worker.emit({ type: "files", files: { "result.txt": "ok" }, deleted: ["old.txt"] });
    expect(callbacks.onFiles).toHaveBeenCalledWith({ "result.txt": "ok" }, ["old.txt"]);
    worker.emit({ type: "artifact", artifact: { kind: "table", columns: [], rows: [], truncated: false } });
    expect(callbacks.onArtifact).toHaveBeenCalledOnce();
    worker.emit({ type: "output", text: "x".repeat(100001) });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(callbacks.onOutput).toHaveBeenCalledWith(expect.stringContaining("Output limit"));
  });
});
