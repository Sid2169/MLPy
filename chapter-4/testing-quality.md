# Chapter 4 — Testing and Code Quality

Chapter 3 produced working projects. This chapter makes them verifiable: tests that run in one command, fail loudly when behavior changes, and replace manual "run it and look" verification. It covers `pytest`, assertions, fixtures, parametrization, exception and edge-case testing, temporary files, mocking external services, the unit/integration split, and the tooling around formatting, linting, and static type checking.

As in previous chapters, exercises have no answers, and worked examples in the lesson are teaching material.

## Contents

1. pytest basics
2. Assertions that explain failures
3. Fixtures
4. Parametrized tests
5. Testing exceptions and edge cases
6. Temporary files and test isolation
7. Mocking and isolating dependencies
8. Unit tests versus integration tests
9. Formatting, linting, and static type checking
10. Common mistakes and conventions
11. Exercises (Groups A–I)

---

## 4.1 pytest basics

`pytest` is the standard Python test runner. Install it and run it from the project root:

```bash
python -m pip install pytest
pytest              # collect and run everything
python -m pytest    # same, guaranteed to use this environment's pytest
```

Collection rules:

- Files named `test_*.py` or `*_test.py` are imported as test modules.
- Functions named `test_*` inside them are test functions.
- Classes named `Test*` may group tests; their methods named `test_*` run. Do not define `__init__` in test classes.
- Fixtures and helpers may live in the same file or in `conftest.py` (section 4.3).

```python
# tests/test_calculator.py
def add(a, b):
    return a + b

def test_add_positive_numbers():
    assert add(2, 3) == 5

def test_add_negative_numbers():
    assert add(-2, -3) == -5
```

There is no `TestCase` subclass, no `self.assertEqual`, and no test registration. A test passes if it returns without raising; it fails if an assertion fails or any exception escapes.

Useful invocations:

```bash
pytest -q                          # quiet output
pytest -v                          # one line per test
pytest -k "parse and not slow"     # select by name expression
pytest -x                          # stop at first failure
pytest --lf                        # rerun only previous failures
pytest -s                          # do not capture stdout
pytest tests/test_config.py::test_missing_key   # one test
pytest --durations=10              # slowest tests
```

Exit codes matter in CI: `0` all passed, `1` failures, `2` interrupted, `5` no tests collected. A misconfigured `testpaths` that collects nothing exits `5` and should fail a pipeline.

Configuration lives in `pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q"
markers = [
    "integration: tests that talk to real services (deselect with -m 'not integration')",
]
```

TypeScript comparison: pytest tests are plain functions; Jest's `describe`/`it` nesting is optional (a `Test*` class or plain functions and good names usually suffice), and `expect(x).toBe(y)` becomes `assert x == y`.

## 4.2 Assertions that explain failures

pytest rewrites `assert` statements to show the values involved, so no assertion library is needed.

```python
def test_merge_prefers_override():
    defaults = {"timeout": 10, "retries": 3}
    override = {"timeout": 30}
    merged = {**defaults, **override}
    assert merged["timeout"] == 30
    assert merged["retries"] == 3
```

On failure, pytest prints both sides of the comparison, including container contents. Make assertions specific:

- Assert the value you care about, not a vague truthiness: `assert result == []`, not `assert result`.
- Use `is None` / `is not None` rather than `== None` (Chapter 1).
- Compare floats with `pytest.approx`:

```python
import pytest

def test_float_sum():
    assert 0.1 + 0.2 == pytest.approx(0.3)
    assert 1.0 / 3 == pytest.approx(0.333, rel=1e-3)
```

- For exception messages, use `pytest.raises(..., match="...")` (section 4.5), remembering `match` is a regular-expression search.
- Assert one behavior per test. When the third of six assertions fails, the reader must figure out which behavior broke; several small tests report precisely.
- Prefer equality on whole structures (`assert result == expected`) over field-by-field checks: it fails with a readable diff and catches unexpected extra fields.

## 4.3 Fixtures

A fixture supplies a test's dependencies: prepared data, a configured object, a temporary directory, a fake client. Fixtures replace `setUp`/`tearDown` and are shared through `conftest.py`.

```python
# tests/conftest.py
import pytest

@pytest.fixture
def settings():
    return {"timeout": 10, "retries": 3}

@pytest.fixture
def client(settings):
    return FakeClient(timeout=settings["timeout"])

@pytest.fixture
def order():
    return {"id": 1, "items": ["a", "b"]}

@pytest.fixture
def order_repo():
    return OrderRepo()          # fresh per test
```

Tests request fixtures by parameter name:

```python
def test_client_uses_timeout(client, settings):
    assert client.timeout == settings["timeout"]
```

Semantics that matter:

- **Scope**: fixtures are function-scoped by default: a fresh value per test. `scope="module"` shares one instance across a module, `scope="session"` across the whole run. Shared state must be read-only, or tests will contaminate each other.
- **Setup and teardown**: a fixture that `yield`s gives the value, then resumes after the test for cleanup. Teardown runs even when the test fails.

```python
@pytest.fixture
def temp_client():
    client = Client()
    client.connect()
    yield client
    client.close()
```

- **conftest.py**: fixtures defined there are available to every test in that directory and below, with no imports. This is where project-wide fixtures belong.
- **Composition**: fixtures can depend on other fixtures; pytest resolves the dependency graph and orders setup/teardown correctly.
- **`tmp_path`**: a built-in fixture providing a unique `pathlib.Path` per test (section 4.6).
- **`monkeypatch`**: a built-in fixture that patches environment variables and attributes and undoes everything after the test (section 4.7).
- **`capsys`** captures stdout/stderr, **`caplog`** captures log records:

```python
def test_cli_prints_summary(capsys):
    main(["--limit", "0"])
    assert "wrote 0 records" in capsys.readouterr().out

def test_no_secrets_in_logs(caplog):
    caplog.set_level(logging.DEBUG)
    do_something(secret="sk-123")
    assert "sk-123" not in caplog.text
```

- **autouse** fixtures run for every test in scope without being requested. Use sparingly, for things like resetting global state; they hide dependencies.
- Fixtures returning a callable (factory fixtures) let a test build several differently-configured objects:

```python
@pytest.fixture
def make_user():
    created = []
    def _make(name="default", active=True):
        user = {"name": name, "active": active}
        created.append(user)
        return user
    yield _make
    # cleanup of created objects if needed
```

Do not share mutable state through module-level globals; the "fixture that returns a fresh object" pattern is the fix for order-dependent tests.

## 4.4 Parametrized tests

`@pytest.mark.parametrize` runs one test function many times, once per input row, with each case reported separately. This replaces loops and copy-pasted tests.

```python
import pytest

@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", True),
        ("a", True),
        ("ab", False),
        ("A man, a plan, a canal: Panama", True),
    ],
)
def test_is_palindrome(text, expected):
    assert is_palindrome(text) == expected
```

Rules and details:

- The first argument is a comma-separated string of parameter names (or a tuple/list of names); the second is a sequence of rows. Row values must match the names.
- Each row becomes a separate test id like `test_is_palindrome[text3-expected3]`; use `ids=["empty", "single", ...]` for readable names.
- Stacking decorators builds the cartesian product of the rows; the test runs once per combination. Watch the count.
- `pytest.param(...)` attaches an id or marks to one case:

```python
@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("1", True),
        ("true", True),
        pytest.param("bogus", False, id="unknown-is-false"),
    ],
)
def test_parse_bool(value, expected):
    assert parse_bool(value) == expected
```

- Choose cases that represent boundaries and equivalence classes, not every possible value: empty, single element, typical, boundary, invalid, duplicate, unicode, `None` where allowed.
- Never write `for` loops or conditionals inside a test body to cover cases; parametrize instead so each failure is independently reported and independently re-runnable.

## 4.5 Testing exceptions and edge cases

`pytest.raises` asserts that an exception is raised, and gives access to the exception object.

```python
import pytest

def test_parse_count_rejects_text():
    with pytest.raises(ValueError, match="invalid count"):
        parse_count("abc")

def test_rate_limit_error_carries_status():
    with pytest.raises(RateLimitError) as exc_info:
        classify(429)
    assert exc_info.value.status_code == 429
```

Details:

- `pytest.raises` passes when the raised exception is an instance of the given class or a subclass. Asserting the specific type (not `Exception`) keeps tests meaningful.
- `match` is a `re.search` on `str(exception)`. Regex metacharacters in the expected message must be escaped: `match=r"expected \(got 3\)"`.
- Exceptions raised in `setup` code inside the `with` block matter: only code after `with pytest.raises(...)` is under test; put the act on its own line.
- Use `exc_info.value` to check attributes. Assert type and message; avoid over-specifying wording unless the message is part of the contract.
- To assert that something succeeds, call it normally; a returned value is the implicit success assertion. (`pytest.raises(Exception)` as a "no exception" guard is wrong: any other exception also passes.)
- Edge-case checklist per function: empty inputs, single element, exact boundaries (0, 1, max), duplicates, whitespace/unicode, `None` where allowed, invalid types, and very large or very small numeric values.
- Test recurrence properties where possible: idempotence (`load(load(x)) == load(x)`), round trips (`load(dump(x)) == x`), and "does not mutate its input".

## 4.6 Temporary files and test isolation

Tests must not depend on the working directory, on files left by other tests, or on execution order. `tmp_path` gives each test a unique directory.

```python
import json

def test_save_and_load_json(tmp_path):
    path = tmp_path / "data" / "config.json"
    save_json(path, {"name": "café"})
    assert path.exists()
    assert load_json(path) == {"name": "café"}

def test_count_lines(tmp_path):
    path = tmp_path / "events.log"
    path.write_text("a\nb\nc\n", encoding="utf-8")
    assert count_lines(path) == 3
```

Rules:

- Never write test artifacts into the repository. The repository may be read-only in CI.
- `tmp_path` is cleaned up automatically; do not delete it yourself.
- `tmp_path_factory` (session-scoped) creates shared temporary directories for expensive, read-only fixtures.
- Code under test must accept a path argument or be anchorable with `Path(__file__)` (Chapter 3). A function that hardcodes `"data/in.json"` cannot be tested hermetically.
- If code reads the current directory, use `monkeypatch.chdir(tmp_path)` in the test to make the dependency explicit.
- Isolation is observable: every test should pass when run alone (`pytest tests/test_x.py::test_y`) and in any order (`pytest -p no:randomly` if a plugin shuffles). Order-dependent tests are bugs in the tests.
- Deterministic output matters: sort collections before asserting (Chapter 3), freeze timestamps with injected clocks, and seed random generators.
- For CLI code, call `main(["--input", str(tmp_path / "in.csv"), ...])` and assert the exit code and the written files. This exercises real file paths without spawning subprocesses.

## 4.7 Mocking and isolating dependencies

The first tool for testability is design: inject dependencies (Chapter 2) and pass configuration as arguments (Chapter 3). Then tests can substitute a fake instead of mocking internals.

```python
class FakeClient:
    def __init__(self):
        self.calls = []
        self.responses = {}

    def get(self, path):
        self.calls.append(path)
        return self.responses[path]

def test_service_uses_injected_client():
    client = FakeClient()
    client.responses["/users/1"] = {"id": 1, "name": "Ada"}
    service = UserService(client)
    assert service.fetch_user(1)["name"] == "Ada"
    assert client.calls == ["/users/1"]
```

Prefer small hand-written fakes for your own interfaces: they are explicit, readable, and refactor-safe.

### `monkeypatch`

`monkeypatch` changes environment variables, attributes, and the working directory, and restores everything automatically.

```python
def test_settings_from_env(monkeypatch):
    monkeypatch.setenv("API_KEY", "test-key")
    monkeypatch.setenv("TIMEOUT", "5")
    settings = load_settings(dict(os.environ))
    assert settings.timeout == 5.0

def test_missing_api_key(monkeypatch):
    monkeypatch.delenv("API_KEY", raising=False)
    with pytest.raises(ConfigError, match="API_KEY"):
        load_settings(dict(os.environ))

def test_locates_file_next_to_module(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    ...
```

`monkeypatch.setattr(module, "name", replacement)` temporarily replaces an attribute; the automatic undo makes it safer than manual assignment.

### `unittest.mock`

The standard library's mock objects are for external boundaries you do not control.

```python
from unittest.mock import Mock, patch

def test_notifier_sends_email():
    mailer = Mock()
    Notifier(mailer).notify("a@b.com", "hi")
    mailer.send.assert_called_once_with("a@b.com", "hi")

def test_retry_gives_up():
    fn = Mock(side_effect=TransientError("down"))
    with pytest.raises(TransientError):
        with_retries(fn, attempts=3)
    assert fn.call_count == 3
```

Key mechanics:

- `Mock()` accepts any attribute access and call. `mock.return_value = 5` makes `mock()` return `5`; `side_effect` may be an exception class, an exception instance, an iterable of results, or a function.
- `patch` replaces a name for the duration of a test. The target is the place where the object is looked up, not where it is defined: to patch `httpx.get` as used by `app.client`, patch `"app.client.httpx.get"` if `app.client` does `import httpx`.
- Prefer `patch(..., autospec=True)` so the mock enforces the real signature; it turns misspelled methods and wrong arity into immediate errors.
- Prefer the context-manager form (`with patch(...) as m:`) or a fixture over decorators when you need the mock object.
- Avoid asserting on internal calls when behavior can be observed instead. Tests that assert "we called `repo.find` then `repo.save`" break on every refactor; tests that assert the returned value do not.
- A mock attribute returns a `Mock`, not data. Errors like `TypeError: 'Mock' object is not subscriptable` mean a `return_value` is missing.

### Mocking HTTP with `httpx.MockTransport`

Instead of patching `httpx` internals, give the client a transport that returns canned responses. This exercises real request building, status handling, and retry logic with zero network access.

```python
import httpx

def make_client(handler, base_url="https://api.test"):
    return httpx.Client(transport=httpx.MockTransport(handler), base_url=base_url)

def test_retry_then_success():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if len(calls) < 3:
            return httpx.Response(500, json={"error": "boom"})
        return httpx.Response(200, json={"ok": True})

    with make_client(handler) as client:
        result = get_with_retries(client, "/items", attempts=3)

    assert result == {"ok": True}
    assert len(calls) == 3

def test_transport_failure():
    def handler(request):
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(TransientError):
        ...
```

This is the preferred way to test any code using `httpx` (Chapter 3) and the async client in Chapter 6: no `patch`, no network, full control over statuses, bodies, and raised transport errors.

## 4.8 Unit tests versus integration tests

- A **unit test** exercises one unit of logic with all dependencies faked or passed in. It is fast, deterministic, and has no external resources.
- An **integration test** exercises real wiring: a real file on disk, the actual client against a mock transport, a database, or a live API. It is slower and may be flaky or require credentials.

Practices:

- Keep the fast suite default: `pytest` runs everything marked as unit plus local integration.
- Separate tests that need the network or credentials with markers:

```python
@pytest.mark.integration
def test_live_api_round_trip():
    ...
```

```bash
pytest -m "not integration"     # fast, hermetic suite for every commit
pytest -m integration           # before release / nightly, with real credentials
```

- Skip when prerequisites are absent, naming the missing piece:

```python
@pytest.mark.skipif(not os.getenv("API_KEY"), reason="API_KEY not set")
def test_live_api():
    ...
```

- Tests against `httpx.MockTransport` are unit tests in spirit: they exercise the real code path without network variance. Reserve "integration" for things your process cannot fully control.
- A test needing `time.sleep`, retries against a real endpoint, or shared mutable state is a maintenance liability; rewrite toward injection and fakes.
- Smoke tests are integration tests too: run the CLI with `--help` or on a tiny sample and assert exit code `0`.

CI ordering: format check, lint, type check, unit tests, then (optionally) integration tests. Fail fast on the cheap checks.

## 4.9 Formatting, linting, and static type checking

Three distinct tools with three distinct jobs:

- **Formatter**: rewrites code to a canonical style. No judgment, no warnings. `ruff format` (compatible with `black`).
- **Linter**: flags probable bugs and style problems; can auto-fix some. `ruff check`.
- **Type checker**: verifies type hints without running code. `mypy` or `pyright`.

```bash
ruff format .                     # rewrite files
ruff format --check .             # exit 1 if files would change (CI)
ruff check .                      # report issues
ruff check --fix .                # apply safe fixes
mypy src                          # type-check the package
```

Configuration in `pyproject.toml`:

```toml
[tool.ruff]
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I"]          # pycodestyle errors, pyflakes, import sorting

[tool.mypy]
python_version = "3.11"
disallow_untyped_defs = true
warn_return_any = true
no_implicit_optional = true
```

What the type checker catches that tests often miss:

- Returning a value of the wrong type (`Incompatible return value type`).
- Using a value that may be `None`: `str | None` must be narrowed with `if x is None` before use.
- Mixing types in containers: `list[int]` receiving `list[str]`.
- Keyword typos in calls to typed functions (`unexpected keyword argument`), which untyped code only discovers at runtime.

Practical guidance:

- Type-check `src`, not `tests` (or relax test checking with a per-module override); test files are allowed to be untyped.
- Add `# type: ignore` only with a reason and a narrow scope; unexplained ignores accumulate as debt. Prefer fixing the annotation or the code.
- Keep `Any` rare; it disables checking for that value.
- Start gradual: annotate public functions and dataclasses first (Chapters 2 and 5); add strictness flags as the codebase complies.
- Run all three tools in pre-commit or CI so the repository state is always consistent and mergeable.

## 4.10 Common mistakes and conventions

Mistakes to avoid:

1. Asserting truthiness (`assert result`) when the exact value matters.
2. Sharing mutable state through module globals or class attributes; tests then pass only in a specific order.
3. Loop-based pseudo-parametrization inside a test.
4. Testing internal call sequences instead of observable behavior.
5. Patching where a name is defined rather than where it is looked up.
6. Mocks returning `Mock` objects and silently satisfying loose assertions.
7. Hitting real networks or sleeping in tests.
8. Depending on the working directory or writing into the repository.
9. Catching `Exception` in tests with `pytest.raises(Exception)`, turning "no test" into "passed".
10. Over-specifying exception messages with unescaped regex metacharacters in `match`.
11. Leaving debug `print` calls and disabled tests (`@pytest.mark.skip`) forever.
12. Letting format, lint, or type-check failures live in CI as "known issues".

Conventions to adopt:

- Test names describe behavior: `test_missing_api_key_raises_config_error`.
- One behavior per test; a test with six asserts usually wants to be six tests or a parametrized one.
- Arrange-act-assert structure, visually separated.
- Fixtures for setup; parametrize for data; fakes or `MockTransport` for boundaries.
- `tmp_path` for files, `monkeypatch` for environment, `caplog`/`capsys` for outputs.
- Run `pytest -q` constantly; before committing run `ruff format .`, `ruff check .`, `mypy src`, `pytest`.
- Add a regression test with every bug fix: reproduce the failure first, then fix.

---

# Exercises

Work each exercise before running code. Groups are ordered from recognition to implementation; within each group, difficulty increases. Do not look up answers — predict, run, reconcile, then rewrite from memory.

## Group A — pytest basics and assertions

**A1.** Given this tree, state which files pytest collects and why each of the others is ignored:

```text
tests/
├── test_utils.py
├── utils_test.py
├── utils.py
├── tests_helpers.py
└── test_utils.py.bak
```

**A2.** Which of these definitions are collected as tests, and why not for the others?

```python
def test_ok(): ...
def test_(): ...
def check_ok(): ...

class TestThing:
    def test_method(self): ...
    def helper(self): ...

class ThingTests:
    def test_x(self): ...
```

**A3.** For each assertion, predict pass or fail and the reason: `assert [1, 2] == [1, 2]`, `assert [1, 2] is [1, 2]`, `assert 1 == True`, `assert "1" == 1`, `assert (1, 2) == (1, 2)`.

**A4.** Predict exactly which assertion fails and what values pytest reports:

```python
def test_merge():
    result = {"a": 1}
    assert result["a"] == 2
    assert result["b"] == 1
```

**A5.** Rewrite this unittest-style test as idiomatic pytest:

```python
import unittest

class TestCalc(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(1, 2), 3)
```

**A6.** Write pytest tests for a `word_counts(text)` function that returns `{word: count}`. Cover a normal sentence, an empty string, and a string with extra whitespace.

**A7.** Predict pass or fail for each, and explain the surprising one:

```python
assert 0.1 + 0.2 == pytest.approx(0.3)
assert 0.1 + 0.2 == 0.3
assert 1 / 3 == pytest.approx(0.333)
```

**A8.** Write a test for `circle_area(radius)` using `pytest.approx` with an explicit `rel` tolerance, covering a small radius and a large one.

**A9.** Fix every weak or wrong assertion and explain each fix: `assert result == None`, `assert ok == True`, `assert len(items) > 0`, `assert items`.

**A10.** Given tests named `test_parse_ok`, `test_parse_slow`, `test_slow_mode`, `test_parser_ok`, and `test_other`, state which run under `pytest -k "parse and not slow"`.

**A11.** Explain what exit code `5` means and why a CI pipeline should treat it as a failure rather than a pass.

**A12.** With five tests where the second fails, describe the difference between running `pytest` and `pytest -x`.

**A13.** Write two tests for `divide(a, b)`: one for a normal result using `approx`, and one asserting that division flips the sign with a negative divisor.

**A14.** Write a `TestParseBool` class with two test methods, and state the naming rules a test class must satisfy (including what must not be defined).

**A15.** Write a test for `merge_defaults(defaults, overrides)` from Chapter 2 that asserts the returned value and that neither input dict was mutated.

**A16.** Explain why plain `assert` produces useful failure messages in pytest without importing any assertion library.

**A17.** This test passes but proves almost nothing. Rewrite it into at least three precise assertions:

```python
def test_parse_settings():
    result = parse_settings("host=x;port=8080;debug=true")
    assert result
```

## Group B — Fixtures

**B1.** Add a fixture returning a fresh list. Then write two tests that each append an item and assert the list length is 1. Explain why the second test does not see the first test's item.

**B2.** Write a `settings` fixture returning a dict, plus two tests that mutate it, demonstrating that each test receives an independent object.

**B3.** Predict the exact printed order under `pytest -s`, including what happens if the test fails:

```python
@pytest.fixture
def resource():
    print("setup")
    yield "r"
    print("teardown")

def test_a(resource):
    print("test a", resource)
```

**B4.** Given this layout, state which conftest fixtures are visible from `tests/unit/test_x.py` and from `tests/it/test_y.py`:

```text
tests/
├── conftest.py
├── unit/
│   ├── conftest.py
│   └── test_x.py
└── it/
    └── test_y.py
```

**B5.** Write two fixtures where `client` depends on `settings`, and a test that requests only `client` while still receiving the settings-provided values.

**B6.** Predict the values observed by each test with a `scope="module"` fixture, and state when the state resets:

```python
@pytest.fixture(scope="module")
def state():
    return {"n": 0}

def test_first(state):
    state["n"] += 1
    assert state["n"] == 1

def test_second(state):
    state["n"] += 1
    assert state["n"] == ??
```

**B7.** Write a fixture that creates a JSON file inside `tmp_path` and returns its path. Then write a test that loads it and checks a nested value.

**B8.** Write a factory fixture `make_user` with defaults `name="default"` and `active=True` that appends each created user to a list, and a test that creates two differently-configured users and asserts both.

**B9.** Predict whether an `autouse=True` fixture runs for a test that does not request it. State one legitimate use and one reason to avoid autouse.

**B10.** These tests pass alone but fail together. Explain why, and fix the design with a fixture:

```python
CACHE = {}

def test_add_to_cache():
    CACHE["a"] = 1
    assert CACHE["a"] == 1

def test_cache_starts_empty():
    assert CACHE == {}
```

**B11.** A fixture is defined in `tests/test_a.py` and requested by a test in `tests/test_b.py`, producing `fixture 'client' not found`. Explain why and give the two standard fixes.

**B12.** Write a fixture returning an environment mapping suitable for Chapter 3's `load_settings`, including `API_KEY` and `TIMEOUT`. Use it in a test asserting the parsed `Settings` values.

**B13.** Fixture `a` depends on fixture `b`. Predict the exact order of setup, test body, and teardown lines for both fixtures plus the test.

**B14.** Write two fixtures: a session-scoped `api_client` that is expensive to construct but read-only, and a function-scoped `fresh_state` for per-test data. Explain the scope choice for each.

**B15.** A test suite shares one client fixture with `scope="session"` that accumulates calls in a list. One test asserts the call count is zero and fails after another test runs. Diagnose and fix.

**B16.** A test function takes a parameter named `setting` while the fixture is named `settings`. Predict the error message pytest reports and the one-word fix.

**B17.** Write a `conftest.py` fixture `data_dir` that creates `raw/` and `processed/` inside `tmp_path` and returns the base path.

**B18.** Write a test using `caplog` asserting that a function logs the request URL at INFO and never logs the word `token` or the secret value.

**B19.** Write a test using `capsys` asserting that `main(["--limit", "0"])` prints a summary line containing `wrote 0 records`.

**B20.** Write a fixture that yields a fake HTTP client recording requested paths, and two tests that use it: one asserting the recorded paths, one asserting the returned data.

**B21.** Explain the difference between a fixture that returns a value and one that yields, and when teardown code is mandatory.

## Group C — Parametrized tests

**C1.** How many test cases does each run: a single `parametrize` with 3 rows; two stacked decorators with 3 and 2 rows; a single decorator with 4 rows and `ids` provided?

**C2.** Write parametrized tests for `parse_bool` with at least five cases and readable ids, including an invalid value that maps to `False`.

**C3.** Convert this loop-based test into a parametrized one:

```python
def test_split():
    for text, expected in [("a b", ["a", "b"]), ("  ", []), ("a  b", ["a", "b"])]:
        assert text.split() == expected
```

**C4.** Rewrite this decorator using the tuple-of-names form and explain the difference in readability:

```python
@pytest.mark.parametrize("a,b,expected", [(1, 2, 3), (0, 0, 0)])
def test_add(a, b, expected):
    assert add(a, b) == expected
```

**C5.** Add `ids=["empty", "single", "unicode"]` to a parametrized test and state how the test IDs change.

**C6.** Mark one row of a parametrized test as expected-to-fail with `pytest.param(..., marks=pytest.mark.xfail)`. Predict how pytest reports that row versus the others.

**C7.** A failure is reported as `test_divide[3-5]` for `@pytest.mark.parametrize("a,b", ...)`. State which values were used in the failing case and how the id was formed.

**C8.** Write the full parametrize table for `chunk(items, size)` covering: exact multiple, remainder, `size` larger than the input, and `size=1`. Include the expected output for each.

**C9.** Write a parametrized test that expects exceptions, with rows shaped `(value, exception_type)`, using `pytest.raises(exc)` inside the test body.

**C10.** Write a test with two stacked `parametrize` decorators of sizes 2 and 3. State the total number of cases and describe the id format.

**C11.** Write parametrized cases for `normalize_text` including `None` handling if the function supports it, empty string, and whitespace-only input. If the function does not support `None`, write the case as expected-to-raise instead.

**C12.** Write a parametrized round-trip test `save_json`/`load_json` over `tmp_path` using cases: a nested dict, an empty dict, and a dict with unicode text. Signature: `def test_round_trip(tmp_path, data)`.

**C13.** State the difference between these two decorators and when each is clearer:

```python
@pytest.mark.parametrize("a,b", [(1, 2), (3, 4)])
@pytest.mark.parametrize(("a", "b"), [(1, 2), (3, 4)])
```

**C14.** Write a parametrized test for `word_counts` that asserts the full output dict for inputs containing repeated words, punctuation-adjacent words, and mixed case (define the function's normalization from Chapter 1 if needed).

**C15.** Write a parametrized test for an `average(xs)` function using `pytest.approx` for two cases with repeating decimals and one exact case.

**C16.** This table has redundant rows that test the same behavior twice. Identify them and replace them with genuinely distinct boundary cases:

```python
@pytest.mark.parametrize("n,expected", [(2, 4), (3, 9), (4, 16), (5, 25), (6, 36)])
def test_square(n, expected):
    assert n * n == expected
```

## Group D — Testing exceptions and edge cases

**D1.** Write a test asserting `parse_count("abc")` raises `ValueError` whose message contains `invalid count`.

**D2.** Predict pass or fail and explain:

```python
with pytest.raises(ValueError, match="invalid"):
    raise ValueError("Invalid input")
```

**D3.** Given an `ApiError` with a `status_code` attribute, write a test using `pytest.raises(...) as exc_info` that asserts both the type and the status code.

**D4.** Write a test that would catch a function accidentally raising on valid input, and explain why wrapping the call in `pytest.raises(Exception)` is wrong as a success check.

**D5.** `classify(429)` raises `RateLimitError`, a subclass of `ProviderError`. Predict whether `pytest.raises(ProviderError)` passes or fails, and whether that is desirable.

**D6.** `parse_pair("k=")` returns `(None, None)` instead of raising (Chapter 2). Write the tests that pin this contract for both the missing-`=` case and a valid case.

**D7.** Write an edge-case table for `first_negative(xs)`: empty list returns `None`, single negative, single positive, all negative, and mixed with the negative last.

**D8.** Predict what `assert float("nan") == float("nan")` does in a test, then write the correct assertion using `math.isnan`.

**D9.** Write a test that invalid JSON raises `json.JSONDecodeError`, deliberately without `match`, and explain why the message is a poor assertion target here.

**D10.** Parametrize tests for a `Port` class (Chapter 2): valid values `1` and `65535`; invalid values `0`, `65536`, and `-1` raising `ValueError`.

**D11.** Explain when to assert only the exception type, when to add a message fragment, and when asserting the full message is a mistake.

**D12.** Write a test proving `add_tag(tags, tag)` does not mutate the input list, plus a test for its return value.

**D13.** Write an idempotence test showing `load_config(raw)` produces equal results when called twice on the same input.

**D14.** Write a test showing `safe_int("x", default=7)` returns `7` and does not raise.

**D15.** This test asserts internal calls instead of behavior. Rewrite it to assert the observable result, and explain the maintenance benefit:

```python
def test_fetch_user(mocker):
    repo = Mock()
    service = UserService(repo)
    service.fetch_user(1)
    repo.find.assert_called_once_with(1)
```

**D16.** Write a test asserting that an error message includes the offending value `3` in a way that still works when the message gains surrounding text. Use a string-matching assertion with proper escaping, or a substring check on `str(exc_info.value)`.

**D17.** A function must reject an empty `name` with a message naming the field. Write both the positive and negative tests, ensuring the negative one cannot pass when a different error is raised.

## Group E — Temporary files and test isolation

**E1.** Write a test that writes text to a file under `tmp_path` and reads it back, asserting round-trip equality with UTF-8 content.

**E2.** Predict whether two tests can share the same `tmp_path` directory or see each other's files.

**E3.** Rewrite this test so it does not use the repository's working directory, and explain what breaks in CI with the original:

```python
def test_generate_report():
    generate_report("report.json")
    assert Path("report.json").exists()
```

**E4.** Write a test for `count_lines(path)` creating a three-line file inside `tmp_path`.

**E5.** Write a test for `save_json`/`load_json` that asserts the round trip, verifies the file ends with a newline, and uses a nested structure with a `"café"` string.

**E6.** Test A writes `test_output.txt` next to the test file; test B reads it. Describe two ways this suite fails depending on how it is run.

**E7.** A test relies on the current working directory to find `data/in.json`. Fix the test using `monkeypatch.chdir(tmp_path)` plus a file created in `tmp_path`, and explain why the original approach was order-dependent.

**E8.** Write a CSV file inside `tmp_path` using `newline=""` and read it with `csv.DictReader`; assert the full list of dicts including that values are strings.

**E9.** Write a session-scoped fixture using `tmp_path_factory` that creates a read-only corpus directory, plus a function-scoped test that copies one file from it before mutating.

**E10.** Two tests both create `tmp_path / "data.json"` with different contents. Predict whether they can interfere, and explain the mechanism.

**E11.** Write an end-to-end CLI test: create an input CSV in `tmp_path`, call `main(["--input", str(inp), "--output", str(out), "--limit", "2"])`, assert the exit code is `0`, and assert the output JSON contains exactly two records.

**E12.** Explain why you should not delete `tmp_path` manually at the end of a test.

**E13.** Write a test asserting that two runs of `save_json` on the same data produce byte-identical files (deterministic formatting), and name the two formatting decisions that make this true.

**E14.** Write a test proving a function writes only under the output directory you pass: create a sentinel directory inside `tmp_path`, run the function with its output path inside a different subdirectory, and assert the sentinel directory is still empty while the expected file exists.

**E15.** Explain the difference between `tmp_path` and `tmp_path_factory`, and state the scope of each.

## Group F — Mocking and isolating dependencies

**F1.** Explain why the injected-client design from Chapter 2 usually removes the need for mocking, and rewrite this test to use a hand-written fake instead of patching:

```python
def test_service(mocker):
    mocker.patch("app.service.httpx.get", return_value=Mock(json=lambda: {"id": 1}))
    assert UserService().fetch_user(1)["id"] == 1
```

**F2.** Write a test using `monkeypatch.setenv` that sets `API_KEY` and `TIMEOUT`, calls `load_settings(dict(os.environ))`, and asserts the parsed values.

**F3.** Predict what `monkeypatch.delenv("API_KEY")` does when the variable is absent, and write the call that does not raise in that case.

**F4.** Write a test using `monkeypatch.setattr` to replace a module function with a fake, call the dependent code, and assert the fake's recorded arguments. State when the real function is restored.

**F5.** `app/service.py` contains `from app.client import fetch`. Explain why patching `app.client.fetch` may not affect the service, and write the correct `monkeypatch.setattr` target.

**F6.** Write a `FakeMailer` class with a `sent` list and a `send(to, body)` method, plus a test for `Notifier(mailer)` that asserts the message was sent without using `unittest.mock` at all.

**F7.** Predict the value and type of each: `Mock(return_value=5)()`, `Mock()()`, `Mock(return_value=[1, 2])().append`.

**F8.** Predict what the third call does for `fn = Mock(side_effect=[10, 20])`, and what `Mock(side_effect=ValueError("x"))` does when called.

**F9.** `app/client.py` does `from httpx import get`. A test patches `"httpx.get"` and the real network call still happens. Explain why, and write the correct patch target.

**F10.** Write a test using `patch` as a context manager that replaces a function, runs the code, and asserts `assert_called_once_with` with exact arguments.

**F11.** Explain what `patch("app.client.httpx.get", autospec=True)` enforces, and predict what happens when the test calls the mock with the wrong number of arguments.

**F12.** Write a test for `fetch_json(url)` using `httpx.MockTransport` whose handler returns `httpx.Response(200, json={"ok": True})`, asserting the parsed result. No real network call may occur.

**F13.** Write a test where the transport returns status 500 and the code calls `raise_for_status()`, asserting the exception type and the status code from the exception.

**F14.** Write a test where the transport handler raises `httpx.ConnectError("refused", request=request)`, asserting your code converts it to `TransientError` (Chapter 2's taxonomy).

**F15.** Using a transport handler that appends to a list, write a test asserting a retry helper made exactly three attempts when the first two responses were 500 and the third was 200.

**F16.** Explain why this test is better without any mock, and rewrite it to call the real loader:

```python
def test_config(monkeypatch):
    monkeypatch.setattr("app.config.load_settings", lambda env: Settings("k", 1, "u", 3))
    assert get_timeout() == 1
```

**F17.** This test breaks every time the service is refactored. Explain why, and rewrite it to assert observable behavior:

```python
def test_process(mocker):
    repo, sender = Mock(), Mock()
    service = Service(repo, sender)
    service.process({"id": 1})
    repo.find.assert_called_once_with(1)
    repo.save.assert_called_once()
    sender.send.assert_called_once()
```

**F18.** Write `get_with_retries(client, path, attempts=3)` tests for the happy path and for one retry before success, using `MockTransport` and counting handler invocations.

**F19.** Write the test asserting a 400 response becomes `PermanentError` immediately, with exactly one attempt made.

**F20.** Predict whether `with MagicMock() as client:` works and what `client.get("/x")` returns, then write a two-line test setup that makes `client.get("/x").json()` return `{"id": 1}`.

**F21.** A test fails with `TypeError: 'Mock' object is not subscriptable` on `response.json()["id"]`. Diagnose the cause and show the one-line fix.

**F22.** Write a test that pins time: patch the clock used by `app/report.py` (`import time`, calls `time.time()`) so `generate_report()` writes a deterministic timestamp. Name the patching rule you applied.

**F23.** Write a test using `caplog` and a 500-then-200 transport that asserts one WARNING was logged per retry and that the warning contains the status code.

**F24.** Explain why replacing `open` with a mock is worse than using `tmp_path`, in two concrete ways.

**F25.** A test mocks `datetime.datetime.now()` at the definition site while the code does `from datetime import datetime`. Explain why the patch has no effect and write the correct target.

## Group G — Unit tests versus integration tests

**G1.** Classify each as unit or integration and justify in one line: a test of `parse_bool`; a test of `fetch_json` using `MockTransport`; a test hitting the staging API with a real key; a CLI `--help` smoke test; a test writing and reading a `tmp_path` file; a test that requires `DATABASE_URL`.

**G2.** Give three reasons unit tests must not depend on the network.

**G3.** Register an `integration` marker in `pyproject.toml` so `pytest -m "not integration"` works and unknown markers do not warn.

**G4.** Write a test decorated to skip when `API_KEY` is missing, with a reason string naming the variable.

**G5.** Given five tests, two marked `integration`, state which run under `pytest` and under `pytest -m "not integration"`.

**G6.** Is a test using `httpx.MockTransport` a unit test or an integration test? Justify, and state what it does and does not verify compared to a live call.

**G7.** Write two tests for `fetch_user(client, user_id)`: a fast one with `MockTransport`, and one marked `integration` that uses a real client and is skipped without `API_KEY`.

**G8.** State a sensible CI ordering for format check, lint, type check, unit tests, and integration tests, and justify the position of integration tests.

**G9.** A live integration test fails intermittently. Propose two changes that remove the flakiness without deleting the test.

**G10.** Describe the symptom and the likely cause when a suite passes test-by-test but fails when run whole.

**G11.** Explain the difference between `skip`, `skipif`, and `xfail`; state the reporting outcome when an `xfail` test unexpectedly passes.

**G12.** Write a smoke test asserting `main(["--help"])` exits with code `0`, using `pytest.raises(SystemExit)` and checking `exc_info.value.code`.

## Group H — Formatting, linting, and static type checking

**H1.** Match each tool to its job and classify each problem: an 80-character line limit violation, an unused import, a function returning `int` where `str` is annotated, import ordering.

**H2.** Write the `pyproject.toml` sections configuring ruff with `line-length = 100` and lint rules `E`, `F`, and `I`.

**H3.** State the exit codes of `ruff format --check .` when everything is formatted versus when one file would change, and of `ruff check .` when a lint error exists.

**H4.** Predict the exact mypy complaint about this function, then fix it:

```python
def label(count: int) -> str:
    return count
```

**H5.** Fix the type errors in this function without changing its behavior:

```python
def format_price(cents: int) -> str:
    if cents < 0:
        return -1
    return f"{cents / 100:.2f}"
```

**H6.** `lookup(key) -> str | None` is used directly in `len(lookup(key))`. State the mypy error category and rewrite the code to narrow the `None` case.

**H7.** Explain gradual typing and why `Any` silences the checker; give one situation where `Any` is acceptable and one where it hides a bug.

**H8.** `config.get("timeout")` returns `int | None` for `dict[str, int]`. Write a version that passes the type checker and handles the missing case.

**H9.** Explain what `disallow_untyped_defs = true` and `warn_return_any = true` do, and which one forces annotations everywhere.

**H10.** Write a mypy override that skips checking all modules under `tests.*` while still checking `src`.

**H11.** Calling `greet(name="Ada", titel="Dr")` with a typo is only caught at runtime unless the function is typed. Explain which tool catches it and under what condition.

**H12.** Reformat this snippet to ruff/black style: correct spacing, quotes, trailing comma where the formatter would add one, and split the long call:

```python
def build(name,retries=3,headers={'X':1}):
    return {'name':name,'retries':retries,'headers':headers,'extra':{'a':1,'b':2,'c':3},'enabled':True}
```

**H13.** Sort these imports into the isort convention (standard library, third-party, first-party) and write the corrected block:

```python
from app.config import settings
import json
import httpx
from pathlib import Path
from app.client import fetch
import os
```

**H14.** List four pre-commit checks in the order you would run them and state what each prevents from reaching the repository.

**H15.** Explain why an unexplained `# type: ignore` is technical debt, and rewrite one with a specific error code and comment:

```python
result = cast(Any, value)  # type: ignore
```

**H16.** Predict what mypy reports when an untyped function is called with wrong argument types, and why that is expected behavior.

**H17.** Annotate `def load(path):` returning a `dict[str, int]`, then add the pytest configuration `testpaths` and `addopts` to `pyproject.toml`.

**H18.** Explain why many teams exclude tests from strict type checking and how the override in H10 keeps production code strict.

**H19.** A `mypy` run reports `Module "app" has no attribute "fetch"` in a test while the import works at runtime. Give two likely causes and the diagnostic commands.

## Group I — TypeScript translations and mixed realistic tasks

**I1.** Translate this Jest test to pytest, preserving the three cases:

```typescript
describe("parseBool", () => {
  it("accepts true forms", () => { expect(parseBool("true")).toBe(true); });
  it("rejects junk", () => { expect(parseBool("junk")).toBe(false); });
});
```

**I2.** Translate `beforeEach`/`afterEach` setup to a pytest fixture with `yield`, and state the ordering of setup and teardown relative to the test.

**I3.** Translate `const fn = jest.fn().mockReturnValue(5);` to `unittest.mock` and show one assertion equivalent to `expect(fn).toHaveBeenCalledTimes(1)`.

**I4.** Translate `jest.mock("./client")` for a service that imports `fetch` from `app.client`, using `monkeypatch.setattr`, and explain why dependency injection removes the need for the mock.

**I5.** Translate `expect(() => parseCount("x")).toThrow(new Error("invalid count"))` to `pytest.raises`, including the message check.

**I6.** Translate the Prettier + ESLint workflow to the two ruff commands, including the CI check-only variants.

**I7.** Translate `tsc --noEmit` and `"strict": true` to Python tooling commands and mypy configuration flags.

**I8.** Translate `test.each([[1,2,3],[0,0,0]])("add", (a,b,expected) => ...)` to `pytest.mark.parametrize`.

**I9.** Write a full test module for Chapter 1's `word_counts` and `normalize_text`: a fixture producing sample text, parametrized cases for both functions, and one exception test for non-string input if the functions raise `TypeError`.

**I10.** Parametrize three environment mappings for Chapter 3's `load_settings`: a valid one; one missing `API_KEY`; one with a bad `TIMEOUT` and bad `BASE_URL`. Assert for the invalid cases that the `ConfigError` message names both offending variables.

**I11.** Write tests for Chapter 3's path helpers using `tmp_path`: `ensure_parent` creates directories idempotently, and `save_json`/`load_json` round-trip unicode content.

**I12.** Write the `MockTransport` tests for Chapter 3's retry client: 500, 500, 200 returns the parsed body after three calls; a 400 raises `PermanentError` after one call.

**I13.** Write a CLI precedence test using `monkeypatch.setenv("TIMEOUT", "30")` and `main(["--timeout", "5"])`; assert the flag wins. Then write the companion test where only the environment variable is set.

**I14.** Write a `caplog` test asserting that a request containing an `Authorization` header and an API-key query parameter never appears unmasked in logs.

**I15.** Rewrite this over-mocked test using real objects plus a single transport fake, and explain what coverage is gained:

```python
def test_pipeline(mocker):
    loader = mocker.patch("app.pipeline.load_json")
    client = mocker.patch("app.pipeline.httpx.Client")
    writer = mocker.patch("app.pipeline.save_json")
    run_pipeline("in.json", "out.json")
    loader.assert_called_once()
    client.assert_called_once()
    writer.assert_called_once()
```

**I16.** Write a `conftest.py` providing `settings`, `fake_client`, and `data_dir` fixtures (using `tmp_path`), then write two test files that use them without importing each other.

**I17.** Identify at least five test smells in this suite and describe the fix for each:

```python
import time

STATE = {}

def test_create_user():
    STATE["user"] = {"id": 1}

def test_user_exists():
    assert STATE["user"]["id"] == 1

def test_fetch_live():
    response = httpx.get("https://api.production.example.com/users/1")
    assert response.status_code == 200

def test_retry_delay():
    time.sleep(1)
    assert retry_once("key") is True  # patched internally

def test_parse_many():
    for value in ["1", "2", "3", "x"]:
        assert parse_int(value) is not None
```

**I18.** Define the complete quality gate for a repository: the commands to run locally and in CI, their order, and the required exit code for each. Include format check, lint, type check, unit tests, and integration tests.

**I19.** Explain how you would add a regression test for this bug fix without knowing the internal implementation: "a 204 No Content response caused the client to crash while parsing an empty body."

**I20.** Given a function that reads environment configuration, calls an HTTP API, and writes a file, describe the minimum test set (which tests, in which style) that gives confidence without duplicating the implementation.

---

## Before moving on

Check yourself against the chapter outcome without looking back at the notes:

- Structure a `tests/` package that pytest discovers; run and select tests confidently from the command line and interpret exit codes.
- Write precise assertions, using `approx` for floats and `pytest.raises` with `match` and `exc_info` for failures.
- Build fixtures for data, clients, and settings; use `yield` teardown, `conftest.py`, scopes, factories, `tmp_path`, `monkeypatch`, `caplog`, and `capsys` deliberately.
- Replace loops and copy-paste with `parametrize` tables that cover boundaries and invalid inputs.
- Keep tests isolated, deterministic, and order-independent; never depend on the working directory or repository state.
- Substitute boundaries with fakes, `monkeypatch`, `unittest.mock`, and especially `httpx.MockTransport`, without mocking your own logic.
- Separate fast unit tests from marked integration tests, and skip cleanly when credentials are missing.
- Run and configure `ruff format`, `ruff check`, and `mypy`, and explain what each tool catches that tests do not.

If any group felt slow, redo a subset of its exercises from scratch before continuing to Chapter 5.
