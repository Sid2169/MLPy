# Chapter 2 — Functions, Objects, and Python's Data Model

Chapter 1 covered expressions and built-in containers. This chapter covers how Python organizes code and data: modules, classes, dataclasses, type hints, iterators and generators, exceptions, context managers, and the conventions that make Python code readable.

Everything here is in daily use in FastAPI services, data pipelines, and AI integrations. Practice by writing and running code, not by reading.

As in Chapter 1, no exercise has a solution, and worked examples in the lesson are teaching material, not answers.

## Contents

1. Modules, imports, and project organization
2. Classes and instances
3. Inheritance and composition
4. Dataclasses
5. Practical type hints
6. Iterables, iterators, and generators
7. Exceptions
8. Context managers and resource management
9. Conventions and readable code
10. Exercises (Groups A–L)

---

## 2.1 Modules, imports, and project organization

A module is any `.py` file. A package is a directory of modules (with an `__init__.py` for a regular package). Importing runs the module's top-level code once, then caches the module object in `sys.modules`.

```python
import math                      # full module, accessed as math.sqrt
import math as m                 # alias
from math import sqrt            # bind one name
from math import sqrt as root    # alias the binding
from math import *               # avoid: pollutes the namespace
```

Details that matter:

- `import x` binds the module object; `from x import y` binds one attribute of it.
- Importing the same module twice does not re-run it. Only the first import executes the code.
- An import executes top-to-bottom at the point of the `import` statement. Heavy work (network calls, file scans, model loading) at import time makes tests slow and import errors surprising. Prefer functions and `main()` entry points.
- Import statements are conventionally at the top of the file: stdlib, then third-party, then your own package, each group separated by a blank line.

### The `__main__` guard

Every module has `__name__`: it is `"__main__"` when the file is executed directly, and the module's name when imported.

```python
# util.py
print("util imported")

def double(x):
    return x * 2

if __name__ == "__main__":
    print(double(21))
```

`python util.py` prints `util imported` and `42`. `from util import double` (from another file) prints only `util imported`. The guard keeps script behavior out of import time.

### Packages and imports across files

```text
my_service/
├── __init__.py
├── config.py
├── clients/
│   ├── __init__.py
│   └── llm.py
└── main.py
```

```python
# main.py
from my_service.config import settings
from my_service.clients.llm import call_model

# inside my_service/clients/llm.py, relative imports are also available:
from ..config import settings
```

Rules:

- Prefer absolute imports (`from my_service.config import settings`); they are readable and survive refactoring.
- Relative imports (`from . import x`, `from ..config import settings`) only work inside packages.
- Run package code with `python -m my_service.main`, not `python my_service/main.py`. The `-m` form sets up imports correctly; the path form breaks relative imports and can import the file twice under two names.
- Circular imports (`a` imports `b`, `b` imports `a`) are a symptom of tangled module responsibilities. Fix the design or import inside the function as a last resort.

An `__init__.py` marks a directory as a package and can re-export names:

```python
# my_service/__init__.py
from .config import settings

__all__ = ["settings"]    # controls `from my_service import *`; documentation more than enforcement
```

TypeScript comparison: each Python file is a namespace like an ES module, but there are no default exports. `import x` is closer to `import * as x from "./x"` than to a default import.

---

## 2.2 Classes and instances

A class bundles data and behavior. `__init__` initializes a new instance; `self` is the instance and is always the first parameter of instance methods. Unlike TypeScript, there is no implicit `this` — it is passed explicitly and can be named anything, though `self` is a hard convention.

```python
class Point:
    kind = "point"                  # class attribute: shared by all instances

    def __init__(self, x, y):
        self.x = x                  # instance attributes: per-instance
        self.y = y

    def distance_to(self, other):
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5

p = Point(3, 4)
print(p.x, p.kind)
print(p.distance_to(Point(0, 0)))
```

Key semantics:

- Attributes are created by assignment. There are no field declarations and no required `__init__`; `Point.__init__` is how instances normally get their attributes.
- Attribute lookup checks the instance first, then the class. Assigning `p.kind = "dot"` creates an *instance* attribute shadowing the class attribute; the class itself is unchanged.
- Mutable class attributes are shared by every instance — the same aliasing trap as Chapter 1:

```python
class Bad:
    items = []                      # shared across all instances

a, b = Bad(), Bad()
a.items.append(1)
print(b.items)                      # [1] -- probably not what was intended
```

- Methods are just functions; `p.distance_to(q)` is sugar for `Point.distance_to(p, q)`.
- `self` is not a keyword. Forgetting it in a definition produces a `TypeError` at the call site, not at definition time.

### `__repr__`, `__str__`, and `__eq__`

Default representations are useless for debugging (`<Point object at 0x...>`), and default equality is identity:

```python
print(Point(1, 2) == Point(1, 2))   # False -- different objects, no __eq__
```

Implement the dunders you actually need:

```python
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __repr__(self):
        return f"Point(x={self.x}, y={self.y})"

    def __eq__(self, other):
        if not isinstance(other, Point):
            return NotImplemented
        return (self.x, self.y) == (other.x, other.y)
```

Rules to remember:

- `__repr__` is for developers (REPL, logs); `__str__` is for end users and falls back to `__repr__`.
- Return `NotImplemented` (not `NotImplementedError`) from `__eq__` for unknown types so Python can try the reflected comparison.
- Defining `__eq__` sets `__hash__` to `None`, making instances unhashable, unless you also define `__hash__` or use a dataclass with `frozen=True`. Objects that are equal must have equal hashes.
- `==` for user classes is identity-based until you define `__eq__`; `is` is always identity.

### Practical instance tools

- `@property` exposes a computed or validated attribute without call syntax:

```python
class Temperature:
    def __init__(self, celsius):
        self._celsius = celsius

    @property
    def fahrenheit(self):
        return self._celsius * 9 / 5 + 32

    @fahrenheit.setter
    def fahrenheit(self, value):
        self._celsius = (value - 32) * 5 / 9
```

- `@classmethod` receives the class instead of the instance and is the standard pattern for alternative constructors: `Point.from_dict(data)`.
- `@staticmethod` is a plain function namespaced under the class; use sparingly, a module-level function is usually clearer.
- `__len__`, `__getitem__`, `__iter__`, and friends let your objects behave like built-ins; use them when the analogy is strong, not to be clever.
- Python has no `private`. A leading underscore (`self._cache`) means "internal, do not touch". Double leading underscores trigger name mangling (`self.__token` becomes `self._ClassName__token`) and are rarely worth it.

TypeScript comparison: no declarations, no access modifiers, no constructor parameter properties. Duck typing replaces interfaces at runtime: if it has the attributes and methods, it works.

---

## 2.3 Inheritance and composition

Inheritance expresses "is a" and shares behavior; composition expresses "has a" and is usually the safer default.

```python
class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        raise NotImplementedError

class Dog(Animal):
    def speak(self):
        return f"{self.name} says woof"

d = Dog("Rex")
print(d.speak(), isinstance(d, Animal), isinstance(d, Dog))
```

Rules:

- `class Child(Parent):` inherits all attributes and methods. Call `super().__init__(...)` first when the parent sets up state.
- Overriding replaces the method for instances of the subclass. `super().method(...)` calls the next implementation in the MRO (method resolution order).
- `isinstance(obj, Parent)` is `True` for subclasses; `type(obj) is Parent` is not. Prefer `isinstance`.
- Multiple inheritance works with a linearized MRO (C3), e.g. `class D(B, C)` searches `D → B → C → A`. It is powerful and easy to misuse; keep it shallow.
- Abstract base classes exist (`abc.ABC`, `@abstractmethod`), but for small codebases, raising `NotImplementedError` in the base method is enough. Chapter 5's Pydantic and Chapter 3's protocols show heavier machinery when it earns its keep.
- Deep inheritance trees are hard to change. A base class with many optional hooks is a design smell.

Composition instead of inheritance:

```python
class HttpClient:
    def get(self, url):
        return {"url": url, "status": 200}

class UserService:
    def __init__(self, client):
        self._client = client        # HAS an HttpClient

    def fetch_user(self, user_id):
        return self._client.get(f"/users/{user_id}")

service = UserService(HttpClient())
```

`UserService` is not a kind of `HttpClient`; it *uses* one. This keeps `UserService` testable (pass a fake client) and avoids exposing `HttpClient`'s entire API on `UserService`.

When to inherit: the subclass truly passes an "is a" test, the parent is stable, and the subclass uses most of the inherited behavior. Otherwise compose.

---

## 2.4 Dataclasses

A dataclass generates `__init__`, `__repr__`, and `__eq__` from annotated fields. It removes exactly the boilerplate that classes should not make you write.

```python
from dataclasses import dataclass, field

@dataclass
class User:
    id: int
    name: str
    tags: list[str] = field(default_factory=list)
    active: bool = True

u = User(id=7, name="Ada")
print(u)                    # User(id=7, name='Ada', tags=[], active=True)
print(u == User(7, "Ada"))  # True -- generated __eq__
```

Details:

- Fields without defaults must come first. A default value must not be mutable; `field(default_factory=list)` runs a fresh factory per instance.
- `@dataclass(frozen=True)` forbids attribute assignment after creation and makes instances hashable (usable in sets and as dict keys).
- `@dataclass(order=True)` generates comparison methods based on field order, enabling `sorted(users)`.
- `@dataclass(slots=True)` (3.10+) drops the per-instance `__dict__`, saving memory for large collections of records.
- Helpers: `dataclasses.asdict(u)` produces nested dicts (useful before JSON serialization); `dataclasses.replace(u, name="Grace")` creates a modified copy.
- `__post_init__` runs after the generated `__init__` for derived or validated fields.

### Choosing a data structure

| Need | Use |
| --- | --- |
| Fixed, known schema; equality; clear attribute access | `@dataclass` |
| Plain dict visible to a developer, but statically typed | `TypedDict` (section 2.5) |
| Dynamic keys, JSON at the edges, quick scripts | `dict` |
| Untrusted input validation, coercion, serialization | Pydantic (Chapter 5) |
| Small internal helper returning two values | `tuple` |

Guidance: use dicts at the boundaries of your program (parsed JSON, request payloads) and dataclasses in the core (config, domain objects, typed results). Do not build a class hierarchy for something a function and a dict already express.

---

## 2.5 Practical type hints

Type hints document intent and let tools (pyright, mypy) and editors catch mistakes. Python itself ignores them at runtime.

```python
def fetch_user(user_id: int, include_deleted: bool = False) -> dict[str, object]:
    return {"id": user_id}
```

Modern container and union syntax (3.9+/3.10+):

```python
ids: list[int] = [1, 2]
counts: dict[str, int] = {"a": 1}
point: tuple[float, float] = (1.0, 2.0)
tags: set[str] = {"api"}

def find(user_id: int) -> str | None:   # Optional[str] before 3.10
    ...
```

Callable and abstract collections:

```python
from collections.abc import Callable, Iterable, Iterator, Sequence, Mapping

def apply(fn: Callable[[int], str], values: Iterable[int]) -> list[str]:
    return [fn(v) for v in values]
```

Prefer abstract types in parameters (`Iterable[int]` accepts lists, tuples, generators) and concrete types for returns (`list[str]` promises an indexable, reusable object).

### `TypedDict` for JSON-shaped data

```python
from typing import TypedDict, NotRequired

class ChatMessage(TypedDict):
    role: str
    content: str
    name: NotRequired[str]

def render(message: ChatMessage) -> str:
    return f"{message['role']}: {message['content']}"
```

At runtime a `TypedDict` is a plain `dict`. `Total=False` applies optionality to all keys; `NotRequired[T]` (3.11+) marks individual keys. Use it when you want static checking but need a real dict, for example when you are going to hand the object to `json.dumps` or a provider SDK.

### Generics at a practical level

```python
from typing import TypeVar

T = TypeVar("T")

def first(items: list[T]) -> T:
    return items[0]

first([1, 2])         # int
first(["a"])          # str
```

`TypeVar` keeps the input and output types linked. Python 3.12 allows the shorter `def first[T](items: list[T]) -> T:`. Also useful:

- `Literal["low", "high"]` for a small fixed set of values.
- Type aliases: `UserId = int`, `Headers = Mapping[str, str]`.
- `Any` disables checking for that value; treat any `Any` as a TODO.
- Forward references are strings when needed: `def clone(self) -> "Point":`. `from __future__ import annotations` postpones evaluation everywhere.

Hints are not validation. `fetch_user("abc")` runs; the mistake surfaces later. Runtime validation belongs to Pydantic at the API boundary (Chapter 5), while type hints keep the internals honest (tooling setup is in Chapter 4).

---

## 2.6 Iterables, iterators, and generators

### The iteration protocol

An **iterable** can be passed to `iter()`: it has `__iter__`. An **iterator** is a single-use cursor: it has `__next__` and returns itself from `__iter__`. `for` calls `iter()` once, then `next()` until `StopIteration`.

```python
xs = [1, 2, 3]
it = iter(xs)
print(next(it))          # 1
print(next(it))          # 2
print(list(it))          # [3]   -- list() consumes the rest
print(list(it))          # []    -- an iterator is exhausted once
print(next(it, "end"))   # end   -- default instead of StopIteration
```

Most containers are iterable but not iterators (`iter(xs) is not xs`). Generators are both.

### Generators

A function containing `yield` returns a generator object. Calling it runs no code until you iterate; each `next()` runs to the next `yield` and pauses, preserving local state.

```python
def evens(limit):
    n = 0
    while n < limit:
        yield n
        n += 2

for value in evens(6):
    print(value)          # 0 2 4
```

- `yield from other` delegates iteration to another iterable, flattening it into the current stream (`yield from [1, 2]`).
- A generator can be infinite; consumers must stop early (`for` with `break`, `next` N times, or `itertools.islice(gen, 10)`).
- Generator expressions are anonymous generators: `sum(x * x for x in xs)`, `any(is_bad(r) for r in rows)`.

### Lazy processing

`map`, `filter`, `zip`, `enumerate`, and `reversed`-free functions return lazy iterators. A pipeline of generators computes one item at a time and holds no intermediate lists:

```python
def read_lines(lines):
    for line in lines:
        yield line.strip()

def non_empty(lines):
    for line in lines:
        if line:
            yield line

text = ["  a ", "", " b", "   "]
for line in non_empty(read_lines(text)):
    print(line)
```

This pattern scales to files, database cursors, and API pages, where materializing everything would blow memory (Chapters 3, 7, 8).

Guidance:

- Return a generator when the caller likely wants to process items one at a time; return a list when the caller needs `len`, indexing, sorting, or multiple passes.
- An iterator cannot be reused. If a caller iterates twice, convert once with `list(...)` or return a fresh generator from a function.
- `bool()`, `in`, `sum`, `list`, `tuple`, `set`, `dict`, and unpacking all consume the same iterator exactly once.
- `itertools` (`islice`, `chain`, `groupby`) composes lazy pipelines; `groupby` requires sorted input.
- Debugging: wrap with `list(...)` temporarily to inspect, then remove it when done.

Beware the "returns an iterator" API that looks like a list:

```python
data = map(int, ["1", "2"])
print(len(data))        # TypeError: no len on map
```

---

## 2.7 Exceptions

Exceptions are Python's error mechanism; they are not exclusively for catastrophic failures. One function per failure mode is idiomatic, and every caller decides to handle or propagate.

```python
try:
    value = int(raw)
except ValueError as e:
    print(f"bad input: {e}")
    value = 0
else:
    print("converted")
finally:
    print("done")
```

Semantics:

- `try` runs the block; on error, the first matching `except` runs and the rest of `try` is skipped.
- `else` runs only when no exception occurred — useful to keep the protected region minimal.
- `finally` always runs (success, exception, or `return`) and is for cleanup.
- Catch specific exception types. A bare `except:` also catches `KeyboardInterrupt` and hides bugs. `except Exception:` is acceptable at process boundaries only, and the exception must be logged or re-raised.
- `except Exception as e` binds the exception; the name is deleted when the block ends.

Common built-in types: `ValueError`, `TypeError`, `KeyError`, `IndexError`, `AttributeError`, `ZeroDivisionError`, `FileNotFoundError` (an `OSError`), `RuntimeError`, `NotImplementedError`. Hierarchy matters: `KeyError` and `IndexError` are both `LookupError`; `OSError` covers most I/O failures.

### Raising and chaining

```python
def parse_port(text):
    try:
        return int(text)
    except ValueError as e:
        raise ValueError(f"invalid port: {text!r}") from e
```

- `raise SomeError("message")` raises with context.
- Bare `raise` inside an `except` block re-raises the current exception unchanged.
- `raise NewError(...) from e` records `e` as the `__cause__`, producing a clear traceback ("The above exception was the direct cause...").
- `raise NewError(...)` inside `except` automatically chains as `__context__`; `raise ... from None` suppresses that display.

### Custom exceptions

```python
class ApiError(Exception):
    """Base for all errors raised by this client."""

class TransientApiError(ApiError):
    """Retryable: timeouts, 429s, 5xx."""

class PermanentApiError(ApiError):
    """Not retryable: 400s, validation failures."""
```

Keep custom exceptions small, module-level, and grouped under one base per subsystem. They carry a type and often a message; only add attributes (like `status_code`) when callers actually branch on them. In particular, transient versus permanent classification is the foundation of retry logic (Chapter 8).

### EAFP and validation

Python style favors EAFP ("easier to ask forgiveness than permission"): attempt the operation and handle the specific exception, rather than checking conditions first.

```python
try:
    port = int(settings["port"])
except (KeyError, ValueError):
    port = 8080
```

Rule of thumb: use exceptions for genuinely exceptional or unavoidable failure; use explicit checks (`if`, `is None`, `in`) for cheap validation that is part of normal control flow. Do not use exceptions for expected branching that a dict lookup could answer directly.

`assert` is for internal invariants, never input validation. It disappears under `python -O`.

---

## 2.8 Context managers and resource management

`with` guarantees cleanup. The object manages a resource: it implements `__enter__` (returns the value bound after `as`) and `__exit__` (runs on exit, even on exception).

```python
with open("data.txt") as f:
    content = f.read()
# f is closed here, even if read() raised
```

Class-based context manager:

```python
class Timer:
    def __enter__(self):
        print("start")
        return self

    def __exit__(self, exc_type, exc, tb):
        print("stop")
        return False          # False: do not suppress exceptions

with Timer():
    pass
```

Generator-based context manager with `contextlib.contextmanager`:

```python
from contextlib import contextmanager

@contextmanager
def tagged(name):
    print(f"<{name}>")
    try:
        yield name            # everything before yield is __enter__
    finally:
        print(f"</{name}>")   # everything after is __exit__

with tagged("b") as t:
    print(t)
```

Points:

- `__exit__` returning a truthy value suppresses the exception. Return `False` (or nothing) by default; suppressing errors silently is a bug factory.
- Multiple managers: `with open(a) as f, open(b) as g:`. They enter left to right and exit right to left.
- `contextlib.suppress(SomeError)` is the explicit way to ignore one specific error.
- `try/finally` is equivalent in power; `with` is preferred because it is shorter and the cleanup cannot be accidentally skipped.
- Context managers are the backbone of connection pooling, sessions, temporary state, and timing in backend code (Chapters 3, 5, 6).

Avoid holding resources beyond the `with` block, and never return a file object from inside the block expecting it to stay open.

---

## 2.9 Conventions and readable code

PEP 8 in the parts that matter daily:

- `snake_case` for functions, methods, modules; `CapWords` for classes; `UPPER_SNAKE` for module constants; `_leading_underscore` for internals.
- 4-space indentation, imports at the top in three groups, two blank lines between top-level definitions.
- Keep lines readable (roughly 79–99 characters). Use parentheses, not backslashes, to wrap.
- No semicolons; one statement per line.

Design conventions that keep Python services maintainable:

- Write small functions that return values; let callers decide about printing and logging. A function that both computes and prints is hard to test.
- Prefer keyword-only arguments for boolean flags: `def fetch(url, *, retries=3)`. Call sites read `fetch(url, retries=1)`.
- Accept the most general type you can (`Iterable[str]`), return the most useful (`list[str]`).
- Use dataclasses for fixed schemas; use dicts at JSON boundaries; do not invent a class hierarchy for two related shapes.
- Name exceptions after failures (`RateLimitError`), not after reactions (`RetryException`).
- Docstrings: one line describing the contract for anything non-obvious, including argument units and failure modes. Do not restate the code.
- Avoid mutable module-level state; pass dependencies explicitly. It makes tests deterministic.
- Fail loudly and early at boundaries; convert exceptions into your subsystem's taxonomy as close to the source as possible.
- `if __name__ == "__main__": main()` for scripts.
- When in doubt, prefer the boring, obvious implementation over the clever one. Python rewards clarity.

Common mistakes checklist for this chapter:

1. Forgetting `self` in a method signature.
2. Mutable class attributes shared across instances.
3. Defining `__eq__` without `__hash__` and then putting instances in a set.
4. Using a mutable default in a dataclass (`items: list = []`), which raises at class definition.
5. Reusing an exhausted generator or iterator.
6. Building giant lists where a generator pipeline is natural.
7. Bare `except:` or `except Exception: pass` swallowing failures.
8. Doing work at import time so importing the module has side effects.
9. Running a module with `python path/to/mod.py` and hitting relative-import errors instead of using `-m`.
10. Hints promising types that the runtime never checks; validation must happen at the boundary.
11. Using inheritance to reuse one method; composition is usually the answer.
12. Returning a resource from inside a `with` block and using it after it closes.

---

# Exercises

Work each exercise before running code. Groups are ordered from recognition to implementation; within each group, difficulty increases. Do not look up answers — predict, run, reconcile, then rewrite from memory.

## Group A — Modules, imports, and project organization

**A1.** Given these two files, predict the exact output of running `python util.py`, then of running `python main.py`:

```python
# util.py
print("A")

def greet(name):
    return f"hi {name}"

if __name__ == "__main__":
    print(greet("direct"))
```

```python
# main.py
import util
print(util.greet("import"))
print(util.__name__)
```

**A2.** State the value of `__name__` in each case: (a) the file is executed directly, (b) the file is imported by another module, (c) the file is run as `python -m pkg.module`.

**A3.** Predict how many times `loading events` is printed:

```python
# events.py
print("loading events")

def publish(event):
    return event
```

```python
# script.py
import events
import events
from events import publish

print(publish("x"))
```

**A4.** Given this tree, write the import statement that `main.py` needs to use `call_model` from `clients/llm.py`, assuming `python -m my_service.main` is the entry point:

```text
my_service/
├── __init__.py
├── config.py
├── clients/
│   ├── __init__.py
│   └── llm.py
└── main.py
```

**A5.** Replace `from math import *` with explicit imports for the three functions actually used: `sqrt`, `floor`, `pi`. Explain one concrete problem the wildcard import can cause.

**A6.** A new developer runs `python my_service/main.py` and gets `ImportError: attempted relative import with no known parent package` because `main.py` contains `from .config import settings`. Explain why the error occurs and give two ways to fix how the code is run or written.

**A7.** Write `clients/__init__.py` so that both `from my_service.clients import call_model` and `from my_service.clients.llm import call_model` work. Include `__all__`.

**A8.** This library module makes a network connection at import time. Explain why that is a problem for tests and for tools that merely inspect the module, then restructure it to avoid the side effect:

```python
# client.py
import requests

session = requests.Session()

def fetch(url):
    return session.get(url)
```

**A9.** Two modules import each other: `a.py` has `from b import helper` and `b.py` has `from a import CONFIG`. Explain why the import can fail depending on which module is imported first, and give one structural fix that does not involve importing inside functions.

**A10.** Arrange these imports into the three conventional groups and order them correctly within each group:

```python
from my_service.config import settings
import os
import requests
from pydantic import BaseModel
import json
from my_service.clients.llm import call_model
```

**A11.** Choose between `import json` and `from json import dumps` for each scenario and justify: (a) a module using five different `json` functions, (b) a module using `dumps` twice, (c) a module that has its own function named `dumps`.

**A12.** Explain why module-level `print()` calls in library code are a bad practice, and state what should replace them once Chapter 3's logging is available.

**A13.** Explain the difference between these two commands in terms of import behavior, and say which one you should use for a package entry point: `python app/main.py` versus `python -m app.main`.

**A14.** Write a `__main__.py`-style `main()` function and guard for this module, so running it directly prints the result of `run("dev")` but importing it prints nothing:

```python
# app.py
def run(mode):
    return f"running in {mode}"
```

**A15.** Given `pkg/__init__.py` containing `from .core import Engine`, predict the output of `print(pkg.Engine)` and explain what happens to the `core` module name in `pkg`'s namespace.

**A16.** Convert this TypeScript idea into Python and explain what replaces `default`:

```typescript
// mathUtils.ts
export default function double(x: number): number { return x * 2; }
export const PI = 3.14159;
```

## Group B — Classes and instances

**B1.** Predict all three printed values:

```python
class C:
    x = 1

c = C()
c.x = 2
print(C.x, c.x)
print(C().x)
```

**B2.** Predict the output and explain the sharing:

```python
class Registry:
    names = []

Registry.names.append("a")
r = Registry()
r.names.append("b")
print(Registry.names, r.names)
```

**B3.** Fix B2 so each instance has its own list without changing `Registry().names` start value.

**B4.** Predict the exact exception and message produced:

```python
class Greeter:
    def greet(name):
        return f"hi {name}"

Greeter().greet("Ada")
```

**B5.** Write a `Counter` class with an `__init__` that sets `count = 0`, an `increment(amount=1)` method, and a `__repr__` producing `Counter(count=2)` after two increments.

**B6.** Predict both booleans and explain both:

```python
class P:
    def __init__(self, x):
        self.x = x

a, b = P(1), P(1)
print(a == b, a is b)
```

**B7.** Add an `__eq__` comparing `x` (and rejecting other types with `NotImplemented`). Then predict the result of `a == b` and the exact error produced by `len({a, b})`. Explain why the error appears.

**B8.** Fix B7 by also defining `__hash__` consistently, then predict `len({a, b})`. State the rule that equal objects must satisfy with respect to hashing.

**B9.** Write `__repr__` for this class so `print(job)` shows `Job(name='sync', status='queued')`:

```python
class Job:
    def __init__(self, name, status="queued"):
        self.name = name
        self.status = status
```

**B10.** The class below defines only `__repr__`. Predict all three printed lines and explain the fallback rule:

```python
class T:
    def __repr__(self):
        return "REPR"

t = T()
print(t)
print(repr(t))
print(str(t))
```

**B11.** Write a `Speed` class that stores meters per second in `self._mps` and exposes a read-only `kmh` property computed as `_mps * 3.6`.

**B12.** Extend `Speed` with a `kmh` setter that sets `_mps = value / 3.6`, and raises `ValueError` when the value is negative. Show one valid and one invalid assignment.

**B13.** Add a `from_dict(cls, data)` classmethod to this class that builds an instance from `{"id": 1, "name": "a"}`:

```python
class User:
    def __init__(self, user_id, name):
        self.user_id = user_id
        self.name = name
```

**B14.** Predict all four outputs:

```python
class C:
    @classmethod
    def cm(cls):
        return cls.__name__

    @staticmethod
    def sm():
        return "static"

print(C.cm(), C().cm(), C.sm(), C().sm())
```

**B15.** Predict all four booleans:

```python
class A: pass
class B(A): pass

b = B()
print(isinstance(b, A), isinstance(b, B), type(b) is A, type(b) is B)
```

**B16.** Predict the exception from `print(c.b)`, then write the equivalent lookup that returns `None` instead of raising:

```python
class C:
    def __init__(self):
        self.a = 1

c = C()
```

**B17.** Write a `Playlist` class wrapping an internal list that supports `len(playlist)` and `playlist[0]`, using `__len__` and `__getitem__`. Show both working.

**B18.** Predict `sorted(C().__dict__)` for this class and explain what `__dict__` contains:

```python
class C:
    def __init__(self):
        self.b = 2
        self.a = 1
```

**B19.** Write a `QueryBuilder` with `with_table(name)` and `where(clause)` methods that each return `self`, and show a chained call producing `{"table": "users", "where": "id > 1"}` via a `build()` method.

**B20.** Predict each line:

```python
class C:
    def m(self):
        return "m"

c = C()
print(c.m())
print(C.m(c))
print(C.m())
```

**B21.** Write a `Port` class whose `__init__` raises `ValueError` unless the value is an integer between 1 and 65535. Show construction of one valid and one invalid port.

**B22.** Explain why this pattern is a bug and rewrite it so each instance gets a distinct cache. Then state what `__hash__` interplay (if any) is involved:

```python
class Client:
    cache = {}

    def get(self, key):
        return self.cache.get(key)
```

## Group C — Inheritance and composition

**C1.** Predict the output order:

```python
class A:
    def __init__(self):
        print("A")

class B(A):
    def __init__(self):
        super().__init__()
        print("B")

B()
```

**C2.** Predict the output:

```python
class A:
    def describe(self):
        return "A"

class B(A):
    def describe(self):
        return "B+" + super().describe()

print(B().describe())
```

**C3.** Predict the output and write the full MRO (the order in which methods are searched):

```python
class A:
    def name(self):
        return "A"

class B(A):
    def name(self):
        return "B" + super().name()

class C(A):
    def name(self):
        return "C" + super().name()

class D(B, C):
    def name(self):
        return "D" + super().name()

print(D().name())
```

**C4.** Predict the list produced by the print, using `__mro__`:

```python
class A: pass
class B(A): pass
class C(A): pass
class D(B, C): pass

print([klass.__name__ for klass in D.__mro__])
```

**C5.** Predict the output:

```python
class Animal:
    def __init__(self, name):
        self.name = name

class Dog(Animal):
    pass

d = Dog("Rex")
print(d.name, isinstance(d, Animal))
```

**C6.** Predict both printed values and the exception:

```python
class A:
    def __init__(self):
        self.x = 1

class B(A):
    def __init__(self):
        self.y = 2

b = B()
print(b.y)
print(b.x)
```

**C7.** This subclass exists only to add caching around one method. Explain why composition is a better fit, then rewrite it so `CachedClient` *has* an `HttpClient` instead of being one:

```python
class HttpClient:
    def get(self, url):
        return {"url": url, "status": 200}

class CachedClient(HttpClient):
    def __init__(self):
        self._cache = {}

    def get(self, url):
        if url not in self._cache:
            self._cache[url] = super().get(url)
        return self._cache[url]
```

**C8.** Write a base class `Shape` whose `area()` raises `NotImplementedError`, and a `Rectangle` subclass implementing `area()`. Show that calling `area()` on the base raises and on the subclass works.

**C9.** Predict which iteration fails and everything printed before the failure:

```python
class Shape:
    def area(self):
        raise NotImplementedError

class Circle(Shape):
    def __init__(self, radius):
        self.radius = radius

    def area(self):
        return 3.0 * self.radius ** 2

for shape in [Shape(), Circle(2)]:
    print(shape.area())
```

**C10.** Predict `isinstance(1, (int, float))`, `isinstance(True, int)`, and `isinstance("x", (int, float))`.

**C11.** The classic `Square(Rectangle)` problem: a square is not a rectangle when width and height can be set independently, because code expecting a rectangle's behavior breaks. Explain the violation in one or two sentences, and propose a design that avoids inheritance.

**C12.** Predict the method resolution for both class definitions, then explain in one sentence why the order matters when neither `B` nor `C` calls `super()`:

```python
class A:
    def m(self):
        return "A"

class B(A):
    def m(self):
        return "B"

class C(A):
    def m(self):
        return "C"

class D1(B, C): pass
class D2(C, B): pass

print(D1().m())
print(D2().m())
```

**C13.** Write a `RetryClient` that composes an `HttpClient` and retries `get` up to `attempts` times by calling `status == 500` responses as failures. Use only what the chapter covered (a simple loop; no exception handling yet).

**C14.** Translate this TypeScript to Python, including the `instanceof` check:

```typescript
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function fail(status: number): never {
  throw new ApiError(status, "request failed");
}
```

**C15.** For each parent-child pair below, state whether inheritance is defensible, and if not, what to use instead: (a) `EmailClient` and `HttpClient`, (b) `DiskCache` and `Cache` (an `ABC`), (c) `Logger` and `Service` where the service only calls `logger.info`.

**C16.** Explain "prefer composition over inheritance" in your own words with one HTTP-client example where the two designs differ concretely in testability.

**C17.** Predict what `isinstance(Dog("Rex"), object)` returns and explain why every class is compatible with `object`.

## Group D — Dataclasses

**D1.** Rewrite this class as a dataclass with identical behavior, including defaults:

```python
class Task:
    def __init__(self, title, priority=1, tags=None):
        self.title = title
        self.priority = priority
        self.tags = tags if tags is not None else []

    def __repr__(self):
        return f"Task(title={self.title!r}, priority={self.priority!r}, tags={self.tags!r})"

    def __eq__(self, other):
        if not isinstance(other, Task):
            return NotImplemented
        return (self.title, self.priority, self.tags) == (other.title, other.priority, other.tags)
```

**D2.** Predict both printed lines:

```python
from dataclasses import dataclass

@dataclass
class User:
    id: int
    name: str

u = User(7, "Ada")
print(u)
print(u == User(7, "Ada"), u == User(8, "Ada"))
```

**D3.** Predict the exact error raised when defining this dataclass, then fix it:

```python
from dataclasses import dataclass

@dataclass
class Bad:
    items: list = []
```

**D4.** Predict the output and explain why the two instances do not share state:

```python
from dataclasses import dataclass, field

@dataclass
class A:
    items: list = field(default_factory=list)

a, b = A(), A()
a.items.append(1)
print(a.items, b.items)
print(a.items is b.items)
```

**D5.** Predict what happens on the assignment line, then write two expressions that work: `hash(Point(1, 2))` and `len({Point(1, 2), Point(1, 2)})`.

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Point:
    x: int
    y: int

p = Point(1, 2)
p.x = 3
```

**D6.** Predict the printed output:

```python
from dataclasses import dataclass

@dataclass(order=True)
class V:
    x: int

print(sorted([V(2), V(1), V(2)]))
```

**D7.** Given nested dataclasses below, predict `data["user"]["name"]`, then state whether mutating `data` changes the original `order`:

```python
from dataclasses import dataclass, asdict

@dataclass
class User:
    name: str

@dataclass
class Order:
    id: int
    user: User

order = Order(1, User("Ada"))
data = asdict(order)
```

**D8.** Predict both booleans, then explain what `replace` does and does not share with the original:

```python
from dataclasses import dataclass, replace

@dataclass
class Config:
    timeout: int = 10
    retries: int = 3

c = Config()
c2 = replace(c, timeout=30)
print(c2 == Config(30, 3), c.timeout)
```

**D9.** Given this dataclass, predict the sorted order of `[V(2, "b"), V(1, "a")]` and explain the role of `compare=False`:

```python
from dataclasses import dataclass, field

@dataclass(order=True)
class V:
    x: int
    label: str = field(compare=False)
```

**D10.** Choose `dict`, `@dataclass`, or `tuple` for each and justify briefly: (a) parsed JSON request body, (b) application configuration with five known fields, (c) the two return values of a function whose caller immediately unpacks them, (d) a cache keyed on two ints.

**D11.** For each scenario, choose `TypedDict` or `@dataclass` and justify: (a) an OpenAI-style chat message that gets passed to `json.dumps`, (b) an internal `User` record with methods, (c) a response payload that will be validated by Pydantic later.

**D12.** Write an `ApiResponse` dataclass with `status: int`, `body: dict`, `headers: dict[str, str]` defaulting to an empty dict per instance, and an `ok` property returning `True` for statuses below 400. Show construction of a success response.

**D13.** Predict the value of `Order(2.5, 4).total` and explain when `__post_init__` runs:

```python
from dataclasses import dataclass

@dataclass
class Order:
    unit_price: float
    quantity: int = 1
    total: float = 0.0

    def __post_init__(self):
        self.total = self.unit_price * self.quantity
```

**D14.** A function currently returns `(status, body)`. List three concrete benefits of returning a dataclass instead, and one scenario where keeping the tuple is the better choice.

**D15.** Predict all three booleans:

```python
from dataclasses import dataclass

@dataclass
class D:
    x: int

class R:
    def __init__(self, x):
        self.x = x

print(D(1) == D(1), R(1) == R(1), D(1) == R(1))
```

**D16.** Write nested dataclasses `Member(name, role)` and `Team(name, members)`, then produce the nested dict for `Team("core", [Member("Ada", "owner")])` using `asdict`.

**D17.** Add `slots=True` to the dataclass in D15 and predict whether `vars(D(1))` still works. Explain the memory trade-off in one sentence.

## Group E — Practical type hints

**E1.** Add complete type hints to this signature: `def fetch(url, retries=3, headers=None)` where `headers` maps strings to strings and may be `None`, and the return value is a `dict` with string keys and values of any type.

**E2.** Predict the output and explain what the annotation failed to prevent:

```python
def double(x: int) -> int:
    return x * 2

print(double("ab"))
```

**E3.** Rewrite each old-style annotation using modern syntax: `Optional[int]`, `List[str]`, `Dict[str, List[int]]`, `Union[str, int, None]`, `Tuple[int, ...]`.

**E4.** Write the annotation for `def total(values):` where `values` may be any iterable of integers (lists and generators must both be acceptable).

**E5.** Write the full signature and body for `map_all(fn, items)` where `fn` takes a string and returns an int, and `items` is a list of strings; the result is a list of ints. Use `Callable`.

**E6.** Write a `ChatMessage` TypedDict with required `role` and `content` strings and an optional `name` string using `NotRequired`. Then annotate `def render(message: ...) -> str`.

**E7.** Given `class Event(TypedDict, total=False): id: int; name: str`, which keys are required? Rewrite it so `id` is required and `name` optional, using `total=True` defaults plus `NotRequired`.

**E8.** Write a generic `last(items: Sequence[T]) -> T | None` using `TypeVar`, returning `None` for an empty sequence.

**E9.** Annotate `def set_level(level)` so `level` accepts only `"debug"` or `"info"` using `Literal`. State what a type checker rejects.

**E10.** Write a `Node` class with `value: int` and `children: list["Node"]`, explaining why the string form of the annotation is needed at definition time.

**E11.** Define a type alias `Headers = Mapping[str, str]` and use it in the signature `def build(headers): ...` returning a `dict[str, str]`.

**E12.** This signature has two separate problems. Identify both and fix them:

```python
def count(xs: list[int] = [], limit: int = None) -> int:
    return len(xs[:limit])
```

**E13.** Given:

```python
from typing import TypedDict

class Msg(TypedDict):
    role: str
    content: str

m: Msg = {"role": "user", "content": "hi"}
```

predict: `type(m)`, whether `m["role"] = 1` raises at runtime, and whether `json.dumps(m)` works.

**E14.** Write `pluck` with this contract: given a list of dicts with string keys and values of a consistent type `T`, and a `key: str`, return a `list[T]` of the values under that key. Annotate it with a `TypeVar`.

**E15.** For each parameter description, choose the annotation (`list[int]`, `Iterable[int]`, `Sequence[int]`, or `Mapping[str, int]`) and justify: (a) the function only loops over the values, (b) the function indexes and measures length, (c) the function looks up keys without mutating.

**E16.** Explain in two or three sentences why `fetch_user("abc")` runs without error despite `user_id: int`, and where runtime validation belongs in an API service.

**E17.** A function returning `Any` hides a bug. Identify the likely intended type and rewrite the annotation:

```python
def load(data: Any) -> Any:
    return data["items"][0]["name"]
```

**E18.** Annotate this dataclass fully, including the mutable default, without changing its behavior:

```python
from dataclasses import dataclass, field

@dataclass
class Job:
    id: int
    name: str
    tags: list = field(default_factory=list)
```

## Group F — Iterables and iterators

**F1.** Classify each as iterable, iterator, or both: a list, a string, a generator object, a `map` object, a dict, a `range`, the result of `zip([1], "a")`.

**F2.** Predict the sequence of outputs, including when and which exception is raised:

```python
it = iter([1, 2])
print(next(it))
print(next(it))
print(next(it))
```

**F3.** Predict both printed values and explain:

```python
nums = (x * 2 for x in range(3))
print(sum(nums))
print(sum(nums))
```

**F4.** Predict all three lines:

```python
it = iter("ab")
print(next(it, "?"))
print(list(it))
print(next(it, "?"))
```

**F5.** Explain why `len(it)` fails on an iterator, then write an expression that counts its remaining items without materializing it as a list (assume consuming the iterator is acceptable).

**F6.** Write a `Countdown` iterator class with `__iter__` and `__next__` yielding `n, n-1, ..., 1` and then raising `StopIteration`. Predict `list(Countdown(3))`.

**F7.** Predict the output of iterating this object and explain which dunder method the `for` loop calls:

```python
class Bag:
    def __init__(self, items):
        self._items = items

    def __iter__(self):
        return iter(self._items)

for x in Bag([1, 2]):
    print(x)
```

**F8.** Predict both printed lines and explain laziness:

```python
m = map(lambda x: x + 1, [1, 2])
print(list(m))
print(list(m))
```

**F9.** Predict the output of `list(reversed([1, 2, 3]))`, then predict what happens with `reversed(x for x in [1, 2, 3])` and explain why the two differ.

**F10.** Which of these return lazy iterators and which return fully materialized containers: `sorted(xs)`, `zip(a, b)`, `map(f, xs)`, `enumerate(xs)`, `range(3)`, `filter(f, xs)`, `list(xs)`?

**F11.** Predict both lines:

```python
e = enumerate("ab")
print(list(e))
print(list(e))
```

**F12.** Predict both lines and explain the partial consumption:

```python
g = (x for x in [1, 2, 3, 4])
print(3 in g)
print(list(g))
```

**F13.** Predict each: `list(range(3))`, `tuple(zip([1, 2], "ab"))`, `set("aab")`, `sorted({3, 1, 2})`.

**F14.** Write `is_iterable(obj)` two ways: once with `hasattr` and once with `iter()` inside `try`/`except TypeError`. State which style is more Pythonic and why.

**F15.** In one sentence each, explain the difference between `iter(x)` and `list(x)`, and when you would choose a generator over a list for an API that returns 100,000 records.

**F16.** Predict the output:

```python
data = [1, 2, 3]
a, b = iter(data), iter(data)
print(next(a), next(a), next(b))
```

**F17.** Given `lines = ["a", "b", "c"]`, write three different expressions using `iter`, `next`, and a generator that each produce `"a"` once.

**F18.** Explain why `zip` objects cannot be indexed (`zipped[0]`) and write the conversion that makes indexing work.

## Group G — Generators and lazy processing

**G1.** Predict the exact output order:

```python
def gen():
    print("start")
    yield 1
    print("middle")
    yield 2

g = gen()
print("created")
print(next(g))
print(next(g))
print(next(g, "done"))
```

**G2.** Write `count_up(n)` yielding `1` through `n`, then show a `for` loop consuming it.

**G3.** Predict the exact output order and explain when each line is produced:

```python
def compute(xs):
    for x in xs:
        print("computing", x)
        yield x * 2

result = compute([1, 2])
print("created")
print(list(result))
```

**G4.** Predict the output:

```python
from itertools import islice

def naturals():
    n = 0
    while True:
        yield n
        n += 1

print(list(islice(naturals(), 3, 6)))
```

**G5.** Predict the output and explain what `yield from` does:

```python
def both():
    yield from [1, 2]
    yield from (3,)

print(list(both()))
```

**G6.** Convert this function to a generator that yields the same values one at a time:

```python
def active_users(users):
    result = []
    for user in users:
        if user["active"]:
            result.append(user["name"])
    return result
```

**G7.** Predict all three printed values:

```python
data = [1, 2, 3, 4]
squares = [x * x for x in data]
gen = (x * x for x in data)
print(len(squares))
print(sum(gen))
print(sum(gen))
```

**G8.** Write a generator `pairs(xs)` yielding consecutive pairs: `pairs([1, 2, 3])` produces `(1, 2)` then `(2, 3)`. The generator should yield nothing for inputs shorter than two elements.

**G9.** Write a generator `chunks(iterable, size)` yielding lists of at most `size` items, with the last possibly shorter. Predict `list(chunks([1, 2, 3, 4, 5], 2))`.

**G10.** Predict both printed lists and explain how `take` consumes the shared iterator:

```python
def take(n, it):
    for _ in range(n):
        yield next(it, None)

it = iter("abcd")
print(list(take(2, it)))
print(list(take(2, it)))
```

**G11.** Predict both numbers, explain the bug, and fix it by restructuring the function so both totals are correct:

```python
def numbers():
    yield from range(3)

g = numbers()
first = sum(g)
second = sum(g)
print(first, second)
```

**G12.** Write `running_total(xs)` yielding cumulative sums: for `[1, 2, 3]` yield `1`, `3`, `6`.

**G13.** Explain the practical difference (memory and timing) between these two lines when `range(10_000_000)` is the input:

```python
big = [x * 2 for x in range(10_000_000)]
big_sum = sum(x * 2 for x in range(10_000_000))
```

**G14.** Predict `next(g, "done")` behavior on an exhausted generator, then show what `next(g)` raises without a default.

**G15.** Predict the output, including the cleanup line, and explain when the `finally` block inside the generator runs:

```python
def source():
    try:
        yield 1
        yield 2
    finally:
        print("cleanup")

g = source()
print(next(g))
g.close()
```

**G16.** Write a generator `filter_records(records, key, value)` yielding records whose `record[key] == value`.

**G17.** Explain why this code is fine for memory but dangerous for correctness, and rewrite it so the data can be summarized twice:

```python
data = map(str.strip, open("input.txt"))
```

**G18.** Write a pipeline of small generators (`stripped`, `non_empty`, `lowercased`) and feed it `["  A ", "", " B"]` to produce `["a", "b"]`. State the type of value produced by the composed pipeline.

**G19.** Write `token_stream(text)` yielding lowercased whitespace-separated tokens, then compute the total token count on `"Hello world HELLO"` with `sum`.

**G20.** Predict the output and explain why the list comprehension version cannot do the same thing here:

```python
def head(gen, n=2):
    return [next(gen) for _ in range(n)]

g = (x for x in range(10**9))
print(head(g))
```

## Group H — Exceptions

**H1.** Predict the exact output:

```python
try:
    print("try")
    result = 1 / 0
except ZeroDivisionError:
    print("caught")
else:
    print("else")
finally:
    print("finally")
```

**H2.** Predict the exact output:

```python
try:
    print("try")
except ValueError:
    print("except")
else:
    print("else")
finally:
    print("finally")
```

**H3.** Name the exception each expression raises: `int("x")`, `{}["k"]`, `"a" + 1`, `[1][5]`, `1 / 0`, `None.attr`, `unknown_name`.

**H4.** Predict which handler runs, explain why, and state what would be required for the `KeyError` handler to run instead:

```python
try:
    {}["k"]
except LookupError:
    print("lookup")
except KeyError:
    print("key")
```

**H5.** Write `parse_count(text)` returning the parsed integer, or raising `ValueError` with the message `invalid count: 'abc'` (using the actual text) when conversion fails.

**H6.** Predict `type(e.__cause__).__name__`:

```python
def f():
    try:
        int("x")
    except ValueError as e:
        raise RuntimeError("processing failed") from e

try:
    f()
except RuntimeError as e:
    print(type(e.__cause__).__name__)
```

**H7.** Define an exception hierarchy: base `ApiError`, plus `TransientError` and `PermanentError` subclasses. Write `classify(status)` raising `TransientError` for 429 and 500, `PermanentError` for 400 and 404, and returning `"ok"` otherwise. Then show that `except ApiError` catches both subclasses.

**H8.** Explain the two problems with the bare `except` in this function and rewrite it to catch only the intended failure:

```python
def read_config(path):
    try:
        return open(path).read()
    except:
        return ""
```

**H9.** Predict the exact output order, then state which exception type escapes at the top level:

```python
try:
    int("x")
except ValueError:
    print("logging")
    raise
```

**H10.** Predict the exact output order:

```python
def f():
    try:
        return 1
    finally:
        print("cleanup")

print(f())
```

**H11.** Rewrite this LBYL-style code in EAFP style, catching `KeyError`, `ValueError`, and `AttributeError` as appropriate:

```python
if "port" in settings and isinstance(settings["port"], str) and settings["port"].isdigit():
    port = int(settings["port"])
else:
    port = 8080
```

**H12.** Find and fix the bug in this function, and state what makes it dangerous in production:

```python
def save(record):
    try:
        write_to_disk(record)
    except Exception:
        pass
```

**H13.** Predict the exact message of the raised exception: `{"a": 1}["b"]`. Then predict `str(error)` and explain why it includes quotes around the key.

**H14.** Predict what happens when `e` is printed after the `except` block ends, and explain why:

```python
try:
    int("x")
except ValueError as e:
    pass

print(e)
```

**H15.** Write `safe_int(text, default=0)` that never raises and uses only specific exception types.

**H16.** Given this traceback, state the exception type, the exact line where it was raised, and a one-line fix using a dict method:

```text
Traceback (most recent call last):
  File "app.py", line 10, in <module>
    main()
  File "app.py", line 7, in main
    print(total["items"])
KeyError: 'items'
```

**H17.** Predict what happens, then explain why `except Exception` does not catch this:

```python
try:
    raise KeyboardInterrupt
except Exception:
    print("caught")
```

**H18.** Write `divide(a, b)` that raises `ZeroDivisionError` with a clear message when `b == 0`, and `safe_divide(a, b)` returning `None` in that case. Justify choosing `ZeroDivisionError` over a custom exception.

**H19.** Predict both printed lines and state whether the program ends normally:

```python
try:
    try:
        raise ValueError("x")
    finally:
        print("inner cleanup")
except ValueError:
    print("outer caught")
```

**H20.** A function must never leak internal library exceptions. Write its contract: catch the library-specific error, `raise` your `ServiceError` `from` it, and show a caller catching only `ServiceError` while the original cause is preserved.

## Group I — Context managers and resource management

**I1.** Predict the exact output order:

```python
class CM:
    def __init__(self, name):
        self.name = name

    def __enter__(self):
        print("enter", self.name)
        return self.name

    def __exit__(self, exc_type, exc, tb):
        print("exit", self.name)

with CM("a") as a, CM("b") as b:
    print("body", a, b)
```

**I2.** Predict the output and explain why no traceback appears:

```python
class Swallow:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return True

with Swallow():
    raise ValueError("boom")
print("done")
```

**I3.** Predict what is printed and which line never runs, then change the class so the exception is suppressed:

```python
class Propagate:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

with Propagate():
    raise ValueError("boom")
print("done")
```

**I4.** Write a context manager class `Overrides` that applies a dict of updates to a passed-in dict on enter and restores the original keys (including deletions) on exit, even when the body raises.

**I5.** Predict the output:

```python
from contextlib import contextmanager

@contextmanager
def section(name):
    print("begin", name)
    yield name
    print("end", name)

with section("x") as s:
    print("inside", s)
```

**I6.** Predict everything printed and whether `"after"` is ever printed:

```python
from contextlib import contextmanager

@contextmanager
def section():
    print("begin")
    try:
        yield
    finally:
        print("end")

with section():
    raise ValueError("x")
print("after")
```

**I7.** Predict both outputs: one for `with suppress(ZeroDivisionError): 1 / 0`, then what happens with `with suppress(KeyError): 1 / 0`.

**I8.** Rewrite this `try/finally` using `with connection() as client:`, where `connection()` is a provided context manager yielding a client with `send`:

```python
client = connect()
try:
    client.send("x")
finally:
    client.close()
```

**I9.** Predict the value of `f.closed` and explain who closes the file:

```python
with open("data.txt", "w") as f:
    f.write("hello")
print(f.closed)
```

**I10.** Predict the exit order when the body raises, and name which manager's `__exit__` sees the exception first:

```python
class CM:
    def __init__(self, name):
        self.name = name

    def __enter__(self):
        print("enter", self.name)
        return self

    def __exit__(self, exc_type, exc, tb):
        print("exit", self.name)
        return False

with CM("a"), CM("b"):
    raise ValueError("boom")
```

**I11.** Write a generator-based context manager `timed()` using `contextmanager` that prints `"start"` on enter and `"stop"` on exit, including when an exception occurs.

**I12.** Explain when `try/finally` is necessary instead of `with`, giving one realistic example from backend code where a context manager is still the better choice.

**I13.** State the difference in behavior between returning `None`, `False`, and `True` from `__exit__`. Then determine which exceptions this class suppresses, and rewrite it so no exception is ever suppressed:

```python
class Mystery:
    def __exit__(self, exc_type, exc, tb):
        return exc_type is ValueError
```

**I14.** Write a `push_tag(tags, tag)` context manager that appends `tag` on enter and pops it on exit, and show nested usage leaving the list in its original state.

**I15.** A function opens a connection, uses it, and returns a result. Explain the bug and fix it with `with`:

```python
def query(sql):
    conn = connect()
    result = conn.execute(sql)
    conn.close()
    return result
```

## Group J — Conventions and readable code

**J1.** List at least five PEP 8 or convention violations in this snippet:

```python
import os,sys
import requests
from mypkg import Db

MAX_RETRIES=3

class user_service:
    def Fetch_User(self,UserID):
        return Db.get(UserID)
```

**J2.** Rewrite this function so it returns a value instead of printing, and show the caller printing the result:

```python
def summarize(code):
    print(f"status {code}")
    print(f"severity {'high' if code >= 500 else 'low'}")
```

**J3.** Make the `verbose` flag keyword-only and show a call site that reads clearly:

```python
def fetch(url, retries=3, verbose=False):
    ...
```

**J4.** Replace the `**kwargs` soup with explicit keyword-only parameters for the two options actually supported:

```python
def configure(**options):
    timeout = options.get("timeout", 10)
    retries = options.get("retries", 3)
    return timeout, retries
```

**J5.** Write a one-line docstring for `def retry(fn, attempts=3)` and identify what is wrong with this docstring: `"""This function retries the function."""`

**J6.** Replace the `assert` statements with proper input validation and explain what `python -O` does to this code:

```python
def withdraw(balance, amount):
    assert amount > 0
    assert amount <= balance
    return balance - amount
```

**J7.** Reorganize this single-file script into `config.py` and `main.py`: move the constants and `load` function, import them in `main.py`, and add a `main()` function with a `__main__` guard.

```python
DEFAULT_TIMEOUT = 10

def load(overrides):
    config = {"timeout": DEFAULT_TIMEOUT}
    config.update(overrides)
    return config

print(load({"timeout": 30}))
```

**J8.** Rename the identifiers to follow PEP 8 without changing behavior:

```python
def CalcTotal(ItemList, TaxRate=0.2):
    Total = sum(ItemList)
    return Total * (1 + TaxRate)
```

**J9.** Explain why the module-level `cache` makes this function hard to test, then rewrite it so the cache is injected by the caller (allow omitting it by using a `None` default that creates a fresh cache, not a mutable default):

```python
cache = {}

def get_user(user_id):
    if user_id not in cache:
        cache[user_id] = fetch(user_id)
    return cache[user_id]
```

**J10.** Rename these exception classes so they describe failures, not reactions: `RetryException`, `BadStuffError`, `Error1`.

**J11.** Refactor the nested conditionals into guard clauses:

```python
def process(payload):
    if payload is not None:
        if "id" in payload:
            if payload["id"] > 0:
                return payload["id"] * 2
            else:
                raise ValueError("bad id")
        else:
            raise ValueError("missing id")
    else:
        raise ValueError("no payload")
```

**J12.** Identify the cleverness problem in this expression and rewrite it as a plain loop:

```python
result = [y for x in data if x for y in (x.strip().lower(),) if y]
```

**J13.** Given a function that does four unrelated things (parses, validates, logs, and sends), describe how to split it and why smaller functions improve testability. Rewrite as a sketch of three functions.

**J14.** State whether each of these belongs in a docstring, a comment, or neither: (a) the units of a parameter, (b) `# increment i by 1`, (c) the exception types a function raises.

## Group K — TypeScript translations

**K1.** Translate to Python using a `TypedDict` and an annotated function:

```typescript
interface Config { timeout: number; retries: number; endpoint: string; }
function describe(config: Config): string {
  return `${config.endpoint}:${config.timeout}`;
}
```

**K2.** Translate to Python, replacing the private field and getter with a property:

```typescript
class Wallet {
  private _balance = 0;
  get balance(): number { return this._balance; }
  deposit(amount: number): void { this._balance += amount; }
}
```

**K3.** Translate the string union to Python using `Literal`, keeping the function signature:

```typescript
type Level = "debug" | "info" | "error";
function setLevel(level: Level): void {}
```

**K4.** Translate to Python and note what Python requires that TypeScript's catch does not:

```typescript
try {
  risky();
} catch (e) {
  if (e instanceof TypeError) console.log("type");
  else throw e;
}
```

**K5.** Translate this generic TypeScript function using `TypeVar`:

```typescript
function first<T>(items: T[]): T | undefined {
  return items[0];
}
```

**K6.** Translate the readonly record to a frozen dataclass:

```typescript
interface Point { readonly x: number; readonly y: number; }
```

**K7.** Translate the static factory to a classmethod:

```typescript
class User {
  constructor(public id: number, public name: string) {}
  static fromRow(row: [number, string]): User {
    return new User(row[0], row[1]);
  }
}
```

**K8.** Python has no `implements`. Translate this relationship using composition or duck typing plus a type hint, and explain the choice:

```typescript
interface Sender { send(msg: string): void; }
class EmailSender implements Sender { send(msg: string) {} }
function notify(sender: Sender, msg: string) { sender.send(msg); }
```

**K9.** Choose the Python equivalent of a TypeScript `enum` for log levels and justify: module-level `UPPER_SNAKE` constants, `Literal`, or `enum.Enum` with small string values.

**K10.** Translate the abstract class to Python, using `NotImplementedError` rather than `abc`:

```typescript
abstract class Store {
  abstract get(key: string): string | null;
  has(key: string): boolean { return this.get(key) !== null; }
}
```

**K11.** Translate this TypeScript error handling contract: a function that throws `ApiError` with a status code and is caught by a caller checking `instanceof`. Show the Python exception classes and the caller's `except` clause.

## Group L — Mixed realistic tasks

These combine several chapter concepts and target the kind of code you will write in AI and backend services. Keep implementations small and idiomatic.

**L1.** Build a mini module skeleton for a service: a `Settings` dataclass with `timeout: int = 10` and `retries: int = 3`; a custom `ConfigError(Exception)`; a `load_settings(overrides: dict)` function that merges defaults with overrides, converts `"timeout"` to `int`, and raises `ConfigError` on bad values; and a `main()` with a `__main__` guard. Show the import surface another module would use.

**L2.** Write a generator pipeline over log lines shaped `"LEVEL: message"`: `parse(lines)` yielding `{"level": ..., "message": ...}`, then a `by_level(lines)` function returning `{"ERROR": 2, "INFO": 1}` for `["INFO: up", "ERROR: down", "ERROR: still down"]`. Validate with a `TypedDict`.

**L3.** Write a `PageIterator` class simulating pagination: constructed with a list of pages (each page is a list of items), it yields items across pages in order, raising `StopIteration` when done. Show `list(PageIterator(...))` on three pages and explain why a class is needed instead of a generator expression.

**L4.** Write `with_retries(fn, attempts=3)` that calls `fn()`, catches only a `TransientError` subclass of `ApiError`, retries up to `attempts` times, and re-raises the last failure if all attempts fail. A `PermanentError` must propagate immediately. Show both custom exceptions in one definition block.

**L5.** Write a `ModelResponse` dataclass with `status: int`, `body: dict`, `headers: dict[str, str]` (fresh per instance), and an `ok` property. Then produce the JSON-serializable dict for a success response using `asdict`.

**L6.** Write a generator-based context manager `elapsed(label)` that prints `f"{label}: start"` on enter, `f"{label}: stop"` on exit, including when the body raises, and returns `label` from enter. Show usage around a function that raises `ValueError` and state whether the exception propagates.

**L7.** Define a `TypedDict` `Event` with required `id: int` and `name: str` and optional `tags: list[str]`. Write `validate_event(event)` raising a custom `ValidationError` (with a message naming the offending key) for: missing keys, `id` not an `int`, empty `name`. Return `None` on success.

**L8.** Define `ProviderError(Exception)` and subclasses `RateLimitError`, `TimeoutError` (name it `RequestTimeout` to avoid clashing with the builtin), and `InvalidRequestError`. Write `classify(status)` mapping 429 to `RateLimitError`, 408/504 to `RequestTimeout`, 4xx to `InvalidRequestError`, and returning `None` otherwise. Explain which failures a retry loop should retry.

**L9.** Given a generator `responses()` yielding `{"model": str, "usage": {"total_tokens": int}}` where some entries lack `"usage"`, write `total_tokens(responses)` that consumes the stream once and returns the total, using `.get` for the missing case.

**L10.** Refactor this class so `Notifier` composes a `Logger` and an `EmailClient` instead of inheriting from either, and can be constructed with fakes in tests:

```python
class Logger:
    def info(self, msg):
        print(msg)

class EmailClient:
    def send(self, to, body):
        return {"to": to, "status": "sent"}

class Notifier(Logger, EmailClient):
    def notify(self, to, event):
        self.info(f"notify {to}")
        return self.send(to, event)
```

**L11.** Create a frozen dataclass `Deployment(version: str, replicas: int)` and show two updates using `replace`: bumping replicas and then version, verifying the original instance is unchanged.

**L12.** Implement configuration precedence with dataclasses: `Settings` defaults, a `replace`-based `apply_overrides(settings, overrides)` function that ignores unknown keys, and a demonstration that the original settings object is untouched.

**L13.** Rewrite this script into a proper module: no work at import time, functions return values, and a `main()` with a guard decides what to print.

```python
import json

with open("events.json") as f:
    events = json.load(f)

counts = {}
for event in events:
    counts[event["type"]] = counts.get(event["type"], 0) + 1

print(counts)
```

**L14.** Choose the right structure for each piece of an AI service and justify in one sentence each: (a) the raw JSON payload from the provider, (b) the internal normalized response with a method to check success, (c) the configuration loaded from environment variables, (d) the tuple returned by an internal helper that the caller unpacks on the next line.

**L15.** Write a `unique(iterable)` generator that yields items in order, skipping values already seen, using a set for membership. Explain why the set cannot be avoided while keeping O(n) behavior.

**L16.** Write `process_batches(items, size, handler)`: a generator pipeline that chunks `items`, calls `handler(batch)`, and stops early (returning so far) if the handler raises a `PermanentError`, while letting `TransientError` propagate to the caller. Provide the exception classes and a short usage sketch.

**L17.** In this module, `load_token()` performs an HTTP request. Describe exactly what happens at import time, whether importing it in tests has side effects, and what you would change:

```python
import requests

BASE_URL = "https://api.example.com"
session = requests.Session()
DEFAULT_HEADERS = {"Authorization": f"Bearer {load_token()}"}

def fetch(path):
    return session.get(BASE_URL + path, headers=DEFAULT_HEADERS)
```

**L18.** Design a tiny `Cache` abstraction for a service: a class with `get(key)` and `put(key, value)`, an `in_memory_cache()` classmethod, and a `@contextmanager`-based `locked(cache)` helper that prints `"lock acquired"` and `"lock released"` around a block. Keep it under 25 lines and use type hints throughout.

---

## Before moving on

Check yourself against the chapter outcome without looking back at the notes:

- Create modules and packages with correct imports, no import-time side effects, and a `__main__` guard.
- Write a class with `__init__`, methods, `__repr__`, `__eq__`, and a property, and explain what `__hash__` must satisfy.
- Choose between inheritance and composition, and refactor the wrong one into the right one.
- Convert boilerplate classes to dataclasses with safe mutable defaults, and choose sensibly between `dict`, `TypedDict`, and dataclasses.
- Annotate function signatures, JSON-shaped data, and generics with hints, knowing the runtime does not enforce them.
- Use iterators and generator pipelines for streaming, and recognize exhausted-iterator bugs.
- Raise, catch, chain, and classify exceptions with a small custom hierarchy; never swallow errors.
- Write and use context managers for guaranteed cleanup.
- Produce code a Python reviewer would not reformat: naming, imports, small functions, explicit dependencies.

If any group felt slow, redo a subset of its exercises from scratch before continuing to Chapter 3.
