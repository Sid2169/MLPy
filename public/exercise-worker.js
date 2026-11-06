/* global loadPyodide */
"use strict";

const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";

self.onmessage = async ({ data }) => {
  let pyodide;
  const output = (text) => self.postMessage({ type: "output", text: String(text) });
  self.learningDisplay = (json) => self.postMessage({ type: "artifact", artifact: JSON.parse(json) });
  try {
    self.postMessage({ type: "status", text: "Loading isolated Python runtime…" });
    importScripts(`${PYODIDE_BASE}pyodide.js`);
    pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
    pyodide.setStdout({ batched: output });
    pyodide.setStderr({ batched: output });
    self.postMessage({ type: "status", text: "Loading declared and imported Pyodide packages…" });
    if (data.packages.length) await pyodide.loadPackage(data.packages);
    for (const [name, content] of Object.entries(data.files)) {
      if (name.endsWith(".py")) await pyodide.loadPackagesFromImports(content);
    }
    pyodide.globals.set("__learning_payload", JSON.stringify(data));
    await pyodide.runPythonAsync(`
import json as _learning_json, sys as _learning_sys, io as _learning_io
import os as _learning_os, pathlib as _learning_pathlib, types as _learning_types
import builtins as _learning_builtins
from js import learningDisplay as _learning_emit
_learning_data = _learning_json.loads(__learning_payload)
_learning_root = _learning_pathlib.Path('/workspace')
_learning_root.mkdir(exist_ok=True)
for _name, _content in _learning_data['files'].items():
    _file = _learning_root / _name
    _file.parent.mkdir(parents=True, exist_ok=True)
    _file.write_text(_content)
_learning_os.chdir('/workspace')
_learning_os.environ['MPLBACKEND'] = 'Agg'
_learning_sys.path.insert(0, '/workspace')
_learning_sys.stdin = _learning_io.StringIO(_learning_data['stdin'])
_learning_sys.argv = [_learning_data['entrypoint']]

def _learning_display(value):
    if hasattr(value, 'columns') and hasattr(value, 'itertuples'):
        columns = [str(c) for c in value.columns[:20]]
        rows = [[str(cell)[:2000] for cell in row[:20]] for row in value.head(100).itertuples(index=False, name=None)]
        truncated = len(value) > 100 or len(value.columns) > 20
    else:
        if hasattr(value, 'tolist'):
            value = value.tolist()
        if isinstance(value, dict):
            value = [value]
        if isinstance(value, (list, tuple)) and value:
            if isinstance(value[0], dict):
                columns = list(dict.fromkeys(k for row in value[:100] for k in row))[:20]
                rows = [[str(row.get(k, ''))[:2000] for k in columns] for row in value[:100]]
                columns = [str(k) for k in columns]
            elif isinstance(value[0], (list, tuple)):
                columns = [str(i) for i in range(min(20, len(value[0])))]
                rows = [[str(cell)[:2000] for cell in row[:20]] for row in value[:100]]
            else:
                columns = ['value']
                rows = [[str(cell)[:2000]] for cell in value[:100]]
            truncated = len(value) > 100
        else:
            print(value)
            return
    _learning_emit(_learning_json.dumps({'kind': 'table', 'columns': columns, 'rows': rows, 'truncated': truncated}))

_learning_builtins.display = _learning_display
_learning_module = _learning_types.ModuleType('learning')
_learning_module.display = _learning_display
_learning_sys.modules['learning'] = _learning_module
if 'matplotlib' in _learning_sys.modules:
    import matplotlib as _learning_mpl
    _learning_mpl.use('Agg')
`);
    self.postMessage({ type: "status", phase: "running", text: "Running in a fresh workspace…" });
    await pyodide.runPythonAsync(`
if _learning_data['mode'] == 'script':
    import runpy as _learning_runpy
    _learning_runpy.run_path(_learning_data['entrypoint'], run_name='__main__')
elif _learning_data['mode'] == 'module':
    import runpy as _learning_runpy
    _learning_name = _learning_data['entrypoint'][:-3].replace('/', '.')
    _learning_runpy.run_module(_learning_name, run_name='__main__', alter_sys=True)
else:
    from pyodide.code import eval_code_async as _learning_eval
    _learning_namespace = {'__name__': '__main__', '__file__': _learning_data['entrypoint']}
    _learning_result = await _learning_eval(_learning_pathlib.Path(_learning_data['entrypoint']).read_text(), globals=_learning_namespace, filename=_learning_data['entrypoint'])
    if _learning_result is not None:
        _learning_display(_learning_result)
`);
  } catch (error) {
    self.postMessage({ type: "error", text: String(error?.message ?? error) });
  } finally {
    if (pyodide) {
      try {
        // Run collection separately so files and figures survive user exceptions.
        await pyodide.runPythonAsync(`
if 'matplotlib.pyplot' in _learning_sys.modules:
    import matplotlib.pyplot as _learning_plt, base64 as _learning_base64
    for _number in _learning_plt.get_fignums()[:10]:
        _buffer = _learning_io.BytesIO()
        _learning_plt.figure(_number).savefig(_buffer, format='png', dpi=100)
        if _buffer.tell() <= 2000000:
            _learning_emit(_learning_json.dumps({'kind': 'plot', 'png': _learning_base64.b64encode(_buffer.getvalue()).decode()}))
    _learning_plt.close('all')
`);
      } catch { /* Setup may not have finished, or the user changed the runtime. */ }
      try {
        const files = {};
        let total = 0;
        let skipped = 0;
        const collect = (directory, prefix = "") => {
          for (const name of pyodide.FS.readdir(directory)) {
            if (name === "." || name === ".." || name === "__pycache__") continue;
            const absolute = `${directory}/${name}`;
            const relative = `${prefix}${name}`;
            const stat = pyodide.FS.lstat(absolute);
            if (pyodide.FS.isDir(stat.mode)) collect(absolute, `${relative}/`);
            else if (pyodide.FS.isFile(stat.mode) && total + stat.size <= 1000000 && Object.keys(files).length < 50) {
              const bytes = pyodide.FS.readFile(absolute);
              try {
                const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                if (!text.includes("\0")) { files[relative] = text; total += stat.size; }
                else skipped += 1;
              } catch { skipped += 1; }
            } else {
              skipped += 1;
            }
          }
        };
        collect("/workspace");
        const deleted = Object.keys(data.files).filter((name) => !pyodide.FS.analyzePath(`/workspace/${name}`).exists);
        if (skipped) output(`${skipped} file(s) could not be saved as text (binary, symlink, or workspace size/count limit).`);
        self.postMessage({ type: "files", files, deleted });
      } catch { /* Filesystem may not exist if initialization failed. */ }
    }
    self.postMessage({ type: "done" });
  }
};
