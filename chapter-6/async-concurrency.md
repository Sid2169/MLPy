# Chapter 6 — Asynchronous Python and Concurrency

Chapter 5 built a synchronous FastAPI service. That model works until a handler waits on a slow upstream: each waiting request occupies a worker thread, and throughput collapses once the pool is exhausted. This chapter covers Python's asynchronous I/O model: coroutines, the event loop, tasks, cancellation, timeouts, bounded fan-out, asynchronous HTTP clients, and the boundary between async and blocking code. It ends with testing and FastAPI integration.

Modern Python 3.11+ is assumed. `asyncio.TaskGroup` and `asyncio.timeout` are 3.11 features; older-version fallbacks are noted where they matter.

## Contents

1. Concurrency, parallelism, and when async helps
2. Coroutines, `await`, and the event loop
3. Tasks, `gather`, and structured concurrency
4. Cancellation, timeouts, and cleanup
5. Concurrency limits and backpressure
6. Asynchronous HTTP clients
7. Bridging sync and async code
8. Async FastAPI
9. Testing asynchronous code
10. Common mistakes and conventions
11. Exercises (Groups A–J)

---

## 6.1 Concurrency, parallelism, and when async helps

Concurrency means multiple operations are in progress at once. Parallelism means multiple operations execute at the same instant. Async I/O gives you concurrency on one thread; it does not give you CPU parallelism.

Three workload shapes:

| Workload | Example | Best tool |
| --- | --- | --- |
| I/O-bound, awaitable | HTTP calls, async database drivers | `async`/`await` |
| I/O-bound, blocking | legacy SDKs, file I/O, `requests`, `time.sleep` | threads (`to_thread`, thread pool) |
| CPU-bound | image resizing, parsing, numerical work | processes |

The standard CPython runtime has a global interpreter lock (GIL), so threads do not run Python bytecode in parallel. Threads still help blocking I/O because the GIL is released during system calls and C extensions. Free-threaded CPython builds are a separate, optional runtime; do not design assuming they are present.

An event loop runs callbacks and coroutines on one thread. A coroutine runs until it hits an `await` that actually suspends; control then returns to the loop, which can run another coroutine. This is cooperative multitasking: a coroutine that never awaits blocks every other task on the loop.

```python
import asyncio, time

async def slow_io() -> None:
    await asyncio.sleep(1)          # yields to the loop

async def bad() -> None:
    time.sleep(1)                   # blocks the entire loop, including slow_io

async def main() -> None:
    await asyncio.gather(slow_io(), bad())

asyncio.run(main())
```

Rules of thumb:

- Use `async def` when the operation is awaitable end to end: async HTTP clients, async DB drivers, async file APIs.
- Use a plain `def` FastAPI handler when the operation is blocking; FastAPI runs it in a worker thread.
- Offload unavoidable blocking calls inside async code with `asyncio.to_thread`.
- Use processes, not coroutines or threads, for heavy CPU work.
- Async is about waiting efficiently, not about making computation faster.

---

## 6.2 Coroutines, `await`, and the event loop

Calling an `async def` function does not run its body. It creates a coroutine object:

```python
async def greet(name: str) -> str:
    return f"hello {name}"

coro = greet("ada")      # <coroutine object ...>, body has not run
result = asyncio.run(coro)
print(result)            # hello ada
```

You can run a coroutine by:

- `await coro` inside another coroutine,
- wrapping it in a task with `asyncio.create_task(coro)`,
- passing it to `asyncio.gather(...)` or a `TaskGroup`,
- or `asyncio.run(coro)` at the top level of a program.

`await` suspends the current coroutine until the awaited operation completes. The event loop is free to run other tasks in the meantime. `await` is only valid inside `async def`; using it elsewhere is a `SyntaxError`.

Async context managers and async iterators use different protocols:

```python
async with httpx.AsyncClient() as client:      # __aenter__ / __aexit__
    response = await client.get("/health")

async for chunk in response.aiter_bytes():     # __aiter__ / __anext__
    ...
```

`async with` requires an object implementing `__aenter__` and `__aexit__`. `async for` requires `__aiter__` and `__anext__`. A sync context manager cannot be used with `async with`, and vice versa.

Event-loop rules:

- `asyncio.run` creates a new loop, runs one coroutine to completion, then closes the loop. Call it once at the top level of a program or test, not inside a running loop.
- Calling `asyncio.run` inside an async function raises `RuntimeError: asyncio.run() cannot be called from a running event loop`.
- Tasks, futures, and clients are bound to the loop that created them. Locks, semaphores, queues, and events may bind to a loop once they have to wait; reusing any of them on another loop is unsupported and typically raises `RuntimeError: ... is bound to a different event loop`. Do not share them across loops, even when an uncontended fast path happens to work.
- A coroutine that is created and never awaited produces `RuntimeWarning: coroutine ... was never awaited` and never runs. This is usually a forgotten `await` or a missing task.

`await` is not a guarantee of fairness: a coroutine that awaits an already-completed operation may continue without giving others a turn. `await asyncio.sleep(0)` explicitly yields once.

---

## 6.3 Tasks, `gather`, and structured concurrency

A task is a coroutine scheduled on the loop. Tasks start running when the loop gets control.

```python
async def fetch(name: str, delay: float) -> str:
    await asyncio.sleep(delay)
    return name

async def main() -> None:
    t1 = asyncio.create_task(fetch("a", 1.0))
    t2 = asyncio.create_task(fetch("b", 1.0))
    print(await t1, await t2)      # both run concurrently; about 1s total

asyncio.run(main())
```

Keep a reference to every task you create. The loop keeps only weak references; a task with no strong reference can be garbage-collected mid-flight.

Sequential awaits sum their latency. `asyncio.gather` runs awaitables concurrently and returns results in input order:

```python
results = await asyncio.gather(
    fetch("a", 1.0),
    fetch("b", 1.0),
)
print(results)                     # ['a', 'b']
```

Important `gather` semantics:

- Results preserve the order of the input awaitables, not completion order.
- With `return_exceptions=False` (default), the first exception propagates to the caller. The other awaitables are **not** cancelled automatically; they may still be running.
- With `return_exceptions=True`, exceptions are returned in the results list instead of raised. You must inspect each element.
- Cancelling the `gather` future cancels all child awaitables that have not completed.

For structured concurrency, use `asyncio.TaskGroup` (3.11+):

```python
async def main() -> None:
    async with asyncio.TaskGroup() as tg:
        t1 = tg.create_task(fetch("a", 1.0))
        t2 = tg.create_task(fetch("b", 1.0))
    print(t1.result(), t2.result())
```

A task group waits for all tasks. If one fails, it cancels the remaining tasks, waits for them to finish, and raises an `ExceptionGroup` containing the failures. The context manager does not exit until every task is done.

```python
try:
    async with asyncio.TaskGroup() as tg:
        tg.create_task(may_fail())
        tg.create_task(also_may_fail())
except* ValueError as group:
    for exc in group.exceptions:
        print("value error:", exc)
```

`except*` is the 3.11 syntax for handling exception groups. On 3.10, use `gather(return_exceptions=True)` and inspect results, or a third-party structured-concurrency library.

`asyncio.as_completed` yields results as they finish, which is useful for progress reporting or streaming:

```python
for coro in asyncio.as_completed([fetch("a", 1.0), fetch("b", 0.2)]):
    print(await coro)
```

Guidelines:

- Use `TaskGroup` when tasks form a unit: all must succeed, or the whole operation fails and cleans up.
- Use `gather` when you need a fixed set of results and will handle partial failure explicitly.
- Use `as_completed` when order does not matter and you want to process results as they arrive.
- Never create background tasks you do not await, track, or cancel deliberately.

---

## 6.4 Cancellation, timeouts, and cleanup

Cancellation in asyncio is cooperative. `task.cancel()` requests cancellation; the task receives `asyncio.CancelledError` at its next `await` (or immediately if it has not started). The task can clean up in `finally`, but it should re-raise the cancellation unless it has a good reason not to.

```python
async def worker() -> None:
    try:
        while True:
            await asyncio.sleep(0.1)
    finally:
        print("cleaning up")

async def main() -> None:
    task = asyncio.create_task(worker())
    await asyncio.sleep(0.25)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        print("worker cancelled")
```

Key facts:

- `asyncio.CancelledError` inherits from `BaseException`, not `Exception` (since Python 3.8). A bare `except Exception` will not catch it.
- If you catch `CancelledError`, re-raise it unless you are deliberately converting it into another outcome. Suppressing it makes the task look successful and breaks shutdown semantics.
- Cleanup belongs in `finally` or an `async with` block. It runs on cancellation, on timeout, and on ordinary exceptions.
- Cancellation only happens at await points. A tight CPU loop with no awaits cannot be cancelled promptly and blocks the loop.

Timeouts:

```python
# Python 3.11+
try:
    async with asyncio.timeout(2.0):
        await call_upstream()
except TimeoutError:
    handle_timeout()

# Works on older versions
try:
    await asyncio.wait_for(call_upstream(), timeout=2.0)
except asyncio.TimeoutError:
    handle_timeout()
```

A timeout cancels the inner operation. If the operation ignores cancellation, the timeout cannot force it to stop. `asyncio.shield` protects an inner operation from outer cancellation:

```python
inner = asyncio.create_task(write_audit_log())
try:
    async with asyncio.timeout(1.0):
        await asyncio.shield(inner)
except TimeoutError:
    print("audit log still running")
```

Shielding means the caller gets the timeout, but the inner task continues. You remain responsible for awaiting or cancelling it eventually. Shield is useful for critical writes that must finish; it is not a way to ignore cancellation.

Cleanup patterns:

```python
async def fetch(client: httpx.AsyncClient, url: str) -> dict:
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        return await response.json()
```

The `async with` closes the stream even when the body raises or the enclosing task is cancelled. For long-lived resources, use lifespan or an async context manager at the appropriate scope. Do not rely on `__del__` for closing async clients.

Common cancellation bugs:

- Swallowing `CancelledError` inside a broad `try/finally` without re-raising.
- Using `except Exception` around a cancellation point and then continuing.
- Creating a task, cancelling it, and never awaiting it, so cleanup errors are lost.
- Cleaning up only on success, so timeouts leak connections.
- Treating timeout as a normal failure when it may have left an operation partially complete.

---

## 6.5 Concurrency limits and backpressure

Unbounded concurrency is a reliability bug. `gather(*[fetch(url) for url in urls])` launches everything at once. With 10,000 URLs, you get 10,000 open connections, memory pressure, upstream rate limits, and a hard-to-debug outage.

Use a semaphore to bound in-flight work:

```python
async def fetch_all(urls: list[str], client: httpx.AsyncClient) -> list[dict]:
    sem = asyncio.Semaphore(20)

    async def bounded(url: str) -> dict:
        async with sem:
            response = await client.get(url)
            response.raise_for_status()
            return response.json()

    return await asyncio.gather(*(bounded(url) for url in urls))
```

The semaphore is acquired inside each coroutine, so only 20 requests are in flight. The remaining coroutines wait; they do not consume network connections. `asyncio.BoundedSemaphore` additionally raises if released too many times, which catches bugs.

This is concurrency limiting, not rate limiting. A semaphore of 20 still allows 20 requests in the same millisecond. Rate limiting needs timestamps or a token bucket:

```python
class RateLimiter:
    def __init__(self, rate: float) -> None:
        self._interval = 1.0 / rate
        self._lock = asyncio.Lock()
        self._next = 0.0

    async def wait(self) -> None:
        async with self._lock:
            loop = asyncio.get_running_loop()
            now = loop.time()
            delay = max(0.0, self._next - now)
            self._next = max(now, self._next) + self._interval
        if delay:
            await asyncio.sleep(delay)
```

For sustained workloads, a worker pool with `asyncio.Queue` gives backpressure. Producers block when the queue is full, so memory stays bounded:

```python
queue: asyncio.Queue[str] = asyncio.Queue(maxsize=100)

async def worker() -> None:
    while True:
        url = await queue.get()
        try:
            await process(url)
        finally:
            queue.task_done()

async def main(urls: list[str]) -> None:
    tasks = [asyncio.create_task(worker()) for _ in range(10)]
    try:
        for url in urls:
            await queue.put(url)       # blocks when full
        await queue.join()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
```

`Queue(maxsize=...)` provides bounded buffering. Without `maxsize`, `put` never blocks and memory grows without limit.

Fan-out guidelines:

- Bound concurrency at every external boundary: HTTP, database, LLM provider.
- Choose limits from the dependency's capacity and your timeout budget, not from a round number.
- Prefer a worker pool for large or unbounded streams of work.
- Handle per-item failures explicitly; one bad URL should not fail a 10,000-item export unless that is the contract.
- Measure queue depth, in-flight requests, and latency; limits should be observable.

---

## 6.6 Asynchronous HTTP clients

`httpx.AsyncClient` is the async counterpart of `httpx.Client`. Reuse one client per process; it owns a connection pool, TLS sessions, and timeouts.

```python
import httpx

async def get_book(client: httpx.AsyncClient, isbn: str) -> dict:
    response = await client.get(f"/books/{isbn}")
    response.raise_for_status()
    return response.json()
```

A client is usually created in the application lifespan:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient(
        base_url="https://catalogue.internal",
        timeout=httpx.Timeout(10.0, connect=2.0),
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
    ) as client:
        app.state.client = client
        yield

app = FastAPI(lifespan=lifespan)
```

- `timeout` covers connect, read, write, and pool waits. Set granular values when operations differ: a health check and a bulk export should not share one generous timeout.
- `limits` caps total and idle connections. Without a pool limit, a burst can open arbitrarily many sockets.
- `AsyncClient` must be closed. `async with` or lifespan handles this. Do not create one per request.
- Never call `requests` or `httpx.Client` (sync) from an `async def`; it blocks the loop.

Streaming large responses:

```python
async with client.stream("GET", "/export") as response:
    response.raise_for_status()
    async for chunk in response.aiter_bytes():
        process(chunk)
```

For retries, keep the policy in a service layer, use `asyncio.sleep` for delays, retry only transient failures, and bound attempts. Do not retry a non-idempotent `POST` unless the upstream supports an idempotency key.

```python
async def get_with_retry(client: httpx.AsyncClient, url: str) -> httpx.Response:
    for attempt in range(3):
        try:
            response = await client.get(url)
            if response.status_code in {429, 500, 502, 503, 504} and attempt < 2:
                await asyncio.sleep(0.2 * (2 ** attempt))
                continue
            response.raise_for_status()
            return response
        except (httpx.TimeoutException, httpx.TransportError):
            if attempt == 2:
                raise
            await asyncio.sleep(0.2 * (2 ** attempt))
    raise AssertionError("unreachable")
```

Chapter 5's mapping rules still apply: timeout becomes `504`, upstream 5xx or invalid payload becomes `502`, and caller-caused upstream 4xx becomes `400` or `404`.

---

## 6.7 Bridging sync and async code

You will often have a blocking library inside an async service. Options, in order of preference:

1. Replace it with an async-native client.
2. Run the blocking call in a thread with `asyncio.to_thread`.
3. Use a dedicated executor with `loop.run_in_executor`.
4. Isolate it behind a synchronous FastAPI route (`def`), which FastAPI runs in its thread pool.

```python
import asyncio

def read_config() -> str:
    return open("config.toml").read()       # blocking

async def load_config() -> str:
    return await asyncio.to_thread(read_config)
```

`asyncio.to_thread` uses the loop's default thread pool. The GIL is released during blocking I/O, so other threads and the event loop can make progress. For CPU-bound work, threads do not help because they contend for the GIL:

```python
from concurrent.futures import ProcessPoolExecutor

def resize(path: str) -> bytes:
    ...

async def resize_async(path: str, pool: ProcessPoolExecutor) -> bytes:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(pool, resize, path)
```

Processes have startup and pickling costs; use them for genuinely CPU-heavy work, not for many tiny tasks.

Calling async from sync code:

- At the top level, use `asyncio.run`.
- Inside a running loop, do not call `asyncio.run`; use `await` or schedule a task.
- If a sync library insists on calling an async function, run that library in a separate thread with its own loop, or restructure the boundary. Do not nest loops casually.

Thread-safety notes:

- Asyncio locks, semaphores, queues, tasks, and clients are not thread-safe. Do not use them from multiple threads.
- If a coroutine must communicate with a thread, use `loop.call_soon_threadsafe` or `asyncio.run_coroutine_threadsafe`.
- Sharing an `AsyncClient` across event loops breaks its connection pool.
- `contextvars` propagate into `to_thread` calls in current Python versions, but do not assume they propagate into arbitrary executors.

FastAPI's threadpool and the event loop are different worlds. A `def` route runs in a worker thread and may block; an `async def` route runs on the loop and must not block. Choose per route, not per application.

---

## 6.8 Async FastAPI

FastAPI supports both kinds of handlers:

```python
@app.get("/books")
def list_books() -> list[Book]:       # runs in a thread pool
    return repo.list_books()

@app.get("/weather/{city}")
async def weather(city: str, client: AsyncClientDep) -> dict:
    response = await client.get(f"/weather/{city}")   # runs on the loop
    response.raise_for_status()
    return response.json()
```

Use `async def` only when the handler awaits async I/O all the way down. An `async def` handler that calls `requests.get` or `time.sleep` stalls every concurrent request on the process.

Async dependencies use the same `Depends` mechanism:

```python
async def get_client(request: Request) -> httpx.AsyncClient:
    return request.app.state.client

ClientDep = Annotated[httpx.AsyncClient, Depends(get_client)]

async def get_current_user(authorization: Annotated[str | None, Header()] = None) -> User:
    if authorization is None:
        raise HTTPException(status_code=401, headers={"WWW-Authenticate": "Bearer"})
    return await verify_token(authorization)
```

An async `yield` dependency's cleanup runs after the response, and it runs on cancellation as well:

```python
async def get_session() -> AsyncIterator[Session]:
    async with session_factory() as session:
        yield session
```

Async lifespan replaces `startup`/`shutdown` handlers. Create shared clients, pools, and caches there; close them on exit.

For bounded concurrency inside an app, inject a semaphore or a dedicated service:

```python
async def get_limiter(request: Request) -> asyncio.Semaphore:
    return request.app.state.upstream_semaphore

LimiterDep = Annotated[asyncio.Semaphore, Depends(get_limiter)]

@app.get("/search")
async def search(q: str, client: ClientDep, limiter: LimiterDep) -> dict:
    async with limiter:
        response = await client.get("/search", params={"q": q})
    response.raise_for_status()
    return response.json()
```

If you must call blocking code from an async handler, use `starlette.concurrency.run_in_threadpool` or `asyncio.to_thread`. Do not hide it behind a normal function call.

Testing note: FastAPI's sync `TestClient` can call async routes, but it runs its own loop and does not run lifespan unless used as a context manager. For async tests, use `httpx.AsyncClient` with `ASGITransport` (Section 6.9). Domain exception handlers from Chapter 5 remain unchanged; an async handler raising `HTTPException` behaves the same as a sync one.

---

## 6.9 Testing asynchronous code

Use `pytest-asyncio` (or `anyio`) to run async tests. A minimal configuration:

```toml
# pyproject.toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

Then async test functions and fixtures run without an explicit marker:

```python
import pytest
from httpx import ASGITransport, AsyncClient

@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

async def test_health(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
```

`ASGITransport` calls the ASGI app in-process. It does not start a server and does not run lifespan events by default. If a test needs lifespan-managed resources, use `asgi-lifespan`'s `LifespanManager`, or override the relevant dependencies with fakes.

Testing cancellation and timeouts:

```python
async def test_timeout() -> None:
    async def slow() -> None:
        await asyncio.sleep(1)

    with pytest.raises(TimeoutError):
        async with asyncio.timeout(0.01):
            await slow()
```

Avoid asserting exact elapsed times. A test that expects "about 100 ms" will be flaky on CI. Use events for synchronization:

```python
async def test_worker_waits_for_signal() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    async def worker() -> None:
        started.set()
        await release.wait()

    task = asyncio.create_task(worker())
    await started.wait()
    assert not task.done()
    release.set()
    await task
```

For upstream HTTP, use `httpx.MockTransport` with `AsyncClient`, exactly as in Chapter 5, and assert the request shape and the mapped domain exception or response. For service tests, call async methods directly; do not start FastAPI.

Test these async-specific behaviors:

- The operation completes within a timeout and the timeout is enforced.
- Cancellation triggers cleanup and re-raises.
- A failing task in a `TaskGroup` cancels its siblings.
- Concurrency limits are respected.
- Partial failures are reported per item.
- No task is left pending at the end of the test.

If using pytest-asyncio in strict mode, mark tests with `@pytest.mark.asyncio` and async fixtures with `@pytest_asyncio.fixture`. In `auto` mode, plain `@pytest.fixture` works. Whichever you choose, keep the configuration in the project, not in individual tests.

---

## 6.10 Common mistakes and conventions

Mistakes to avoid:

1. Calling an `async def` function without `await` or scheduling it; the coroutine never runs.
2. Calling `asyncio.run` inside a running event loop.
3. Using `time.sleep`, `requests`, or blocking database drivers inside `async def`.
4. Creating tasks and dropping the reference, or never awaiting them.
5. Using `gather` for unbounded fan-out.
6. Assuming `gather` cancels siblings when one fails; it does not by default.
7. Catching `CancelledError` with `except Exception` and being surprised it is not caught.
8. Swallowing cancellation instead of re-raising it.
9. Omitting timeouts on external calls.
10. Creating an `AsyncClient` (or DB session) per request instead of reusing one.
11. Sharing asyncio primitives or clients across event loops or threads.
12. Using threads for CPU-bound work and expecting parallelism.
13. Treating a semaphore as a rate limiter.
14. Using unbounded `asyncio.Queue()` and losing backpressure.
15. Writing timing-sensitive tests with real sleeps.

Conventions to adopt:

- `async def` only for awaitable I/O; `def` for blocking code unless you deliberately offload.
- Every external call has a timeout; every batch has a concurrency bound.
- One long-lived `AsyncClient` per process, created in lifespan and closed on shutdown.
- `TaskGroup` for structured fan-out; `gather` only when partial failure is handled explicitly.
- Cleanup in `finally` or `async with`; never suppress `CancelledError`.
- `asyncio.to_thread` for blocking I/O in async code; process pools for CPU-bound work.
- Bounded queues and worker pools for large workloads.
- Tests use `ASGITransport`, `MockTransport`, and events rather than real network calls or sleeps.
- Log task failures and cancellation at the right level; cancellation is not an error in normal shutdown.

---

# Exercises

Work each exercise before running code. Groups are ordered from recognition to implementation; within each group, difficulty increases. Do not look up answers — predict, run, reconcile, then rewrite from memory. Most exercises can be run with a plain Python 3.11+ interpreter; HTTP exercises need `httpx`, and FastAPI exercises need the Chapter 5 project.

## Group A — Async fundamentals, coroutines, and the event loop

**A1.** Classify each workload as I/O-bound with an awaitable API, I/O-bound with a blocking API, or CPU-bound. Then choose `async`, threads, or processes:

1. Fetching 200 URLs with `httpx.AsyncClient`.
2. Fetching 200 URLs with `requests`.
3. Compressing 500 images.
4. Querying an async PostgreSQL driver.
5. Reading 5,000 small files with blocking `Path.read_text`.
6. Calling a legacy SDK that blocks and has no async variant.
7. Computing a large matrix product in pure Python.
8. Waiting on a rate-limited third-party API.

**A2.** Predict the complete output, including warnings, of this program:

```python
import asyncio

async def work() -> int:
    print("work")
    return 1

async def main() -> None:
    print("start")
    result = work()
    print("end", type(result).__name__)

asyncio.run(main())
```

Then explain when `work` actually executes and how to run it correctly.

**A3.** Predict what happens when this runs:

```python
import asyncio

async def main() -> None:
    asyncio.run(main())

asyncio.run(main())
```

State the exception type and message. Then write the corrected version that awaits an inner coroutine.

**A4.** Predict the elapsed time and the completion order:

```python
import asyncio, time

async def job(name: str, delay: float) -> str:
    await asyncio.sleep(delay)
    print("done", name)
    return name

async def main() -> None:
    start = time.perf_counter()
    a = await job("a", 1.0)
    b = await job("b", 1.0)
    print(a, b, round(time.perf_counter() - start, 1))

asyncio.run(main())
```

Then rewrite `main` so the two jobs run concurrently and state the new elapsed time.

**A5.** For each value, state whether `await value` is valid and why: a coroutine object, an `asyncio.Task`, an `asyncio.Future`, an `int`, a `list`, an object whose class defines `__await__`, and an object whose class defines only `__iter__`.

**A6.** Explain why this code fails before it runs, and rewrite it to execute successfully:

```python
import asyncio

async def fetch() -> str:
    return "data"

result = await fetch()
print(result)
```

**A7.** Predict the result of awaiting the same coroutine object twice:

```python
import asyncio

async def work() -> str:
    return "done"

async def main() -> None:
    coro = work()
    print(await coro)
    print(await coro)

asyncio.run(main())
```

State the exception type and explain why the same is not true for a task.

**A8.** Compare these two programs. Predict the output order and total elapsed time, then explain the difference:

```python
import asyncio, time

async def a() -> None:
    time.sleep(0.2)
    print("a")

async def b() -> None:
    await asyncio.sleep(0.2)
    print("b")

async def main() -> None:
    await asyncio.gather(a(), b())

asyncio.run(main())
```

**A9.** Find the blocking calls that would stall an event loop in this handler, and replace each with an async-safe alternative:

```python
import time
import requests

async def handler(url: str) -> str:
    time.sleep(0.1)
    response = requests.get(url, timeout=5)
    with open("cache.json", "w") as f:
        f.write(response.text)
    return response.text
```

**A10.** For each object, state whether it can be used with `async with`, `with`, both, or neither, based only on the listed methods: `__enter__`/`__exit__`, `__aenter__`/`__aexit__`, both pairs, or neither.

Then explain what `async with` does that `with` cannot do.

**A11.** Write an async generator that yields the numbers `1`, `2`, and `3` with a short `asyncio.sleep(0)` between them. Consume it with `async for` and collect the values. Then state what protocol methods make it usable in `async for`.

**A12.** An async generator holds a resource and has cleanup in `finally`. Answer:

1. What happens to the cleanup if the consumer breaks out of `async for` early?
2. How do you explicitly close the generator?
3. What is the role of `aclose()`?
4. Why is `for` instead of `async for` a `TypeError`?

**A13.** Write two coroutines:

- `fetch_value(name: str, delay: float) -> str` sleeps, then returns the name.
- `fetch_pair(a: str, b: str) -> tuple[str, str]` awaits both concurrently and returns the tuple.

Then write a `main` that runs `fetch_pair` with `asyncio.run` and prints the result.

**A14.** Write a complete program with a `main` coroutine and the correct top-level entry point. It should print `start`, run two coroutines concurrently, print the results, and print `end`. Explain why the top-level call is not just `main()`.

**A15.** Predict the print order:

```python
import asyncio

async def worker(name: str) -> None:
    print("start", name)
    await asyncio.sleep(0)
    print("end", name)

async def main() -> None:
    t1 = asyncio.create_task(worker("one"))
    t2 = asyncio.create_task(worker("two"))
    print("created")
    await t1
    await t2
    print("done")

asyncio.run(main())
```

Then change `sleep(0)` to `sleep(0.1)` and predict again.

**A16.** Rewrite this blocking function as an async function that does not block the loop. You may use `asyncio.to_thread` or change the underlying API:

```python
import subprocess

def run_command(args: list[str]) -> str:
    completed = subprocess.run(args, capture_output=True, text=True, check=True)
    return completed.stdout
```

**A17.** For each function, state whether `asyncio.iscoroutinefunction` returns `True` or `False`, and whether calling it returns a coroutine:

```python
async def a(): ...
def b(): ...
def c():
    async def inner(): ...
    return inner
f = c()
```

Then explain why wrapping a coroutine in a regular function changes how the caller must handle it.

**A18.** Predict what happens:

```python
import asyncio

async def wait_briefly(event: asyncio.Event) -> None:
    try:
        await asyncio.wait_for(event.wait(), 0.05)
    except TimeoutError:
        print("waited")

event = asyncio.Event()
asyncio.run(wait_briefly(event))
asyncio.run(wait_briefly(event))
```

State the exception type in the second run. Then run the same pattern with an uncontended `asyncio.Lock` and explain why it can appear to work even though sharing the object across loops is unsupported.

**A19.** This program is intended to print `tick` three times while work runs, but it never does:

```python
import asyncio

async def spin() -> None:
    while True:
        pass

async def ticker() -> None:
    for _ in range(3):
        print("tick")
        await asyncio.sleep(0.1)

async def main() -> None:
    await asyncio.gather(spin(), ticker())

asyncio.run(main())
```

Explain why, then propose two fixes: one that keeps the CPU work and one that restructures the algorithm to yield periodically.

**A20.** For each FastAPI handler, choose `def` or `async def` and justify:

1. Calls `await httpx.AsyncClient.get()`.
2. Calls a synchronous ORM.
3. Reads a small file with `Path.read_text()`.
4. Computes a SHA-256 of a 10-byte string.
5. Calls an async Redis client.
6. Runs a 2-second CPU-heavy image transform.
7. Calls a legacy SOAP client with no async support.

---

## Group B — Tasks, `gather`, and structured concurrency

**B1.** Predict the print order:

```python
import asyncio

async def hello() -> None:
    print("hello")

async def main() -> None:
    asyncio.create_task(hello())
    print("after create")
    await asyncio.sleep(0)

asyncio.run(main())
```

Then explain why creating a task does not run the coroutine immediately.

**B2.** Predict the return value and the print order:

```python
import asyncio

async def job(name: str, delay: float) -> str:
    await asyncio.sleep(delay)
    print("finished", name)
    return name

async def main() -> None:
    results = await asyncio.gather(
        job("slow", 0.2),
        job("fast", 0.05),
    )
    print(results)

asyncio.run(main())
```

Then state whether `gather` returns results in completion order or input order.

**B3.** Three tasks take 0.3, 0.5, and 0.1 seconds. Compare the elapsed time when they are awaited one after another versus when they are passed to `gather`. State which total is roughly the sum and which is roughly the maximum.

**B4.** Predict what is printed and what exception escapes:

```python
import asyncio

async def fail() -> None:
    await asyncio.sleep(0.01)
    raise ValueError("boom")

async def slow() -> None:
    await asyncio.sleep(0.1)
    print("slow finished")

async def main() -> None:
    try:
        await asyncio.gather(fail(), slow())
    except ValueError as exc:
        print("caught", exc)
    await asyncio.sleep(0.2)

asyncio.run(main())
```

Then explain whether `slow` was cancelled or allowed to continue, and what would change if `main` did not sleep after catching.

**B5.** Rewrite the previous `gather` call with `return_exceptions=True`. Predict the resulting list, its order, and what happens to `slow`. Then state the check you must perform on every element.

**B6.** A `gather` future is cancelled with `gather_future.cancel()`. Answer:

1. What happens to the child awaitables that have not completed?
2. What exception does the awaiting code receive?
3. Do children that have already completed matter?
4. How do you ensure cleanup has finished before exiting?

**B7.** Rewrite this sequential code with a `TaskGroup`:

```python
async def main() -> None:
    a = await fetch("a")
    b = await fetch("b")
    print(a, b)
```

Answer what the task group guarantees when the body exits normally.

**B8.** Predict the outcome:

```python
import asyncio

async def fail() -> None:
    await asyncio.sleep(0.01)
    raise ValueError("boom")

async def sibling() -> None:
    try:
        await asyncio.sleep(1)
    finally:
        print("sibling cleanup")

async def main() -> None:
    async with asyncio.TaskGroup() as tg:
        tg.create_task(fail())
        tg.create_task(sibling())

asyncio.run(main())
```

State the exception type that exits `main`, whether `sibling` is cancelled, and whether its `finally` runs.

**B9.** A task group contains three tasks; two fail with different exception types. Answer:

1. What exception is raised by the `async with` block?
2. How many errors does it contain?
3. What happens to the third task?
4. How do you inspect the individual errors?

**B10.** Write an `except*` clause that handles `ValueError` and `TimeoutError` separately from a `TaskGroup`. Answer:

1. Which order do the clauses run in?
2. What happens to unmatched exception types?
3. Can you use a plain `except` with an exception group?
4. How do you re-raise unmatched errors?

**B11.** An exception is raised in the body of `async with asyncio.TaskGroup()` after tasks were created. Answer:

1. Are the tasks cancelled?
2. Does the group wait for them?
3. Which exception or exceptions propagate?
4. Where should cleanup be placed?

**B12.** `asyncio.as_completed` receives three coroutines with delays 0.3, 0.1, and 0.2 seconds. Answer:

1. In which order are results yielded?
2. Is the order guaranteed for equal delays?
3. How do you distinguish which result belongs to which input?
4. How do exceptions surface?

**B13.** This code creates a background task and keeps no reference:

```python
async def main() -> None:
    asyncio.create_task(cleanup_cache())
    await do_work()
```

Answer:

1. Why is this risky?
2. What warning may appear if the task is garbage-collected while pending?
3. How do you keep a safe reference?
4. What should happen to the task on shutdown?

**B14.** A task has not finished, but code calls `task.result()`. Predict the exception. Then state what `task.done()`, `task.cancelled()`, and `task.exception()` return at that moment.

**B15.** A task was cancelled and awaited. Answer:

1. What does `await task` raise?
2. What does `task.exception()` raise?
3. What does `task.cancelled()` return?
4. Why is `task.result()` not the right way to check for cancellation?

**B16.** Predict the result of `asyncio.create_task(compute())` where `compute()` is a regular function returning an `int`. Then state what kinds of objects `create_task` accepts.

**B17.** Predict what happens with `with asyncio.TaskGroup() as tg:` instead of `async with`. State the exception and the reason.

**B18.** Nested task groups: an inner group raises. Answer:

1. Does the outer group cancel its other tasks?
2. How many levels of `ExceptionGroup` can result?
3. How do you handle the inner failure without failing the outer group?
4. Why is returning a result object sometimes better than letting an exception escape?

**B19.** Compare `asyncio.gather` and `asyncio.wait`. Answer:

1. Which one returns results and which returns done/pending sets?
2. Which one raises child exceptions directly?
3. Why can passing bare coroutines to `asyncio.wait` fail in modern Python?
4. When would you use `wait` with `FIRST_COMPLETED`?

**B20.** Write a function that runs 10 jobs concurrently with `gather(return_exceptions=True)` and returns a tuple of successes and failures, preserving which job produced each failure. The jobs are `async def job(i: int) -> str`.

**B21.** Write an async function `gather_bounded(coros, limit)` that never runs more than `limit` coroutines at once and returns results in input order. Use a semaphore. State what happens when one coroutine raises.

**B22.** For 20 tasks each sleeping 0.1 seconds, compare:

```python
for coro in coros:
    results.append(await coro)

results = await asyncio.gather(*coros)
```

State the approximate elapsed time for each and why.

**B23.** Predict the result of `await asyncio.gather()` with no arguments. Then predict `await asyncio.gather(*[])`.

**B24.** Predict what happens when the same coroutine object is passed twice to `gather`. Then explain how tasks avoid the problem.

**B25.** Add names to tasks created with `create_task(..., name="fetch-books")`. Answer:

1. Where do the names appear?
2. How do you retrieve a task's name?
3. How do names help debugging?
4. Are names unique?

**B26.** Write `run_all_or_report(coros)` using a `TaskGroup` such that all tasks run to completion even if some fail, and all errors are returned as a list. You may catch the `ExceptionGroup` after the group exits. State why `TaskGroup` cancels siblings on the first failure and how that affects this requirement.

---

## Group C — Cancellation, timeouts, and cleanup

**C1.** Predict the output and the exception seen by the caller:

```python
import asyncio

async def worker() -> None:
    try:
        await asyncio.sleep(10)
    finally:
        print("cleanup")

async def main() -> None:
    task = asyncio.create_task(worker())
    await asyncio.sleep(0.01)
    task.cancel()
    await task

asyncio.run(main())
```

Then change `await task` to catch `asyncio.CancelledError` and print a message.

**C2.** A task is cancelled immediately after creation, before it ever runs. Answer:

1. Does the coroutine body start?
2. Does a `try/finally` inside the coroutine run?
3. What does awaiting the task raise?
4. What does `task.cancelled()` return?

**C3.** Predict whether `except Exception` catches a `CancelledError` raised by `task.cancel()`. Explain the class hierarchy and the consequence for cleanup code.

**C4.** Predict the output and the value of `task.cancelled()`:

```python
import asyncio

async def stubborn() -> str:
    try:
        await asyncio.sleep(10)
    except asyncio.CancelledError:
        return "finished anyway"

async def main() -> None:
    task = asyncio.create_task(stubborn())
    await asyncio.sleep(0.01)
    task.cancel()
    print(await task)
    print(task.cancelled())

asyncio.run(main())
```

Explain why suppressing cancellation is usually a bug.

**C5.** Rewrite this code with `asyncio.timeout` and state which exception the caller sees:

```python
result = await asyncio.wait_for(fetch_slow(), timeout=2.0)
```

Then answer what happens to `fetch_slow` at the timeout.

**C6.** Compare `asyncio.timeout` and `asyncio.wait_for`. Answer:

1. Which one is a context manager?
2. Which one works on 3.10?
3. Do both cancel the inner operation?
4. Which one can be composed around several awaits with one shared budget?

**C7.** Predict the outcome of nested timeouts:

```python
async with asyncio.timeout(5):
    async with asyncio.timeout(1):
        await asyncio.sleep(10)
```

Which timeout fires, what exception propagates, and what happens to the outer context?

**C8.** Predict the behavior of `asyncio.timeout(0)` around:

1. `await asyncio.sleep(1)`
2. `await immediate_coroutine()` where the coroutine has no awaits and returns `42`

Then explain why a timeout cannot interrupt code that never awaits.

**C9.** Predict what happens to the inner task in this code, and what the caller sees:

```python
inner = asyncio.create_task(write_audit_log())

async with asyncio.timeout(0.1):
    await asyncio.shield(inner)

print("inner done?", inner.done())
```

Then state how you must eventually handle `inner`.

**C10.** A task is awaiting `asyncio.shield(inner)`, and the outer task is cancelled. Answer:

1. Does `inner` receive `CancelledError`?
2. What does the outer caller see?
3. How do you later retrieve `inner`'s result?
4. Why is shield not a way to ignore cancellation?

**C11.** A coroutine holds an async resource and is cancelled by a timeout. Answer:

1. Where should cleanup be placed?
2. Does `async with` run `__aexit__` on cancellation?
3. Does `finally` run?
4. What happens if cleanup itself awaits and is cancelled again?

**C12.** Write an async context manager whose `__aexit__` logs whether it received an exception, and test it with a normal exit, a `ValueError`, and cancellation. State the argument types passed to `__aexit__`.

**C13.** Fix this code so it cleans up and propagates cancellation:

```python
async def run() -> None:
    try:
        await do_work()
    except asyncio.CancelledError:
        cleanup_sync()
```

Then explain why `cleanup_sync()` should itself not block for long.

**C14.** Predict what happens here, and explain why `asyncio.timeout` cannot save the caller:

```python
async def spin() -> None:
    while True:
        pass

async def main() -> None:
    async with asyncio.timeout(0.1):
        await spin()

asyncio.run(main())
```

**C15.** You need to distinguish a timeout from an explicit cancellation. Answer:

1. Which exception does `asyncio.timeout` raise on expiry?
2. Which exception does an explicit `task.cancel()` deliver?
3. Why can catching both with one handler lose information?
4. How do you log each case differently?

**C16.** Write `fetch_with_timeout(url, client, seconds)` that uses `asyncio.timeout`, returns the parsed JSON, and maps a timeout to a domain `UpstreamTimeout` exception while allowing cancellation to propagate.

**C17.** Write a graceful-shutdown helper that accepts a list of tasks, cancels them, waits for all of them to finish, and returns any cleanup errors. State why `gather(..., return_exceptions=True)` is useful here.

**C18.** A `TaskGroup` is cancelled from outside (`task.cancel()` on the task running the group). Answer:

1. Are the child tasks cancelled?
2. Does the group wait for them?
3. What exception does the group's parent task see?
4. Does each child's `finally` run?

**C19.** A retry loop wraps each attempt in a timeout of 2 seconds, but the whole operation must finish in 5 seconds. Answer:

1. How do you enforce both budgets?
2. What happens to an attempt in progress when the outer budget expires?
3. How do you avoid retrying after the outer deadline?
4. Which exception should the caller receive?

**C20.** A `gather` future is cancelled while two children are still running. Answer:

1. Are the children cancelled?
2. What does the code awaiting the gather receive?
3. How do you wait for the children's cleanup?
4. What if one child suppresses cancellation?

**C21.** Explain `Task.uncancel()` and the `cancelling()` count in Python 3.11+. Answer:

1. Who is expected to call `uncancel()`?
2. Why is it mainly a structured-concurrency tool?
3. What can go wrong if application code clears cancellation casually?
4. When should you leave cancellation alone?

**C22.** A handler performs three sequential upstream calls with a total budget of 4 seconds. Write the structure using one `asyncio.timeout(4)` around all three. Then explain how the remaining budget shrinks after each call and what happens if the second call uses 3.5 seconds.

---

## Group D — Concurrency limits and backpressure

**D1.** This code starts 100 tasks with a semaphore of 5. Predict the maximum number of tasks inside the critical section, and explain how you would measure it with a counter:

```python
sem = asyncio.Semaphore(5)

async def work(i: int) -> None:
    async with sem:
        await asyncio.sleep(0.1)

await asyncio.gather(*(work(i) for i in range(100)))
```

**D2.** Compare `asyncio.Semaphore(5)` and `asyncio.BoundedSemaphore(5)`. Answer:

1. What happens when each is released more times than it was acquired?
2. Which one catches programmer error?
3. Why does the standard `Semaphore` allow over-release?
4. Which would you use for request limiting, and why?

**D3.** A semaphore starts at `0`. A worker awaits `acquire()`, and another coroutine calls `release()`. Answer what happens, and why this pattern is useful for startup gating.

**D4.** Predict what happens:

```python
lock = asyncio.Lock()

async def outer() -> None:
    async with lock:
        async with lock:
            print("inner")
```

Then explain why `asyncio.Lock` is not reentrant and how to restructure the code.

**D5.** This increment loses updates:

```python
count = 0

async def increment() -> None:
    global count
    value = count
    await asyncio.sleep(0)
    count = value + 1

await asyncio.gather(*(increment() for _ in range(100)))
```

Predict `count` roughly, explain the interleaving that causes it, and fix it with an `asyncio.Lock`. Then state why no lock is needed if the increment has no await between read and write.

**D6.** A queue is created with `asyncio.Queue(maxsize=1)`. A producer calls `await queue.put(1)` then `await queue.put(2)` with no consumer. Answer:

1. Where does the producer block?
2. What would happen with `put_nowait`?
3. Why is blocking here desirable?
4. How does a consumer unblock the producer?

**D7.** A worker calls `queue.get()` but never calls `queue.task_done()`, and the main coroutine awaits `queue.join()`. Predict the outcome, and explain the contract between `get`, `task_done`, and `join`.

**D8.** Implement a worker pool with 8 workers consuming from an `asyncio.Queue` of URLs. Requirements: bounded queue, all items processed, workers shut down cleanly, and a failing item is logged without killing its worker.

**D9.** Compare shutting down workers with sentinel values versus cancelling tasks. Answer:

1. Which approach lets in-flight items finish?
2. Which is faster to stop?
3. How do you avoid leaving sentinels in the queue?
4. Which approach preserves errors better?

**D10.** A producer can generate 1,000,000 items faster than consumers process them, and the queue has no `maxsize`. Answer:

1. What happens to memory?
2. Where is the backpressure missing?
3. How does `maxsize` change producer behavior?
4. What else would you monitor?

**D11.** Explain why a semaphore of 10 is not a rate limit of 10 requests per second. Then describe a token-bucket limiter and a case where each is the right tool.

**D12.** Implement bounded processing with `asyncio.as_completed`: at most 5 tasks in flight, results processed as they finish, and all errors collected. Explain why you cannot simply wrap the `as_completed` iterator in a semaphore.

**D13.** Write a reusable `map_bounded(func, items, limit)` for async `func` that returns results in input order, stops starting new work after the first failure, and cancels in-flight work. Compare that policy with "collect all errors and continue."

**D14.** Instrument the bounded fetch example with an `in_flight` counter and a `max_in_flight` high-water mark. Answer what values you expect for a limit of 20 and 200 items, and how a bug in semaphore placement would show up in the high-water mark.

**D15.** Design an end-to-end backpressure chain: HTTP requests produce work, a queue buffers it, workers call an upstream API, and results are written to disk. Specify queue sizes, worker counts, timeouts, and what happens when the disk is slow.

**D16.** A producer is blocked in `await queue.put(item)` when its task is cancelled. Answer:

1. Is the item enqueued?
2. Does the producer need cleanup?
3. How do you make the cancellation safe?
4. Why should `task_done()` only be called after a successful `get()`?

**D17.** Use `asyncio.Event` to start 10 workers at the same time. Answer:

1. What does each worker await?
2. Who calls `set()`?
3. What happens to a worker that calls `wait()` after the event is already set?
4. How do you reset the event, and when is that dangerous?

**D18.** Design a concurrency limiter for an LLM provider that allows 8 concurrent requests and 60 requests per minute. Answer:

1. Which primitive bounds concurrency?
2. Which primitive or algorithm bounds rate?
3. What happens when both limits are hit?
4. How do retries interact with both limits?
5. Which metric proves the limiter works?

**D19.** A worker raises an exception after consuming an item. Answer:

1. Is `task_done()` called if it is only in the success path?
2. What happens to `queue.join()`?
3. Where should `task_done()` go?
4. How do you report the failure without killing the worker?

**D20.** Semaphore acquisition is cancelled while waiting. Answer:

1. Is a permit consumed?
2. What does `async with sem` guarantee on cancellation?
3. How can a manual `acquire()`/`release()` pair leak a permit?
4. Why is `async with` safer?

---

## Group E — Asynchronous HTTP clients

**E1.** Write an async function that fetches `https://example.com/health` with `httpx.AsyncClient`, checks the status, and returns the parsed JSON. Then answer which operations must be awaited.

**E2.** Predict what happens here:

```python
async with httpx.AsyncClient() as client:
    response = client.get("https://example.com")
    print(response.status_code)
```

State the error, why it occurs, and what warning may appear if the coroutine is never awaited.

**E3.** Compare creating an `AsyncClient` per request with reusing one. Answer:

1. What connection setup is repeated per request?
2. How does that affect latency and socket usage?
3. Where should the shared client live in a FastAPI app?
4. Why is `async with` per request still better than never closing the client?

**E4.** Set a total timeout of 10 seconds, a connect timeout of 2 seconds, and a read timeout of 5 seconds on an `AsyncClient`. Answer:

1. Write the `httpx.Timeout` configuration.
2. Which exception is raised when the read timeout expires?
3. Which exception is raised when the connection cannot be established?
4. Why is a connect timeout usually shorter than a read timeout?

**E5.** An upstream returns `404` and `503`. Answer:

1. What does `raise_for_status()` raise for each?
2. How do you inspect the status without raising?
3. Which status should become a local `404`, and which a local `502` or `503`?
4. Why should you avoid returning the upstream body to the client?

**E6.** Compare `await client.aclose()` with `async with httpx.AsyncClient() as client:`. Answer:

1. When does each close connections?
2. What happens if you forget both?
3. Why is closing inside a request handler usually wrong?
4. How does lifespan fit in?

**E7.** Write a FastAPI lifespan that creates an `AsyncClient`, stores it on `app.state`, and closes it on shutdown. Then write a dependency that returns the client. Answer what happens if the app fails during startup after creating the client.

**E8.** An `AsyncClient` is created with `base_url="https://api.example.com/v1"`. Answer:

1. What URL results from `await client.get("/books")`?
2. What URL results from `await client.get("books")`?
3. Does `httpx` discard the base path when the relative path starts with `/`? Verify with a `MockTransport`.
4. Why should the base URL live in settings?

**E9.** Send `q="sci-fi & fantasy"` and repeated tags with `params`. Answer:

1. What query string is produced?
2. How do you send `tag=fantasy` and `tag=sci-fi`?
3. What happens if the upstream expects a comma-separated list?
4. Why should you never build the query with an f-string?

**E10.** Use `httpx.MockTransport` with an `AsyncClient` to return `{"isbn": "123", "title": "Dune"}` for `GET /books/123`. Answer:

1. How is the transport constructed?
2. How is the client constructed?
3. How do you assert the request path and query?
4. How do you return a `404` conditionally?

**E11.** Simulate a read timeout with `MockTransport`. Answer:

1. Which exception do you raise inside the handler?
2. Which method awaits the request?
3. Which exception does the service see?
4. What local status should the API return?

**E12.** Simulate an upstream `500` with an HTML body. Answer:

1. How does the service detect the failure?
2. Why should it not parse the HTML?
3. What should it log?
4. What should it raise, and what should the client see?

**E13.** Stream a large response with `client.stream`. Answer:

1. What context manager is used?
2. How do you iterate over bytes?
3. Why should you not call `response.json()` on a streamed response after consuming it?
4. How do you enforce a maximum size?

**E14.** Write an async retry loop for `GET` that retries timeouts and `503` up to three attempts with exponential backoff. Answer:

1. Which exception types are transient?
2. What do you do with `Retry-After`?
3. Why must the delay use `asyncio.sleep`?
4. What local status results after the final failure?

**E15.** Fetch 500 URLs with a shared `AsyncClient` and a semaphore of 25. Answer:

1. Where is the semaphore acquired?
2. Why must the client be shared?
3. What happens to the 475 waiting coroutines?
4. How do you collect per-URL failures without failing the whole batch?

**E16.** A module-level `AsyncClient` is created at import time and used by two different `asyncio.run` calls in tests. Predict the problem and explain how lifespan-scoped creation avoids it.

**E17.** Configure `httpx.Limits(max_connections=50, max_keepalive_connections=10)`. Answer:

1. What happens when 100 requests arrive at once?
2. What does the pool do with requests beyond the limit?
3. Why can a too-small pool cause avoidable timeouts?
4. How does the limit relate to a semaphore?

**E18.** A request coroutine is cancelled while awaiting an upstream response. Answer:

1. Is the HTTP request abandoned?
2. Is the connection reused or closed?
3. Why should cleanup not depend on receiving a response?
4. What timeout would have prevented a long wait anyway?

**E19.** A service method catches `httpx.TimeoutException` and raises `UpstreamTimeout`, catches `httpx.HTTPStatusError` with a 5xx and raises `UpstreamError`, and maps invalid JSON to `UpstreamError`. Answer:

1. Which layer owns these mappings?
2. Why should the route not catch raw `httpx` exceptions?
3. What statuses do the handlers return?
4. How do you unit test the service without FastAPI?

**E20.** Write service tests with `AsyncClient(MockTransport(...))` for success, 404, timeout, invalid JSON, and 500. Answer:

1. How do you assert the domain exception type?
2. How do you assert the request URL and headers?
3. Why are these tests deterministic?
4. What do they not prove about the FastAPI wiring?

**E21.** An upstream call has a total budget of 3 seconds, but the client timeout is 10 seconds. Answer:

1. Which timeout wins?
2. How do you make the route return within 3 seconds?
3. What exception should the client receive?
4. How do you ensure retries do not exceed the budget?

**E22.** For each situation, choose `httpx.Client` or `httpx.AsyncClient`: a sync FastAPI `def` handler, an `async def` handler, a CLI script that just makes one call, a background thread, and an async service with 1,000 concurrent requests. Explain the choice in each case.

## Group F — Bridging sync and async, threads, processes, and the GIL

**F1.** Predict the output order and total elapsed time:

```python
import asyncio, time

async def blocking() -> None:
    time.sleep(0.2)
    print("blocking")

async def async_sleep() -> None:
    await asyncio.sleep(0.2)
    print("async")

async def main() -> None:
    start = time.perf_counter()
    await asyncio.gather(blocking(), async_sleep())
    print(round(time.perf_counter() - start, 1))

asyncio.run(main())
```

Explain why the async sleep does not overlap with the blocking call.

**F2.** Write `read_config_async(path)` that wraps blocking `Path.read_text()` with `asyncio.to_thread`. Answer:

1. What does `to_thread` return?
2. Which thread runs the function?
3. Does it make the read faster in wall-clock terms for a single call?
4. What does it protect?

**F3.** Use `loop.run_in_executor` with a dedicated `ThreadPoolExecutor(max_workers=4)` to run four blocking functions. Answer:

1. How do you obtain the running loop?
2. How do you pass arguments?
3. What does the call return, and what must you do with it?
4. Who is responsible for shutting down the executor?
5. How does this differ from `asyncio.to_thread`?

**F4.** Four CPU-bound tasks each take 1 second. Compare running them with `asyncio.gather` (no awaits inside), a `ThreadPoolExecutor`, and a `ProcessPoolExecutor` with 4 workers. State the approximate elapsed time for each and explain the role of the GIL.

**F5.** Two threads run this function 1,000,000 times each:

```python
counter = 0

def bump() -> None:
    global counter
    for _ in range(1_000_000):
        counter += 1
```

Answer:

1. Is the final value guaranteed to be 2,000,000? Why or why not?
2. Which bytecode-level operations make `+=` non-atomic?
3. Would a `threading.Lock` fix it?
4. Why does the GIL not make this safe automatically?
5. Would two processes produce the same result in one shared variable?

**F6.** Compare these two FastAPI handlers for a blocking `requests` call:

```python
@app.get("/a")
async def a() -> dict:
    return requests.get("https://example.com").json()

@app.get("/b")
def b() -> dict:
    return requests.get("https://example.com").json()
```

Answer:

1. Which one blocks the event loop?
2. Which one runs in a worker thread?
3. Which one limits throughput by the thread pool size?
4. Which one is correct for this blocking client?
5. What would you do if the handler also needed another async operation?

**F7.** Predict what happens when `asyncio.run` is called from inside a coroutine, and when it is called from a plain thread that has no running loop. State the exception in the first case.

**F8.** You have a sync function that must call an async library function. Answer:

1. Where is the acceptable place to call `asyncio.run`?
2. Why is calling it from within an async application unsafe?
3. What alternatives avoid nesting loops?
4. What happens to the async client's connections when each call creates a new loop?

**F9.** An `asyncio.Lock` is used from two threads to protect a shared variable. Answer:

1. Is it safe?
2. Which lock should be used for thread synchronization?
3. What should be used for coroutine synchronization?
4. How do you hand work from a thread to the event loop safely?

**F10.** An `httpx.AsyncClient` is created in one `asyncio.run` call and closed in a later one. Answer:

1. What is the client bound to?
2. What error or failure can occur?
3. Where should the client live instead?
4. Why does the same problem affect `asyncio.Queue` and `asyncio.Semaphore`?

**F11.** A worker thread needs to run a coroutine on the main event loop. Answer:

1. Which function schedules the coroutine?
2. What kind of future does it return?
3. How does the thread wait for the result?
4. How are exceptions propagated?
5. Why is this preferable to starting a new event loop in the thread?

**F12.** A `ContextVar` is set in an async handler, then a blocking function that reads it runs via `asyncio.to_thread`. Answer whether the variable is visible in the thread, and how to verify. Then explain why relying on context propagation into arbitrary executors is riskier.

**F13.** Write a `with ThreadPoolExecutor(max_workers=4) as pool:` block that submits ten tasks and waits for all results. Answer what `shutdown(wait=True)` guarantees and what happens to queued tasks when you leave the block early.

**F14.** CPython's default executor size is roughly `min(32, os.cpu_count() + 4)`. Answer:

1. Why is it not simply the CPU count?
2. What happens when more blocking tasks than workers arrive?
3. Why can a slow blocking endpoint exhaust the pool?
4. How would you monitor this?
5. When should you use a dedicated executor?

**F15.** Compare `await asyncio.to_thread(path.read_text)`, using `aiofiles`, and calling `path.read_text()` directly in an async handler. Answer which performs blocking I/O on the loop and which keeps the loop responsive.

**F16.** A synchronous ORM call takes 50 ms inside an `async def` handler. Answer:

1. What happens to other requests during those 50 ms?
2. What are three ways to fix it?
3. Which fix is best if the ORM has no async support and you control the route?
4. Which fix is best if the same call is needed inside an async pipeline?

**F17.** A process pool receives a lambda and a locally defined function. Answer what happens, why, and how to restructure the code. Then state what arguments and return values must be picklable.

**F18.** Find the nested-loop anti-patterns:

```python
async def handler() -> None:
    asyncio.run(helper())

    loop = asyncio.new_event_loop()
    loop.run_until_complete(helper())
    loop.close()

    asyncio.get_event_loop().run_until_complete(helper())
```

Explain why each is wrong inside async code and rewrite the handler.

**F19.** For each scenario, choose `async def`, `def`, or `async def` plus an offload:

1. An async HTTP call plus JSON parsing.
2. A blocking SDK call with no timeout support.
3. A pure computation on a small dict.
4. A 3-second CPU-heavy transform.
5. A sync database driver used from an async route.
6. An async cache client plus a blocking audit-log write.

**F20.** Offload 50 CPU-heavy jobs to a process pool with at most 4 running at once. Answer:

1. Which part is bounded: process count or submissions?
2. How do you avoid creating 50 futures at once?
3. What happens to the event loop while processes run?
4. How do you handle one failed job?

**F21.** Design a mixed pipeline: fetch 100 documents asynchronously with a concurrency of 10, transform each in a process pool, then write results asynchronously. Specify where backpressure applies at each stage and whether one queue is enough.

**F22.** A FastAPI app has 100 concurrent requests to a `def` endpoint that sleeps for 5 seconds. The default thread pool has 40 workers. Answer:

1. How many requests run at once?
2. What happens to the rest?
3. What latency does the last request see?
4. Why is adding more threads not always the fix?
5. What would you change?

**F23.** `asyncio.to_thread` is cancelled while the thread is running. Answer:

1. Does the thread stop?
2. What does the awaiting coroutine see?
3. Why can this leak work or write a stale result?
4. How do you design around it?

**F24.** Explain why moving CPU-bound work to threads does not increase throughput on standard CPython, even though the event loop remains responsive. Then state when a thread is still the right choice.

---

## Group G — Async FastAPI

**G1.** Convert this synchronous route to async, using a shared `AsyncClient` dependency:

```python
@app.get("/weather/{city}")
def weather(city: str) -> dict:
    response = requests.get(f"https://weather.internal/{city}", timeout=5)
    response.raise_for_status()
    return response.json()
```

Answer which calls must be awaited and where error mapping belongs.

**G2.** Identify every blocking operation in this async handler and fix it:

```python
@app.get("/report")
async def report() -> dict:
    raw = Path("report.json").read_text()
    data = json.loads(raw)
    time.sleep(0.5)
    return data
```

**G3.** A `def` route calls a synchronous ORM. Answer:

1. Which thread runs the handler?
2. Is the event loop blocked?
3. What limits concurrency?
4. What happens under a slow query?
5. When would you convert it to async?

**G4.** Write an async dependency that reads the `Authorization` header, awaits a token verification function, and returns a `User`. Answer what status and headers a missing token should produce.

**G5.** Write an async `yield` dependency that opens a transaction, yields it, and rolls back on exception. Answer:

1. When does the code after `yield` run?
2. Does it run if the handler raises `HTTPException`?
3. Does it run if the request is cancelled?
4. Where does the commit belong?
5. Why should the dependency not swallow exceptions?

**G6.** Write a lifespan that creates an `httpx.AsyncClient` and an `asyncio.Semaphore`, stores both on `app.state`, and cleans up on shutdown. Answer why the semaphore should not be created per request.

**G7.** Write a dependency that reads `app.state.client` from the request. Answer:

1. Which object gives access to the app?
2. What happens if the dependency is called before lifespan startup?
3. Why is `app.state` better than a module-level global?
4. How do tests replace the client?

**G8.** A route needs to limit upstream calls to 10 concurrent requests. Answer:

1. Where is the semaphore created?
2. How is it injected?
3. Is the semaphore per process or per request?
4. What happens when 100 requests arrive?
5. How do you test the limit?

**G9.** Write an async exception handler for a domain `UpstreamTimeout`. Answer:

1. Can FastAPI exception handlers be async?
2. What must the handler return?
3. How do you log the failure?
4. How do you avoid leaking upstream details?
5. How does this handler interact with an async route that was cancelled?

**G10.** A client disconnects while an async handler is awaiting a slow upstream call. Answer:

1. How can the handler detect the disconnect?
2. What happens to the handler task by default?
3. How do you stop wasteful work?
4. Why should cleanup still run?
5. What should be logged?

**G11.** Implement a `StreamingResponse` backed by an async generator that yields lines from a large query. Answer:

1. What media type would you use?
2. When does the generator start and stop?
3. How do you ensure the database cursor closes on disconnect?
4. Why can you not set a `Content-Length` easily?
5. What happens if the generator raises after streaming started?

**G12.** Compare `BackgroundTasks` with `asyncio.create_task`. Answer:

1. When does each run relative to the response?
2. Does either survive a process restart?
3. Which one should handle a 30-second CPU job?
4. What happens to exceptions in each?
5. Which is appropriate for sending an email?

**G13.** Write an async database session dependency using `async with session_factory() as session:` and `yield session`. Answer:

1. Where should commit happen?
2. Where should rollback happen?
3. What happens on cancellation?
4. Why must the session not be reused across requests?
5. How does the pool interact with a semaphore?

**G14.** An app has a DB pool of 10 connections and a request semaphore of 100. Answer:

1. What happens to 100 concurrent requests?
2. Where do they wait?
3. What timeout applies while waiting?
4. Why is the semaphore limit misleading?
5. How would you align the two limits?

**G15.** A sync `TestClient` calls an `async def` route that awaits an upstream client. Answer:

1. Does the route run?
2. Which loop runs it?
3. Does lifespan run when the client is used without a context manager?
4. How do you make the test deterministic?
5. When would you switch to `AsyncClient`?

**G16.** Write an async test using `httpx.AsyncClient` and `ASGITransport`. Answer:

1. What is the base URL used for?
2. Does `ASGITransport` start a network server?
3. Are lifespan events run?
4. How do you inject a fake client?
5. How do you assert the response?

**G17.** A test needs lifespan-created resources. Answer:

1. Why does `ASGITransport` alone not provide them?
2. What does `asgi-lifespan`'s `LifespanManager` do?
3. What is the alternative of overriding dependencies with fakes?
4. How do you ensure cleanup after the test?
5. Why is manually calling the lifespan context risky?

**G18.** Override an async dependency in a test. Answer:

1. Can the override be a sync function returning a value?
2. Can it be an async function?
3. What must the override return for a `yield` dependency?
4. How do you clear it?
5. Why should the override match the dependency's interface, not its implementation?

**G19.** Enforce a 2-second timeout on all upstream work inside a route. Answer:

1. Where do you place `asyncio.timeout`?
2. What exception does the route see?
3. How do you map it to `504`?
4. Does the timeout cancel the upstream request?
5. What happens if the handler catches `TimeoutError` and continues?

**G20.** Implement graceful shutdown for background tasks started by the app. Answer:

1. Where do you store task references?
2. What order should shutdown follow: stop accepting work, cancel tasks, wait, close clients?
3. What happens to in-flight requests during shutdown?
4. How do you log unfinished tasks?
5. Why is `asyncio.run` unsuitable inside an ASGI app?

**G21.** For each endpoint, choose `def`, `async def`, or `async def` with offload: health check, list from sync DB, list from async DB, call async LLM provider, compute checksum of a small payload, resize 20 images, write a blocking audit log after an async call.

**G22.** An app mixes sync and async routes. Answer:

1. Is that supported?
2. Which routes can block the event loop?
3. Which routes consume the thread pool?
4. How do you prevent one slow sync route from starving others?
5. What convention would you document for the team?

---

## Group H — Testing asynchronous code

**H1.** Configure pytest for async tests. Answer:

1. Which package provides the marker or auto mode?
2. What does `asyncio_mode = "auto"` do?
3. Where does the configuration live?
4. What is the alternative `anyio` setup?
5. Why should the configuration be in the project rather than in each test?

**H2.** Write a minimal async test for this function:

```python
async def add(a: int, b: int) -> int:
    await asyncio.sleep(0)
    return a + b
```

Answer whether the test function itself must be async and why.

**H3.** Write an async fixture that creates an `AsyncClient` with `ASGITransport` and closes it after the test. Answer:

1. What decorator is needed in strict mode?
2. Does the fixture need to be async?
3. What does it yield?
4. How does teardown run if the test fails?
5. What goes wrong if the fixture is module-scoped while each test gets a fresh event loop?

**H4.** Tests share an event loop by default or get a fresh one depending on configuration. Answer:

1. Why can sharing loop-bound state between tests cause failures?
2. What state is loop-bound?
3. How do you detect a leaked task from a previous test?
4. Why is per-test isolation the safer default?
5. What is the trade-off for expensive resources?

**H5.** Write a test that starts a worker, asserts it is waiting, releases it with an `asyncio.Event`, and asserts completion. Answer why this is more reliable than `await asyncio.sleep(0.1)`.

**H6.** Write a test that asserts a slow operation times out. Answer:

1. Which exception do you assert?
2. What timeout do you use?
3. Why should the timeout be tiny but not zero?
4. How do you avoid leaking the slow task?
5. Why should you not assert the exact elapsed time?

**H7.** Write a test that cancels a task and asserts that its cleanup ran. Answer:

1. How do you cancel the task?
2. Which exception does `await task` raise?
3. How do you assert cleanup without swallowing cancellation in production code?
4. What flag or list would you use?
5. How do you avoid a race before cancellation?

**H8.** A `TaskGroup` raises an `ExceptionGroup`. Write the `pytest.raises` assertion and answer how you inspect the contained exceptions.

**H9.** Given an `ExceptionGroup` with a `ValueError` and a `TimeoutError`, write code that counts each type. Answer why `except ValueError` alone does not catch the `ValueError` inside the group.

**H10.** Write an async integration test with `ASGITransport` for `GET /books/1` returning a 200. Answer:

1. How do you install the transport?
2. What base URL do you use?
3. How do you assert the JSON body?
4. How do you override a dependency?
5. Why is no port opened?

**H11.** A test needs a client created in lifespan. Answer:

1. Which library can run the lifespan around the test?
2. What does `LifespanManager` enter and exit?
3. How do you obtain the client afterward?
4. What is the lighter alternative if the test only needs a fake?
5. How do you assert cleanup ran?

**H12.** Test a service that calls an upstream API using `AsyncClient` with `MockTransport`. Answer:

1. How do you define the handler?
2. How do you assert the request path and query?
3. How do you return different responses per path?
4. How do you simulate a timeout?
5. Why is this better than hitting the real service?

**H13.** Write a test that asserts at most 5 upstream requests are in flight. Answer:

1. Where do you increment and decrement the counter?
2. What is the high-water mark?
3. How do you make the requests overlap reliably?
4. Why is a semaphore in the test not the same as the production limit?
5. What assertion proves the limit worked?

**H14.** Write a test that asserts no tasks are left pending after an operation. Answer:

1. How do you capture the current task set?
2. Why is `asyncio.all_tasks()` noisy in a test runner?
3. How do you exclude the current task?
4. What names or groups help?
5. Why is this assertion valuable for cancellation bugs?

**H15.** This test is flaky. Explain why and rewrite it deterministically:

```python
async def test_concurrent() -> None:
    results = []

    async def job(i: int) -> None:
        await asyncio.sleep(0.01)
        results.append(i)

    await asyncio.gather(*(job(i) for i in range(10)))
    assert results == list(range(10))
```

**H16.** Write a test that proves an `async with` resource closed even when the body raised. Answer which flag or mock records the close and how to assert it.

**H17.** Test a batch function that returns successes and failures. Answer:

1. How do you create inputs that fail deterministically?
2. How do you assert the order of successes?
3. How do you assert that failures carry the input identifier?
4. Why should the test not assert traceback text?
5. What happens if one failure is accidentally treated as success?

**H18.** Decide whether each belongs in a service test or an HTTP test: retry counting, request-body validation, response-model filtering, timeout mapping, auth dependency, and concurrency limiting inside a service. Justify each.

**H19.** Rewrite an async test using `anyio` instead of `pytest-asyncio`. Answer:

1. Which marker is used?
2. Which fixture parameter selects the backend?
3. How do async fixtures work?
4. What is the benefit of backend-agnostic tests?
5. What is the cost?

**H20.** An async fixture creates a connection and a task. Answer:

1. What must its teardown do?
2. In which order should it cancel the task and close the connection?
3. What happens if teardown raises?
4. How do you ensure the task is awaited?
5. Why is `yield` teardown preferable to `__del__`?

**H21.** Write a test that cancels a request handler and asserts that a fake upstream request was closed. Answer:

1. How do you trigger the cancellation?
2. Which fake records the close?
3. What exception does the caller see?
4. How do you avoid a deadlock while waiting for the fake?
5. Why is this test more valuable than a timeout test alone?

---

## Group I — Debugging and realistic async tasks

**I1.** This code sometimes prints `AttributeError: 'coroutine' object has no attribute 'json'`. Explain why, then fix it:

```python
async def get_title(client, url: str) -> str:
    response = client.get(url)
    return response.json()["title"]
```

**I2.** This service handles one request at a time despite using `async def`. Find the cause and list three fixes:

```python
@app.get("/summary")
async def summary(ids: list[int]) -> dict:
    totals = []
    for book_id in ids:
        response = requests.get(f"https://books.internal/{book_id}", timeout=5)
        totals.append(response.json()["sales"])
    return {"total": sum(totals)}
```

**I3.** This batch job exhausts file descriptors and the upstream rate limit. Rewrite it with bounded concurrency and state the maximum number of in-flight requests:

```python
responses = await asyncio.gather(*(client.get(url) for url in urls))
```

**I4.** A task is created for a cache refresh. It sometimes disappears, and exceptions are never logged. Explain why and propose a fix using a tracked task and a done callback or a `TaskGroup`.

**I5.** This code prevents shutdown. Explain why and fix it:

```python
async def run() -> None:
    try:
        await long_running()
    except asyncio.CancelledError:
        pass
```

**I6.** Two workers run this function concurrently. Explain why they can deadlock, then rewrite it so each worker releases exactly what it acquired:

```python
sem = asyncio.Semaphore(2)

async def work() -> None:
    await sem.acquire()
    await sem.acquire()
    try:
        await do_work()
    finally:
        sem.release()
        sem.release()
```

**I7.** A pipeline hangs at `await queue.join()` even though all workers are idle. Explain the likely cause and the fix.

**I8.** A test creates an `AsyncClient` at module scope and fails with an event-loop error when the test suite runs multiple tests. Explain why and restructure the fixture.

**I9.** A retry loop sets a 1-second timeout around the whole loop but also wants each attempt to time out after 0.5 seconds. The code only applies one timeout. Rewrite it with both budgets and state which wins when they conflict.

**I10.** Multiple tasks update a shared dict and a shared list. Explain which operations interleave at await points and how to protect the invariant. Then state when a lock is unnecessary.

**I11.** Refactor this synchronous service into an async service with an injected async client, timeouts, and domain exceptions:

```python
class BookService:
    def __init__(self, client: httpx.Client) -> None:
        self.client = client

    def get(self, isbn: str) -> dict:
        response = self.client.get(f"/books/{isbn}")
        response.raise_for_status()
        return response.json()
```

**I12.** Add a 2-second per-attempt timeout, three attempts, exponential backoff, and a concurrency limit of 10 to a function that fetches a list of URLs. List the order in which those controls apply.

**I13.** Build a bounded scraper: 500 URLs, 10 concurrent requests, 5-second timeout per request, per-URL errors collected, and a final summary with success and failure counts. State what happens when the upstream starts returning `429`.

**I14.** Build a batch LLM caller: 100 prompts, at most 8 in flight, 30-second timeout per call, retries on transient failures, and results returned in input order with per-item status. Explain why `gather(..., return_exceptions=True)` alone is not enough.

**I15.** Design graceful shutdown for a service with an HTTP client, a queue, 8 workers, and in-flight requests. Specify the sequence and which operations must be awaited.

**I16.** An endpoint takes 200 ms of upstream latency. With concurrency 20, estimate throughput in requests per second and the latency for the 100th request if 100 requests arrive at once. State the assumptions and what happens when upstream latency doubles.

**I17.** Build an async pipeline with three stages: producer, transformer, and writer, connected by bounded queues. Explain where backpressure appears and how a slow writer affects the producer.

**I18.** A task is cancelled while awaiting `queue.put()`. Explain what happens to the item and to `queue.join()`, then write cancellation-safe producer code.

**I19.** A service accepts 10,000 webhook deliveries per minute but can process only 2,000 per minute. Design buffering, concurrency limits, and failure handling. Explain why unbounded in-memory queues are not a solution.

**I20.** Capstone: build an async service that:

- fetches book metadata from 300 URLs with at most 15 in-flight requests
- enforces a 4-second budget per request and an overall budget
- retries transient failures with backoff
- validates each response with a Pydantic model
- transforms results in a process pool
- returns successes and failures in input order
- cancels cleanly and closes the HTTP client
- has tests using `MockTransport`, `ASGITransport`, and events rather than sleeps

Describe the modules, the task structure, the error taxonomy, and the tests. Then implement it. Answer which failure mode is hardest to reproduce in a test and how you would simulate it.

---

## Group J — TypeScript translations and conceptual comparisons

**J1.** Compare a JavaScript `Promise` with a Python coroutine. Answer:

1. Which one starts executing when created?
2. Which one is lazy?
3. What must you do to run a coroutine?
4. How does each represent the eventual result?
5. Why does this difference affect error handling and scheduling?

**J2.** Translate `Promise.all([a(), b(), c()])` to Python. Answer:

1. Which asyncio function corresponds to it?
2. Is result order preserved?
3. What happens on the first rejection or exception?
4. Do the other operations stop?
5. What is the Python equivalent of passing already-created promises?

**J3.** Translate `Promise.allSettled` to asyncio. Answer:

1. Which argument produces settled-style results?
2. How do you distinguish success from failure?
3. Does the result preserve input order?
4. How do you avoid re-raising the exception later?
5. What is the TypeScript `status` field equivalent in Python?

**J4.** Translate `Promise.race` to asyncio. Answer:

1. Which function returns when the first task finishes?
2. What happens to the other tasks?
3. How do you implement a timeout race?
4. Why is cancelling the losers important?
5. How does `asyncio.timeout` improve on a manual race?

**J5.** Compare `AbortController` with asyncio cancellation and timeouts. Answer:

1. How do you cancel a fetch in each ecosystem?
2. Does cancellation stop the underlying network work immediately?
3. How does each signal propagate to nested operations?
4. What cleanup is required?
5. Which model is cooperative in both cases?

**J6.** Compare the Node.js event loop with asyncio's event loop. Answer:

1. Which phases or queues exist in Node that have no direct asyncio equivalent?
2. Are microtasks and callbacks identical concepts?
3. Which runtime lets you block all concurrency with a synchronous loop?
4. Does `await` behave identically in both?
5. What practical advice carries over regardless of runtime?

**J7.** Translate this TypeScript to Python:

```ts
async function loadAll(ids: string[]): Promise<Item[]> {
  const items = await Promise.all(ids.map((id) => fetchItem(id)));
  return items;
}
```

Answer how the Python function signature, concurrency, and result collection differ.

**J8.** Compare `new Promise((resolve, reject) => {...})` with `asyncio.create_task(coro)`. Answer:

1. Which executes the work eagerly?
2. Which schedules work on the running loop?
3. How do you keep a reference to the task?
4. How do errors surface if you never await?
5. Which is closer to `asyncio.ensure_future`?

**J9.** Compare Node's unhandled promise rejection with Python's never-awaited coroutine and pending-task destruction. Answer:

1. Which warnings or errors appear?
2. When do they appear?
3. Are they guaranteed to crash the process?
4. How do you make background work observable?
5. What production monitoring would catch either?

**J10.** Translate `p-limit(5)` to asyncio. Answer:

1. Which primitive implements the limit?
2. Where is the permit acquired?
3. How do you return results in input order?
4. What happens when one task rejects?
5. How do you test the maximum concurrency?

**J11.** Compare Node readable streams with Python async iterators. Answer:

1. Which protocol methods does each use?
2. How do you handle backpressure?
3. How do you close or destroy the stream/generator?
4. Which one composes more naturally with `async for`?
5. What is the equivalent of a `for await` loop?

**J12.** Translate TypeScript types `Promise<T>`, `Promise<T | null>`, and `AsyncIterable<T>` to Python annotations. Answer:

1. What is the type of an un-awaited coroutine?
2. What is the type of a task?
3. What is the type of an async generator?
4. Why does Python distinguish `Coroutine` from `Awaitable`?
5. What does `AsyncIterator[T]` represent?

**J13.** Translate this Node fan-out to Python with bounded concurrency and per-URL error collection:

```ts
const results = await Promise.all(
  urls.map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }),
);
```

Explain what changes when the code must return partial successes.

**J14.** Translate an Express async route that catches upstream errors in middleware to FastAPI. Answer:

1. Where does the domain exception get raised?
2. Where is it mapped to HTTP?
3. What statuses correspond to timeout and upstream 5xx?
4. Why should the route not contain a broad `try/except`?
5. How do you test the mapping?

**J15.** Translate a retry helper using `AbortSignal.timeout` to Python with `asyncio.timeout` and `asyncio.sleep`. Answer:

1. Where is the per-attempt timeout applied?
2. How do you combine it with an overall budget?
3. Which errors are retryable?
4. How do you avoid retrying a cancelled operation?
5. How do you test the delay without waiting for real time?

**J16.** Compare Jest/Vitest async tests with pytest async tests. Answer:

1. How do you mark or configure async tests?
2. How do async fixtures/setup differ?
3. How do you assert rejections or exceptions?
4. How do you avoid real timers in each ecosystem?
5. Which patterns are most portable?

**J17.** Explain event-loop starvation in both Node and Python. Give an example of code that causes it in each, and describe one mitigation that works in both. Then state a mitigation that is Python-specific.

**J18.** Build a comparison table for `Promise.all`, `Promise.allSettled`, `Promise.race`, `Array.prototype.map` with `await`, and `p-limit`, mapping each to its asyncio counterpart and stating failure and ordering semantics.

**J19.** You are designing a Node/TypeScript frontend that calls a Python async backend. Answer:

1. Which failures should be represented as HTTP statuses versus streaming events?
2. How should the backend bound concurrency to protect the LLM provider?
3. How do timeouts and retries interact with client-side `AbortController`?
4. How do you keep partial results flowing for a long batch?
5. What contract details must be shared between the TypeScript client and the Python service?

**J20.** Explain the GIL to a Node.js developer. Answer:

1. Why can Node run many concurrent requests on one thread while Python needs threads or processes for CPU work?
2. Where does Python's async I/O resemble Node's model?
3. Why does Python still use multiple workers in production?
4. What does the GIL protect, and what does it not guarantee?
5. When would a free-threaded Python build change the answer?

---

## Before moving on

Check yourself against the chapter outcome without looking back at the notes:

- Explain concurrency versus parallelism, the GIL, and when to use async, threads, or processes.
- Create and await coroutines correctly; avoid never-awaited coroutines, nested `asyncio.run`, and cross-loop state.
- Schedule tasks, keep references, and choose between sequential awaits, `gather`, `TaskGroup`, and `as_completed`.
- Predict `gather` exception and cancellation behavior; inspect `ExceptionGroup` errors with `except*` or explicit iteration.
- Cancel tasks cooperatively, enforce timeouts and shared budgets, and guarantee cleanup without swallowing `CancelledError`.
- Bound fan-out with semaphores, worker pools, and bounded queues; distinguish concurrency limits from rate limits and design backpressure.
- Reuse an `AsyncClient` with correct timeouts, connection limits, retries, streaming, and lifecycle management.
- Offload blocking calls with `to_thread` or executors, use processes for CPU-bound work, and keep asyncio primitives on their loop and thread.
- Build async FastAPI endpoints and dependencies, manage shared clients with lifespan, and avoid blocking the event loop.
- Test async code deterministically with `pytest-asyncio`, `ASGITransport`, `MockTransport`, and events rather than sleeps.
- Translate Promise-based patterns and concurrency limits from TypeScript into their asyncio equivalents.

If any group felt slow, redo a subset of its exercises from scratch before continuing to Chapter 7.
