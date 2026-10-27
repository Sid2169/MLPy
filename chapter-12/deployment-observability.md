# Chapter 12 — Deployment and Observability

Chapter 5 built an HTTP service. Chapters 6 and 8 made it concurrent and reliable. This chapter puts that service into production: a reproducible artifact, explicit configuration, a container, health and shutdown semantics, structured logs, metrics, traces, service objectives, load tests, and a deployment pipeline you can roll back.

The runnable examples use the Python standard library; the packaging and container snippets show the FastAPI/uvicorn service from Chapter 5. Container and CI snippets are configuration files, not Python. The ideas apply to any ASGI framework, worker, scheduler, or platform.

The central rule: deployment is a contract with the runtime, and observability is evidence. A process that starts is not necessarily ready; a request that returns `200` is not necessarily healthy; a log line is not necessarily an answer.

## Contents

1. From code to a running service
2. Packaging and reproducible artifacts
3. Configuration, secrets, and startup validation
4. Containers and process lifecycle
5. Health, readiness, and graceful shutdown
6. Structured logging and correlation
7. Metrics and dashboards
8. Tracing and error tracking
9. SLOs, alerting, and incident response
10. Performance, load, and capacity
11. CI/CD, migrations, and progressive delivery
12. Security, cost, and common mistakes
13. Exercises (Groups A–J)

---

## 12.1 From code to a running service

A deployment turns a versioned artifact into a process that receives traffic. Keep four things separate:

- **Build:** produce an immutable artifact from a commit.
- **Deploy:** place that artifact on infrastructure.
- **Release:** send it traffic.
- **Observe:** decide whether it is healthy and useful.

The artifact can be a wheel, a container image, or both. Build it once and promote the same digest through environments. Do not rebuild “the same” commit for production; the dependency graph or base image may have changed.

A runtime contract describes what the platform expects:

```text
command             python -m rag_service
port                8000
config              environment variables and mounted secrets
health              /livez, /readyz
shutdown            SIGTERM, drain deadline, exit code 0
resources           CPU, memory, writable paths
dependencies        database, cache, model provider
```

Write this contract down. A Dockerfile, a platform manifest, and a README that disagree are three different deployments.

The service has a lifecycle:

```text
starting → ready → draining → stopped
```

Only `ready` receives new requests. `starting` may take seconds while pools open, models load, or migrations finish. `draining` stops accepting work and finishes what is already in progress.

```python
from dataclasses import dataclass
from enum import Enum


class Phase(Enum):
    STARTING = "starting"
    READY = "ready"
    DRAINING = "draining"
    STOPPED = "stopped"


@dataclass
class Lifecycle:
    phase: Phase = Phase.STARTING

    def mark_ready(self) -> None:
        if self.phase is Phase.STARTING:
            self.phase = Phase.READY

    def begin_drain(self) -> None:
        if self.phase in (Phase.STARTING, Phase.READY):
            self.phase = Phase.DRAINING

    def mark_stopped(self) -> None:
        self.phase = Phase.STOPPED

    @property
    def accepts_traffic(self) -> bool:
        return self.phase is Phase.READY
```

This is a state machine, not three independent booleans. A common bug is a `ready = True` flag that remains true while the server is shutting down.

---

## 12.2 Packaging and reproducible artifacts

A production image should contain:

- the Python version you tested
- the application package
- pinned runtime dependencies
- no build tools that are not needed at runtime
- no secrets, tests, caches, or development dependencies

A minimal `pyproject.toml`:

```toml
[project]
name = "rag-service"
version = "1.4.0"
requires-python = ">=3.12,<3.13"
dependencies = [
    "fastapi>=0.115,<1",
    "uvicorn[standard]>=0.30,<1",
    "pydantic>=2.8,<3",
]

[project.optional-dependencies]
dev = ["pytest>=8,<9", "ruff>=0.6,<1", "mypy>=1.10,<2"]

[project.scripts]
rag-service = "rag_service.__main__:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

A lock file pins the full transitive graph. Commit it. `requires-python` is a runtime guard, not a suggestion: installing on an unsupported interpreter should fail during build, not at the first request.

Use a `src/` layout so tests import the installed package rather than an accidental working-directory module:

```text
src/rag_service/
  __init__.py
  __main__.py
  config.py
  logging.py
  metrics.py
  tracing.py
  api.py
tests/
pyproject.toml
uv.lock
```

`python -m rag_service` executes `rag_service/__main__.py`. The console script in `[project.scripts]` calls the same `main()` function. Do not maintain two startup paths.

```python
# src/rag_service/__main__.py
import uvicorn

from rag_service.api import create_app
from rag_service.config import Settings


def main() -> None:
    settings = Settings.from_env()
    app = create_app(settings)
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=settings.port,
        log_config=None,
        timeout_graceful_shutdown=int(settings.shutdown_grace_s),
    )


if __name__ == "__main__":
    main()
```

`log_config=None` prevents the server from replacing your JSON logging configuration. The exact `uvicorn` arguments depend on the version; the principle is that the application owns configuration and logging.

Version metadata should come from the installed package, not a hand-edited constant:

```python
from importlib.metadata import PackageNotFoundError, version


def app_version() -> str:
    try:
        return version("rag-service")
    except PackageNotFoundError:
        return "0.0.0+unknown"
```

Build the wheel once:

```bash
python -m build --wheel
```

Install that wheel in the runtime image. Installing directly from a Git branch makes the deployed bytes hard to reproduce; if you must, pin the exact commit and record it in the image labels.

Reproducibility checklist:

- Python version and base image digest are pinned.
- Dependency lock file is committed.
- Build and runtime stages are separate.
- The image is rebuilt from the same lock file for every release.
- The artifact is tagged with an immutable version or digest, never only `latest`.
- The deployed digest and commit are recorded.

---

## 12.3 Configuration, secrets, and startup validation

Environment variables are strings. Parse them at startup and fail with a clear error. Do not scatter `os.getenv()` calls through request handlers.

```python
import os
from dataclasses import dataclass, field


class ConfigError(ValueError):
    pass


def required(env: dict[str, str], name: str) -> str:
    value = env.get(name)
    if value is None or value.strip() == "":
        raise ConfigError(f"missing required setting: {name}")
    return value


def parse_bool(raw: str) -> bool:
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ConfigError(f"invalid boolean: {raw!r}")


@dataclass(frozen=True)
class Settings:
    database_url: str
    port: int
    request_timeout_s: float
    shutdown_grace_s: float
    log_level: str
    debug: bool
    api_key: str = field(repr=False)

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        port = int(required(env, "PORT"))
        timeout = float(required(env, "REQUEST_TIMEOUT_SECONDS"))
        grace = float(required(env, "SHUTDOWN_GRACE_SECONDS"))
        if not 1 <= port <= 65535:
            raise ConfigError(f"PORT out of range: {port}")
        if timeout <= 0:
            raise ConfigError("REQUEST_TIMEOUT_SECONDS must be positive")
        if grace <= 0:
            raise ConfigError("SHUTDOWN_GRACE_SECONDS must be positive")
        return cls(
            database_url=required(env, "DATABASE_URL"),
            port=port,
            request_timeout_s=timeout,
            shutdown_grace_s=grace,
            log_level=required(env, "LOG_LEVEL").upper(),
            debug=parse_bool(required(env, "DEBUG")),
            api_key=required(env, "API_KEY"),
        )
```

`repr=False` prevents the secret from appearing when someone logs the settings object. It does not prevent it from appearing in a custom serializer, a traceback, or an error report. Treat redaction as a separate control.

Define precedence explicitly:

```text
explicit constructor argument > environment variable > config file > default
```

Test that precedence. A configuration system with unclear precedence produces incidents that cannot be reproduced.

Safe defaults matter:

- `debug=False` by default.
- Bind to `0.0.0.0` only inside a container; a laptop should bind to `127.0.0.1`.
- Never default to a production database URL.
- Never default a secret to an empty string and continue.
- Reject unknown environment values that look like booleans instead of treating them as true.

Secrets are not configuration. They should not be baked into images, passed as Docker build arguments, committed to Git, or written to logs. Common sources:

- a secret manager read at startup or by the platform
- a mounted file with restrictive permissions
- short-lived credentials issued to the workload identity

Rotation is part of the design. A rotation that requires rebuilding the image is an outage waiting to happen. Prefer providers that refresh credentials, or support two valid keys during a rotation window.

Validate secrets and external dependencies at startup, but distinguish “cannot serve at all” from “degraded.” A missing database URL is a startup failure. A temporarily unavailable recommendation service may be a readiness failure, a degraded mode, or a feature flag.

```python
def build_settings_or_exit() -> Settings:
    try:
        return Settings.from_env()
    except (ConfigError, ValueError) as exc:
        raise SystemExit(f"configuration error: {exc}") from exc
```

`SystemExit` with a non-zero code tells the orchestrator the process failed to configure itself. A traceback without the setting name is not a useful production log.

Configuration is versioned with the deployment. Record a hash of non-secret settings and the names of secret references, not the secret values.

---

## 12.4 Containers and process lifecycle

A container is a process with a filesystem, resource limits, and a network namespace. It is not a small virtual machine. Run one concern per container; do not start cron, a queue consumer, and the web server in the same entrypoint.

A multi-stage Dockerfile:

```dockerfile
FROM python:3.12-slim AS build
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN pip install --no-cache-dir uv && uv sync --frozen --no-dev

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY --from=build /app/src /app/src
USER app
EXPOSE 8000
ENTRYPOINT ["python", "-m", "rag_service"]
```

This example assumes the application is importable from `/app/src` or installed into the virtual environment by the build step. In a real image, install the wheel into the runtime environment and copy only the installed package, not the source tree.

Why the details matter:

- **Multi-stage:** build tools and caches do not ship in the runtime image.
- **Non-root:** a compromised process cannot write to most of the filesystem or install packages.
- **Exec form:** `ENTRYPOINT ["python", ...]` sends signals to Python, not to a shell.
- **`PYTHONUNBUFFERED=1`:** logs appear immediately instead of sitting in a block buffer.
- **`PYTHONDONTWRITEBYTECODE=1`:** no `__pycache__` writes in a read-only image.
- **Pinned base image:** `python:3.12-slim` is a moving tag; pin a digest for reproducibility.

Use a `.dockerignore` that excludes `.git`, `.venv`, tests, caches, local data, and secrets. A file excluded from the build context cannot accidentally leak into a layer.

Image layers are not a secret store. Deleting a file in a later layer does not remove it from the earlier layer. Build arguments are visible in image history. Use runtime secret mounts or a secret manager.

Run with a read-only root filesystem when possible, and mount a writable temporary directory only where needed. Set CPU and memory limits based on measurements, not guesses. A container that is killed for exceeding memory has no chance to drain.

PID 1 has special signal semantics. A Python process can handle `SIGTERM` if it installs a handler, but it may not reap orphaned child processes. Use an init process (`docker run --init`, Kubernetes `shareProcessNamespace` alternatives, or a tiny init) when the container starts subprocesses. For a single ASGI server, installing a signal handler is usually enough.

Workers:

- ASGI workers are separate processes. Each has its own memory, connection pool, and in-process metrics.
- `2 * CPU + 1` is a starting point for blocking workloads, not a law. Async I/O workloads often need fewer workers and more concurrency inside each worker.
- More workers increase memory and database connections. Measure both.
- With multiple workers, in-process counters are not global. Export per-worker metrics or aggregate at the metrics backend.

Never run database migrations from the application entrypoint on every replica. Multiple replicas will race, and a failed migration can leave a crash loop. Use a separate migration job with a lock.

---

## 12.5 Health, readiness, and graceful shutdown

Health checks answer different questions:

| Probe | Question | Failure action |
| --- | --- | --- |
| Startup | Has initialization finished? | Keep waiting; do not restart immediately |
| Liveness | Is the process able to make progress? | Restart the container |
| Readiness | Should this instance receive traffic? | Remove it from the load balancer |

A liveness check must not depend on the database. If the database is down, restarting every application instance will not fix it and may make the outage worse. Check that the event loop is responsive and the process is not deadlocked.

A readiness check can depend on required dependencies, but think about the blast radius. If every instance fails readiness when a shared cache is down, the load balancer removes the entire fleet. Prefer degraded behavior when the dependency is optional.

```python
from dataclasses import dataclass


@dataclass
class Health:
    lifecycle: Lifecycle
    database_ok: bool

    def live(self) -> tuple[int, dict[str, str]]:
        if self.lifecycle.phase is Phase.STOPPED:
            return 503, {"status": "stopped"}
        return 200, {"status": "ok"}

    def ready(self) -> tuple[int, dict[str, str]]:
        if not self.lifecycle.accepts_traffic:
            return 503, {"status": self.lifecycle.phase.value}
        if not self.database_ok:
            return 503, {"status": "database_unavailable"}
        return 200, {"status": "ready"}
```

Do not return stack traces, connection strings, environment variables, or internal hostnames from a health endpoint. Health endpoints are often unauthenticated and reachable from the platform.

Graceful shutdown order:

1. Receive `SIGTERM`.
2. Mark the instance not ready.
3. Give the load balancer time to stop sending new requests.
4. Stop accepting new connections.
5. Let in-flight requests finish until a deadline.
6. Cancel remaining work.
7. Close database connections and flush telemetry.
8. Exit with status `0`.

```python
import signal
import threading


class Shutdown:
    def __init__(self) -> None:
        self.event = threading.Event()

    def install(self) -> None:
        signal.signal(signal.SIGTERM, self._handle)
        signal.signal(signal.SIGINT, self._handle)

    def _handle(self, signum: int, frame: object) -> None:
        self.event.set()

    def wait(self, timeout: float) -> bool:
        return self.event.wait(timeout)
```

The handler should only set a flag. Do not acquire locks, write to the database, or log heavy diagnostics inside a signal handler.

In an asyncio service, use `loop.add_signal_handler` or the server's lifecycle hooks. `asyncio.run()` installs its own `SIGINT` handling; do not fight it with a second handler.

The drain deadline must be shorter than the platform's kill deadline. If the platform sends `SIGKILL` after 30 seconds, your deadline must leave time to close connections and exit. A shutdown that always gets killed is not graceful.

Background tasks need explicit ownership:

- Keep a set of in-flight tasks.
- Stop accepting new work when draining begins.
- Await tasks with a timeout.
- Cancel and await cancellation.
- Do not fire-and-forget without tracking, or shutdown will race with the event loop closing.

Test shutdown by sending `SIGTERM` during a slow request. The request should finish, the readiness endpoint should fail, and the process should exit before the deadline.

---

## 12.6 Structured logging and correlation

Production logs are events, not prose. One JSON object per line to stdout is easy for the platform to collect and query.

```python
import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "event": getattr(record, "event", record.getMessage()),
            "message": record.getMessage(),
            "service": "rag-service",
        }
        for key in (
            "request_id",
            "trace_id",
            "tenant_id",
            "route",
            "status",
            "duration_ms",
            "error_code",
        ):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
```

Avoid logging the same exception at every layer. Log it once where it is handled, with `exc_info=True`, and return a stable error code to the caller. Re-logging at each layer multiplies volume and hides the original boundary.

Request correlation:

```python
from contextvars import ContextVar
from uuid import uuid4

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


def current_request_id() -> str:
    request_id = request_id_var.get()
    if request_id is None:
        request_id = str(uuid4())
        request_id_var.set(request_id)
    return request_id
```

Set the context value in middleware or at the request boundary, and reset it in a `finally` block. Context variables propagate into `asyncio` tasks created from the current context. They do not automatically propagate into new threads; capture the context and run with `contextvars.copy_context().run(...)` if you cross a thread boundary.

Add fields with `extra`, not by interpolating untrusted text into the message:

```python
logger.info(
    "request completed",
    extra={
        "event": "http.request.completed",
        "request_id": current_request_id(),
        "route": "/ask",
        "status": 200,
        "duration_ms": 42.5,
    },
)
```

Logging rules:

- Prefer stable event names over free-form messages.
- Use UTC timestamps in RFC 3339 format.
- Include service, version, environment, request ID, and trace ID.
- Hash or omit user identifiers when full values are not needed.
- Never log secrets, authorization headers, raw prompts, or full request bodies by default.
- Bound field sizes; a 10 MB log line can break a collector.
- Do not put unbounded values in indexed fields.
- Send audit events to an append-only destination separate from debug logs.

Log injection is still possible in structured logs if a field is rendered by a downstream text processor. Validate or escape newlines in values that come from users, and prefer fields over string concatenation.

Log levels are operational controls, not decoration:

- `DEBUG`: development detail, sampled or disabled in production.
- `INFO`: lifecycle and business events worth retaining.
- `WARNING`: degraded behavior that still serves traffic.
- `ERROR`: a request or task failed.
- `CRITICAL`: the process or a major subsystem cannot continue.

Third-party libraries can be noisy. Set their levels deliberately; do not set the root logger to `DEBUG` because one dependency is hard to debug.

Access logs and application logs are different. The server can log every request line, but business events need semantic fields. If both exist, correlate them with the request ID rather than duplicating the entire request body.

Retention and access:

- Keep hot logs long enough to debug an incident, then archive or delete.
- Apply the same privacy rules to logs as to the database.
- Restrict who can query raw logs.
- Test that redaction works by logging a fake secret and asserting it never appears.

---

## 12.7 Metrics and dashboards

Metrics are cheap, aggregated numbers. Choose the type deliberately:

- **Counter:** monotonically increasing total, such as requests, errors, or tokens.
- **Gauge:** a value that can go up or down, such as in-flight requests, queue depth, or memory.
- **Histogram:** a distribution, such as request latency or response size.

Counters must never decrease. A process restart resets its in-process counter; the backend handles resets, but application code should not subtract from a counter.

Labels split a metric into series. Keep cardinality bounded:

```text
route="/ask"             good
route="/users/12345"     bad: one series per user
user_id="..."            bad
status="200"             okay but often status_class is enough
error="timeout"          good if the set is fixed
error=str(exc)           bad: unbounded, may contain PII
```

Use route templates (`/users/{user_id}`), status classes, provider names, model names, and fixed error codes. Do not put raw SQL, URLs, exception messages, trace IDs, or email addresses in labels.

Prometheus text exposition:

```text
# HELP http_requests_total Total HTTP requests.
# TYPE http_requests_total counter
http_requests_total{route="/ask",status_class="2xx"} 42

# HELP http_request_duration_seconds HTTP request latency.
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{route="/ask",le="0.1"} 10
http_request_duration_seconds_bucket{route="/ask",le="0.5"} 39
http_request_duration_seconds_bucket{route="/ask",le="1"} 42
http_request_duration_seconds_bucket{route="/ask",le="+Inf"} 42
http_request_duration_seconds_sum{route="/ask"} 8.7
http_request_duration_seconds_count{route="/ask"} 42
```

A histogram has cumulative buckets, a sum, and a count. Percentiles computed from buckets are estimates. Do not average percentiles across instances or time windows; aggregate the underlying buckets or use a backend that supports distribution aggregation.

```python
from dataclasses import dataclass


@dataclass
class Counter:
    name: str
    labels: dict[str, str]
    value: int = 0

    def inc(self, amount: int = 1) -> None:
        if amount < 0:
            raise ValueError("counters cannot decrease")
        self.value += amount
```

The real implementation needs a lock for threads or an atomic backend. Keep the state in one place and expose a snapshot; do not let request handlers mutate shared dictionaries without synchronization.

Useful metric families:

- **RED:** rate, errors, duration per request-driven service.
- **USE:** utilization, saturation, errors for resources such as CPU, memory, and queues.
- **Golden signals:** latency, traffic, errors, saturation.
- **Business:** requests, documents retrieved, tokens, model cost, conversions.

Instrumentation placement:

- HTTP boundary: count, duration, status class.
- Dependency call: count, duration, error class, timeout.
- Queue: depth, age of oldest item, processing rate.
- Worker: in-flight jobs, successes, failures, retries.
- Model call: tokens, latency, provider errors, estimated cost.

A dashboard should answer a question. Start with user-visible health: request rate, error rate, latency percentiles, saturation, and dependency health. Add business metrics below. A wall of CPU graphs is not a dashboard.

Alerts should be symptom-based and actionable. “CPU is 80%” is a cause; “p99 latency exceeded the SLO for ten minutes” is a symptom users feel. Page only when a human must act now. Send the rest to a ticket or a daily review.

Every alert should include:

- what is broken
- the affected service and environment
- the current value and threshold
- the window
- a link to a dashboard and a runbook
- the expected action

---

## 12.8 Tracing and error tracking

A trace is a tree of timed spans for one request or job. Every span has a trace ID, a span ID, a parent, a name, a start and end time, a status, and attributes.

```text
trace 4bf92f...
├── POST /ask              120 ms
│   ├── auth.verify         8 ms
│   ├── retrieve           45 ms
│   │   └── vector.search  40 ms
│   └── llm.generate       60 ms
```

Instrument boundaries, not every function. Inbound HTTP, outbound HTTP, database calls, cache calls, queue publish/consume, and model calls are enough to find most latency.

Propagation uses headers. The W3C `traceparent` header looks like:

```text
00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

The fields are version, trace ID, parent span ID, and flags. If you call another service, forward the header or use the client library's instrumentation. A trace that stops at your service boundary cannot explain the user's latency.

A minimal in-process span:

```python
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from time import perf_counter_ns
from uuid import uuid4

current_span: ContextVar["Span | None"] = ContextVar("current_span", default=None)


@dataclass
class Span:
    name: str
    trace_id: str
    span_id: str
    parent_id: str | None
    start_ns: int
    end_ns: int | None = None
    status: str = "ok"
    attributes: dict[str, object] = field(default_factory=dict)


@contextmanager
def start_span(name: str, **attributes: object) -> Iterator[Span]:
    parent = current_span.get()
    span = Span(
        name=name,
        trace_id=parent.trace_id if parent else uuid4().hex,
        span_id=uuid4().hex[:16],
        parent_id=parent.span_id if parent else None,
        start_ns=perf_counter_ns(),
        attributes=dict(attributes),
    )
    token = current_span.set(span)
    try:
        yield span
    except Exception as exc:
        span.status = "error"
        span.attributes["exception.type"] = type(exc).__name__
        raise
    finally:
        span.end_ns = perf_counter_ns()
        current_span.reset(token)
```

Creating a child span reads the current context, copies the trace ID, and sets the parent. Resetting the context in `finally` prevents a span from leaking into the next task. The exporter is deliberately omitted; production code should batch and drop spans rather than block a request on a tracing backend.

Sampling:

- **Head sampling** decides at the start of a trace. It is cheap but may miss rare errors.
- **Tail sampling** buffers a trace and decides after seeing the whole trace. It can keep errors and slow requests, but costs memory.
- Sample rates should be recorded so counts can be adjusted.
- Always consider sampling errors, or use a separate error tracker.

Never put raw prompts, tokens, credentials, or personal data in span attributes. Use allowlisted metadata: route, status, model name, token counts, cache hit, retrieval count.

Error tracking is not the same as logging. It groups repeated exceptions and preserves enough context to fix them:

- exception type and normalized stack
- release/version and environment
- request ID and trace ID
- route or job name
- breadcrumbs of recent events
- affected user count, without storing unnecessary PII

Group by a fingerprint that ignores volatile values such as IDs and timestamps. A new release can create a new fingerprint; record the release so you can distinguish a regression from a long-standing issue.

Deduplicate alerts. One broken dependency can produce thousands of identical errors; page on the aggregate, not each occurrence.

---

## 12.9 SLOs, alerting, and incident response

An SLI is a measurement. An SLO is a target for that measurement. An error budget is how much failure the target allows.

Examples:

```text
availability SLI = successful requests / valid requests
latency SLI     = requests faster than 300 ms / valid requests
freshness SLI   = pipeline outputs newer than 15 minutes / checks
```

Choose a window and a target:

```text
99.9% of valid requests succeed over 30 days
95% of requests complete in under 300 ms over 30 days
```

Error budget:

```python
def error_budget(total_events: int, slo: float) -> float:
    return total_events * (1 - slo)


def burn_rate(bad_events: int, total_events: int, slo: float) -> float:
    if total_events == 0:
        return 0.0
    allowed_bad_rate = 1 - slo
    observed_bad_rate = bad_events / total_events
    return observed_bad_rate / allowed_bad_rate
```

If your SLO is 99.9% and 0.5% of requests are failing, the burn rate is 5: you are consuming the 30-day budget five times too fast. A burn rate of 1 exactly exhausts the budget over the window.

Multi-window alerting reduces both false pages and missed incidents:

- Fast burn: a high burn rate over a short window pages immediately.
- Slow burn: a moderate burn rate over a longer window creates a ticket.
- Require the condition to hold in both a short and a long window before paging.

The exact thresholds are policy choices. The important part is that alerts are tied to user-visible objectives and have a runbook.

Page versus ticket:

- **Page:** the SLO is at risk now; a human must act.
- **Ticket:** a trend will breach the SLO if ignored.
- **Dashboard only:** useful context, no action required.

Incident response:

1. Detect and acknowledge.
2. Assess customer impact and severity.
3. Assign an incident commander and a communications owner.
4. Mitigate first: roll back, disable a flag, shed load, fail over.
5. Keep a timeline of decisions and timestamps.
6. Resolve and verify with the SLI.
7. Hold a blameless postmortem with action items, owners, and dates.

Mitigation is not root-cause analysis. Restoring service comes first. A rollback is a valid fix even before you understand the bug.

Runbooks should be short and executable:

```text
Symptom: /ask p99 latency above SLO for 10 minutes
Check: dashboard link, recent deploys, provider status, database latency
Mitigate: roll back previous image; disable reranking flag; increase timeout budget
Verify: error rate and p99 return below threshold for 15 minutes
Escalate: platform on-call if database saturation is the cause
```

A runbook that says “investigate” is not a runbook. Include commands, dashboards, expected outputs, and rollback steps.

---

## 12.10 Performance, load, and capacity

Latency is a distribution. Report percentiles, not only the mean:

```python
from math import ceil


def percentile(values: list[float], p: float) -> float:
    if not values:
        raise ValueError("empty sample")
    if not 0 < p <= 1:
        raise ValueError("p must be in (0, 1]")
    ordered = sorted(values)
    rank = ceil(p * len(ordered))
    return ordered[rank - 1]
```

This is the nearest-rank definition. Different libraries use interpolation; state which one you use. A p95 of 200 ms means 95% of observed requests were at or below 200 ms, not that the average user sees 200 ms.

Little's law relates concurrency, throughput, and latency:

```text
in-flight requests = throughput × latency
```

At 50 requests per second and 200 ms average latency, about 10 requests are in flight. If your connection pool has 5 connections, requests queue. This is a capacity bug, not a code-style issue.

Queueing is nonlinear. At 50% utilization, queues are short; at 90%, latency rises sharply; at 100%, it grows without bound. Keep headroom for bursts and dependency slowdowns.

A load test must define:

- the target SLO and workload mix
- request rate and concurrency model
- realistic payload sizes, auth, and cache behavior
- warmup and steady-state duration
- stop conditions and safety limits
- the environment and data isolation

Test stages:

1. Baseline at low rate.
2. Ramp until the SLO breaks or saturation appears.
3. Hold at expected peak.
4. Spike briefly.
5. Soak for hours to find leaks.

Measure both client and server:

- p50, p95, p99 latency
- throughput and error rate
- CPU, memory, file descriptors
- connection pool usage and queue depth
- dependency latency and error rate
- garbage collection pauses if relevant

Averages hide tail latency. A load test that only reports mean latency can pass while real users time out.

Profiling:

```python
import cProfile
import pstats


def profile_me() -> None:
    with cProfile.Profile() as profiler:
        run_workload()
    pstats.Stats(profiler).sort_stats("cumulative").print_stats(20)
```

Use `time.perf_counter()` for elapsed time; it is monotonic. `time.time()` can jump when the system clock changes.

Memory:

```python
import tracemalloc

tracemalloc.start()
run_workload()
snapshot = tracemalloc.take_snapshot()
for stat in snapshot.statistics("lineno")[:10]:
    print(stat)
```

Common production performance bugs:

- a blocking call inside an async request handler
- a synchronous database driver in an async service
- unbounded `asyncio.create_task` calls
- a connection pool smaller than the concurrency
- retries without a budget or jitter
- a timeout longer than the caller's timeout
- CPU-bound work in the event loop
- per-request client construction instead of reuse
- logging large payloads on the hot path

Capacity:

- Measure memory per worker and per connection.
- Autoscale on queue depth or concurrency, not only CPU.
- Scale dependencies too; the database is often the bottleneck.
- Keep headroom for one instance failure.
- Test the failure of one replica, not only steady-state load.

---

## 12.11 CI/CD, migrations, and progressive delivery

A release pipeline should be boring and repeatable:

```text
lint → typecheck → unit tests → integration tests
     → build artifact once → scan → sign → SBOM
     → deploy staging → smoke tests → canary
     → promote or roll back
```

Use the same Python version and lock file in CI and production. A test that passes on 3.13 while production runs 3.12 is not evidence.

A GitHub Actions sketch:

```yaml
name: release
on:
  push:
    tags: ["v*"]

permissions:
  contents: read
  packages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install uv
      - run: uv sync --frozen
      - run: uv run pytest
      - run: uv run ruff check .
      - run: uv run mypy src
      - run: docker build -t "$IMAGE:$GITHUB_SHA" .
```

Pin actions to a commit SHA in a high-security environment; tags can move. Use short-lived workload identity instead of long-lived cloud keys. Keep production credentials out of pull-request workflows.

Artifact promotion:

- Build once per commit.
- Tag with the commit SHA and a semantic version.
- Deploy the same digest to staging and production.
- Record the digest, commit, migration version, and configuration hash in the release record.
- Never deploy from a developer laptop as the normal path.

Database migrations are the riskiest part of many deployments. Use expand/contract:

1. **Expand:** add a nullable column, new table, or new index.
2. **Deploy:** code writes both old and new forms and reads the old form.
3. **Backfill:** populate the new form in batches.
4. **Switch:** code reads the new form.
5. **Contract:** remove the old column or table after no deployed code uses it.

This allows old and new application versions to coexist during a rolling deploy. A destructive migration in the same release as a code change makes rollback unsafe.

Migrations should:

- run in a separate job, not in every web replica
- take a lock so two jobs cannot race
- be idempotent or tracked
- be tested against production-sized data
- have a backup or a forward-fix plan
- have a timeout and a rollback/abort strategy

Some migrations cannot be rolled back safely. Prefer additive changes and forward fixes.

Progressive delivery:

- **Canary:** send a small percentage of traffic to the new version; compare error rate, latency, and business metrics with the baseline; promote or roll back automatically.
- **Blue-green:** run two environments, warm the new one, switch traffic, keep the old one for rollback.
- **Feature flag:** deploy code dark and release behavior separately; provide a kill switch; assign an owner and an expiry date.

A canary without a comparison is just a slow full deploy. Define the metrics and the rollback threshold before starting.

Rollback checklist:

- previous image digest is known
- schema is backward compatible
- feature flag can disable the new path
- caches and queues can handle the old version
- rollback is tested, not assumed
- the on-call engineer knows how to verify recovery

Smoke tests after deployment:

- health and readiness return success
- one authenticated request succeeds
- one dependency call succeeds
- one background job processes a test message
- version and commit are the expected values

---

## 12.12 Security, cost, and common mistakes

Deployment security is mostly about reducing blast radius:

- run as non-root with a read-only filesystem
- grant the workload only the permissions it needs
- restrict network egress to known dependencies
- terminate TLS at the edge and use secure headers
- authenticate and authorize every business endpoint
- rate-limit expensive endpoints
- keep health and metrics endpoints internal
- pin and scan dependencies and images
- generate an SBOM and sign the image
- rotate secrets and audit access

Supply chain:

- commit the lock file
- verify hashes where the package manager supports it
- review new dependencies and their licenses
- scan images for known vulnerabilities
- rebuild regularly to pick up base-image patches
- do not run arbitrary install scripts from untrusted sources in production builds

Observability data is production data. It can contain prompts, headers, user IDs, and database queries. Apply retention, access control, and redaction to logs, metrics, traces, and error reports. Do not assume a tracing backend is exempt because it is “only for debugging.”

Cost drivers:

- idle replicas and over-provisioned CPU or memory
- high-cardinality metrics
- verbose logs and long retention
- unsampled traces
- cross-region or egress traffic
- external model calls and retries
- storage of raw payloads that no one reads

Track cost per request, per tenant, or per model call when the business depends on it. A cost dashboard without an owner becomes noise.

Common deployment and observability mistakes:

- liveness checks that depend on the database
- readiness that stays true during shutdown
- no drain window before the load balancer stops sending traffic
- logs without request IDs
- exceptions logged at every layer
- metrics with user IDs or raw URLs as labels
- alerting on CPU instead of user-visible symptoms
- averaging latency percentiles
- secrets in build arguments or image layers
- mutable `latest` tags
- migrations running from every replica
- retries without jitter or a budget
- deploying and releasing at the same time with no rollback
- dashboards and alerts with no owner
- observability data that ignores privacy requirements

A final operational checklist:

- Can you identify the deployed commit and artifact digest?
- Can you tell whether the instance is ready without reading logs?
- Does a slow request finish during shutdown?
- Can you trace one request across the service boundary?
- Do you know the SLO and the current error budget?
- Does every page have a runbook?
- Can you roll back without a database restore?
- Are secrets absent from images, logs, and traces?
- Does the load test reflect the real workload?
- Is someone accountable for each dashboard and alert?

---

## Exercises

The exercises are grouped by deployment and observability skill. Groups A–D build the runtime and lifecycle, E–G build logs, metrics, and traces, H–I cover reliability and performance, and J integrates deployment, security, and a capstone.

Work predictively: answer before running code, then verify. The container, CI, and platform snippets are configuration exercises; reason about them from the specifications rather than expecting a local Docker daemon.

## Group A — Packaging and deployment artifacts

**A1.** A `pyproject.toml` contains:

```toml
requires-python = ">=3.12,<3.13"
```

The production host has Python 3.11. Answer:

1. When should installation fail?
2. Why is a runtime version check in `main()` too late?
3. What error would you expect from the installer?
4. How does this differ from a `python_requires`-style check in application code?

**A2.** Compare:

```toml
dependencies = ["pytest>=8", "fastapi>=0.115"]
[project.optional-dependencies]
dev = ["pytest>=8", "ruff>=0.6"]
```

Answer:

1. Which package should be a runtime dependency?
2. Which should be development-only?
3. What happens if `pytest` ships in the production image?
4. How does a lock file represent optional groups?

**A3.** Explain the purpose of a lock file. Answer:

1. What does it pin that `pyproject.toml` may not?
2. Why must it be committed?
3. What can change if CI resolves dependencies fresh without it?
4. How do you update it intentionally?

**A4.** Compare a wheel and a source distribution. Answer:

1. Which is usually installed in production?
2. Which may require a build step at install time?
3. Which is more reproducible?
4. Why does a pure-Python wheel have a different filename from a native wheel?

**A5.** A team builds an image for staging, then rebuilds from the same commit for production. Answer:

1. Why is this not the same artifact?
2. What can differ?
3. How should promotion work instead?
4. What identifier should production record?

**A6.** A package is installed as `rag-service`, but the code imports `rag_service`. Explain the relationship. Then answer what happens to `version("rag_service")` if the distribution is installed but the import package is not.

**A7.** Compare:

```bash
python app.py
python -m app
```

Answer:

1. Which modifies `sys.path` differently?
2. Which respects package-relative imports more reliably?
3. What file must exist for `python -m app`?
4. Which is preferable for a package application?

**A8.** A project uses:

```text
src/rag_service/__init__.py
src/rag_service/api.py
tests/test_api.py
pyproject.toml
```

Running `pytest` from the repository root imports `rag_service` from the installed package. Answer:

1. Why is the `src/` layout useful?
2. What accidental import problem does it prevent?
3. How does an editable install make the package importable?
4. What should `pyproject.toml` declare for the build backend?

**A9.** A `[project.scripts]` entry is:

```toml
[project.scripts]
rag-service = "rag_service.__main__:main"
```

Answer:

1. What function does the generated executable call?
2. What is passed to it?
3. Why should `main()` return `None` or an integer, not call `sys.exit()` internally?
4. How does this differ from a shell script that runs `python -m rag_service`?

**A10.** Write a minimal `__main__.py` for a package that calls `main()`. Answer:

1. Why is the `if __name__ == "__main__"` guard used?
2. What happens if `__main__.py` imports the package and the package imports `__main__`?
3. How do you pass command-line arguments?
4. How do you set an exit code?

**A11.** A Docker image contains `pytest`, `ruff`, and `mypy`. Answer:

1. Why is this a problem?
2. Which risks does it add?
3. How do multi-stage builds prevent it?
4. Why is `pip uninstall` in a later layer insufficient?

**A12.** A Dockerfile starts with `FROM python:3.12-slim`. Answer:

1. Why is this tag mutable?
2. What should be pinned instead?
3. What must be rebuilt when the base image is patched?
4. How do you record the base image in provenance?

**A13.** Add labels for the application version and Git commit to an image. Answer:

1. Which Dockerfile instruction sets labels?
2. Why should the commit be the full SHA?
3. How can a deployment verify the labels?
4. Why are labels not a substitute for an immutable digest?

**A14.** An image reports version `1.4.0`, but the package metadata says `1.3.9`. Answer:

1. Which is the source of truth?
2. How can this happen with a stale build cache?
3. How do you prevent it?
4. Which value should the health endpoint return?

**A15.** An editable install is created with `pip install -e .`. Answer:

1. What does editable mean?
2. Why is it useful in development?
3. Why is it dangerous in production?
4. How can a container accidentally use one?

**A16.** A `.dockerignore` excludes `.venv` but not `tests` or `.git`. Answer:

1. Why does `.git` matter for build performance?
2. Why can tests leak into the runtime image?
3. Which files should be excluded as a baseline?
4. How do you verify the build context size?

**A17.** A build is reproducible only if it produces the same artifact from the same inputs. Answer:

1. Which inputs must be pinned?
2. Why can timestamps and file ordering break reproducibility?
3. How do build tools normalize them?
4. Why is a byte-identical image not always required for deployment safety?

**A18.** Two dependencies require different major versions of the same library. Answer:

1. What does the resolver do?
2. When does resolution fail?
3. How do you inspect the dependency tree?
4. Why is “it installed on my machine” not evidence of compatibility?

**A19.** A deployment uses `myapp:latest`. Answer:

1. What does the tag point to over time?
2. Why is rollback ambiguous?
3. What should replace it?
4. How do you enforce immutable tags in a registry?

**A20.** A package includes a compiled extension. Answer:

1. Why does the wheel filename include a platform tag?
2. What happens if you build on macOS and deploy to Linux?
3. How do you verify the wheel is compatible?
4. What is a manylinux wheel?

**A21.** A Dockerfile runs `pip install --no-cache-dir -r requirements.txt`. Answer:

1. What does `--no-cache-dir` prevent?
2. Why does layer ordering affect rebuild time?
3. How do you use a lock file here?
4. Why should you avoid installing from unpinned ranges at image build time?

**A22.** Define artifact provenance. Answer:

1. Which commit produced the image?
2. Which dependencies and base image were used?
3. Which CI job built it?
4. How is provenance verified at deploy time?

**A23.** A container has no `CMD` or `ENTRYPOINT`. Answer:

1. What does the runtime do?
2. What error is likely?
3. How does this differ from a missing executable?
4. What should the deployment manifest specify?

**A24.** Write a release record for a deployment containing version, commit, image digest, migration version, configuration hash, and deploy timestamp. Answer:

1. Which fields are immutable?
2. Which field identifies the exact bytes?
3. How do you link an incident to a release?
4. How long should the record be retained?

---

## Group B — Configuration, secrets, and startup validation

**B1.** A service reads `PORT` from the environment:

```python
port = int(os.environ.get("PORT", "8000"))
```

Answer:

1. What happens when `PORT="eight"`?
2. Where should the error be raised?
3. What happens when `PORT` is unset?
4. Why is a string default risky for a required production setting?

**B2.** `required(env, "DATABASE_URL")` raises `ConfigError` when the value is missing or empty. Answer:

1. Why is an empty string treated as missing?
2. What should the process exit code be?
3. What should the log message contain?
4. What should it not contain?

**B3.** Evaluate `parse_bool` from the lesson for each input: `"yes"`, `"False"`, `"0"`, `"maybe"`, `""`. State the result or exception for each.

**B4.** A setting is parsed with `int(os.environ["MAX_CONNECTIONS"])`. Answer:

1. What exception is raised for `"ten"`?
2. Why is catching `ValueError` better than catching all exceptions?
3. How do you validate a positive range?
4. Where should the validated value be stored?

**B5.** A setting is:

```python
database_url = os.environ.get("DATABASE_URL", " ")
```

Answer:

1. Is the default useful?
2. What does `required` do with it?
3. Why can a whitespace-only setting pass a naive `if value` check?
4. How do you test it?

**B6.** Define precedence: explicit value, environment, config file, default. Answer:

1. Which wins?
2. Why must the precedence be tested?
3. What happens if two sources disagree?
4. How do you record the effective configuration without recording secrets?

**B7.** A frozen dataclass is used for settings. Answer:

1. What does assignment to a field do?
2. Can a nested list still be mutated?
3. Why is immutability useful for configuration?
4. How do you make a secret field absent from `repr`?

**B8.** A settings object is logged at startup. Answer:

1. Which field must be excluded?
2. Does `repr=False` protect serialization by `dataclasses.asdict`?
3. Does it protect tracebacks?
4. What is the safer default for logging configuration?

**B9.** A log line contains `settings`. Answer:

1. Why is this dangerous if the object contains an API key?
2. How can a custom `__repr__` help?
3. Why is redaction still required?
4. How do you test it?

**B10.** A Dockerfile contains `ENV API_KEY=secret`. Answer:

1. Where is the value stored?
2. Who can read it?
3. Why does deleting it in a later layer not remove it?
4. What should replace it?

**B11.** A secret is passed with `docker build --build-arg API_KEY=...`. Answer:

1. Why is this unsafe?
2. Where can the value appear?
3. How do BuildKit secret mounts differ?
4. Does a secret mount automatically keep the secret out of application logs?

**B12.** An API key must be rotated without downtime. Answer:

1. How can two keys be valid during rotation?
2. Where should the application read the key?
3. What happens if only the old key is cached?
4. How do you verify the new key works before removing the old one?

**B13.** A service defaults `DEBUG` to `true` when the variable is unset. Answer:

1. Why is this risky?
2. What should the default be?
3. How does debug mode affect error responses?
4. How do you make the production setting explicit?

**B14.** An environment variable is `"prod "` with a trailing space. Answer:

1. Which comparisons fail?
2. Should values be stripped globally?
3. Why can silent stripping hide a configuration error?
4. How should an enum-like setting be validated?

**B15.** A deployment records a hash of non-secret settings. Answer:

1. Which values go into the hash?
2. How do you canonicalize ordering?
3. Why exclude secrets?
4. How does the hash help reproduce an incident?

**B16.** Write a test for `Settings.from_env` with a missing required key. Answer:

1. Which exception do you assert?
2. What message fragment do you check?
3. How do you avoid reading the real environment?
4. How do you test a valid configuration?

**B17.** Explain the twelve-factor configuration rule. Answer:

1. What belongs in environment variables?
2. What should not be baked into the image?
3. Is a config file always forbidden?
4. How do secrets differ from ordinary configuration?

**B18.** A secret is mounted as a file. Answer:

1. How do you read it in Python?
2. Why check file permissions?
3. Why is a world-readable mount dangerous?
4. How do you avoid including file contents in an exception?

**B19.** A startup error prints the full `DATABASE_URL`. Answer:

1. What secret can it expose?
2. How do you redact credentials while keeping the host?
3. Why is a URL parser better than string slicing?
4. What should the operator see instead?

**B20.** A service validates configuration in a request handler instead of at startup. Answer:

1. What happens to the first requests?
2. Why is fail-fast better?
3. Which checks belong at startup?
4. Which checks must remain at the boundary?

**B21.** A service supports hot-reloading configuration. Answer:

1. Which settings are safe to reload?
2. Which require a restart?
3. How do you avoid partially applied changes?
4. How do you record that a reload happened?

**B22.** A feature flag is read from the environment at startup. Answer:

1. Why is this not a true feature flag?
2. What can you do without redeploying?
3. How do you turn it off quickly?
4. Why should flags have an owner and expiry?

**B23.** An environment name is read from `ENV`. Answer:

1. Why is `"production"` safer than `"prod"` or `"live"`?
2. Where should it appear in telemetry?
3. How do you prevent a staging process from using production credentials?
4. What should happen on an unknown environment value?

**B24.** Improve this error:

```text
ValueError: invalid literal for int() with base 10: 'eight'
```

Answer:

1. Which setting is missing from the message?
2. What should the message include?
3. Should it include the raw secret value?
4. How can a structured error type help?

---

## Group C — Containers and process lifecycle

**C1.** A Dockerfile copies `pyproject.toml` and installs dependencies before copying source. Answer:

1. Why does this improve layer caching?
2. What invalidates the dependency layer?
3. What invalidates the source layer?
4. Why does copying everything first make rebuilds slower?

**C2.** Explain a multi-stage build. Answer:

1. Which stage contains the compiler?
2. Which stage contains the runtime?
3. How are artifacts copied between stages?
4. Why does this reduce attack surface?

**C3.** A container runs as root. Answer:

1. What can a compromised process do?
2. How do you create a non-root user?
3. Why does `USER app` need to come after file ownership changes?
4. What breaks if the app needs to write to `/tmp`?

**C4.** Compare:

```dockerfile
ENTRYPOINT ["python", "-m", "app"]
ENTRYPOINT python -m app
```

Answer:

1. Which uses exec form?
2. Which may run through a shell?
3. Which receives `SIGTERM` directly?
4. How do you pass arguments in each case?

**C5.** A Python process is PID 1 in a container. Answer:

1. What special responsibilities does PID 1 have?
2. What happens to orphaned children?
3. How does an init process help?
4. Does Python automatically reap every subprocess?

**C6.** A Dockerfile omits `PYTHONUNBUFFERED=1`. Answer:

1. Where can logs accumulate?
2. Why does this matter during a crash?
3. Does `-u` do the same thing?
4. Which streams are affected?

**C7.** An image includes test data, a virtual environment, and build caches. Answer:

1. Which layers are unnecessarily large?
2. How do you inspect layer sizes?
3. Why is deleting files in a later layer insufficient?
4. What should the runtime image contain?

**C8.** A repository's `.dockerignore` is empty. Answer:

1. What enters the build context?
2. Why can `.git` be large?
3. Why can local secrets be copied accidentally?
4. Which patterns would you add first?

**C9.** A secret is copied into an image layer and deleted in the next layer. Answer:

1. Is the secret still present?
2. How can an attacker recover it?
3. What should have been done instead?
4. Why is a private registry not sufficient protection?

**C10.** A container runs with a read-only root filesystem. Answer:

1. Which operations fail?
2. Where should temporary files go?
3. How do you mount a writable temporary directory?
4. Why is this a useful security control?

**C11.** An application writes uploads to `/app/uploads`. Answer:

1. Why is this fragile in a container?
2. What happens when the container is replaced?
3. Where should uploads go?
4. How do multiple replicas see the same files?

**C12.** A container has a 512 MiB memory limit and no CPU limit. Answer:

1. What happens when Python exceeds memory?
2. Why can the process be killed without a traceback?
3. How do you set a CPU limit?
4. Why should limits be based on measurements?

**C13.** A service runs four ASGI workers in one container. Answer:

1. How much memory does each worker have?
2. Are in-process metrics shared?
3. How many database connections can the service open?
4. What happens when the container is killed?

**C14.** A Dockerfile exposes port `8000`, but the server binds to `127.0.0.1:8000` inside the container. Answer:

1. Can traffic from outside the container reach it?
2. Why does binding to `0.0.0.0` matter inside a container?
3. Why is `0.0.0.0` a poor choice on a laptop?
4. How do you configure the bind address?

**C15.** A container starts a web server, a cron loop, and a queue worker. Answer:

1. Which process receives `SIGTERM`?
2. What happens to the others?
3. Why is one concern per container simpler?
4. How do you deploy the worker separately?

**C16.** A Dockerfile defines a `HEALTHCHECK`. Answer:

1. What does it check?
2. Who acts on the result?
3. How does it differ from Kubernetes probes?
4. Why should it not perform an expensive database query?

**C17.** A base image is pinned by tag but not digest. Answer:

1. Can the tag content change?
2. What does a digest pin guarantee?
3. How do you find the digest?
4. When must you update it?

**C18.** A team builds on an Apple Silicon laptop and deploys to AMD64 nodes. Answer:

1. What architecture does the local image have?
2. What happens at runtime?
3. How do you build for the target platform?
4. Why is emulation slower?

**C19.** A Docker build context includes a 2 GB data directory. Answer:

1. Why is the build slow?
2. Does the data end up in the final image if not copied?
3. How do you exclude it?
4. Why should data not be in the repository image at all?

**C20.** A Dockerfile installs OS packages and Python packages in one `RUN`. Answer:

1. Why can this be good for layer size?
2. Why can it hurt cache reuse?
3. How do you separate stable and volatile layers?
4. What is the trade-off?

**C21.** A Python package needs `libpq` at runtime. Answer:

1. Which build stage needs the development headers?
2. Which runtime stage needs the shared library?
3. Why does copying the wheel alone fail?
4. How do you verify the library is present?

**C22.** A deployment runs `alembic upgrade head` in the container entrypoint with ten replicas. Answer:

1. What race can occur?
2. What happens if the migration fails?
3. Where should migrations run?
4. How do you prevent two migration jobs from running simultaneously?

**C23.** A container exits immediately after start. Answer:

1. Which command shows the logs?
2. How do you inspect the exit code?
3. How do you run an interactive shell in the image?
4. Why is `docker run` without a TTY sometimes unhelpful?

**C24.** A container starts a child process and forwards no signals. Answer:

1. What happens to the child on `SIGTERM`?
2. How does an init process help?
3. How do you test signal forwarding?
4. Why is `SIGKILL` not a graceful solution?

---

## Group D — Health, readiness, and graceful shutdown

**D1.** A liveness probe checks `/readyz`, which queries the database. Answer:

1. What happens during a database outage?
2. Why is restarting the service unlikely to help?
3. What should the liveness probe check instead?
4. What should the readiness probe check?

**D2.** A readiness probe returns `200` during startup before the database pool is ready. Answer:

1. What happens to early requests?
2. How do you represent the startup phase?
3. When should readiness become `200`?
4. Why is a startup probe useful for slow initialization?

**D3.** A service receives `SIGTERM` and immediately exits. Answer:

1. What happens to in-flight requests?
2. What should happen to readiness first?
3. Why is a short drain delay useful?
4. How does the load balancer learn about the change?

**D4.** A service marks readiness false but keeps accepting requests. Answer:

1. Is this graceful?
2. What is the correct order?
3. Why can a load balancer still send requests briefly?
4. How do you test the gap?

**D5.** A readiness endpoint returns `HTTP 200` with `{"status":"not_ready"}`. Answer:

1. Will a typical load balancer route traffic?
2. Why is the body insufficient?
3. Which status code should be used?
4. How do clients distinguish degraded from healthy?

**D6.** A service takes 40 seconds to load a model. Answer:

1. Which probe should allow the delay?
2. What happens if the liveness probe fires first?
3. How do you avoid a restart loop?
4. How long should the startup probe allow?

**D7.** A health endpoint returns:

```json
{"status":"ok","database":"postgres://user:pass@db:5432/app","version":"1.4.0"}
```

Answer:

1. What is exposed?
2. What should be returned instead?
3. Why are stack traces dangerous here?
4. Should the endpoint require authentication?

**D8.** Write the shutdown sequence as a numbered list for a request-serving process. Include readiness, signal, drain, close, and exit. Then explain which step prevents new traffic.

**D9.** A signal handler tries to close the database and flush logs before setting a stop flag. Answer:

1. Why is this risky?
2. What should the handler do?
3. Where should cleanup happen?
4. Why can a signal interrupt a database call?

**D10.** Why should a signal handler avoid acquiring locks? Answer:

1. What deadlock is possible?
2. What operations are async-signal-safe?
3. How does a flag avoid the problem?
4. How do you handle a second signal?

**D11.** A slow request takes eight seconds. The shutdown deadline is five seconds. Answer:

1. What happens to the request?
2. What should the server do at the deadline?
3. How do you choose the deadline?
4. How do you test the behavior?

**D12.** A background worker is processing a batch during shutdown. Answer:

1. Should it finish the whole batch?
2. How do you checkpoint progress?
3. How do you cancel safely?
4. What happens if the process is killed?

**D13.** A service creates `asyncio.create_task()` for every email and never stores the task. Answer:

1. Why is this a shutdown problem?
2. What happens to exceptions?
3. How do you track tasks?
4. How do you cancel them?

**D14.** A load balancer removes an instance after readiness fails. Answer:

1. Why is there a delay?
2. What happens to requests already sent?
3. How does connection draining help?
4. What should the instance do during that delay?

**D15.** A probe has a one-second timeout but the health check waits five seconds for the database. Answer:

1. What does the platform observe?
2. What happens to the instance?
3. How do you fix the probe or the check?
4. Why is a slow health check a reliability risk?

**D16.** A readiness probe runs every second and opens a database connection each time. Answer:

1. What load does this add?
2. How do you make the check cheap?
3. Why should health checks not perform writes?
4. How can caching the result hide a real failure?

**D17.** A shared cache fails and every service instance fails readiness. Answer:

1. What happens to the fleet?
2. Why can this create a cascading outage?
3. How do you make the cache optional?
4. When is failing readiness still correct?

**D18.** A health endpoint is publicly reachable. Answer:

1. What information can it leak?
2. How do you restrict access?
3. Why do platforms often need internal access?
4. Should it expose dependency versions?

**D19.** A health endpoint is called 100 times per second per instance. Answer:

1. What is the cost?
2. How do you reduce frequency?
3. Why is a cached status acceptable?
4. When must the cache be invalidated?

**D20.** During shutdown, the database pool is closed before in-flight requests finish. Answer:

1. What error do requests see?
2. What is the correct order?
3. How do you know requests are finished?
4. How do you handle a stuck request?

**D21.** A process catches `SIGTERM`, drains successfully, and exits with status `0`. Answer:

1. How does the orchestrator interpret the exit?
2. What if it exits with `1` after a clean drain?
3. What if it exits with `0` while a request failed?
4. Why is the exit code part of the contract?

**D22.** A container crashes on startup repeatedly. Answer:

1. What is a crash loop?
2. Which logs help?
3. How do you distinguish a configuration error from a probe error?
4. What should the platform eventually do?

**D23.** A rolling deploy replaces instances one at a time. Answer:

1. What must be true for zero downtime?
2. How do readiness and drain participate?
3. What happens if old and new versions need different schemas?
4. How do you test the rollout?

**D24.** Write a test that starts a process, sends a slow request, sends `SIGTERM`, and asserts the request completes and the process exits. Answer:

1. How do you find the PID?
2. How do you send the signal?
3. How do you bound the test duration?
4. What should the readiness endpoint return during the test?

## Group E — Structured logging and correlation

**E1.** A log line is:

```json
{"ts":"2026-01-01T10:00:00+00:00","level":"INFO","service":"api","event":"http.request.completed","status":200}
```

Answer:

1. Which field is the event name?
2. Why is the timestamp offset explicit?
3. Which field would you use to correlate with a trace?
4. Why is a JSON object easier to query than a prose line?

**E2.** Compare:

```python
logger.info(f"user={user_id} status={status}")
logger.info("request completed", extra={"user_id": user_id, "status": status})
```

Answer:

1. Which form keeps fields structured?
2. Which is more vulnerable to log injection?
3. Why can the f-string version make cardinality worse?
4. What happens if `user_id` contains a newline?

**E3.** A formatter reads `getattr(record, "event", record.getMessage())`. Answer:

1. What is logged when `event` is supplied?
2. What is logged when it is absent?
3. Why is the fallback potentially noisy?
4. How do you enforce that every application log has an event name?

**E4.** A call uses:

```python
logger.info("x", extra={"message": "override"})
```

Answer:

1. What may happen?
2. Why are some `LogRecord` attributes reserved?
3. How do you choose safe custom field names?
4. What is the difference between `msg` and `message` on the record?

**E5.** An exception is caught and logged:

```python
try:
    risky()
except Exception:
    logger.error("request failed")
```

Answer:

1. What is missing from the log?
2. How do you include the stack trace?
3. Why should the exception be logged once?
4. What should the caller receive?

**E6.** A module adds a `StreamHandler` at import time, and the application also configures one. Answer:

1. What happens to each log line?
2. Why is duplicate logging common in libraries?
3. How should a library expose logging?
4. How do you reset handlers in a test?

**E7.** A logger has `propagate = True` and both it and the root logger have handlers. Answer:

1. How many times is the record emitted?
2. What happens if `propagate = False`?
3. Why should handler configuration live at the application boundary?
4. How can duplicate output hide the real error?

**E8.** A request ID is stored in a `ContextVar`. Answer:

1. What happens when the value is set inside a request?
2. What does a new `asyncio` task inherit?
3. What does a new thread inherit?
4. How do you avoid leaking the value between requests?

**E9.** A context token is obtained with `token = var.set(value)`. Answer:

1. What does `var.reset(token)` do?
2. What happens if you reset in a different context?
3. Why should the reset be in `finally`?
4. What happens if you never reset?

**E10.** A request handler creates an `asyncio` task that logs later. Answer:

1. Does the task see the request ID?
2. Why?
3. What changes if the task is created from a different context?
4. How do you propagate the ID explicitly?

**E11.** A handler submits work to a `ThreadPoolExecutor`. Answer:

1. Does the worker thread inherit the context variable?
2. How can you copy the context?
3. Why is `contextvars.copy_context()` useful?
4. What should the log line include if propagation fails?

**E12.** Write middleware that:

- reads `X-Request-ID` or generates one
- sets the context variable
- logs the completed request
- resets the context in `finally`

Then answer what happens if the client sends a very long request ID.

**E13.** A user-controlled `User-Agent` is logged as a raw field. Answer:

1. Can it contain newlines?
2. Why does that matter even in JSON?
3. How do you bound and sanitize it?
4. Should it be indexed?

**E14.** A log formatter replaces `authorization` with `[REDACTED]`. Answer:

1. Why is a denylist fragile?
2. How does structured logging reduce the risk?
3. What should happen to nested headers?
4. How do you test the formatter?

**E15.** An exception message contains a database password. Answer:

1. How can it reach logs?
2. Why does `exc_info=True` increase the risk?
3. How do you redact before logging?
4. What should the operator see?

**E16.** A log line includes `email`, `user_id`, and `tenant_id`. Answer:

1. Which are personal data?
2. Which can be hashed or truncated?
3. Why might tenant ID be acceptable?
4. How do retention rules apply?

**E17.** A log field is `path` with one value per URL. Answer:

1. Why is this high cardinality?
2. How do you normalize it?
3. Why does cardinality affect cost?
4. Which path components should remain?

**E18.** A service logs every retrieved document at `INFO`. Answer:

1. What happens to volume?
2. When is this useful?
3. How do you sample or downgrade it?
4. What should be logged at the request boundary instead?

**E19.** A service sets the root logger to `DEBUG` in production. Answer:

1. What can happen to volume?
2. Which sensitive data can leak?
3. How should levels be chosen per logger?
4. How do you change a level safely at runtime?

**E20.** An HTTP library logs every request at `INFO`, and your application also logs every request. Answer:

1. Why is this duplicate?
2. How do you quiet the library?
3. What information do you lose?
4. Why not silence all third-party loggers?

**E21.** Compare an access log and an application event log. Answer:

1. Which records HTTP status and duration?
2. Which records business context?
3. How do you join them?
4. Why can an access log alone be insufficient?

**E22.** An audit log records who changed a permission. Answer:

1. What fields are mandatory?
2. Why must it be append-only?
3. How long is it retained?
4. Why is it separate from debug logs?

**E23.** A log timestamp is generated with `datetime.now()` and no timezone. Answer:

1. What is ambiguous during a timezone change?
2. What should be used instead?
3. How do consumers compare logs across regions?
4. Why is local time useful in a UI but risky in storage?

**E24.** A log event is named `"failed"`. Answer:

1. Why is this ambiguous?
2. Propose a more stable event name.
3. Why does a stable name help alerts?
4. Should the message contain the dynamic error?

**E25.** A high-traffic service samples 1% of successful request logs. Answer:

1. What happens to error logs?
2. How do you preserve counts?
3. What can sampling hide?
4. Why is sampling different from metrics?

**E26.** Write a test that logs a fake secret and asserts it never appears in the output. Answer:

1. How do you capture log output?
2. Which formatter do you exercise?
3. What should the test do with the handler afterward?
4. Why should the fake secret look realistic?
## Group F — Metrics and dashboards

**F1.** Classify each metric as counter, gauge, or histogram: total requests, current in-flight requests, request latency, queue depth, bytes sent, response size, active workers, failed jobs. Explain each choice.

**F2.** A counter is decremented after a request is cancelled. Answer:

1. Why is this invalid?
2. What does a metrics backend expect from a counter?
3. How do you represent cancellations instead?
4. What happens on process restart?

**F3.** A gauge reports the number of open connections. Answer:

1. Can it go down?
2. What does a sudden drop mean?
3. Why can a gauge be scraped at the wrong moment?
4. How do you alert on a gauge safely?

**F4.** A histogram has cumulative bucket counts `le=0.1: 10`, `le=0.5: 30`, `le=1: 45`, `le=+Inf: 50`. Answer:

1. How many observations are at most 0.5 seconds?
2. How many are greater than 0.1 and at most 0.5?
3. How many are greater than 1 second?
4. What is the total count?

**F5.** Parse this exposition fragment:

```text
# TYPE http_requests_total counter
http_requests_total{route="/ask",status_class="2xx"} 42
http_requests_total{route="/ask",status_class="5xx"} 3
```

Answer:

1. What is the total request count for `/ask`?
2. What is the 5xx rate?
3. Why are labels part of the series identity?
4. What happens if a label value changes every request?

**F6.** A histogram has only six buckets. Answer:

1. Can it produce an exact p99?
2. Why is the result an estimate?
3. What does the `+Inf` bucket guarantee?
4. How do you improve precision?

**F7.** A dashboard shows the average of each instance's p95 latency. Answer:

1. Why is this not the fleet p95?
2. What should be aggregated instead?
3. Why can averaging hide a single slow instance?
4. How do you display the worst instance?

**F8.** A metric label is `user_id`. Answer:

1. How many series can this create?
2. What happens to memory and query cost?
3. What should replace it?
4. When is a user identifier legitimately needed?

**F9.** A label is `route="/users/12345/orders/678"`. Answer:

1. Why is this bad?
2. What is the normalized route template?
3. Where should the actual IDs go?
4. How do you enforce route naming?

**F10.** A metric is named `latency`. Answer:

1. What unit is missing?
2. Why should the unit be in the name?
3. What is a better name?
4. Why do seconds and milliseconds cause incidents?

**F11.** Define RED metrics for an HTTP service. Answer:

1. What is rate?
2. What is errors?
3. What is duration?
4. Which labels are appropriate for each?

**F12.** Define USE metrics for a worker pool. Answer:

1. What is utilization?
2. What is saturation?
3. What are errors?
4. How do these differ from RED?

**F13.** List the four golden signals. Then map each to one concrete metric in this chapter.

**F14.** A service handles 200 requests in a minute and 5 fail. Compute the error rate. Then explain why a 1-minute window can be misleading.

**F15.** A counter increases from 1,200 to 1,320 over 60 seconds. Compute the per-second rate. Then explain what happens to the rate after a process restart.

**F16.** A CPU limit is 2 cores and the process uses 1.8 cores. Compute utilization. Then explain why utilization alone does not prove saturation.

**F17.** A queue has 500 items and the oldest is 12 minutes old. Answer:

1. Which gauge is more actionable?
2. Why can depth alone mislead?
3. What does age imply about latency?
4. How do you alert on a stuck consumer?

**F18.** Define one business metric for each: a RAG API, a batch pipeline, and a model provider integration. Answer:

1. What does each measure?
2. Why are request counts insufficient?
3. Which labels are safe?
4. How does cost relate?

**F19.** A dashboard has 60 CPU graphs and no request metrics. Answer:

1. What question does it fail to answer?
2. Which four panels would you add first?
3. Where should business metrics go?
4. How do you reduce dashboard noise?

**F20.** An alert fires when CPU exceeds 80%. Answer:

1. Is this a symptom or a cause?
2. Why can it be noisy?
3. What user-visible alert would be better?
4. When is a CPU alert still useful?

**F21.** An availability SLO is 99.9% over 30 days. Answer:

1. How many minutes of downtime does that allow approximately?
2. How many failed requests out of 1,000,000?
3. Why is the window part of the definition?
4. What happens to the budget after a major incident?

**F22.** Explain multi-window burn-rate alerting. Answer:

1. Why use a short window?
2. Why use a long window?
3. What does requiring both reduce?
4. Which alert should page immediately?

**F23.** A metric disappears from the dashboard after a deploy. Answer:

1. What are possible causes?
2. How do you tell “no traffic” from “no instrumentation”?
3. What should happen if a required metric is absent?
4. How do you test metric emission?

**F24.** Place instrumentation at the HTTP boundary, dependency call, and queue consumer. Answer:

1. What does each measure?
2. Where do you start and stop the timer?
3. How do you avoid double-counting retries?
4. Which labels belong at each boundary?

**F25.** Write a test for a counter and histogram. Answer:

1. What should a counter test assert?
2. How do you test a negative increment?
3. How do you test bucket counts?
4. How do you test label cardinality?

**F26.** A metric has labels for `tenant_id`, `request_id`, and `error_message`. Answer:

1. Which label is the worst offender?
2. Which can be bounded?
3. What should replace the error message?
4. How do you detect label explosion before it reaches production?

---

## Group G — Tracing and error tracking

**G1.** List the minimum fields of a span. Answer:

1. Which field links it to its parent?
2. Which field links it to the whole trace?
3. Which fields measure duration?
4. Which field describes success or failure?

**G2.** A request span calls a database span. Answer:

1. Which is the parent?
2. What trace ID should both use?
3. What parent ID should the database span have?
4. What happens if the child starts after the parent ends?

**G3.** A trace has three services. Answer:

1. How do they share a trace ID?
2. How does each service create its own spans?
3. What must be forwarded on outbound calls?
4. What happens if one service drops the header?

**G4.** An outbound HTTP call does not forward `traceparent`. Answer:

1. What does the downstream service see?
2. Can the trace still be complete?
3. How do you fix it?
4. Why is logging the trace ID not a substitute for propagation?

**G5.** Parse:

```text
00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Answer:

1. Which part is the version?
2. Which part is the trace ID?
3. Which part is the parent span ID?
4. What does the final field indicate?

**G6.** Compare head sampling and tail sampling. Answer:

1. When is the decision made?
2. Which is cheaper at the service?
3. Which can preserve rare errors?
4. What does each cost in storage or memory?

**G7.** A trace sampler keeps 1% of traces but 100% of errors. Answer:

1. Why is this useful?
2. How are success counts affected?
3. What must be recorded with the sample?
4. What happens to slow non-error traces?

**G8.** A span attribute is the full user query. Answer:

1. Why is this risky?
2. Is it high cardinality?
3. What metadata is safe?
4. How do you debug retrieval without storing the query?

**G9.** A span includes an authorization header. Answer:

1. What secret is exposed?
2. Where can span data be exported?
3. How do you redact it?
4. Why is a private tracing backend not enough?

**G10.** A span catches an exception and sets status to `ERROR`. Answer:

1. What should be recorded?
2. Should the exception be re-raised?
3. What happens if the error is handled and the request succeeds?
4. How does status differ from an event?

**G11.** A span records an exception event with type, message, and stack. Answer:

1. Why record it on the span instead of only logging?
2. What can be duplicated?
3. Which fields must be redacted?
4. How do you link it to an error tracker?

**G12.** Instrument a database query. Answer:

1. What span name is low cardinality?
2. Which attributes are safe?
3. Why should the SQL text be handled carefully?
4. How do you record rows affected?

**G13.** Instrument an external model call. Answer:

1. Which provider and model attributes are safe?
2. Which token counts are useful?
3. How do you record timeouts?
4. Why should prompt text be excluded?

**G14.** An `asyncio` task is created inside a traced request. Answer:

1. Does it inherit the current span?
2. Why or why not?
3. How do you make it a child span?
4. What happens if it outlives the request?

**G15.** A span context is set but never reset. Answer:

1. What leaks into later work?
2. How does `ContextVar.reset(token)` help?
3. Why should reset be in `finally`?
4. How do you test for leakage?

**G16.** A worker consumes a message and starts a trace from scratch. Answer:

1. Why is the trace disconnected?
2. What should the producer include?
3. How does the consumer continue the trace?
4. What if the message has no trace header?

**G17.** A tracing backend drops spans under load. Answer:

1. What happens to trace completeness?
2. How does sampling help?
3. Why should telemetry export not block requests?
4. What should happen when the exporter is down?

**G18.** An error tracker groups by exception message. Answer:

1. Why can a dynamic message create thousands of groups?
2. What should the fingerprint use?
3. Which volatile values should be normalized?
4. How do release and environment affect grouping?

**G19.** Two errors have the same type and stack but different user IDs. Answer:

1. Should they be one group or many?
2. Why is the user ID a bad grouping key?
3. What context should be attached instead?
4. How do you count affected users?

**G20.** A new release causes a spike in a known error. Answer:

1. How does release tracking help?
2. What should the alert compare?
3. How do you roll back?
4. What should the postmortem record?

**G21.** Error reports include breadcrumbs. Answer:

1. What is a breadcrumb?
2. Which events are useful?
3. Why can breadcrumbs leak data?
4. How many should be retained?

**G22.** An error tracker sends one alert per occurrence. Answer:

1. Why is this unusable?
2. How should alerts be aggregated?
3. What threshold is meaningful?
4. How do you avoid alerting on a known issue?

**G23.** The same exception is reported by the web tier and the worker tier. Answer:

1. Is this one incident or two?
2. How do service and environment attributes help?
3. How do you deduplicate?
4. Which team owns the fix?

**G24.** A user reports a slow request, but logs show only a total duration. Answer:

1. What can tracing add?
2. Which spans would you inspect first?
3. How do you find the trace ID?
4. What if the request crossed a service that has no tracing?

---

## Group H — SLOs, alerting, and incident response

**H1.** Define an SLI for API availability. Answer:

1. What counts as a valid request?
2. What counts as a good request?
3. Where is the measurement taken?
4. Why do 4xx responses sometimes count differently from 5xx?

**H2.** Define an SLO for p95 latency. Answer:

1. What percentage of requests must be below the threshold?
2. Over what window?
3. Why is p95 more useful than the mean?
4. What is excluded from the measurement?

**H3.** An SLO is 99.95% over 30 days. Answer:

1. What is the allowed bad rate?
2. How many minutes of downtime is that approximately?
3. How does the budget change after an incident?
4. What happens when the budget is exhausted?

**H4.** A service handles 1,000,000 requests in a month with an availability SLO of 99.9%. Answer:

1. How many failed requests exhaust the budget?
2. How many minutes is that approximately if traffic is uniform?
3. Why is the request count more precise than a minutes estimate?
4. Which requests are excluded?

**H5.** The SLO is 99.9% and 0.5% of requests fail. Compute the burn rate. Then explain what it means for a 30-day budget.

**H6.** The SLO is 99.9% and 2% of requests fail. Compute the burn rate. Then explain why a short-window alert should fire.

**H7.** A latency SLO uses a 30-day window. Answer:

1. Why not a 1-hour window?
2. Why not a 1-year window?
3. What does a rolling window mean?
4. How do calendar windows differ?

**H8.** Explain a fast-burn alert and a slow-burn alert. Answer:

1. Which pages immediately?
2. Which creates a ticket?
3. Why require multiple windows?
4. What is the risk of too many fast-burn alerts?

**H9.** Classify each as page, ticket, or dashboard-only: total outage, 2% of requests failing for five minutes, slow disk growth over a month, a single retry, p99 up 5% for a week. Explain each.

**H10.** An alert fires because CPU is high. Answer:

1. Is this a user-visible symptom?
2. What symptom would you page on?
3. When is CPU a leading indicator?
4. How do you link the cause and symptom?

**H11.** A runbook says “check the logs and investigate.” Answer:

1. Why is this insufficient?
2. What should it include instead?
3. How do you verify recovery?
4. Who escalates if the first action fails?

**H12.** Define incident severity levels. Answer:

1. What distinguishes severity 1 from severity 2?
2. Who decides?
3. How does severity affect communication?
4. Can severity change during an incident?

**H13.** Assign roles for an incident. Answer:

1. Who coordinates?
2. Who communicates with stakeholders?
3. Who performs technical mitigation?
4. Why should the incident commander not also debug?

**H14.** Keep an incident timeline. Answer:

1. Which events are recorded?
2. Why are timestamps in UTC?
3. How does the timeline help the postmortem?
4. What should not be included?

**H15.** A dependency is timing out and the service returns errors. Answer:

1. What is the first mitigation?
2. Should you restart the dependency?
3. How do timeouts and circuit breakers help?
4. What should you communicate?

**H16.** A deploy caused the incident and the previous image is available. Answer:

1. What is the fastest mitigation?
2. What must be true about the database schema?
3. How do you verify the rollback?
4. What do you do if rollback is unsafe?

**H17.** During an incident, support asks for an update. Answer:

1. What should the update include?
2. How often should it be sent?
3. What should it avoid?
4. Who owns the status page?

**H18.** A postmortem blames an engineer. Answer:

1. Why is this counterproductive?
2. What should the postmortem focus on?
3. Which contributing factors matter?
4. What makes an action item useful?

**H19.** A postmortem action is “be more careful.” Answer:

1. Why is it not actionable?
2. Rewrite it as a concrete control.
3. Who should own it?
4. How do you track completion?

**H20.** An on-call team receives 40 pages per week, mostly for non-actionable alerts. Answer:

1. What is alert fatigue?
2. How do you triage the alerts?
3. Which alerts should become tickets?
4. How do you measure improvement?

**H21.** A service depends on a database with its own SLO. Answer:

1. Why can the service SLO be lower than the dependency SLO?
2. How do you handle a dependency outage?
3. What should the status page say?
4. How do you avoid duplicated alerts?

**H22.** A planned migration will cause brief errors. Answer:

1. What is a maintenance window?
2. How do you communicate it?
3. How do you exclude it from the SLO, if at all?
4. Why is silent exclusion dangerous?

**H23.** A status page shows “operational” while users report failures. Answer:

1. What is wrong?
2. How should status be derived?
3. Who can update it?
4. How do you avoid stale status?

**H24.** Review an SLO after three months. Answer:

1. Which data do you inspect?
2. When should the target change?
3. How do you avoid moving the goalposts?
4. What stakeholders must agree?

---

## Group I — Performance, load, and capacity

**I1.** A sample has 100 latencies. Define p50, p95, and p99. Answer:

1. Which value is the median?
2. How many observations are above p99?
3. Why do tail percentiles matter for user experience?
4. Why is p99 unstable with small samples?

**I2.** A dashboard reports average latency of 120 ms and p99 of 2 seconds. Answer:

1. Why can both be true?
2. Which better reflects the slow users?
3. Why can optimizing the average miss the problem?
4. What would you investigate next?

**I3.** Using nearest-rank, compute p95 for `[10, 20, 30, 40, 50, 60, 70, 80, 90, 100]`. Then compute p50. Explain your indexing.

**I4.** A service processes 12,000 requests in 5 minutes. Compute the average throughput per second. Then explain why the peak rate can be much higher.

**I5.** A service handles 80 requests per second with an average latency of 150 ms. Use Little's law to estimate in-flight requests. Then explain what happens if concurrency is capped at 5.

**I6.** A connection pool has 10 connections, 20 worker tasks, and each request holds a connection for 100 ms at 100 requests per second. Answer:

1. What is the required concurrency?
2. Is the pool large enough?
3. What happens to requests waiting for a connection?
4. How do you measure pool saturation?

**I7.** A queue is at 95% utilization. Answer:

1. Why does latency rise sharply?
2. What is headroom for?
3. How do bursts affect the queue?
4. What metric reveals the problem?

**I8.** Design load-test stages for a new endpoint. Answer:

1. What is the baseline?
2. How do you ramp?
3. When do you stop?
4. What do you measure at each stage?

**I9.** A load test starts at full traffic immediately. Answer:

1. Why can results be misleading?
2. What does warmup change?
3. Which caches and pools need warming?
4. How long should warmup last?

**I10.** A load test sends only tiny requests with no authentication. Answer:

1. Why is the mix unrealistic?
2. Which costs are missing?
3. What should the test include?
4. How do you protect production data?

**I11.** A closed-loop load test uses 20 workers, each waiting for a response before sending the next request. Answer:

1. What happens to request rate when latency rises?
2. How does an open-loop test differ?
3. Which model better matches real traffic?
4. What is think time?

**I12.** A load test runs against production. Answer:

1. What are the risks?
2. How do you isolate test data?
3. What approvals are needed?
4. What is shadow traffic?

**I13.** Under load, error rate rises from 0.1% to 8%. Answer:

1. What does this indicate?
2. Which errors should you inspect first?
3. How do timeouts appear in metrics?
4. Why is a successful throughput number misleading?

**I14.** CPU is at 60%, memory at 70%, and p99 latency is rising. Answer:

1. Which resource is saturated?
2. What else could be the bottleneck?
3. How do you check connection pools and queues?
4. Why is CPU below 100% not proof of spare capacity?

**I15.** A caller has a 2-second deadline, but an inner service timeout is 5 seconds. Answer:

1. What happens at 2 seconds?
2. What is wasted?
3. How should timeout budgets nest?
4. How do you test deadline propagation?

**I16.** A dependency times out and clients retry three times. Answer:

1. How much extra load can this create?
2. Why is jitter important?
3. What is a retry budget?
4. When should retries stop?

**I17.** A service opens a new database connection per request. Answer:

1. Why is this expensive?
2. What does a pool reuse?
3. How do you size the pool?
4. What happens when the pool is exhausted?

**I18.** A container has 2 CPUs and 8 ASGI workers. Answer:

1. How much scheduling contention is possible?
2. When do more workers help?
3. When do they hurt?
4. How do you choose a starting point?

**I19.** A request performs a CPU-heavy image transform inside an async handler. Answer:

1. What happens to other requests?
2. How do you move the work off the event loop?
3. Which executor would you use?
4. How do you bound concurrency?

**I20.** Use `cProfile` to find a hot function. Answer:

1. Which sort key shows cumulative time?
2. Why can cumulative and tottime differ?
3. What does a high call count suggest?
4. Why is profiling in production risky?

**I21.** Use `tracemalloc` to investigate memory growth. Answer:

1. What does it track?
2. How do you compare snapshots?
3. Why is the largest allocation not always the leak?
4. How does this differ from RSS?

**I22.** Memory grows over a 24-hour soak test. Answer:

1. What are possible causes?
2. How do you distinguish a cache from a leak?
3. Why can unbounded task tracking leak?
4. What metric would you add?

**I23.** A service runs at 85% CPU at peak and has three replicas. Answer:

1. What happens if one replica fails?
2. How much headroom remains?
3. Why is 100% utilization unstable?
4. How do you test failover capacity?

**I24.** An autoscaler scales on CPU only. Answer:

1. What happens when the bottleneck is a queue?
2. What metric should drive scaling?
3. Why can scaling out increase database load?
4. How do you prevent flapping?

---

## Group J — CI/CD, security, and capstone

**J1.** Order these pipeline stages: build image, unit tests, deploy staging, lint, canary, scan image, smoke tests. Answer:

1. Which stages must pass before build?
2. Which produces the artifact?
3. Which validates the artifact?
4. Which controls production traffic?

**J2.** A pull request changes a database query. Answer:

1. Which tests should run?
2. How do you test against a temporary database?
3. Why must CI use the production Python version?
4. Which checks can run in parallel?

**J3.** A pipeline rebuilds the image separately for staging and production. Answer:

1. Why is this a problem?
2. What should be promoted?
3. How do you identify the artifact?
4. What metadata should the deploy record?

**J4.** Add an image vulnerability scan. Answer:

1. What does it scan?
2. When does it fail the build?
3. Why can a clean scan be misleading?
4. How do you handle a base-image vulnerability?

**J5.** Generate an SBOM. Answer:

1. What does it list?
2. Why is it useful during a vulnerability disclosure?
3. Which formats are common?
4. How do you store it with the artifact?

**J6.** Sign a container image. Answer:

1. What does signing prove?
2. Who verifies it?
3. When is verification enforced?
4. What happens if the signing key leaks?

**J7.** A deployment runs with cluster-admin permissions. Answer:

1. Why is this dangerous?
2. What permissions does the service actually need?
3. How do you scope them?
4. How do you audit usage?

**J8.** A container runs as root with a writable filesystem. Answer:

1. What can an attacker do?
2. Which two controls reduce the blast radius?
3. What breaks when the filesystem is read-only?
4. How do you test the hardened image?

**J9.** A service can reach the entire internet. Answer:

1. Why is egress control useful?
2. What should it allow?
3. How does this affect model provider calls?
4. How do you detect unexpected egress?

**J10.** CI needs cloud credentials. Answer:

1. Why are long-lived keys risky?
2. What should replace them?
3. How do you scope the identity?
4. Why must pull-request workflows not receive production secrets?

**J11.** A migration adds a nullable `tenant_id` column and a new index. Answer:

1. Why is this an expand step?
2. What must the application do during the rollout?
3. When can the column become required?
4. How do you backfill safely?

**J12.** A migration drops a column used by the previous release. Answer:

1. Why is this unsafe during a rolling deploy?
2. What is the contract step?
3. How long must you wait before dropping?
4. What if the migration cannot be rolled back?

**J13.** A canary receives 5% of traffic. Answer:

1. Which metrics do you compare?
2. What is the baseline?
3. What triggers rollback?
4. Why is a canary without comparison useless?

**J14.** A blue-green deployment switches all traffic at once. Answer:

1. What must be warm before the switch?
2. How do you roll back?
3. What about database compatibility?
4. Why can session state be a problem?

**J15.** A feature flag controls a new retrieval path. Answer:

1. Why deploy dark?
2. How do you enable it for one tenant?
3. How do you kill it quickly?
4. Why should flags not replace schema migrations?

**J16.** Write five post-deploy smoke tests. Answer:

1. Which endpoint proves authentication works?
2. Which proves a dependency call works?
3. Which proves the version is correct?
4. What should happen if a smoke test fails?

**J17.** A rollback to the previous image is requested. Answer:

1. What must be known?
2. Which schema state must be compatible?
3. How do you verify recovery?
4. What if the old image cannot read the new data?

**J18.** A Dockerfile installs a dependency from a mutable Git branch. Answer:

1. Why is this not reproducible?
2. What should be pinned?
3. How do you verify the commit?
4. Why is a lock file not enough for an arbitrary branch install?

**J19.** A deployment has no audit trail. Answer:

1. Which events should be recorded?
2. Who deployed what and when?
3. How do you link a deploy to a change ticket?
4. How long is the record retained?

**J20.** Observability costs are rising. Answer:

1. Which telemetry is highest volume?
2. How do you reduce log volume?
3. How do you reduce metric cardinality?
4. Why is deleting all traces a bad first move?

**J21.** Capstone: write a production Dockerfile for a Python ASGI service. Requirements:

- multi-stage build
- pinned base image
- non-root user
- read-only-friendly runtime
- no secrets in the image
- exact dependency lock
- JSON logs and unbuffered output
- graceful termination
- separate migration job

Then answer:

1. Which layer is largest?
2. How do you verify the image runs as non-root?
3. How do you test signal handling?
4. Which command starts the service?

**J22.** Capstone: define observability for that service. Requirements:

- `/livez` and `/readyz`
- structured request logs with request and trace IDs
- request count, error count, and latency histogram
- dependency latency and error metrics
- spans for HTTP, database, and model calls
- an availability SLO and burn-rate alerts
- a dashboard and a runbook

Then answer:

1. Which metrics page immediately?
2. Which data must be redacted?
3. How do you test the alerts?
4. How do you know a deploy is healthy?

**J23.** Compare Python service deployment with a TypeScript Node.js service. Answer:

1. How does the process model differ?
2. How do dependency locks differ?
3. How do signal handlers differ?
4. How does structured logging compare?
5. Why do both need readiness and graceful shutdown?

**J24.** Explain this chapter to a TypeScript backend developer in one page. Cover artifacts, configuration, containers, health, shutdown, logs, metrics, traces, SLOs, load tests, migrations, security, and rollback. Include one deployment mistake that is easy in both ecosystems and one Python-specific pitfall.

---

## Before moving on

Check yourself against the chapter outcome without looking back at the notes:

- Build one immutable artifact and promote it through environments.
- Parse and validate configuration at startup; keep secrets out of images and logs.
- Run a non-root container with a pinned base image and explicit resource limits.
- Distinguish startup, liveness, and readiness, and drain traffic before exit.
- Handle `SIGTERM` without dropping in-flight work.
- Emit structured logs with request IDs, stable event names, and redaction.
- Choose counters, gauges, and histograms correctly and keep labels bounded.
- Instrument HTTP, dependency, queue, and model-call boundaries.
- Propagate trace context and sample without losing important errors.
- Define SLIs, SLOs, error budgets, and actionable burn-rate alerts.
- Use load tests and percentiles to find saturation before users do.
- Run migrations with expand/contract and deploy with a rollback path.
- Apply least privilege, supply-chain checks, and telemetry retention limits.
- Explain a release, an incident, and a rollback to a TypeScript client.

If any group felt slow, redo a subset of its exercises from scratch before treating this chapter as complete.
