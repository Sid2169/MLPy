# Chapter 1 — Python Language Fundamentals

This chapter builds Python-specific fluency for a developer who already programs in TypeScript and knows backend development. It focuses on the rules, semantics, and idioms that make Python behave differently from TypeScript: names and objects, mutability and aliasing, truthiness, comprehensions, unpacking, function arguments, and scope.

Practice by typing every example into a Python REPL or a scratch file. Predicting behavior precisely, before running the code, is the fastest way to build fluency.

Nothing in the exercise sections has answers. Work them out by reasoning first, then verify by running code.

## Contents

1. Names, objects, and assignment
2. Numbers
3. Strings
4. Booleans, `None`, and truthiness
5. Identity and equality
6. Lists
7. Tuples
8. Dictionaries
9. Sets
10. Conditionals and loops
11. Comprehensions
12. Unpacking
13. Functions and arguments
14. Scope
15. Idioms and common mistakes
16. Exercises (Groups A–N)

---

## 1. Names, objects, and assignment

In Python, a variable is a **name bound to an object**. Assignment never copies a value into a named box; it attaches a name to an existing object. Types belong to objects, not to names, and a name can be rebound to an object of a different type at any time.

```python
count = 0          # name 'count' -> int object 0
count = "zero"     # rebinding the name to a str object; no error
```

There are no `let`/`const`/`var` declarations and no type annotations required. A type annotation is a hint for readers and tools; it is not enforced at runtime (more on this in section 13).

### Assignment binds, it does not copy

```python
a = [1, 2, 3]
b = a              # b and a refer to the SAME list object
b.append(4)
print(a)           # [1, 2, 3, 4]
```

Compare with TypeScript, where `const b = a` for an array has the same aliasing behavior. The Python rules are the same, but they apply to *everything*: no primitives are special, and there are no copy-on-assignment semantics for any type.

Rebinding a name leaves the original object untouched:

```python
a = [1, 2, 3]
b = a
b = b + [4]        # creates a NEW list and rebinds b
print(a)           # [1, 2, 3]
print(b)           # [1, 2, 3, 4]
```

But mutating in place affects every name that refers to the object:

```python
a = [1, 2, 3]
b = a
b += [4]           # for lists, += mutates in place (same as extend)
print(a)           # [1, 2, 3, 4]
```

`id(obj)` returns the identity of an object (its address in CPython). Two names referring to the same object have the same `id`. The `is` operator compares identity (section 5).

Everyday conventions:

- `snake_case` for names and functions; `PascalCase` for classes; `UPPER_SNAKE` for constants by convention only.
- Multiple assignment works: `x = y = 0`.
- Augmented assignment: `+=`, `-=`, `*=`, `/=`, `//=`, `**=`, `%=`.

---

## 2. Numbers

Two everyday numeric types:

- `int` — arbitrary precision. There is no 32/64-bit overflow.
- `float` — IEEE 754 double precision, like JavaScript numbers.

```python
big = 2 ** 100             # 1267650600228229401496703205376
print(type(10), type(10.0))  # <class 'int'> <class 'float'>
```

### Operators that differ from TypeScript

```python
print(7 / 2)      # 3.5   -- / ALWAYS produces a float
print(7 // 2)     # 3     -- floor division
print(7 % 2)      # 1
print(2 ** 10)    # 1024  -- ** is exponentiation, ^ is NOT
```

Floor division and modulo round toward negative infinity, not toward zero:

```python
print(-7 // 2)    # -4
print(-7 % 2)     # 1     (result has the sign of the divisor)
print(-7 // -2)   # 3
print(-7 % -2)    # -1
```

JavaScript's `Math.floor(-7 / 2)` is `-4`, matching `//`. JavaScript's `%` returns `-1` for `-7 % 2`, which does not match Python.

### Conversions and pitfalls

```python
int("42")       # 42
int("3.9")      # ValueError -- not a valid integer literal
int(3.9)        # 3    -- truncates toward zero
int(-3.9)       # -3
int("ff", 16)   # 255  -- optional base
float("2.5")    # 2.5
float("nan")    # nan
float("inf")    # inf
str(2.5)        # "2.5"
```

`round` uses banker's rounding (round half to even):

```python
round(0.5)      # 0
round(1.5)      # 2
round(2.5)      # 2
round(2.675, 2) # 2.67  -- binary representation strikes again
```

Floating point behaves exactly as in JavaScript; compare with `math.isclose` when needed:

```python
import math
print(0.1 + 0.2)                    # 0.30000000000000004
print(0.1 + 0.2 == 0.3)             # False
print(math.isclose(0.1 + 0.2, 0.3)) # True
```

Also useful: `abs`, `divmod(a, b)` (returns `(a // b, a % b)`), `min`, `max`, `sum`, `pow`, and the `math` module. Numeric literals may use underscores (`1_000_000`) and bases (`0b1010`, `0o17`, `0x1F`).

Booleans are numbers: `True == 1` and `True + True == 2`. Never use this for arithmetic in application code, but expect to encounter it in code that sums flags.

---

## 3. Strings

Strings are **immutable sequences of Unicode code points**.

```python
s = "hello"
s2 = 'single quotes work too'
s3 = """triple quotes
span multiple lines"""
raw = r"C:\new\folder"     # backslashes are literal
```

No method ever mutates a string; every "modifying" method returns a new one.

### Indexing and slicing

```python
s = "python"
print(s[0])      # p
print(s[-1])     # n
print(s[1:4])    # yth      (end index is exclusive)
print(s[:3])     # pyt
print(s[3:])     # hon
print(s[::2])    # pto
print(s[::-1])   # nohtyp
```

Key differences from JavaScript and TypeScript:

- Negative indexes are normal and legal (`s[-1]`), unlike JS arrays.
- `s[2:100]` does *not* error on an out-of-range end; it returns `"thon"`.
- `s[100]` *does* raise `IndexError`.
- Slices copy: `t = s[1:3]` is a new string object.

### f-strings and formatting

```python
name = "Ada"
score = 91.2567

print(f"{name} scored {score:.1f}")      # Ada scored 91.3
print(f"{1234567:,}")                    # 1,234,567
print(f"{42:05d}")                       # 00042
print(f"{0.75:.0%}")                     # 75%
print(f"{name!r}")                       # 'Ada'
print(f"{score=}")                       # score=91.2567
```

`f"{x=}"` (Python 3.8+) prints the expression text and its value — handy for debugging.

### Common string operations

```python
s = "  Hello, World  "
s.strip()                 # "Hello, World"
s.strip().lower()         # "hello, world"
s.strip().split(", ")     # ["Hello", "World"]
",".join(["a", "b"])      # "a,b"
"hello".replace("l", "L") # "heLLo"
"hello".startswith("he")  # True
"hello".find("z")         # -1    (index() raises ValueError instead)
"hello".count("l")        # 2
"ell" in "hello"          # True
len("hello")              # 5
```

Details worth remembering:

- `"".join(parts)` is the idiomatic way to concatenate many strings. Joining non-strings raises `TypeError`.
- `text.split()` with no arguments splits on runs of whitespace and removes empty strings; `text.split(" ")` does not.
- `"abc" + 1` raises `TypeError`. You must convert explicitly: `"abc" + str(1)`.
- `"-" * 3` is `"---"`; multiplying a string by an int repeats it.
- `str()` and `repr()` differ: `str("a")` is `a`, `repr("a")` is `'a'`. `print` uses `str`; containers display their elements with `repr`.
- String comparison is by code point: `"Z" < "a"` is `True`.
- Text is Unicode; converting to bytes uses `s.encode("utf-8")` and `b.decode("utf-8")`. You will need this when working with files and HTTP (Chapters 3 and 5).

---

## 4. Booleans, `None`, and truthiness

Booleans are capitalized: `True` and `False` (TypeScript's `true`/`false` do not exist). The null-like value is `None`.

Python has a general notion of **truthiness**. These values are falsy:

- `None`
- `False`
- `0`, `0.0`, `0j`
- `""` (empty string)
- `[]`, `()`, `{}`, `set()` (empty containers)

Everything else is truthy, including `"0"`, `"False"`, `[0]`, and `" "`.

```python
if []:
    print("never runs")
if "False":
    print("runs, because non-empty strings are truthy")
```

Boolean operators return **operands**, not booleans:

```python
print(0 or "default")     # default
print("a" and "b")        # b
print("" or 0 or [])      # []     -- all falsy; returns the last one
print("a" and "" and 5)   # ""     -- short-circuits at the first falsy
```

This powers the default-value idiom, which has a trap with falsy-but-valid values:

```python
name = supplied or "anonymous"   # "" and 0 are replaced too!
```

The safe version when `""` or `0` are valid inputs:

```python
name = supplied if supplied is not None else "anonymous"
```

Comparison operators (`==`, `<`, `>=`, `!=`, `in`, `is`) produce actual booleans, which is why the distinction above matters.

`None` checks use `is`, never `==`:

```python
result = None
if result is None:
    print("no result")
```

Functions that fall off the end return `None`. `print()` also returns `None` — a classic source of `x = print(...)` bugs.

The conditional expression is written in the opposite order from TypeScript:

```python
status = "ok" if score >= 60 else "fail"
```

There is no `??` or `?.` operator. Use explicit `is None` checks or `dict.get`.

---

## 5. Identity and equality

Two operators that TypeScript does not separate:

- `==` — **equality**: calls `__eq__`; same value.
- `is` — **identity**: same object (`id(a) == id(b)`).

```python
a = [1, 2]
b = [1, 2]
c = a
print(a == b)   # True  (equal contents)
print(a is b)   # False (different objects)
print(a is c)   # True  (same object)
print(a == c)   # True
```

Rules of thumb:

- Use `is` only with `None` and sentinel objects: `x is None`, `x is not None`.
- Use `==` for everything else.
- Do not use `is` to compare numbers or strings. CPython caches small ints (`-5..256`) and interns some strings, so `x is y` for equal values can be `True` or `False` depending on context. Never depend on it.

```python
x = 256
y = 256
print(x is y)   # True in CPython -- an implementation detail, not a language rule

x = 1000
y = 1000
print(x is y)   # may be True or False depending on how the code was compiled
```

Some equality facts that differ from JavaScript:

```python
print(1 == 1.0)    # True   -- numeric comparison across types
print(1 == True)   # True   -- bool is a subtype of int
print(0 == False)  # True
print("1" == 1)    # False  -- no coercion
```

`is` also appears in chained form, as do all comparisons. A chained comparison evaluates each operand once and means "pairwise and":

```python
x = 5
print(1 < x < 10)          # True
print(10 < x < 20)         # False
names = []
print(names == [])         # True (prefer 'if not names:' instead)
```

NaN is never equal to itself: `float("nan") == float("nan")` is `False`. Detect with `math.isnan`.

---

## 6. Lists

Lists are mutable, ordered, heterogeneous sequences — the Python workhorse for ordered collections.

```python
xs = [3, 1, 2]
xs.append(4)         # [3, 1, 2, 4]
xs.sort()            # [1, 2, 3, 4]        (sorts in place, returns None)
xs.insert(0, 0)      # [0, 1, 2, 3, 4]
xs.pop()             # returns 4, list is [0, 1, 2, 3]
xs.remove(2)         # removes first occurrence of value 2
xs.index(3)          # 3  (raises ValueError if absent)
xs.count(1)          # 1
xs.extend([9, 9])    # appends each item
len(xs)              # length
```

Critical rule: **in-place methods return `None`**. This is a common bug:

```python
xs = [3, 1, 2]
ys = xs.sort()       # ys is None!
print(ys)            # None
```

Use `sorted(xs)` when you want a new list and to leave the original alone:

```python
xs = [3, 1, 2]
ys = sorted(xs)              # xs unchanged, ys == [1, 2, 3]
ys = sorted(xs, reverse=True)  # [3, 2, 1]
words = ["bb", "a", "ccc"]
words.sort(key=len)            # ["a", "bb", "ccc"]
```

### Indexing, slicing, and mutation

```python
xs = ["a", "b", "c", "d"]
xs[0]                # "a"
xs[-1]               # "d"
xs[1:3]              # ["b", "c"]  -- new list
xs[4:10]             # []          -- slice past the end is fine
xs[0] = "A"          # item assignment works (unlike strings)
del xs[1]            # remove by index
xs[1:3] = ["X", "Y", "Z"]   # slice assignment can change length
```

### Aliasing and copies

```python
a = [1, [2, 3]]
b = a              # alias
c = a[:]           # shallow copy: outer list is new, inner objects shared
d = a.copy()       # same as a[:]
import copy
e = copy.deepcopy(a)   # recursive copy
```

The classic multiplication trap:

```python
grid = [[0] * 3] * 3   # WRONG: three references to ONE inner list
grid[0][0] = 1
print(grid)            # [[1, 0, 0], [1, 0, 0], [1, 0, 0]]

grid = [[0] * 3 for _ in range(3)]   # correct: three distinct rows
```

Also note the difference between `+` (new list) and `+=` (mutates in place, same as `extend`):

```python
a = [1]
b = a
a = a + [2]   # b still [1]
a = [1]
b = a
a += [2]      # b is now [1, 2]
```

Other useful facts:

- `in` performs linear search: `2 in [1, 2, 3]`.
- Lists compare elementwise with `==`; ordering comparisons work lexicographically.
- Never mutate a list while iterating over it; iterate over a copy (`for x in xs[:]`) or build a new list with a comprehension.
- `list("abc")` gives `["a", "b", "c"]`; `list(range(3))` gives `[0, 1, 2]`.
- `sum`, `min`, `max`, `any`, `all` accept lists: `sum([1, 2, 3])` is `6`.

---

## 7. Tuples

Tuples are immutable sequences, typically used for fixed-shape records and multiple return values.

```python
point = (3, 4)
x, y = point          # unpacking
print(point[0], len(point))

single = (1)          # this is just the int 1!
single = (1,)         # one-element tuple needs a trailing comma
empty = ()

nested = (1, (2, 3))
nested[1][1]          # 3
nested[0] = 9         # TypeError: tuples do not support item assignment
```

Facts worth knowing:

- Tuples support concatenation (`(1, 2) + (3,)`) and repetition, and slices return new tuples.
- Tuples are hashable when all their elements are hashable, so they can be dictionary keys or set members. Lists cannot.
- "Immutable" is shallow: `t = (1, [2])` forbids `t[1] = ...` but `t[1].append(3)` works.
- A trailing comma creates a tuple in unpacking contexts too: `a, = [1]` binds `a = 1`.
- `sorted(tup)` returns a *list*.

Choosing between list and tuple: use a list for homogeneous, growable sequences; use a tuple for fixed sets of fields (coordinates, `(status, body)` pairs) and when you need hashability.

---

## 8. Dictionaries

Dictionaries map hashable keys to values and preserve insertion order.

```python
user = {"id": 1, "name": "Ada"}
user["name"]           # "Ada"
user["email"]          # KeyError!
user.get("email")      # None
user.get("email", "")  # "" (default)
user["email"] = "a@x.com"   # add or update
del user["email"]           # remove (KeyError if absent)
"name" in user              # True -- checks KEYS
"Ada" in user.values()      # check values explicitly
len(user)                   # 2

for key, value in user.items():
    print(key, value)
```

Idioms:

```python
counts = {}
for word in ["a", "b", "a"]:
    counts[word] = counts.get(word, 0) + 1     # counting

buckets = {}
buckets.setdefault("a", []).append(1)          # grouping / multi-value

pairs = dict(zip(["a", "b"], [1, 2]))          # {"a": 1, "b": 2}
squares = {n: n * n for n in range(3)}         # {0: 0, 1: 1, 2: 4}
deduped = list(dict.fromkeys(["b", "a", "b"])) # ["b", "a"] order preserved
```

Merging and updating:

```python
defaults = {"timeout": 10, "retries": 3}
override = {"timeout": 30}
merged = {**defaults, **override}   # {"timeout": 30, "retries": 3}
merged = defaults | override        # same, Python 3.9+
defaults.update(override)           # in-place; returns None
```

Subtleties:

- Keys must be hashable: strings, numbers, and tuples are fine; lists and dicts are not.
- `1` and `True` are equal and hash the same, so `{1: "a", True: "b"}` collapses to `{1: "b"}`.
- Two dicts are `==` when they have the same key-value pairs regardless of order.
- Accessing a missing key raises `KeyError`; prefer `get` for optional keys.
- Nested structures are accessed by chaining: `response["data"]["items"][0]["id"]`. Each step is an independent lookup with its own error behavior.
- `d.keys()`, `d.values()`, `d.items()` are live views; `list(d)` gives the keys.

---

## 9. Sets

Sets are unordered collections of unique hashable elements.

```python
s = {1, 2, 3}
empty = set()          # NOT {} -- that is an empty dict
s.add(4)
s.discard(99)          # no error if missing
s.remove(99)           # KeyError if missing
2 in s                 # fast membership (hash-based)
len(s)

a = {1, 2, 3}
b = {3, 4}
a | b       # {1, 2, 3, 4}  union
a & b       # {3}           intersection
a - b       # {1, 2}        difference
a ^ b       # {1, 2, 4}     symmetric difference
a <= {1, 2, 3, 4}   # True -- subset
```

Rules and uses:

- Sets have no indexing or slicing: `s[0]` raises `TypeError`.
- Iteration order is unspecified; never rely on printed set order. Sort before display: `sorted(s)`.
- Elements must be hashable; `{1, [2]}` raises `TypeError`.
- `set([1, 1, 2])` produces `{1, 2}`; `set("hello")` produces the distinct characters.
- Membership in a set is O(1) on average versus O(n) for a list — use a set for "have I seen this?" checks in loops.
- `frozenset` is the immutable, hashable variant usable as a dict key.
- Set comprehension syntax: `{x * 2 for x in xs}`.

---

## 10. Conditionals and loops

### Indentation defines blocks

Python uses indentation (four spaces by convention) with a trailing colon. There are no braces and no semicolons needed. Mixing tabs and spaces raises errors.

```python
score = 75
if score >= 90:
    grade = "A"
elif score >= 60:
    grade = "pass"
else:
    grade = "fail"
```

There is no `switch` in older Python; since 3.10, `match` provides structural pattern matching:

```python
command = "start"
match command:
    case "start":
        print("starting")
    case "stop" | "halt":
        print("stopping")
    case _:
        print("unknown")
```

`pass` is a no-op placeholder used when syntax requires a block:

```python
def todo():
    pass
```

Walrus assignment inside conditions is occasionally useful:

```python
if (n := len(items)) > 10:
    print(f"too many: {n}")
```

### `for` iterates over objects, not indices

```python
for ch in "abc":
    print(ch)

for i in range(3):          # 0, 1, 2
    print(i)

for i in range(1, 6, 2):    # 1, 3, 5
    print(i)

for i in range(len(xs)):    # legal but usually a smell; prefer enumerate
    print(xs[i])

for i, value in enumerate(xs, start=1):
    print(i, value)

for name, age in zip(names, ages):   # stops at the shorter one
    print(name, age)

for name, age in zip(names, ages, strict=True):  # 3.10+: error on length mismatch
    print(name, age)

for k, v in dict_example.items():
    print(k, v)
```

Key differences from TypeScript/JavaScript:

- No C-style `for (init; cond; step)`; combine `while` with manual counters if genuinely needed.
- `for` works on any iterable (strings, lists, dicts, files, generators).
- `range` is lazy (a compact sequence object), not a list: `list(range(3))` converts.

### `while`, `break`, `continue`, `else`

```python
i = 0
while i < 3:
    i += 1

while True:
    line = next_line()
    if line is None:
        break
```

`for` and `while` both support an `else` clause executed only if the loop was *not* exited via `break`:

```python
for n in numbers:
    if n < 0:
        print("negative found")
        break
else:
    print("all non-negative")
```

`continue` skips to the next iteration. `while True` plus `break` is idiomatic for retry/read loops.

### Loops and truthiness together

- `if xs:` means "if non-empty"; `if not xs:` means "empty". This is idiomatic Python.
- `any(xs)` and `all(xs)` expect already-computed booleans; with a generator expression they short-circuit: `any(x > 0 for x in xs)`.
- Comparisons chain: `0 <= i < len(xs)`.
- `and`/`or` short-circuit and return operands (section 4), which is why `if not found and name` patterns work.

Traps:

- The loop variable persists after the loop: `for i in range(3): pass; print(i)` prints `2`. Python has no block scope.
- Removing items from a list while iterating it skips elements. Iterate over a copy or rebuild.
- Repeated `x in some_list` inside a loop is O(n²); convert to a set once.

---

## 11. Comprehensions

Comprehensions build a new collection from an iterable in one expression. They are central to idiomatic Python.

```python
xs = [1, -2, 3, -4]

squares = [x * x for x in xs]                  # [1, 4, 9, 16]
positives = [x for x in xs if x > 0]           # [1, 3]
abs_values = [x if x > 0 else -x for x in xs]  # [1, 2, 3, 4]
pairs = {x: x * x for x in range(3)}           # {0: 0, 1: 1, 2: 4}
unique_lens = {len(w) for w in ["a", "bb", "c"]}  # {1, 2}
flat = [c for word in ["ab", "cd"] for c in word]  # ["a", "b", "c", "d"]
```

Reading order of a nested comprehension: the `for` clauses appear in the same order you would write nested loops; the expression on the left is the innermost body.

```python
matrix = [[1, 2], [3, 4]]
flat = [n for row in matrix for n in row]   # [1, 2, 3, 4]
```

Rules and guidance:

- A conditional filter (`if x > 0`) goes after the `for`; an if/else expression goes *before* the `for`.
- Comprehension variables live in their own scope and do not leak.
- Prefer a comprehension to `map`/`filter` chains; Python's equivalents are less idiomatic for simple transformations.
- Do not use comprehensions for side effects (`[print(x) for x in xs]` is an anti-pattern).
- If the logic needs more than two `for`/`if` clauses, or nested conditionals, write a loop.
- A **generator expression** looks identical with parentheses instead of brackets and is lazy — it produces values on demand and is consumed once:

```python
total = sum(x * x for x in xs)   # no intermediate list is built
```

Generators get full treatment in Chapter 2; for now, use them where a function like `sum`, `any`, or `max` consumes an iterable.

---

## 12. Unpacking

Unpacking distributes the elements of an iterable into names. It is used pervasively in Python code.

```python
a, b = 1, 2
a, b = b, a                       # swap without a temporary

first, *rest = [1, 2, 3, 4]       # first=1, rest=[2, 3, 4]
*init, last = [1, 2, 3, 4]        # init=[1, 2, 3], last=4
a, *mid, z = [1, 2, 3, 4, 5]      # a=1, mid=[2, 3, 4], z=5

point = (3, 4)
x, y = point

status, body = ("ok", {"id": 7})  # mixed types are fine
```

Details:

- Only one starred target is allowed per assignment.
- Unpacking requires the counts to match (except for the starred target): `a, b = [1, 2, 3]` raises `ValueError`.
- Use `_` for values you do not need: `_, response = read()`.
- Nested unpacking works: `(a, (b, c)) = (1, (2, 3))`.
- Works in `for` headers: `for key, value in mapping.items():` and `for i, (k, v) in enumerate(mapping.items()):`.
- In function calls, `*` and `**` unpack arguments: `f(*args)` and `f(**kwargs)`.
- Building new containers: `[*a, *b]`, `{*a, *b}`, `{**d1, **d2}`.
- `zip(*pairs)` transposes a list of pairs: `zip(*[(1, 2), (3, 4)])` yields `(1, 3), (2, 4)`.

Common error messages: `ValueError: too many values to unpack` and `ValueError: not enough values to unpack`.

---

## 13. Functions and arguments

```python
def greet(name, greeting="Hello"):
    """Return a greeting message."""
    return f"{greeting}, {name}!"

print(greet("Ada"))                      # Hello, Ada!
print(greet("Ada", "Hi"))                # Hi, Ada!
print(greet("Ada", greeting="Hi"))       # Hi, Ada!
print(greet(name="Ada", greeting="Hi"))  # Hi, Ada!
```

Key rules:

- Arguments can be passed positionally or by keyword. Positional arguments must come before keyword arguments in a call.
- A function with no `return` (or a bare `return`) returns `None`.
- There is no function overloading and no arity-based dispatch: defining a second function with the same name replaces the first.
- Functions are objects: assign them to variables, pass them as arguments, store them in dicts.

### Defaults are evaluated once

Default parameter values are evaluated at function *definition* time, and the same object is reused on every call. Mutable defaults are a classic bug:

```python
def append_log(message, log=[]):
    log.append(message)
    return log

print(append_log("first"))    # ['first']
print(append_log("second"))   # ['first', 'second'] -- shared list!
```

The correct pattern is a `None` sentinel:

```python
def append_log(message, log=None):
    if log is None:
        log = []
    log.append(message)
    return log
```

### Variadic signatures

```python
def total(*numbers):            # numbers is a tuple
    return sum(numbers)

def configure(**options):       # options is a dict
    return options

print(total(1, 2, 3))               # 6
print(configure(retries=3, ttl=60)) # {'retries': 3, 'ttl': 60}
```

`*args` collects extra positional arguments; `**kwargs` collects extra keyword arguments. Names `args`/`kwargs` are conventions. Unpacking at the call site uses the same symbols:

```python
values = [1, 2, 3]
print(total(*values))                     # same as total(1, 2, 3)

config = {"retries": 3}
print(configure(**config))                # same as configure(retries=3)
```

### Keyword-only and positional-only parameters

```python
def connect(host, port, *, timeout=5, retries=2):
    ...

connect("db", 5432, timeout=10)   # ok
connect("db", 5432, 10)           # TypeError: timeout is keyword-only
```

```python
def normalize(text, /, mode="lower"):
    ...

normalize("A")            # ok
normalize(text="A")       # TypeError: text is positional-only
```

`function` definitions enforce this at the call site; TypeScript has no exact equivalent (though object destructuring patterns approximate keyword-only arguments).

### Type hints

```python
def fetch_user(user_id: int, include_deleted: bool = False) -> dict[str, object]:
    return {"id": user_id}
```

Hints are documentation and tooling input. Python does not enforce them at runtime or check them automatically: `fetch_user("abc")` runs fine and can misbehave later. Chapter 2 covers hints in depth.

### Argument semantics

Python is neither strictly "pass by value" nor "pass by reference": names inside the function are bound to the same objects the caller passed.

- Mutating an argument in place (for example `log.append(x)`) is visible to the caller.
- Rebinding a parameter (`log = []`) does not affect the caller's name.
- Reassigning a parameter never changes the caller's variable, but in-place mutation does. This mirrors the aliasing rules from section 1.

---

## 14. Scope

Python resolves names with the **LEGB** rule: **L**ocal, **E**nclosing function, **G**lobal (module), **B**uilt-in.

There is no block scope. Unlike TypeScript's `let`/`const`, a name assigned inside `if`, `for`, or `while` belongs to the enclosing function or module:

```python
for i in range(3):
    pass
print(i)            # 2 -- still defined

if condition:
    temp = 1
print(temp)         # works (if the branch ran)
```

That makes loop variables and temporaries leak, unlike TypeScript.

### Reading versus assigning

Reading a global from a function works. Assigning to a name anywhere in a function makes it local for the *entire* function, which causes `UnboundLocalError` when read before assignment:

```python
counter = 0

def bump():
    counter += 1        # UnboundLocalError: local variable 'counter'

def bump():
    global counter      # explicit; use sparingly
    counter += 1
```

For closures, `nonlocal` reassigns a name in the nearest enclosing function scope:

```python
def make_counter():
    count = 0
    def increment():
        nonlocal count
        count += 1
        return count
    return increment
```

### Other scope facts

- Builtins (`list`, `id`, `sum`, `dict`, ...) can be shadowed. `list = [1, 2]` breaks `list("ab")` for the rest of that scope. Never do this.
- Comprehension variables have their own scope and do not leak: after `[x for x in range(3)]`, `x` is undefined unless it existed before.
- Functions capture variables, not values. Lambdas created in a loop all see the final value:

```python
funcs = [lambda: i for i in range(3)]
print([f() for f in funcs])   # [2, 2, 2]
```

- `del name` removes the binding from the current namespace; it does not destroy the object while other names reference it.
- Module-level code runs top to bottom at import time; function bodies run only when called. (Modules and imports are covered in Chapter 2.)

---

## 15. Idioms and common mistakes

Idioms to adopt:

- `if not xs:` / `if xs is None:` — pick the check that matches the meaning.
- `enumerate`, `zip`, `items()` instead of index arithmetic.
- `"".join(parts)` instead of repeated `+=` for strings.
- `dict.get(key, default)` and `setdefault` for optional and grouped data.
- Comprehensions instead of `map`/`filter` loops.
- `a, b = b, a` swaps; star-unpacking for head/tail.
- f-strings for all formatting.
- `sorted(data, key=...)` instead of hand-written comparators.

Mistakes to avoid:

1. `xs = xs.sort()` — in-place methods return `None`.
2. Mutable default arguments (`def f(x, acc=[])`).
3. `[[0] * 3] * 3` — repeated aliases, not independent rows.
4. Using `is` to compare values instead of `None`/sentinels.
5. Expecting `/` to do integer division, or `%` to follow JavaScript sign rules.
6. `"count: " + n` — no implicit string conversion.
7. `{}` for an empty set; it is an empty dict.
8. Mutating a list while iterating over it.
9. Assuming loop variables disappear after the loop.
10. Trusting `and`/`or` to return booleans rather than operands.
11. Assuming `if name:` when `""` is a valid value.
12. Forgetting the comma in one-element tuples.
13. `int("3.5")` instead of `int(float("3.5"))`.
14. Shadowing builtins such as `list`, `id`, `str`, `sum`.
15. Function calls where `return` was intended, or vice versa.

---

# Exercises

Work each exercise before running code. Groups are ordered from recognition to implementation; within each group, difficulty increases. Do not look up answers — predict, run, and reconcile.

## Group A — Names, aliasing, identity, and mutability

**A1.** Predict the output:

```python
a = [1, 2]
b = a
c = a[:]
b.append(3)
c.append(4)
print(a, c)
```

**A2.** Predict the output:

```python
x = {"n": 1}
y = x
x["n"] = 2
y = {"n": 3}
print(x, y)
```

**A3.** Predict the output and explain why `xs` ends as it does:

```python
def add_item(items, item):
    items.append(item)

def replace(items):
    items = []

xs = [1]
add_item(xs, 2)
replace(xs)
print(xs)
```

**A4.** The following code was meant to copy `original` so that mutating `copy` leaves `original` untouched, but it has a bug. Identify the bug and give two different fixes:

```python
original = [1, 2, 3]
copy = original
copy.append(4)
print(original)
```

**A5.** For each pair, state whether `a is b`, `a == b`, both, or neither is `True`, and explain:

```python
a = [1, 2, 3]
b = [1, 2, 3]
```

```python
a = (1, 2)
b = a
```

```python
a = "hello"
b = "hello"
```

**A6.** Predict the output:

```python
a = [1, 2, 3]
b = a
b = b + [4]
b += [5]
print(a, b)
```

**A7.** Predict both outputs:

```python
import copy

a = [[1], [2]]
b = a[:]
c = copy.deepcopy(a)
b[0].append(9)
b.append([3])
print(a)
print(c)
```

**A8.** When run in a REPL, `a = 1000; b = 1000; a is b` may print `False`, yet `a = 256; b = 256; a is b` prints `True`. Explain both results and state the rule you should follow in your own code.

**A9.** Predict the four printed booleans:

```python
a = [1]
b = [1]
c = a
print(a is b, a is c, a == b, a == c)
```

**A10.** For each type, state whether values are mutable and whether the type is hashable: `int`, `str`, `list`, `tuple`, `dict`, `set`, `frozenset`, `bool`, `None`.

**A11.** Fill in the blank four different ways such that `b` is a copy that can be mutated independently of `a` (shallow copies are acceptable unless stated otherwise):

```python
a = [[1, 2], [3, 4]]
b = ______  # must not be "a"
```

**A12.** One of the following statements succeeds and the other raises. Identify which is which, give the exact exception type, and explain the difference:

```python
t = (1, [2, 3])
t[1].append(4)
t[0] = 9
```

**A13.** Write a function `same_object(a, b)` that returns `True` when the two arguments are the same object, implemented (a) with `id()` and (b) with `is`. State which one you would actually use.

**A14.** Predict the output:

```python
a = 5
b = a
a += 1
print(a, b)
```

**A15.** Explain why this function does not modify the caller's list, then rewrite it so it does:

```python
def clear_all(xs):
    xs = []
```

## Group B — Numbers

**B1.** Predict both lines:

```python
print(9 / 2, 9 // 2, 9 % 2)
print(-9 / 2, -9 // 2, -9 % 2)
```

**B2.** In JavaScript, `-7 % 2` is `-1`. State the results of `-7 % 2` and `-7 // 2` in Python, and explain the rounding rule for `//` and `%` with negative numbers.

**B3.** Predict the three lines, then write a comparison that correctly checks whether `a` and `b` are equal within a small tolerance:

```python
a = 0.1 + 0.2
b = 0.3
print(a)
print(a == b)
print(round(a, 1) == round(b, 1))
```

**B4.** Predict each value or state that it raises `ValueError`/`TypeError`:

```python
int("7")
int(7.9)
int(-7.9)
float("7")
str(7.5)
int("3.5")
int("  4  ")
int("0x10")
int("0x10", 16)
```

**B5.** Predict each result: `round(0.5)`, `round(1.5)`, `round(2.5)`, `round(-1.5)`, `round(-0.5)`, `round(3.14159, 2)`. Name the rounding mode Python uses.

**B6.** Predict the two tuples: `divmod(17, 5)` and `divmod(-17, 5)`.

**B7.** Predict each expression: `2 ** 64`, `2 ** 0.5`, `10 ** 20 + 1`, `-3 ** 2`, `(-3) ** 2`, `7 // 2 * 2 + 7 % 2`.

**B8.** State the value of each literal: `1_000_000`, `0b1011`, `0o12`, `0xFF`, `1e3`. Which of these are valid TypeScript literals as well?

**B9.** Predict each expression, paying attention to precedence and associativity: `2 + 3 * 4 ** 2`, `(2 + 3) * 4`, `10 - 4 - 3`, `2 ** 3 ** 2`.

**B10.** Predict the output and explain why it is not `3.0`:

```python
print(True + True + False)
print(sum([True, True, False]))
print(isinstance(True, int))
```

**B11.** Write `count_down(n)` that prints `n, n-1, ..., 1, 0`, then `"liftoff"`, using a `while` loop. Then write the same with a `for` loop and `range`.

**B12.** Write `is_close(a, b, tol=1e-9)` returning a boolean, and use it to compare `0.1 + 0.2` with `0.3`.

**B13.** Predict the outputs and state what the second demonstrates about NaN:

```python
import math
print(math.inf > 10 ** 100)
nan = float("nan")
print(nan == nan, math.isnan(nan))
```

**B14.** Predict `-1 // 10` and `-1 % 10`. Explain why the remainder is not `-1` as in JavaScript.

**B15.** A function receives `total` in cents and must print a currency string rounded to cents. Given `total = 123456.789`, write an f-string producing `$1,234.57` (assume `total` is already a plain number; you may divide by 100 first if you prefer).

## Group C — Strings

**C1.** Given `s = "mathematics"`, predict each expression: `s[:4]`, `s[4:]`, `s[-3:]`, `s[::3]`, `s[::-1]`, `s[2:100]`, `s[100:200]`, `s[100]`.

**C2.** Write two different expressions or functions that reverse a string.

**C3.** For each line, state whether it succeeds or raises, and why:

```python
s = "data"
s[0] = "D"
s = s.replace("d", "D")
s += "set"
```

**C4.** Given `x = 12.3456`, `n = 7`, `name = "api"`, predict each printed line:

```python
print(f"{x:.2f}")
print(f"{n:03d}")
print(f"{n / 8:.1%}")
print(f"{name.upper()} v{n}")
print(f"{n=}")
```

**C5.** Using `parts = ["alpha", "beta", "gamma"]` and its text form `"alpha-beta-gamma"`, write one expression that joins and one that parses back to the original list.

**C6.** Fix this line so it prints `retries: 3` without manual concatenation of mixed types:

```python
print("retries: " + 3)
```

**C7.** Predict each printed line:

```python
print("a b  c".split())
print("a b  c".split(" "))
print("a,b,".split(","))
print(",".join(["x", "y"]))
print(",".join([]))
```

**C8.** Predict: `"a-b-c".replace("-", "_").replace("a", "A")`.

**C9.** Given `s = "banana"`, predict all four: `s.find("an")`, `s.rfind("an")`, `s.index("an")`, `s.count("an")`.

**C10.** Write `is_palindrome(text)` that ignores case and all non-alphanumeric characters. Example: `"A man, a plan, a canal: Panama"` returns `True`.

**C11.** Predict each printed line and explain the difference between `str` and `repr`:

```python
print("a")
print(repr("a"))
print(["a", "b"])
```

**C12.** Predict each printed line and the length in the last line:

```python
print("a\nb")
print(r"a\nb")
print("""x
y""")
print(len("\t"))
```

**C13.** Write `normalize(text)` that trims the ends and collapses any run of whitespace (spaces, tabs, newlines) into a single space, using `split()` and `join`. Example: `normalize("  a \t b\n c ")` returns `"a b c"`.

**C14.** Given `total = 1234.5678`, predict `f"{total:,.2f}"`. Then write an expression producing `75%` from the float `0.75` using a format spec, not string concatenation.

**C15.** Predict: `"an" in "banana"`, `"x" in "banana"`, `"b" in ["b"]`, `"ab" in "abc"`.

**C16.** Predict each result: `"xxabcxx".strip("x")`, `"xxabcxx".lstrip("x")`, `"xxabcxx".rstrip("x")`, `"abc".center(7, "-")`.

**C17.** Write `initials(full_name)` turning `"ada lovelace"` into `"A.L."` (uppercase initial and dot for each word, split on whitespace).

**C18.** Given a list of raw CSV lines, write an expression that splits each line on commas and strips each field:

```python
lines = ["a, b ,c", "1,2, 3"]
```

## Group D — Booleans, `None`, and truthiness

**D1.** Classify each as truthy or falsy: `0`, `"0"`, `[]`, `[0]`, `""`, `" "`, `None`, `{}`, `set()`, `-1`, `0.0`, `range(0)`.

**D2.** Predict each: `bool(0.1)`, `bool("False")`, `bool([[]])`, `bool(range(1))`, `bool(None)`, `bool(-0.0)`.

**D3.** Predict the output for `name = ""` and then for `name = 0`, and explain the difference between the two checks:

```python
if name is None:
    print("None branch")
if not name:
    print("falsy branch")
```

**D4.** Predict all five lines:

```python
print(3 and 4)
print(0 and 4)
print(3 or 4)
print(0 or 4)
print([] or {} or "x")
```

**D5.** This default-value idiom is wrong when `port = 0` is a valid setting. Explain what happens and rewrite it correctly:

```python
port = settings.get("port") or 8080
```

**D6.** Write `display_name(user)` returning the user's `"name"` when it is a non-empty string, and `"anonymous"` otherwise. The name may be missing (use `None`), `""`, or a valid string.

**D7.** Predict all four printed values:

```python
x = None
print(x == None)
print(x is None)
print(x == False)
print(bool(x))
```

**D8.** Predict each printed line:

```python
score = 55
print("pass" if score >= 60 else "fail")
x = 0
print("zero" if not x else "nonzero")
```

**D9.** Write `is_valid(payload)` returning `True` only when `payload` is a non-empty dict whose `"id"` key exists and is a non-zero integer. No exceptions should escape the function.

## Group E — Lists

**E1.** Predict the output:

```python
a = [1, 2]
a.append([3, 4])
b = [1, 2]
b.extend([3, 4])
print(a, b)
```

**E2.** Predict each output (note the last line uses `xs.index(3)`):

```python
xs = [1, 2, 3, 2]
xs.remove(2)
print(xs)
print(xs.pop())
print(xs)
print(xs.index(3))
```

**E3.** Predict both printed lines and explain the `None`:

```python
xs = [3, 1, 2]
ys = xs.sort()
print(xs, ys)
zs = sorted(xs)
print(xs, zs)
```

**E4.** Predict both outputs and explain why they differ:

```python
a = [[0]] * 2
b = [[0] for _ in range(2)]
a[0][0] = 5
b[0][0] = 5
print(a, b)
```

**E5.** Given `xs = [0, 1, 2, 3, 4, 5]`, predict each: `xs[1:4]`, `xs[-2:]`, `xs[:2]`, `xs[::2]`, `xs[1::2]`, `xs[5:1]`, `xs[5:1:-1]`.

**E6.** Predict each output:

```python
xs = [1, 2, 3, 4]
xs[1:3] = [9]
print(xs, len(xs))
xs[0:2] = []
print(xs)
```

**E7.** For `xs = ["a", "b", "c", "d"]`, predict the result of `del xs[0]`, then `del xs[1:3]` applied to the result.

**E8.** Predict the outputs and say which names alias each other:

```python
xs = [1, 2, 3]
ys = xs
zs = xs[:]
ys.append(4)
zs.append(5)
print(xs, ys, zs)
print(xs is ys, xs is zs, xs == zs)
```

**E9.** Predict each: `2 in [1, 2, 3]`, `[1, 2] in [[1, 2], [3]]`, `[1, 2] == [1, 2, 3]`, `[1, [2]] == [1, [2]]`.

**E10.** Write `remove_duplicates(xs)` returning a new list with duplicates removed, preserving first-occurrence order. Do not mutate the input.

**E11.** Write `flatten(matrix)` turning `[[1, 2], [3], []]` into `[1, 2, 3]`.

**E12.** Predict each output:

```python
print(sum([1, 2, 3]), min("bca"), max([1, 5, 3]))
words = ["bb", "a", "ccc"]
print(sorted(words, key=len, reverse=True))
```

**E13.** The code below tries to remove all even numbers but leaves one behind. Explain the mechanism and fix it:

```python
nums = [1, 2, 2, 3]
for n in nums:
    if n % 2 == 0:
        nums.remove(n)
print(nums)
```

**E14.** Given `names = ["Ada", "Grace", "Alan"]`, write a single expression producing `[3, 5, 4]`.

**E15.** Predict: `list(range(5))`, `list(range(2, 5))`, `list("ab")`, `[0] * 3`, `[] + [1]`.

**E16.** Predict the output and explain:

```python
a = [1, 2]
b = a * 2
a.append(3)
print(b, a)
```

**E17.** Write `second_largest(xs)` returning the second largest distinct value or `None` for lists with fewer than two distinct values. Examples: `[3, 1, 4, 4]` returns `3`; `[5, 5]` returns `None`.

## Group F — Tuples and unpacking

**F1.** For each expression, state whether the result is a tuple and why: `1,`, `(1)`, `(1,)`, `()`, `tuple("ab")`, `(1, 2)[0:1]`.

**F2.** Predict each output:

```python
t = (1, 2, 3)
a, b, c = t
print(a, b, c)
x, *rest = t
print(x, rest)
```

**F3.** Predict both printed lines:

```python
first, *middle, last = [1, 2, 3, 4, 5]
print(first, middle, last)
*x, = [1, 2]
print(x)
```

**F4.** Predict the output and name the idiom in use:

```python
a, b = 1, 2
b, a = a, b
print(a, b)
```

**F5.** Identify which statements raise and which succeed, and explain the last two:

```python
t = (1, 2, 3)
t[0] = 9
t = t + (4,)
t += (5,)
```

**F6.** Which of these are valid dictionary keys and why: `(1, 2)`, `(1, [2])`, `frozenset({1})`, `[1]`, `(1, (2, 3))`?

**F7.** Given `people = [("Ada", 36), ("Grace", 45)]`, write a loop printing `1 Ada 36` and `2 Grace 45` using `enumerate` and tuple unpacking in the header.

**F8.** Predict the output and explain what `zip(*rows)` does:

```python
rows = [(1, "a"), (2, "b")]
columns = list(zip(*rows))
print(columns)
```

**F9.** Write `min_max(xs)` that returns a tuple `(smallest, largest)` and show, in two lines of caller code, how to unpack the result.

**F10.** Explain the exact error raised by `a, b = [1, 2, 3]` and by `a, b, c = [1, 2]`.

**F11.** Rewrite this loop to unpack `item` directly in the `for` header:

```python
for item in [("a", 1), ("b", 2)]:
    name = item[0]
    value = item[1]
```

**F12.** Write a single assignment statement that rotates three variables so that after `a, b, c = 1, 2, 3` they become `3, 1, 2`.

**F13.** Predict the output:

```python
data = {"a": 1, "b": 2}
for index, (key, value) in enumerate(data.items(), start=1):
    print(index, key, value)
```

## Group G — Dictionaries

**G1.** Predict each printed value:

```python
d = {"a": 1}
d["b"] = 2
print(d.get("c"))
print(d.get("c", 0))
print(d.get("a"))
print(len(d))
```

**G2.** Given `config = {}`, state which line raises, and the final value of `config` if the raising line is removed:

```python
config["timeout"] = config.get("timeout", 30)
value = config.setdefault("retries", 3)
value = config["missing"]
```

**G3.** Write `word_counts(words)` returning a dict of counts for the list `["b", "a", "b", "c", "b"]`, using `get`.

**G4.** Predict the exact output order:

```python
d = {"x": 1, "y": 2}
for k in d:
    print(k)
for v in d.values():
    print(v)
for k, v in d.items():
    print(k, v)
```

**G5.** Predict all three printed dicts:

```python
a = {"x": 1, "y": 2}
b = {"y": 20, "z": 30}
print({**a, **b})
print(a | b)
c = dict(a)
c.update(b)
print(c)
```

**G6.** Predict the resulting dict: `{1: "a", True: "b", 1.0: "c"}`. Explain the collisions.

**G7.** Given:

```python
response = {"data": {"items": [{"id": 1}, {"id": 2}]}}
```

write one expression that extracts the id of the second item, and one expression that uses `get` to return `None` instead of raising when `"data"` or `"items"` are missing. (Nested `get` chains are fine.)

**G8.** Write a dict comprehension that inverts `{"a": 1, "b": 2}` into `{1: "a", 2: "b"}`. State what happens if two keys share a value.

**G9.** Predict each: `"a" in {"a": 1}`, `1 in {"a": 1}`, `"a" in {"a": 1}.keys()`, `1 in {"a": 1}.values()`.

**G10.** Given records shaped `{"id": 1, "team": "blue"}`, write code using `setdefault` to build `{"blue": [1, 3], "red": [2]}` from `[{"id": 1, "team": "blue"}, {"id": 2, "team": "red"}, {"id": 3, "team": "blue"}]`.

**G11.** Write `top_words(text, n=3)` returning the `n` most frequent words from a whitespace-split text, sorted by count descending and then alphabetically for ties. Return a list of `(word, count)` tuples.

**G12.** Predict the output: `list(dict.fromkeys(["b", "a", "b", "c", "a"]))`. Explain how this preserves order while deduplicating.

**G13.** Predict both printed lines:

```python
d = {"a": 1, "b": 2}
print(d.pop("a"), d)
print(d.pop("z", None), d)
```

**G14.** Predict: `dict([("a", 1), ("b", 2)])` and `dict(a=1, b=2)`.

**G15.** Predict and explain: `{"a": 1, "b": 2} == {"b": 2, "a": 1}`.

**G16.** Write `merge_defaults(defaults, overrides)` returning a new dict where `overrides` wins on conflicts, without mutating either input.

**G17.** Write `required_missing(payload, required)` that returns a sorted list of required keys absent from `payload`. Example: `required_missing({"a": 1}, ["a", "b", "c"])` returns `["b", "c"]`.

## Group H — Sets

**H1.** State what each literal or call produces: `{}`, `set()`, `{1, 2, 2}`, `set("mississippi")`, `set([1, 1, 2]) == {1, 2}`.

**H2.** Predict each, using `sorted(...)` to make the output deterministic:

```python
a = {1, 2, 3}
b = {2, 3, 4}
print(sorted(a | b))
print(sorted(a & b))
print(sorted(a - b))
print(sorted(a ^ b))
```

**H3.** For each statement on `s = {1, 2}`, state whether it raises or silently does nothing: `s.add(3)`, `s.discard(9)`, `s.remove(9)`, `s.pop()`, `s.clear()`.

**H4.** Explain why checking `x in large_collection` is faster for a set than for a list, and rewrite this loop to use a set:

```python
seen = []
for item in stream:
    if item not in seen:
        seen.append(item)
        process(item)
```

**H5.** Explain the exact error raised by `{1, 2, 3}[0]` and the correct way to get an arbitrary element.

**H6.** State the error raised by `{1, [2, 3]}` and give two different fixes that keep the "collection of items" meaning.

**H7.** Predict: `{1, 2} <= {1, 2, 3}`, `{1, 2, 3} >= {1, 2}`, `{1, 2} < {1, 2}`, `{1, 2} < {1, 2, 3}`.

**H8.** Write `changed_ids(old_ids, new_ids)` returning the set of ids that were added or removed between two collections of ids, in one expression using a set operator.

**H9.** Deduplicate `["b", "a", "b", "c"]` two ways: once with a set (losing order) and once preserving order. Explain when each is acceptable.

**H10.** Explain why `frozenset({"read", "write"})` can be used as a dict key while `{"read", "write"}` cannot, and write three lines that use a frozenset key in a dict.

**H11.** Predict each: `2 in {1, 2}`, `2 in {1: "b"}`, `"a" in {"a": 1}`, `[1] in {1, 2}`.

**H12.** Given two lists of tags, `old_tags` and `new_tags`, write code producing (a) tags present in both, (b) tags only in `new_tags`, (c) all tags, deduplicated. Use set operations and return sorted lists for deterministic output.

## Group I — Conditionals and loops

**I1.** Predict the exact output lines:

```python
x = 5
if x > 0:
    print("pos")
    if x > 10:
        print("big")
    print("done")
print("end")
```

**I2.** Predict the exact output:

```python
for n in [2, 4, 6]:
    if n % 2:
        break
else:
    print("all even")

for n in [2, 3, 4]:
    if n % 2:
        break
else:
    print("all even")
print("done")
```

**I3.** Predict each: `list(range(4))`, `list(range(2, 8, 2))`, `list(range(5, 0, -1))`, `list(range(0))`.

**I4.** Predict the output:

```python
for i, ch in enumerate("abc", start=10):
    print(i, ch)
```

**I5.** Predict the output and explain the truncation:

```python
print(list(zip([1, 2, 3], "ab")))
```

**I6.** Predict the value of `i` printed at the end and the total number of iterations:

```python
i = 0
total = 0
while i < 5:
    i += 1
    if i % 2 == 0:
        continue
    total += i
print(total, i)
```

**I7.** Predict the full output:

```python
for i in range(2):
    for j in range(2):
        print(i, j)
```

**I8.** Predict the output and explain why it works even though Python has no block scope:

```python
for i in range(3):
    pass
print(i)
```

**I9.** Predict each boolean: `5 < 10 < 15`, `5 < 10 > 3`, `1 == 1.0 < 2`, `10 < 5 < 15`, `1 < 2 < "a"`.

**I10.** Predict each: `any(x > 3 for x in [1, 2])`, `all(x > 0 for x in [1, 2])`, `all([])`, `any([])`.

**I11.** Rewrite this loop idiomatically without index arithmetic:

```python
xs = ["a", "b", "c"]
for i in range(len(xs)):
    print(i, xs[i])
```

**I12.** Predict each call result (Python 3.10+):

```python
def handle(code):
    match code:
        case 200:
            return "ok"
        case 404 | 410:
            return "gone"
        case _:
            return "other"

print(handle(200), handle(410), handle(500))
```

**I13.** Write `first_negative(xs)` returning the first negative number found, or `None` if there is none. Then write a second version using a `for ... else` that reports `"none found"` inside the loop construct itself.

**I14.** Write `classify_status(code)` where 100–199 returns `"info"`, 200–299 `"success"`, 300–399 `"redirect"`, 400–499 `"client_error"`, 500–599 `"server_error"`, and anything else `"unknown"`. Use chained comparisons.

**I15.** In nested loops, what does `break` inside the inner loop actually exit? Write a two-loop example that breaks out of both loops using a flag or a function return.

**I16.** Predict each printed line:

```python
x = 5
print("small" if x < 10 else "big")
items = []
print("empty" if not items else "full")
```

**I17.** Identify every error in this snippet (there are at least two) and rewrite it so it prints `1` through `3`:

```python
for i in range(1, 4)
print(i)
```

**I18.** Trace this loop and give the exact sequence of printed values:

```python
i = 3
while i:
    print(i)
    i -= 1
```

**I19.** Write a retry loop skeleton: `attempts` starts at 0; call `fetch()` at most 3 times; stop early if it returns a truthy result; after the loop, return the result or `None`. Use `while`, `break`, and truthiness.

## Group J — Comprehensions

**J1.** Predict the output: `[x * 2 for x in [1, 2, 3]]`.

**J2.** Predict the output: `[x for x in [4, -1, 5, -2] if x > 0]`.

**J3.** Predict both outputs:

```python
print([x if x > 0 else -x for x in [4, -1, 5, -2]])
print([-x if x > 0 else x for x in [4, -1]])
```

**J4.** Given `keys = ["a", "b"]` and `values = [1, 2]`, write a dict comprehension producing `{"a": 1, "b": 2}`.

**J5.** Predict the output: `sorted({len(w) for w in ["a", "bb", "c", "ddd"]})`.

**J6.** Predict the output: `[n for row in [[1, 2], [3]] for n in row]`.

**J7.** Predict the output: `[(x, y) for x in [1, 2] for y in ["a", "b"]]`. Then state how the nested loops would be written as a normal `for` loop.

**J8.** Predict both printed lines and explain why the second is not `1`:

```python
x = "outer"
print([x for x in range(2)])
print(x)
```

**J9.** Rewrite this loop as a single comprehension:

```python
result = []
for n in range(10):
    if n % 3 == 0:
        result.append(n * n)
```

**J10.** Given `lines = ["  Alpha ", "BETA", " gamma "]`, write a comprehension producing `["alpha", "beta", "gamma"]`.

**J11.** Predict the output: `sum(x * x for x in range(4))`. Explain what is different between this and `sum([x * x for x in range(4)])`.

**J12.** Identify the anti-pattern and rewrite it correctly:

```python
[print(x) for x in [1, 2, 3]]
```

**J13.** Given records `[{"id": 1, "name": "a", "active": True}, {"id": 2, "name": "b", "active": False}, {"id": 3, "name": "c", "active": True}]`, write one dict comprehension mapping `id` to `name` for active records only.

**J14.** Predict the output: `[x * y for x in range(3) if x for y in range(2)]`.

**J15.** Rewrite this as one comprehension:

```python
names = ["ada", "alan", "grace", "bob"]
upper_long = []
for name in names:
    if len(name) > 3:
        upper_long.append(name.upper())
```

**J16.** Write a comprehension that produces the uppercase first letters of words longer than three characters from `["api", "gateway", "ui", "cache"]`. Expected: `["A", "G", "C"]`.

**J17.** Explain why this comprehension is a poor choice and rewrite it as a loop:

```python
logs = []
[logs.extend(line.strip().split()) for line in ["a b", "c d"]]
```

## Group K — Functions and arguments

**K1.** Given `def f(a, b=2, c=3): return a + b + c`, predict each call: `f(1)`, `f(1, 10)`, `f(1, c=100)`, `f(c=1, a=2)`, `f(a=1, b=2, c=3)`.

**K2.** Predict the four printed lists, then rewrite the function to avoid the bug:

```python
def add(tag, tags=[]):
    tags.append(tag)
    return tags

print(add("a"))
print(add("b"))
print(add("c", []))
print(add("d"))
```

**K3.** Predict the output:

```python
def gather(a, *args, **kwargs):
    return a, args, kwargs

print(gather(1, 2, 3, x=4))
```

**K4.** Given `def connect(host, port, *, timeout=5)`, classify each call as valid or invalid and name the exception for the invalid ones: `connect("h", 80)`, `connect("h", 80, 10)`, `connect("h", port=80, timeout=10)`, `connect(host="h", port=80)`.

**K5.** Given `def normalize(text, /, mode="lower")`, classify each call as valid or invalid: `normalize("A")`, `normalize(text="A")`, `normalize("A", mode="upper")`, `normalize("A", "upper")`.

**K6.** Predict the output and the final value of `x`:

```python
x = print("hi")
print(x)
```

**K7.** Given `def f(a, b): return a + b`, explain the exact exception and message produced by `f(1, 2, 3)` and by `f(1)`.

**K8.** Predict the output and explain why there is no overloading:

```python
def f(x):
    return "first"

def f(x):
    return "second"

print(f(1))
```

**K9.** Write `format_log(message, level="INFO", *, timestamp=None)` returning `"[LEVEL] message"` or `"[LEVEL] timestamp message"` when a timestamp string is supplied.

**K10.** Predict the output and explain what type hints do not do:

```python
def double(x: int) -> int:
    return x * 2

print(double("ab"))
```

**K11.** Predict the final list and explain why `reset` had no effect:

```python
def add_tag(tags):
    tags.append("new")

def reset(tags):
    tags = []

tags = ["old"]
add_tag(tags)
reset(tags)
print(tags)
```

**K12.** Predict the output:

```python
records = [{"name": "b", "age": 30}, {"name": "a", "age": 25}]
print([r["name"] for r in sorted(records, key=lambda r: r["age"])])
```

**K13.** Explain why every call to `stamp()` below returns the same value, and rewrite it so each call returns the current time at call time:

```python
import time

def stamp(when=time.time()):
    return when
```

**K14.** Write `normalize_text(text, *, lower=True, strip=True)` that optionally lowercases and strips the input. Defaults must not mutate anything.

**K15.** Write `parse_pair(text)` that converts `"k=1"` into `("k", 1)`. If the text has no `"=""`, return `(None, None)`. If the value part is not an integer, raise nothing — return the value as a string instead.

**K16.** Predict the output and state what `print(greet)` displays in principle:

```python
def greet():
    return "hi"

f = greet
print(f())
print(greet)
```

**K17.** Translate this TypeScript function to Python, preserving the default and the callback:

```typescript
function retry(fn: () => boolean, attempts = 3): boolean {
  for (let i = 0; i < attempts; i++) {
    if (fn()) return true;
  }
  return false;
}
```

**K18.** Write `apply_twice(fn, x)` that returns `fn(fn(x))`. Then use it with a lambda that doubles a number.

**K19.** Predict the output and explain the ordering:

```python
def f(**kw):
    return list(kw)

print(f(b=1, a=2, c=3))
```

**K20.** Write `filter_kwargs(data, allowed)` that returns a new dict containing only the keys present in the `allowed` container. Example: `filter_kwargs({"a": 1, "b": 2, "debug": True}, ["a", "b"])` returns `{"a": 1, "b": 2}`. Use a dict comprehension.

## Group L — Scope

**L1.** Predict the output:

```python
x = 10

def show():
    print(x)

show()
```

**L2.** Predict the exception, the variable involved, and explain the rule that causes it:

```python
count = 0

def inc():
    count += 1

inc()
```

**L3.** Fix the previous exercise with `global`. Then explain in one sentence why `global` is usually a design smell and suggest one alternative.

**L4.** Write a function factory `make_counter()` that returns a function which increments and returns an internal count each time it is called. Use `nonlocal`.

**L5.** Predict the output:

```python
if True:
    y = 5
print(y)
```

**L6.** Predict both outputs:

```python
x = "outer"
squares = [x for x in range(3)]
print(squares)
print(x)
```

**L7.** Predict the output, explain the mechanism, and rewrite so the functions return `0`, `1`, and `2` respectively:

```python
funcs = [lambda: i for i in range(3)]
print([f() for f in funcs])
```

**L8.** Predict the exception, then fix the code without renaming or deleting the first line:

```python
list = [1, 2]
print(list("ab"))
```

**L9.** Predict the output:

```python
total = 100

def f(total):
    return total + 1

print(f(1), total)
```

**L10.** Predict the output and describe the scope relationship between `inner` and `x`:

```python
def outer():
    x = 1
    def inner():
        return x
    return inner

print(outer()())
```

**L11.** Write a counter two ways: once with `nonlocal`, and once with a single-element list as an accumulator (no `nonlocal`). Explain why the list version works.

**L12.** Predict whether each statement raises and explain: accessing a local before assignment in the same function; reading a global in a function; reading a builtin after shadowing it in the same function.

## Group M — Translating TypeScript patterns

**M1.** Translate to Python and show the access expression:

```typescript
const user = { id: 1, name: "Ada", tags: ["admin", "beta"] };
console.log(user.name, user.tags[0]);
```

**M2.** Given `nums = [1, 2, 3, 4]`, translate this TypeScript chain into idiomatic Python (one expression):

```typescript
const result = nums.filter(n => n % 2 === 0).map(n => n * n);
```

**M3.** Translate this optional-chaining/nullish expression into Python where `user` is a dict that may have missing or `None` keys:

```typescript
const age = user?.profile?.age ?? 0;
```

**M4.** Translate this TypeScript switch into Python using `match`:

```typescript
switch (method) {
  case "GET":
  case "HEAD":
    return "read";
  case "POST":
  case "PUT":
    return "write";
  default:
    return "other";
}
```

**M5.** Translate this loop into idiomatic Python using `enumerate`:

```typescript
for (let i = 0; i < items.length; i++) {
  console.log(i, items[i]);
}
```

**M6.** Translate this template literal into an f-string:

```typescript
const message = `${user.name} has ${count} new ${count === 1 ? "message" : "messages"}`;
```

**M7.** Rewrite each TypeScript check as the appropriate Python equivalent (choose `is`, `==`, or `isinstance` deliberately): `x === null`, `x === undefined`, `x === 0`, `typeof x === "string"`, `Number.isInteger(x)`.

**M8.** Add Python type hints to this signature and body, treating the input as a dict mapping strings to ints:

```python
def total_score(scores):
    return sum(scores.values())
```

**M9.** Translate the spread pattern to Python:

```typescript
const config = { ...defaults, ...overrides, retries: 5 };
```

**M10.** Translate this to a Python comprehension over `services.items()`:

```typescript
const names = Object.entries(services).map(([name, svc]) => `${name}:${svc.port}`);
```

**M11.** Translate this TypeScript into Python, then explain the one behavioral difference in equality that matters most here:

```typescript
const statuses = [200, 201, 404];
const isOk = (code: number) => code === 200 || code === 201;
console.log(statuses.includes(200), isOk(201));
```

## Group N — Mixed realistic tasks

These combine several chapter concepts. Keep implementations small and idiomatic. Do not use any imports beyond the standard library, and only what the chapter covered.

**N1.** Write `parse_settings(text)` converting `"host=localhost;port=8080;debug=true"` into `{"host": "localhost", "port": 8080, "debug": True}`. The port must be an `int` and `debug` a `bool` (`"true"` means `True`, anything else `False`). Handle an empty string by returning `{}`.

**N2.** Given `records = [{"id": 1, "status": "ok"}, {"id": 2, "status": "error"}, {"id": 3, "status": "ok"}]`, write code producing `{"ok": 2, "error": 1}`.

**N3.** Write `chunk(items, size)` returning a list of lists, each of length `size` except possibly the last. Example: `chunk([1, 2, 3, 4, 5], 2)` returns `[[1, 2], [3, 4], [5]]`.

**N4.** Write `effective_config(defaults, file_config, env_config)` where later dictionaries override earlier ones, returning a new dict and mutating none of the inputs. Show a call with `{"timeout": 10}`, `{"timeout": 30, "retries": 2}`, `{"retries": 5}`.

**N5.** Given `lines = ["2026-01-01 GET /users 200", "2026-01-01 POST /users 500", "2026-01-02 GET /health 200"]`, extract the set of distinct status codes as integers.

**N6.** Given a list of provider responses shaped `{"model": "m1", "usage": {"total_tokens": 120}}`, write code computing the total tokens across all responses. Some responses may be missing the `"usage"` key; treat those as zero without raising.

**N7.** Write `validate_event(event)` returning a sorted list of problem strings. Rules: `"id"` must exist and be an `int`; `"name"` must exist and be a non-empty `str`; any other keys are ignored. An empty list means valid. Use `isinstance`, `in`, and truthiness checks.

**N8.** Given `responses = [{"id": "r1", "ok": True}, {"id": "r2", "ok": False}, {"id": "r3", "ok": False}]`, produce a list of ids where `ok` is false.

**N9.** Given `endpoints = ["/Users", "/health", "/users", "/HEALTH", "/metrics"]`, produce a deduplicated, case-insensitively sorted list. State whether you used a set or `dict.fromkeys` and why.

**N10.** Write `has_pair(nums, target)` returning `True` when two distinct positions hold values summing to `target`. Use a set for O(n) average time. Example: `has_pair([2, 7, 11, 15], 9)` returns `True`.

**N11.** Given `usage = [{"model": "m1", "tokens": 100}, {"model": "m2", "tokens": 50}, {"model": "m1", "tokens": 25}]`, compute `{"m1": 125, "m2": 50}`, then return the model with the highest total (alphabetical tie-break).

**N12.** Given `tag_lists = [["API", "beta"], ["api"], ["Beta", "v2"]]`, produce a flattened, lowercased, order-preserving, deduplicated list: `["api", "beta", "v2"]`.

**N13.** Given `requests = [{"endpoint": "/a", "ms": 10}, {"endpoint": "/b", "ms": 20}, {"endpoint": "/a", "ms": 30}]`, compute the average latency per endpoint as `{"/a": 20.0, "/b": 20.0}`. Use `setdefault` or `get` and a final comprehension.

**N14.** Given prompt/response records `{"prompt": "...", "response": "...", "model": "m1"}`, write code producing a summary dict with `"count"`, `"total_chars"` (prompt plus response lengths), and `"models"` (a set of distinct model names).

**N15.** Write `mask_secrets(env)` taking a dict of environment variables and returning a copy where any key containing `"TOKEN"`, `"SECRET"`, or `"PASSWORD"` (case-insensitive) has its value replaced with `"***"`. The original dict must be unchanged.

**N16.** Write `summarize_status(codes)` taking a list of HTTP status codes and returning `(count, unique_count, has_error)` where `has_error` is `True` if any code is `>= 400`. Use builtins and a generator expression.

**N17.** Write `dedupe_records(records, key)` that returns records deduplicated by the value of `key`, keeping the first occurrence, preserving order. Example: `dedupe_records([{"id": 1}, {"id": 1}, {"id": 2}], "id")` returns the first and third records.

**N18.** A JSON-like payload arrives as `{"user": {"id": 7, "roles": ["admin"]}, "meta": None}`. Write `safe_username(payload)` returning the username safe-access pattern result: `payload["user"]["name"]` if everything exists and is a non-empty string, otherwise `"unknown"`. Do not use `try`/`except` (Chapter 2 topic); use `get`, truthiness, and `isinstance`.

---

## Before moving on

Check yourself against the chapter outcome without looking back at the notes:

- Predict aliasing, mutation, identity, and equality behavior for the four built-in containers without running code.
- Explain when `/`, `//`, and `%` differ from JavaScript expectations.
- Write comprehensions, unpacking assignments, and default-argument functions from memory.
- Diagnose `UnboundLocalError`, mutable-default bugs, `None`-returning method bugs, and the `[[0]] * n` trap on sight.
- Translate a familiar TypeScript function into idiomatic Python using truthiness, f-strings, `enumerate`, and `dict.get`.

If any group felt slow, redo a subset of its exercises from scratch before continuing to Chapter 2.
