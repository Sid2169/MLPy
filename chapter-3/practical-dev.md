# Chapter 3 — Practical Python Development

Chapters 1 and 2 covered the language. This chapter covers the working environment around it: virtual environments and dependencies, project layout, configuration and secrets, file and path handling, JSON and CSV, logging, debugging, HTTP calls, and command-line scripts.

The goal is reproducible projects: someone else (or future you) should be able to clone the repository, install exactly the required dependencies, provide configuration, and run the same code with the same results.

As in previous chapters, exercises have no answers, and worked examples in the lesson are teaching material.

## Contents

1. Virtual environments and dependencies
2. Project structure, configuration, environment variables, and secrets
3. Paths and files with `pathlib`
4. JSON and CSV
5. Logging
6. Debugging and tracebacks
7. HTTP requests with `httpx`
8. Command-line scripts and configuration validation
9. Common mistakes and idioms
10. Exercises (Groups A–J)

---

## 3.1 Virtual environments and dependencies

A virtual environment is a per-project directory containing its own Python interpreter shim and its own `site-packages`. Installing dependencies into it does not affect other projects or the system Python.

```bash
# create it (once per project machine)
python3 -m venv .venv

# activate it (per shell session)
source .venv/bin/activate        # Linux/macOS
.venv\Scripts\Activate.ps1       # Windows PowerShell

# confirm which interpreter is active
python -c "import sys; print(sys.executable)"
python -m pip --version

# leave it
deactivate
```

Rules that prevent most dependency pain:

- Always invoke pip as `python -m pip`, never bare `pip`. The bare command may belong to a different interpreter than `python`, silently installing into the wrong environment.
- Put the environment directory (`.venv/`) in `.gitignore`. Environments are machine-specific and must never be committed. Dependencies are declared in files instead.
- Create one environment per project. Node.js has `node_modules` per project; Python needs this explicitly.
- Activate the environment before running anything, or invoke `.venv/bin/python` directly. A surprising number of "ModuleNotFoundError" incidents are a shell using the wrong interpreter.

TypeScript comparison: `.venv/` is conceptually `node_modules/`, and `pyproject.toml` is conceptually `package.json`.

### Installing, pinning, and updating packages

```bash
python -m pip install httpx                # install latest
python -m pip install "httpx==0.27.2"      # exact pin
python -m pip install -r requirements.txt  # install a curated list
python -m pip list --outdated              # see newer versions
python -m pip install --upgrade httpx      # update one package
```

Version specifiers in `requirements.txt`:

```text
httpx==0.27.2        # exact: reproducible, requires deliberate upgrades
httpx>=0.27          # any newer major version; risky for libraries with breaking changes
httpx~=0.27.2        # compatible release: >=0.27.2, <0.28.0
```

Applications should pin (or lock) exact versions so deployments are reproducible. `pip freeze > requirements.txt` records the full transitive dependency graph of the current environment; it is a snapshot, not a curated manifest, but it is exactly what you want for "run this again somewhere else." Libraries usually declare ranges in `pyproject.toml` instead.

The modern project manifest is `pyproject.toml`:

```toml
[project]
name = "app"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "httpx~=0.27",
    "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = ["pytest", "ruff"]
```

```bash
python -m pip install -e .          # install this project (editable) plus its dependencies
python -m pip install -e ".[dev]"   # with the dev extras
```

Editable installs (`-e`) link the project into the environment so source edits take effect without reinstalling. `uv` is a fast drop-in alternative with the same model (`uv venv`, `uv pip install`, `uv add httpx`); the concepts are identical, only the commands differ. `pip` and the virtual environment remain the baseline you must be able to explain.

## 3.2 Project structure, configuration, environment variables, and secrets

A layout that scales from a script to a service:

```text
app/
├── pyproject.toml
├── README.md
├── .gitignore
├── .env.example          # committed: documents required variables
├── .env                  # NOT committed: real values
├── src/
│   └── app/
│       ├── __init__.py
│       ├── config.py
│       ├── client.py
│       └── main.py
├── tests/
└── data/
```

- `src/` layout prevents accidentally importing the working directory instead of the installed package.
- `tests/` mirrors the package structure. Chapter 4 covers pytest.
- `data/` and generated outputs are not source code; decide explicitly what is committed.

### Environment variables

Environment variables carry configuration and secrets so they are not baked into code or images. In Python they live in `os.environ`, a mapping of strings to strings.

```python
import os

port = int(os.getenv("PORT", "8080"))          # default as a STRING, then convert
api_key = os.environ["API_KEY"]                # KeyError if missing: fail fast
debug = os.getenv("DEBUG", "false").lower() in {"1", "true", "yes"}
```

Everything from the environment is a string. There are no numbers, booleans, or lists unless you parse them. Parsing booleans with `bool(os.getenv("DEBUG"))` is a bug: `"false"` is a non-empty string and therefore truthy.

A development `.env` file (loaded by `python-dotenv`) keeps local values out of the shell history and out of git:

```bash
# .env  (git-ignored)
API_KEY=sk-local-dev
PORT=8080
```

```python
from dotenv import load_dotenv
load_dotenv()          # reads .env into os.environ; call once at startup, in the entry point
```

`.env.example` documents every variable with placeholder values and is committed; `.env` is never committed. In production, the platform injects real environment variables.

### Validating configuration once, at startup

Configuration errors should surface immediately with an actionable message, not as a mysterious `TypeError` deep in a request handler.

```python
from dataclasses import dataclass

class ConfigError(Exception):
    """Raised when required configuration is missing or invalid."""

@dataclass
class Settings:
    api_key: str
    base_url: str
    timeout: float
    retries: int

def load_settings(environ: dict[str, str]) -> Settings:
    errors = []

    api_key = environ.get("API_KEY", "")
    if not api_key:
        errors.append("API_KEY is required")

    base_url = environ.get("BASE_URL", "https://api.example.com")
    if not base_url.startswith(("http://", "https://")):
        errors.append(f"BASE_URL must be an http(s) URL, got {base_url!r}")

    try:
        timeout = float(environ.get("TIMEOUT", "10"))
        if timeout <= 0:
            errors.append("TIMEOUT must be positive")
    except ValueError:
        timeout = 10.0
        errors.append(f"TIMEOUT must be a number, got {environ.get('TIMEOUT')!r}")

    if errors:
        raise ConfigError("; ".join(errors))

    return Settings(api_key=api_key, base_url=base_url, timeout=timeout, retries=3)
```

Key ideas:

- The function takes an `environ` mapping explicitly instead of reading `os.environ` directly. Tests can pass a dict; production passes `dict(os.environ)`. This is dependency injection from Chapter 2 applied to configuration.
- Collect *all* errors before raising; users should not discover problems one restart at a time.
- Never include secret *values* in error messages; name the variable instead.
- Validate number ranges and URL shapes at the boundary (Chapter 5's Pydantic automates this; `pydantic-settings` is the standard upgrade path once you meet Pydantic).

Return an immutable settings object (a frozen dataclass works well) and pass it to the functions that need it. Avoid importing a module-level `settings = load_settings(os.environ)` everywhere, because that runs at import time and makes tests depend on the ambient environment.

## 3.3 Paths and files with `pathlib`

`pathlib.Path` replaces most `os.path` string juggling. Prefer it in new code.

```python
from pathlib import Path

data_dir = Path("data")
file_path = data_dir / "raw" / "users.json"   # the / operator joins paths
print(file_path)                # data/raw/users.json
print(str(file_path))           # convert to string for libraries that need one

p = Path("/var/log/app/server.log")
p.name        # 'server.log'
p.stem        # 'server'
p.suffix      # '.log'
p.parent      # Path('/var/log/app')
p.with_suffix(".json")   # Path('/var/log/app/server.json')
```

### Reading and writing text

```python
text = Path("notes.txt").read_text(encoding="utf-8")
Path("out").mkdir(parents=True, exist_ok=True)
Path("out/notes.txt").write_text(text.upper(), encoding="utf-8")
```

- Always pass `encoding="utf-8"`. The default is the platform locale, which differs across machines and is a classic source of mojibake.
- `write_text` overwrites by default. Modes still matter when using `open`: `"w"` truncates, `"a"` appends, `"r"` reads.
- `mkdir(parents=True, exist_ok=True)` creates intermediate directories and does not fail if the directory already exists. Without `parents=True`, a missing intermediate raises `FileNotFoundError`.
- Reading a missing file raises `FileNotFoundError`; check with `.exists()` only when the behavior is genuinely optional, otherwise let the error surface with context added at the boundary.

For line-by-line processing of large files, iterate instead of reading it all:

```python
with Path("events.log").open(encoding="utf-8") as f:
    for line in f:
        process(line.rstrip("\n"))
```

### Navigating directories

```python
root = Path("data")
for path in root.iterdir():            # all entries, non-recursive
    print(path)

for path in root.glob("*.json"):       # pattern in this directory
    print(path)

for path in root.rglob("*.json"):      # recursive
    print(path)

json_files = sorted(p for p in root.rglob("*.json") if p.is_file())
```

Sort the results when the output order matters; filesystem order is arbitrary.

### Locating files relative to your code

A relative path like `"data/users.json"` depends on the current working directory. Running the script from another directory breaks it. Anchor paths to the module instead:

```python
# app/config.py
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
```

`__file__` is the module's path; `.resolve()` makes it absolute and normalizes `..`. This is Python's equivalent of `import.meta.url` in ES modules.

### Binary data and temporary files

- `read_bytes()` / `write_bytes()` handle binary content; text APIs must not be used for images or archives.
- `tempfile.TemporaryDirectory()` and `tempfile.NamedTemporaryFile()` create scratch space that cleans itself up. Chapter 4 uses them heavily for tests.

## 3.4 JSON and CSV

### JSON

`json` maps between Python objects and text: `dict` ↔ object, `list`/`tuple` ↔ array, `str` ↔ string, `int`/`float` ↔ number, `True`/`False` ↔ `true`/`false`, `None` ↔ `null`.

```python
import json

payload = {"id": 1, "name": "Ada", "active": True, "score": None}
text = json.dumps(payload)                  # '{"id": 1, "name": "Ada", ...}'
text = json.dumps(payload, indent=2, ensure_ascii=False)  # file-friendly
data = json.loads(text)                     # back to a dict
```

File helpers:

```python
from pathlib import Path
import json

def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

def load_json(path: Path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)
```

Details and pitfalls:

- `json.dumps(x, indent=2)` is for humans (configs, fixtures, debugging). Compact output is for transport and storage. Trailing newline makes file diffs cleaner.
- `ensure_ascii=False` writes real Unicode characters instead of `\uXXXX` escapes.
- Invalid JSON raises `json.JSONDecodeError` (a subclass of `ValueError`): trailing commas, single quotes, comments, and unquoted keys are all invalid, unlike JavaScript object literals.
- Not every object is serializable. `datetime`, `Path`, `set`, and custom classes raise `TypeError` unless you convert them yourself (`dt.isoformat()`, `str(p)`, `sorted(s)`) or pass `default=str` (which can silently produce unhelpful output — prefer explicit conversion).
- Tuples serialize as arrays and come back as lists.
- `json.load(f)` reads from a file object; `json.loads(s)` reads from a string. The trailing `s` means "string."
- JSON key order is preserved on load because modern Python dicts preserve insertion order, but do not depend on it for correctness.
- NDJSON (one JSON object per line) is the standard for streams and logs: read line by line, `json.loads` each non-empty line.

Accessing nested payloads safely:

```python
name = data.get("user", {}).get("name") or "unknown"
```

This does not validate; it degrades gracefully. Validation is Chapter 5.

### CSV

CSV values are always strings once read; every number needs conversion. The `csv` module handles quoting, delimiters, and embedded newlines that naive `split(",")` breaks on.

```python
import csv

with Path("users.csv").open(encoding="utf-8", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        print(row["name"], int(row["age"]))
```

Writing:

```python
rows = [{"name": "Ada", "age": 36}, {"name": "Grace", "age": 45}]

with Path("out.csv").open("w", encoding="utf-8", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["name", "age"])
    writer.writeheader()
    writer.writerows(rows)
```

Rules:

- Open CSV files with `newline=""` so the module controls line endings; otherwise blank lines appear on Windows.
- `DictReader` uses the first row as keys. Values are strings; convert with `int`/`float`/custom parsers and expect `ValueError` on bad data.
- DictWriter writes fields in `fieldnames` order; missing keys error unless you pass `restval`, and extra keys error unless you pass `extrasaction="ignore"`.
- `csv.reader` yields lists; `DictReader` yields dicts. Dicts are usually clearer.
- Quoting is automatic: a field containing commas, quotes, or newlines is wrapped and quotes are doubled. Do not hand-roll CSV with `split`/`join`.
- For Excel-produced files, `encoding="utf-8-sig"` strips the BOM.
- For positional columns, empty cells become `""` (or `None` with `restval`); do not confuse `""` with missing.

Pandas (Chapter 7) is the right tool for large, numeric, multi-join datasets. The `csv` module is right for small, streaming, dependency-free processing.

## 3.5 Logging

`logging` is the standard diagnostic channel. `print` writes to stdout for interactive use; logging adds levels, timestamps, module names, and destinations, and can be configured without touching call sites.

```python
# app/client.py
import logging

logger = logging.getLogger(__name__)   # one logger per module, named after it

def fetch(url):
    logger.info("fetching %s", url)     # lazy % formatting
    ...
    logger.warning("slow response: %.2fs", elapsed)
```

```python
# app/main.py  (entry point only)
import logging

def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    ...
```

Rules and details:

- Use `logging.getLogger(__name__)` at module level. The name shows which module logged the message; libraries must never configure the root logger themselves.
- Call `logging.basicConfig()` exactly once, in the application entry point. Calling it again without `force=True` does nothing because handlers already exist. Library modules must not call it at all, or they hijack the host application's logging.
- Levels, in increasing severity: `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`. The root logger defaults to `WARNING`, which is why `logger.info` seems to "do nothing" before configuration.
- Prefer `logger.info("fetched %s in %.1fs", url, seconds)` over f-strings. The parameters are formatted only if the record is emitted, and the message stays a fixed template. In `logger.debug`, f-strings eagerly build expensive strings even when debug is off.
- Inside an `except` block, `logger.exception("failed to fetch %s", url)` logs the message plus traceback (`exc_info=True`). Use it instead of `logger.error` when you want the stack.
- Log enough context to diagnose without logging secrets: no API keys, tokens, passwords, or full headers. Redact before logging.
- Do not swallow exceptions with `except ...: pass`; log them or re-raise (Chapter 2).
- Structured logging (JSON lines) is standard for services: emit fields like `event`, `request_id`, `latency_ms` so log systems can query them. You can approximate it with a JSON formatter; full treatment is Chapter 8.
- Configuration can come from the environment: parse `LOG_LEVEL` with a safe fallback (`getattr(logging, name.upper(), logging.INFO)` after validating).
- Handlers determine destination (console, file, syslog); formatters determine the line format. `logging.basicConfig(handlers=[...])` or `dictConfig` wires them. Keep it simple until you need files and rotation.

## 3.6 Debugging and tracebacks

A traceback reads from the bottom up:

```text
Traceback (most recent call last):
  File "app/main.py", line 12, in <module>
    main()
  File "app/main.py", line 8, in main
    print(load(path)["items"])
          ~~~~^^^^^^^^^^^^^^^^
KeyError: 'items'
```

- The last line is the exception type and message: `KeyError: 'items'`.
- The line above it points at the failing expression, often with `^^^` markers.
- Frames are ordered oldest call first; every frame belonging to your code is a candidate for scrutiny. Third-party frames in the middle are usually victims, not causes.
- Chained exceptions show `The above exception was the direct cause of the following exception` (from `raise ... from e`) or `During handling of the above exception, another exception occurred` (implicit). Read the first chain link when the bottom error is a generic wrapper.

The workflow:

1. Read the bottom line. Identify the exception type and message.
2. Find the topmost frame inside your own code.
3. Check the values on that line (types, `None`, key presence) — most bugs are `None` where an object was expected or a missing key.
4. Reproduce minimally: copy the failing call into a scratch file with literal inputs.
5. Fix, then add a test (Chapter 4) so it cannot silently return.

Tools:

- `python -i script.py` drops into an interactive session after a crash with traceback state available.
- `breakpoint()` (Python 3.7+) starts the built-in debugger `pdb` at that line: `p` prints, `n` steps over, `s` steps into, `c` continues, `q` quits.
- `python -m pdb script.py` debugs from the first line.
- `logging` beats `print` for anything beyond one-off exploration because it can be left in place and configured at runtime.
- `assert` documents invariants while developing; it is removed under `python -O` and is not input validation (Chapter 2).

Error-type quick reference:

| Exception | Typical cause |
| --- | --- |
| `ModuleNotFoundError` | package not installed in the *active* environment, or wrong import path |
| `ImportError` | name does not exist in an existing module (often circular import) |
| `AttributeError` | object is not the type you think, frequently `None` |
| `TypeError: NoneType is not subscriptable` | a function returned `None` where a dict/list was expected |
| `KeyError` | dict key missing; use `.get` or fix upstream validation |
| `FileNotFoundError` | wrong working directory or typo; anchor with `Path(__file__)` |
| `json.JSONDecodeError` | malformed JSON (trailing comma, single quotes) |
| `ConnectionError`/`Timeout` | network, DNS, firewall, or missing timeout handling |

## 3.7 HTTP requests with `httpx`

`httpx` is a modern synchronous-and-asynchronous HTTP client. Chapter 6 uses its async API; here is the synchronous side, which is all you need for scripts and many services.

```python
import httpx

response = httpx.get("https://api.example.com/users/1", timeout=10.0)
print(response.status_code)          # 200
data = response.json()               # parses JSON body
print(response.headers["content-type"])
```

Always check status and set an explicit timeout:

```python
def fetch_user(user_id: int) -> dict:
    response = httpx.get(f"https://api.example.com/users/{user_id}", timeout=10.0)
    response.raise_for_status()      # raises httpx.HTTPStatusError for 4xx/5xx
    return response.json()
```

Rules:

- Never leave timeouts implicit. `httpx` defaults to 5 seconds per phase (unlike `requests`, which defaults to no timeout), but production code should state its budget: `timeout=httpx.Timeout(10.0, connect=5.0)` or the simple `timeout=10.0`.
- `response.raise_for_status()` is the shortest path to "fail on HTTP errors." Without it, a 500 response body flows onward as if it were valid data.
- `response.json()` raises `json.JSONDecodeError` on invalid JSON. Do not assume the body is JSON just because the request succeeded.
- `response.text` decodes using the response charset; `response.content` is raw bytes.

### Reuse connections with a Client

```python
with httpx.Client(base_url="https://api.example.com", timeout=10.0) as client:
    users = client.get("/users").raise_for_status().json()
    user = client.get(f"/users/{users[0]['id']}").raise_for_status().json()
```

- A `Client` pools connections and carries shared configuration (`base_url`, headers, auth, timeouts). Creating a client per request forfeits pooling and is the most common performance mistake.
- Always close it with `with` or `client.close()`; Chapter 6 makes the async equivalent explicit.
- Pass query parameters with `params=` and JSON bodies with `json=` (which sets `content-type: application/json` and serializes the object):

```python
client.post("/users", json={"name": "Ada"}, params={"notify": "true"})
```

### Errors and retries

```python
import httpx

try:
    response = client.get("/users/1")
    response.raise_for_status()
except httpx.HTTPStatusError as e:
    if e.response.status_code < 500:
        raise                # 4xx: not retryable, fix the request
    raise
except httpx.TimeoutException:
    ...                      # connect/read timeout
except httpx.RequestError:
    ...                      # DNS, connection refused, TLS, and other transport failures
```

Hierarchy: `httpx.HTTPError` is the base; `HTTPStatusError` covers bad statuses; `RequestError` (with `TimeoutException`, `ConnectError`, ...) covers transport problems. Catch the narrowest type that matches your policy.

Retry only transient failures (timeouts, connection resets, 429, 5xx), with a small bounded number of attempts and a delay. Never retry a 400, 401, or 404. Chapter 8 builds the full retry policy; the pattern is a `for` loop with `break`/`continue` and a final raise.

Security hygiene: never log the `Authorization` header or full request/response bodies by default; redact secrets when logging headers.

## 3.8 Command-line scripts and configuration validation

`argparse` is the standard-library CLI framework. Even a 20-line script benefits from named, typed arguments.

```python
import argparse
import sys

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import records from an API.")
    parser.add_argument("input", help="path to the input JSON file")
    parser.add_argument("--limit", type=int, default=100, help="max records (default: 100)")
    parser.add_argument("--output", default="out.json", help="output path")
    parser.add_argument("--verbose", action="store_true", help="enable debug logging")
    return parser

def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    ...
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

Conventions that make scripts testable and scriptable:

- `main(argv=None)` takes arguments explicitly; `parse_args(None)` reads `sys.argv`. Tests call `main(["--limit", "5", "in.json"])` without spawning a process.
- Return an exit code (`0` success, `1` expected failure) and let the `__main__` guard call `sys.exit`. This makes shell automation reliable.
- `argparse` handles `--help`, `type=int` conversion, and missing required arguments for you. A bad value exits with code 2 and prints usage.
- Positional arguments for the primary inputs; options with `--` for everything else. Give every option a default or make it `required=True`.
- Precedence when combining CLI flags, environment variables, and defaults: explicit CLI flag > environment variable > built-in default. Implement one merge function with that order, at startup.
- Validate the assembled configuration in one place before doing any work; print all problems, use clear messages, and exit non-zero. Do not discover a bad URL after fetching half a dataset.
- `--verbose` conventionally lowers the log level; wire it to `logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO)`.
- Write help text as if it were documentation: it is the first thing users run.

A typical main flow:

```python
def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(name)s %(message)s")
    logger = logging.getLogger("app")

    try:
        settings = load_settings(dict(os.environ))
    except ConfigError as e:
        logger.error("configuration error: %s", e)
        return 1

    try:
        records = load_input(Path(args.input))
    except FileNotFoundError:
        logger.error("input file not found: %s", args.input)
        return 1

    save_json(Path(args.output), records)
    logger.info("wrote %d records to %s", len(records), args.output)
    return 0
```

## 3.9 Common mistakes and idioms

Mistakes to avoid:

1. Running bare `pip install` or `python` from outside the virtual environment.
2. Committing `.venv/`, `.env`, or absolute paths.
3. `bool(os.getenv("DEBUG"))` — every non-empty string is truthy.
4. Reading configuration all over the codebase instead of once at startup into a settings object.
5. `json.dumps` on `datetime`/`set` without conversion; expecting JavaScript object literals to parse.
6. Hand-parsing CSV with `split(",")`; forgetting `newline=""`.
7. `open()` / `write_text` without `encoding="utf-8"`.
8. Relative paths that depend on the working directory instead of `Path(__file__)`.
9. `print` for diagnostics in libraries; `basicConfig` in libraries; f-strings in `logger.debug`.
10. Logging secrets or full headers.
11. HTTP calls without timeouts or without `raise_for_status()`.
12. Creating a new `httpx.Client` per request inside a loop.
13. Retrying permanent failures (4xx) or retrying forever.
14. CLI scripts with no exit codes, or `main()` that reads `sys.argv` directly, making tests spawn processes.
15. Validating configuration lazily, producing deep, confusing errors.

Idioms to adopt:

- `python -m venv .venv` + `python -m pip install -e ".[dev]"` for a reproducible baseline.
- `python -m pip freeze > requirements.txt` to snapshot an environment that must run elsewhere.
- `Path(__file__).resolve().parent` for code-anchored paths.
- `Path.mkdir(parents=True, exist_ok=True)` before writes.
- `json.dumps(data, indent=2, ensure_ascii=False) + "\n"` for committed JSON.
- `csv.DictReader`/`DictWriter` with `newline=""`.
- `logger = logging.getLogger(__name__)` per module; configure logging once in `main`.
- `response.raise_for_status()` immediately after every client call.
- `main(argv=None) -> int` plus `sys.exit(main())` for every script.

---

# Exercises

Work each exercise before running commands or code. Groups are ordered from recognition to implementation; within each group, difficulty increases. Do not look up answers — predict, run, reconcile, then rewrite from memory.

## Group A — Virtual environments and dependencies

**A1.** Put these steps in the correct order and write the exact commands: create the environment, activate it, install the pinned dependencies from `requirements.txt`.

**A2.** Explain why the command `pip install httpx` can install the package into the wrong interpreter, and write the safe form of the command.

**A3.** A developer ran `pip install httpx` successfully, but the script still fails with:

```text
ModuleNotFoundError: No module named 'httpx'
```

List two likely causes and the two commands that would confirm the active interpreter and the package location.

**A4.** Write the activation command for Linux/macOS and for Windows PowerShell, the command to confirm which Python is active, and the command to leave the environment.

**A5.** State which command produces a reproducible snapshot of an application's full dependency graph, and when a hand-curated manifest is preferable.

**A6.** For each requirement line, state the allowed versions: `httpx==0.27.2`, `httpx~=0.27.2`, `httpx>=0.27`. Then write an exact pin for version `1.4.2` and a compatible-release pin for the same version.

**A7.** Explain what `python -m pip install -e .` does and describe one workflow where it is clearly better than `pip install .`.

**A8.** Classify each item as "commit" or "git-ignore" and justify in one line each: `.venv/`, `requirements.txt`, `.env`, `.env.example`, `__pycache__/`, `pyproject.toml`, `data/output.json`.

**A9.** Write a minimal `pyproject.toml` for an application named `importer` that requires Python 3.11+, depends on `httpx` version 0.27.x, and has a `dev` extra with `pytest`.

**A10.** Write the commands to list outdated packages and to upgrade only `httpx`. Explain in two sentences why upgrading all packages blindly before a release is risky.

**A11.** A team member reports that tests pass locally but fail in CI with different `httpx` behavior. Explain the most likely cause and the two-line fix.

**A12.** Explain the difference in upper bounds between `httpx~=0.27.2` and `httpx~=0.27`, and state which one allows `0.28.0`.

**A13.** Write the `uv` equivalents of `python -m venv .venv`, `python -m pip install -r requirements.txt`, and `python -m pip install httpx`.

**A14.** Explain why committing `.venv/` is a bad idea (give three distinct reasons).

**A15.** Translate these `package.json` concepts to their Python equivalents: `dependencies`, `devDependencies`, and `scripts`.

**A16.** A script works when the shell is at the project root but fails with `FileNotFoundError` from any other directory. Name the class of bug and the one-line approach that fixes it permanently.

**A17.** Write the sequence of commands a new contributor must run after cloning a repository that uses `.venv`, `requirements.txt`, and a `.env.example`, ending with running `python -m app.main`.

## Group B — Project structure, configuration, environment variables, and secrets

**B1.** Predict all three printed values (the third raises; name the exception):

```python
import os

os.environ["TIMEOUT"] = "30"
print(os.getenv("TIMEOUT", "10"))
print(os.getenv("MISSING", "10"))
print(os.environ["MISSING"])
```

**B2.** Predict the output and the exact exception, then fix the line so it works whether `PORT` is set or not:

```python
import os

os.environ.pop("PORT", None)
port = int(os.getenv("PORT"))
print(port)
```

**B3.** Explain the bug and write a correct boolean parser:

```python
import os

if os.getenv("DEBUG"):
    print("debug mode")
```

The variable may be `"true"`, `"false"`, `"1"`, or `"0"` (any case).

**B4.** Write `parse_bool(value: str) -> bool` that accepts `"1"`, `"true"`, and `"yes"` case-insensitively as `True`, and everything else as `False`. State the results for `"True"`, `"FALSE"`, `" yes "`, and `""`.

**B5.** Given this `.env` file, write the two lines of startup code that load it and read `BASE_URL` with a default:

```text
API_KEY=sk-local-dev
BASE_URL=https://staging.example.com
```

**B6.** For each item, state whether it is committed to git and why: `.env`, `.env.example`, an API key pasted into `tests/test_client.py`, a token inside a code comment.

**B7.** Write `load_settings(environ)` returning a `Settings` dataclass with `api_key`, `port`, and `base_url`. Collect all errors (missing key, non-integer or out-of-range port, non-http URL) and raise a single `ConfigError` naming each problem. Do not include secret values in messages.

**B8.** Explain why this module is hard to test, then refactor it so configuration is passed in rather than read at import time:

```python
# settings.py
import os

settings = {
    "api_key": os.environ["API_KEY"],
    "timeout": int(os.getenv("TIMEOUT", "10")),
}
```

**B9.** Implement precedence: an explicit CLI value beats the environment variable, which beats the default. Write `resolve_timeout(cli_value, environ, default=10)` handling string conversion and bad values.

**B10.** Write `mask_secret(value, keep=4)` returning a masked form like `sk-l...abcd` for long values and `"***"` for short ones. Then state why logging the full key is unacceptable.

**B11.** Fix this log statement so the secret never appears in logs:

```python
logger.info("calling API with key %s", api_key)
```

**B12.** Write the error message for a missing required environment variable so it names the variable but never prints a value. Then write the message for an invalid `PORT` that includes the offending value.

**B13.** Explain why this works locally but breaks the moment the service moves environments, and rewrite it:

```python
BASE_URL = "http://localhost:8000"
```

**B14.** Build a frozen `Settings` dataclass from a mapping, validating that `LOG_LEVEL` is one of `DEBUG`, `INFO`, `WARNING`, `ERROR`, defaulting to `INFO` with no error when absent.

**B15.** Write the `.env.example` file for an app needing `APP_API_KEY`, `APP_BASE_URL`, `APP_TIMEOUT`, and `APP_LOG_LEVEL`, with comments documenting each.

**B16.** Explain why generic environment variable names like `TIMEOUT` and `TOKEN` cause collisions on shared machines, and rewrite them with an application prefix.

**B17.** Predict the value for `X=""` and explain when the idiom is a bug:

```python
value = os.environ.get("X") or "default"
```

**B18.** Explain why `load_dotenv()` belongs in the application entry point and not at the top of a shared library module.

**B19.** Write `main()` that loads settings, catches `ConfigError`, logs the message, and returns exit code 1. Show the `__main__` guard.

**B20.** Explain the difference between failing at startup with one clear `ConfigError` and failing later with `TypeError: int() argument must be a string...` inside a request handler. Give one concrete production consequence.

## Group C — Paths and files with `pathlib`

**C1.** Predict every printed value:

```python
from pathlib import Path

p = Path("data/raw/users.csv")
print(p.name)
print(p.stem)
print(p.suffix)
print(p.parent)
print(p.parent.parent)
print(p.with_suffix(".json"))
```

**C2.** Predict the value and type of `Path("a") / "b" / "c.txt"`, then write the expression converting it to a string.

**C3.** Write `write_utf8(path, text)` that creates any missing parent directories and writes the text with UTF-8 encoding, then `read_utf8(path)` returning the text. Show a round trip containing the character `é`.

**C4.** Predict what happens when `Path("missing.txt").read_text(encoding="utf-8")` runs, and rewrite the call to return `None` when the file is absent.

**C5.** For each of the four combinations, state whether it raises: `mkdir()` for a missing parent; `mkdir(parents=True)` for a missing parent; `mkdir()` when the directory exists; `mkdir(exist_ok=True)` when the directory exists.

**C6.** Write code that idempotently creates `data/raw` and `data/processed`; running it twice must not raise.

**C7.** Given this tree, write expressions that list (a) all entries of `data/`, (b) only `*.json` files under `data/`, (c) all `*.csv` files recursively, sorted for deterministic output:

```text
data/
├── raw/
│   ├── users.json
│   └── events.csv
├── processed/
│   └── summary.json
└── notes.txt
```

**C8.** Explain why the relative path below breaks when the script is run from another directory, and rewrite it anchored to the script's location:

```python
raw = Path("data/raw/users.json").read_text(encoding="utf-8")
```

**C9.** Given `app/config.py` in the layout below, write `PROJECT_ROOT` and `DATA_DIR` constants using `__file__`:

```text
app/
├── src/
│   └── app/
│       ├── __init__.py
│       └── config.py
└── data/
```

**C10.** Predict the printed path and explain the rule:

```python
from pathlib import Path

print(Path("/tmp") / "/etc/passwd")
```

**C11.** Predict the file contents after this code runs, then state what a second `write_text` call would do:

```python
from pathlib import Path

p = Path("log.txt")
p.write_text("one\n", encoding="utf-8")
with p.open("a", encoding="utf-8") as f:
    f.write("two\n")
```

**C12.** Explain why `read_text()` without `encoding="utf-8"` can produce different results on different machines, and state the rule you should follow.

**C13.** Write `safe_load_text(path, default=None)` returning the file's text or `default` when the path does not exist. It must not catch unrelated errors.

**C14.** Predict each value: `Path("file.csv").with_suffix("")`, `Path("archive.tar.gz").suffix`, `Path("archive.tar.gz").stem`, `Path("file").suffix`.

**C15.** Write `count_lines(path)` that streams the file line by line and returns the number of lines without loading the whole file into memory.

**C16.** Write `ensure_parent(path)` that accepts a target file path and creates its parent directory idempotently.

**C17.** Predict each boolean for `p = Path("data")` when `data` exists as a directory: `p.exists()`, `p.is_dir()`, `p.is_file()`.

**C18.** Predict the exception raised by writing to `out/report.txt` when `out/` does not exist, and give two different fixes.

**C19.** Write code using `tempfile.TemporaryDirectory()` that creates a file inside it, prints its path, and then proves the directory is gone after the `with` block.

**C20.** For a `.png` file, state whether to use `read_text` or `read_bytes` and why, then write the expression that returns the file size in bytes.

**C21.** Predict the result of `Path("data/../notes.txt").resolve()` given a project root of `/home/dev/project`, and explain what `resolve()` guarantees.

**C22.** Write a function `find_latest(directory, pattern)` returning the most recently modified file matching a glob, or `None` when nothing matches. Use `stat().st_mtime`.

## Group D — JSON

**D1.** Predict the exact string produced by `json.dumps({"b": 1, "a": True, "c": None})`. Note the spaces and the lowercase literals.

**D2.** Predict the printed values and their types:

```python
import json

data = json.loads('{"n": 1, "f": 2.5, "s": "x", "b": true, "z": null, "xs": [1, 2]}')
print(data["n"] + data["f"])
print(type(data["b"]), data["z"], type(data["xs"]))
```

**D3.** Predict the first three lines of `json.dumps({"id": 1, "name": "Ada"}, indent=2)` and state whether the key order survives the round trip.

**D4.** For each invalid snippet, name the exception and the JSON rule it breaks: `{"a": 1,}`, `{'a': 1}`, `{"a": 1} // comment`, `{a: 1}`.

**D5.** Write `save_json(path, data)` and `load_json(path)` helpers: pretty-printed, UTF-8, trailing newline, parent directories created. Show a round trip of a nested dict containing `"café"`.

**D6.** For each value, predict `json.dumps(value)` success or `TypeError`, and write a serializable replacement: `(1, 2)`, `{1, 2}`, `datetime.datetime.now()`, `Path("x.txt")`.

**D7.** Predict the difference between `json.dumps({"name": "café"})` and the same call with `ensure_ascii=False`.

**D8.** Predict the exact output of `json.dumps({"b": 2, "a": 1}, sort_keys=True)`.

**D9.** Given `response = {"data": {"items": [{"id": 7}]}}`, write one expression that returns `7` and one expression that returns `None` when any level is missing.

**D10.** State which function to use in each case: parsing from a string, parsing from an open file, producing a string, writing to a file.

**D11.** Parse this NDJSON text into a list of two dicts, skipping empty lines:

```python
text = '{"event": "start"}\n\n{"event": "stop"}\n'
```

**D12.** Given a custom `Point` class, write the conversion needed before `json.dumps` can serialize a `{"points": [Point(1, 2)]}` payload.

**D13.** Predict both booleans: `json.loads("[]") == []` and `json.loads("{}") == {}`. Then predict `json.loads('"hi"')`.

**D14.** A developer sees `TypeError: Object of type set is not JSON serializable`. Explain how to interpret this message and give two acceptable fixes.

**D15.** Explain when to use `indent=2` and when to use compact output, with one concrete example of each (committed config file versus HTTP body).

**D16.** Write `deep_get(data, keys, default=None)` that walks nested dicts by a list of keys and returns the default when any key is missing or a non-dict value is encountered.

**D17.** A JSON file written by another service contains an integer where your code expects a string. Write the boundary conversion that handles both without raising.

## Group E — CSV

**E1.** Given this CSV text, predict the exact list of dicts produced by `DictReader` (including types):

```text
name,age
Ada,36
Grace,45
```

**E2.** Explain the two symptoms caused by opening a CSV file without `newline=""`, and state the correct open call in all four arguments (mode, encoding, newline, file object).

**E3.** Predict the exact file contents written by this code:

```python
import csv
from pathlib import Path

rows = [{"name": "Ada", "age": 36}, {"name": "Grace", "age": 45}]
with Path("out.csv").open("w", encoding="utf-8", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["name", "age"])
    writer.writeheader()
    writer.writerows(rows)
```

**E4.** For a `DictWriter(fieldnames=["name", "age"])`, state what happens when a row lacks `"age"` and when a row has an extra `"email"` key. Give the parameters that change each behavior.

**E5.** Write `summarize_scores(path)` reading a CSV with columns `name,score` and returning `{"count": ..., "total": ...}` with scores converted to `int`. Decide and state what to do when a score is not numeric.

**E6.** Given an input CSV with columns `id,total`, write a function that writes a new CSV containing only rows with `total > 100`, preserving the header.

**E7.** Write the code to read a semicolon-delimited CSV into dicts, and state the exact parameter needed by both `csv.reader` and `DictReader`.

**E8.** Predict how `csv.writer` writes the values `"a,b"` and `'say "hi"'` into two fields. State the quoting rule for embedded quotes.

**E9.** Write `count_data_rows(path)` that returns the number of data rows (excluding the header) and returns `0` for a header-only file.

**E10.** A CSV has rows where `age` is empty. Predict what `int(row["age"])` raises, then write the parsing expression that falls back to `None`.

**E11.** Predict the shape and types of the first rows produced by `csv.reader` versus `csv.DictReader` for the same file.

**E12.** Write `write_rows(path, rows, fieldnames)` that writes a header and rows, ignores unknown keys, and writes empty cells for missing keys. Name the two DictWriter parameters used.

**E13.** Predict how `csv.writer` outputs a `None` value in a row, then state what you should write instead if you want an explicit empty string.

**E14.** Explain two signals that a CSV task has outgrown the `csv` module and should move to pandas (Chapter 7).

**E15.** An Excel-exported CSV shows the first dictionary key as `"\ufeffname"`. Explain the cause and the one-argument fix when opening the file.

**E16.** Write a complete mini ETL: read `raw.csv` with columns `id,name,total`, convert `id` and `total` to `int`, and write `clean.json` containing a list of dicts sorted by `id`. Include parent-directory creation and UTF-8 handling.

## Group F — Logging

**F1.** In `app/clients/llm.py`, state the exact logger name produced by `logging.getLogger(__name__)`.

**F2.** Predict which line is printed with no logging configuration:

```python
import logging

logger = logging.getLogger(__name__)
logger.info("info message")
logger.warning("warning message")
```

**F3.** Predict the output after this change, and explain the default level rule:

```python
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.info("info message")
logger.warning("warning message")
```

**F4.** Explain why a library module must never call `logging.basicConfig()`, and describe what goes wrong in an application that imports two libraries that both call it.

**F5.** Predict the effect of calling `logging.basicConfig(level=logging.DEBUG)` after the root logger already has handlers, and state how to force reconfiguration.

**F6.** List the standard levels in increasing severity, and state which levels are emitted when the root level is `WARNING`.

**F7.** Explain the practical difference between these two debug calls, and state which one you should write:

```python
logger.debug("payload: %s", build_payload())
logger.debug(f"payload: {build_payload()}")
```

**F8.** Write the code that logs an error with its traceback from inside an `except` block, using one call. Then state the difference between that call and `logger.error("failed")`.

**F9.** Predict what a bare `logger.exception("boom")` outside any exception handler produces in the traceback portion of the log, and explain why this is a bug.

**F10.** Given the format `"%(asctime)s %(levelname)s %(name)s %(message)s"`, predict the shape of the line printed for `logger.warning("disk almost full")` from logger `app.storage`.

**F11.** Explain why this code prints the same warning twice, and give the two standard ways to avoid duplicate handlers:

```python
import logging

logging.basicConfig(level=logging.INFO)
logging.getLogger().addHandler(logging.StreamHandler())
logging.getLogger("app").warning("hello")
```

**F12.** In a module `app/importer.py`, write the module-level logger and then the appropriate call for each event: service starting, transient failure being retried, request permanently failed with traceback.

**F13.** Replace the diagnostic `print` calls in this library function with logging at appropriate levels, given a module-level `logger`:

```python
def import_rows(rows):
    print("starting import")
    if not rows:
        print("WARNING: no rows")
        return 0
    print(f"imported {len(rows)} rows")
    return len(rows)
```

**F14.** Fix this log call so no credential is ever written, while keeping it useful for diagnosis:

```python
logger.debug("request headers: %s", dict(response.request.headers))
```

**F15.** Write `parse_log_level(name)` mapping `"debug"`, `"info"`, `"warning"`, `"error"` (any case) to the corresponding `logging` constants and falling back to `logging.INFO` for unknown values.

**F16.** Predict whether the debug line is emitted, and explain the rule about where logger levels are checked versus handler levels:

```python
import logging

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
child = logging.getLogger("app.child")
child.setLevel(logging.DEBUG)
child.debug("hidden?")
```

**F17.** Write the configuration that logs to both the console and `app.log` (UTF-8), with the same format string, using handlers passed to `basicConfig`.

**F18.** Explain in two sentences why structured (JSON) logs are preferred in deployed services over free-text messages, and name two fields a request log should include.

**F19.** A developer logs an entire settings object at startup. Identify the problem and rewrite the line to log only safe fields plus masked secrets.

**F20.** A shared module at import time runs `logging.basicConfig(level=logging.DEBUG)`. Explain two concrete problems this causes in a host application, and state where configuration belongs.

## Group G — Debugging and tracebacks

**G1.** For this traceback, state the exception type, the exact failing line, the likely root cause, and a one-line fix:

```text
Traceback (most recent call last):
  File "app/main.py", line 5, in <module>
    print(config["timeout"])
KeyError: 'timeout'
```

**G2.** For this traceback, name the exception type, the failing expression, and the most likely reason `data` is not subscriptable:

```text
Traceback (most recent call last):
  File "app/main.py", line 9, in <module>
    main()
  File "app/main.py", line 6, in main
    total = data["items"][0]["total"]
TypeError: 'NoneType' object is not subscriptable
```

**G3.** A traceback contains both `The above exception was the direct cause of the following exception` and a final `RuntimeError`. Explain which exception is the underlying problem, which is the wrapper, and why the output contains both.

**G4.** State which exception type best matches each symptom: calling a method on `None`; missing dictionary key; adding a number to a string; indexing past the end of a list.

**G5.** Given the G2 traceback, write the minimal scratch script that reproduces the error with literal data, and state what you would change to confirm the hypothesis.

**G6.** State what each `pdb` command does after `breakpoint()` stops execution: `p name`, `n`, `s`, `c`, `q`.

**G7.** Explain what `python -i script.py` does after a crash, and give one scenario where it is more effective than adding more `print` calls.

**G8.** Choose `print`, `logging`, or the debugger for each scenario and justify: a one-off experiment in the REPL; diagnosing an intermittent failure in a deployed service; understanding a loop that runs 200 times and fails at iteration 187.

**G9.** This function hides the real error. Rewrite it so the failure is not silently swallowed, using one of the two correct strategies from Chapter 2:

```python
def load_rows(path):
    try:
        return read_rows(path)
    except Exception:
        pass
```

**G10.** Distinguish `ModuleNotFoundError` from `ImportError` and classify each traceback fragment: (a) `No module named 'httpx'`; (b) `cannot import name 'fetch' from 'app.client'`.

**G11.** Rewrite this raise so the resulting traceback clearly shows both the context message and the original cause:

```python
try:
    port = int(raw)
except ValueError:
    raise ConfigError("bad port")
```

**G12.** A script fails with `FileNotFoundError` for `data/in.json` that exists. State two commands or print statements that would confirm the working-directory hypothesis.

**G13.** Predict the exact final line of the traceback produced by `int("x")`, and state which part of the message tells you the offending input.

**G14.** A JSON task fails with `json.JSONDecodeError: Expecting value: line 3 column 5 (char 42)`. Explain how to use the line, column, and character position to find the defect.

**G15.** Explain why the topmost frame in your own code is usually more interesting than the third-party frames below it in a library-internal traceback.

**G16.** A traceback shows a frame inside an installed package, and you suspect a version mismatch. State the two commands that show the installed version and where it lives.

## Group H — HTTP requests with `httpx`

**H1.** For a successful GET returning JSON, predict the types of `response.status_code`, `response.json()`, and `response.text`.

**H2.** Predict the exception and its attributes when calling `raise_for_status()` on a 404 response, then show the expression that retrieves the status code from the exception object.

**H3.** Explain what goes wrong downstream when a 500 response is used without `raise_for_status()`, and give one consequence specific to AI-provider APIs.

**H4.** State `httpx`'s default timeout and explain why production code should still set an explicit timeout budget.

**H5.** Explain the two costs of this pattern, and rewrite it to reuse connections:

```python
for user_id in range(10):
    response = httpx.get(f"https://api.test/users/{user_id}", timeout=10.0)
    process(response.json())
```

**H6.** Predict the URL produced by this request object:

```python
import httpx

request = httpx.Request("GET", "https://api.test/search", params={"q": "python", "page": 2})
print(request.url)
```

**H7.** Predict the content type and body produced by `client.post("/users", json={"name": "Ada"})`, then state the difference from `client.post("/users", data={"name": "Ada"})`.

**H8.** State which call to use when an API expects form-encoded parameters and which when it expects a JSON body.

**H9.** Given the httpx exception hierarchy (`HTTPError`, `HTTPStatusError`, `RequestError`, `TimeoutException`, `ConnectError`), state which base class catches: (a) only transport failures, (b) both bad statuses and transport failures, (c) only timeouts.

**H10.** Write `fetch_json(url, timeout=10.0)` using a module-level `Client` that raises on HTTP errors and returns parsed JSON. State what exception invalid JSON raises.

**H11.** Write a bounded retry loop around a client GET: retry only on 429 and 5xx, log a warning per retry, do not retry 4xx, and re-raise the final failure. Do not use external retry libraries.

**H12.** Predict the output of `response.headers["Content-Type"]` when the server sent `content-type: application/json`, and explain why the lookup works.

**H13.** Write the request that sends a bearer token, and the request that uses basic authentication, using `httpx` parameters rather than manual headers where available.

**H14.** Write the code that streams a large response and iterates its lines without loading the whole body into memory. State why `response.text` is unacceptable here.

**H15.** Write `redacted(headers)` returning a copy of a headers mapping where `Authorization` and `X-Api-Key` values are replaced with `"***"` (case-insensitive matching).

**H16.** Predict the full URL requested by `client.get("/users")` when the client was created with `base_url="https://api.test"`.

**H17.** Explain what `response.history` contains after following a redirect, and how to disable redirect following.

**H18.** A request fails with `httpx.ConnectError`. State three plausible causes and one check for each.

**H19.** Write `describe_error(e)` returning a short diagnostic string for each of: `HTTPStatusError`, `TimeoutException`, other `RequestError`. Include status code or reason where available, and never include request headers.

**H20.** Integrate with Chapter 2's exception taxonomy: write `get_with_retries(client, path, attempts=3)` where 5xx/429 become `TransientError`, other 4xx become `PermanentError`, and transport errors are retried as transient. Show the final raise after exhausting attempts.

**H21.** A 400 response arrives with a JSON error body. Write the code that extracts `error` from the body without raising when the body is not JSON or lacks the key.

**H22.** Fix these three problems in one rewritten function: no timeout, no status check, and logging of the full request body (which contains a secret):

```python
def create_user(name, token):
    response = httpx.post("https://api.test/users", json={"name": name, "token": token})
    logger.info("response: %s", response.text)
    return response.json()
```

## Group I — Command-line scripts and configuration validation

**I1.** Given this parser, predict each value printed for `argv = ["in.json", "--limit", "5"]`:

```python
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("input")
parser.add_argument("--limit", type=int, default=100)
args = parser.parse_args(["in.json", "--limit", "5"])
print(args.input, args.limit)
```

**I2.** State the exit code and output stream for `--help` and for a missing required positional argument.

**I3.** Predict what happens when the user passes `--limit abc` with `type=int`, including the exit code and where the message is written.

**I4.** Add to a parser: `--mode` restricted to `fast` or `slow` and required; `--verbose` as a boolean flag; `--output` defaulting to `out.json`. Show the three `add_argument` calls.

**I5.** Explain why `def main(argv: list[str] | None = None) -> int` is more testable than reading `sys.argv` inside the function body, and show how a test would call it.

**I6.** Write a complete script skeleton: `build_parser()`, `main(argv=None) -> int`, a `if __name__ == "__main__": sys.exit(main())` guard.

**I7.** Implement precedence for a `timeout` setting: explicit CLI value, then `TIMEOUT` environment variable, then default `10`. Write the merge function and show it with all three sources and with only the default.

**I8.** Write `validate(config)` returning a list of human-readable problems (missing `api_key`, non-positive `timeout`, URL without scheme). Then write `main` code that prints every problem to stderr and exits with code 1.

**I9.** Write the two lines that make `--verbose` lower the logging threshold to DEBUG, keeping INFO otherwise.

**I10.** Predict what happens when the user runs the script with no arguments at all, for a parser with one required positional `input`.

**I11.** Write a parser with subcommands `fetch` (taking `--url`) and `validate` (taking a positional `path`) using `add_subparsers`. Do not implement the commands; the parsed structure is the deliverable.

**I12.** A tool accepts configuration from a JSON file and from CLI flags. Write the load-and-merge order so that CLI flags win, and state which errors are fatal.

**I13.** Write the code that checks for a required API key, writes `config error: APP_API_KEY is not set` to stderr, and exits with code 1 without a traceback.

**I14.** Explain when `argparse` exits with code 2 versus when your code should exit with code 1, and write the line that produces a custom usage error from `argparse` itself.

**I15.** Given a program that finishes successfully, one that fails expected validation, and one invoked with a typo'd flag, state the exit code for each.

**I16.** JSON output from a CLI is diffed between runs in CI. Write the `json.dumps` call that makes output deterministic across runs, and name the two relevant parameters.

**I17.** Explain why functions called by `main` should return values and raise exceptions instead of calling `sys.exit`, and where the single `sys.exit` belongs.

**I18.** Write `build_parser()` for a script with sensible help text for every argument: a positional `config`, `--log-level` with choices and default, and `--dry-run`.

**I19.** A CLI reads `LOG_LEVEL` from the environment but the user passes `--log-level bogus`. State the desired behavior and implement the validation error.

## Group J — Mixed realistic tasks

These combine the whole chapter. Keep implementations small, use only the standard library plus `httpx` and `python-dotenv`, and make behavior deterministic where asked.

**J1.** Write the complete skeleton for a project called `importer`: directory tree, virtual environment commands, `pyproject.toml`, `.gitignore`, `.env.example`, `src/importer/__init__.py`, `src/importer/config.py`, `src/importer/main.py`, and the README "how to run" steps a new contributor would follow.

**J2.** Write a CLI `import_csv.py` that reads `raw.csv` with columns `id,name,total`, validates and converts `id` and `total` to `int`, writes `out.ndjson` (one JSON object per line) with a `--limit` option, prints a summary line, and uses distinct exit codes for bad input versus success.

**J3.** Write `fetch_report.py`: loads settings from the environment, fetches `GET {base_url}/report` with a timeout, saves the JSON body to `report.json` with `indent=2`, logs the elapsed time at INFO, and turns a missing API key into a configuration error with exit code 1. Time the call with `time.perf_counter()`.

**J4.** Write `load_config(environ, cli_args)` combining defaults, `.env` values, environment variables, and CLI flags (in increasing precedence), validating all fields and returning a frozen `Settings` dataclass. Collect every error into one `ConfigError`.

**J5.** Write `get_json(path)` using an `httpx.Client` with a retry policy (429/5xx retried, 4xx permanent), custom `TransientError`/`PermanentError` exceptions from Chapter 2, `raise_for_status`, JSON parsing, warning logs on retry, and no secret material in any log message.

**J6.** Write `validate_json_file.py`: an argparse CLI that loads a JSON file, reports `json.JSONDecodeError` with line and column, checks that the top level is a list of dicts with a required `"id"` integer key, prints a summary (`N records, M invalid`), and exits non-zero when invalid records exist.

**J7.** Write `log_stats(path)` reading a log file where each line starts with a level name (`INFO`, `WARNING`, `ERROR`) followed by a space and a message. Return a dict counting lines per level, ignoring malformed lines, and process the file line by line.

**J8.** Write a generator pipeline over an NDJSON file: `read_events(path)` yielding parsed dicts, skipping blank lines; then a function writing only events with `"level" == "error"` to `errors.ndjson`. Include a `--limit` on the number of written events.

**J9.** Write `merge_json_dir(directory)` that finds all `*.json` files recursively, loads each (which contains a list of records), merges them, sorts by `"id"`, logs one INFO line with the file count and record count, and writes `merged.json` with deterministic formatting.

**J10.** This script has three separate bugs. Find and explain all three, then rewrite it correctly:

```python
import httpx
import json
from pathlib import Path

def fetch_all(url, out="out.json"):
    response = httpx.get(url)
    data = response.json()
    Path(out).write_text(json.dumps(data))
    return len(data)

if __name__ == "__main__":
    print(fetch_all("https://api.test/items"))
```

**J11.** A script imports `httpx`, `dotenv`, and uses only the standard library otherwise. Write the pinned `requirements.txt` a deployer would use, and state why the `dotenv` import name differs from the package name.

**J12.** Build the end-to-end mini project described here, splitting it into at least three modules: a `config` module (env loading, validation), a `client` module (httpx `Client` with retries and `raise_for_status`), and a `main` module (CLI with `--input`, `--output`, `--limit`; reads CSV records; posts each to the API; writes results as NDJSON; logs progress at INFO; returns exit code 0 or 1). Configuration problems must exit 1 with a single clear message; transient errors must be retried; permanent API rejections must be logged per record and must not abort the run unless every record fails. Include the `__main__` guard.

**J13.** For the project in J12, write a `redact(value)` helper and apply it everywhere a key, token, header, or full request body could reach a log or an error message. Show three call sites.

**J14.** Two consecutive runs of your J12 tool produce byte-identical output files for identical inputs. Name every formatting and ordering decision that makes this true, and fix any place where your implementation depends on dict order or filesystem order.

**J15.** Explain, as if writing the README "Troubleshooting" section, the diagnosis steps for the three most common failures of the tool: `ModuleNotFoundError`, `FileNotFoundError`, and HTTP timeouts.

---

## Before moving on

Check yourself against the chapter outcome without looking back at the notes:

- Create, activate, and use a per-project virtual environment; install pinned dependencies reproducibly; explain what belongs in git.
- Lay out a project so configuration comes from the environment, is validated once at startup, and never leaks secrets into logs or errors.
- Read, write, and navigate files and directories with `pathlib`, always with explicit encoding and code-anchored paths.
- Parse and produce JSON and CSV correctly, including error cases and Excel quirks.
- Configure logging once in the entry point, use module loggers, and choose levels and lazy formatting deliberately.
- Read a traceback bottom-up, identify your own failing frame, reproduce minimally, and fix with a test in mind.
- Make HTTP calls with timeouts, `raise_for_status`, a reused client, bounded retries for transient failures only, and redaction.
- Write CLI scripts with `argparse`, testable `main(argv) -> int`, sensible exit codes, and aggregated configuration errors.

If any group felt slow, redo a subset of its exercises from scratch before continuing to Chapter 4.
