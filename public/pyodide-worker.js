/* global loadPyodide */
"use strict";

const PYODIDE_VERSION = "0.29.5";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise = null;
let currentId = null;

function getPyodide() {
  if (!pyodidePromise) {
    importScripts(`${PYODIDE_BASE}pyodide.js`);
    pyodidePromise = loadPyodide({ indexURL: PYODIDE_BASE }).then((pyodide) => {
      pyodide.setStdout({
        batched: (text) => {
          self.postMessage({ type: "stdout", id: currentId, text });
        },
      });
      pyodide.setStderr({
        batched: (text) => {
          self.postMessage({ type: "stderr", id: currentId, text });
        },
      });
      return pyodide;
    });
  }

  return pyodidePromise;
}

self.onmessage = async (event) => {
  const data = event.data || {};
  if (data.type !== "run") {
    return;
  }

  const id = data.id;
  const code = String(data.code ?? "");
  currentId = id;

  try {
    self.postMessage({ type: "status", id, status: "loading" });
    const pyodide = await getPyodide();

    self.postMessage({ type: "status", id, status: "running" });

    try {
      await pyodide.loadPackagesFromImports(code);
    } catch {
      // The snippet may import a package that Pyodide does not provide.
      // Running it anyway surfaces the normal Python ModuleNotFoundError.
    }

    const result = await pyodide.runPythonAsync(code);
    self.postMessage({
      type: "result",
      id,
      result: result === undefined || result === null ? "" : String(result),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      id,
      error:
        typeof error?.message === "string"
          ? error.message
          : String(error ?? "Unknown Python error"),
    });
  } finally {
    currentId = null;
  }
};
