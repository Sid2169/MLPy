# Chapter 5 — HTTP APIs with FastAPI and Pydantic

Chapters 1–4 covered the language, project setup, and testing. This chapter builds an HTTP API that validates input, calls an external service reliably, and is testable without real network access. It covers HTTP essentials, FastAPI routing and dependency injection, Pydantic models and validation, request/response handling, error mapping, resource-managed HTTP clients, and API testing.

Pydantic v2 and current FastAPI idioms are assumed. As in previous chapters, exercises have no answers, and worked examples are teaching material.

## Contents

1. HTTP essentials for API authors
2. A first FastAPI application
3. Path and query parameters
4. Pydantic models and validation
5. Request bodies, responses, and serialization
6. Error handling
7. Dependencies and configuration
8. Calling external services
9. Structuring the application
10. Testing the API
11. Common mistakes and conventions
12. Exercises (Groups A–J)

---

## 5.1 HTTP essentials for API authors

An HTTP exchange is a request (method, path, query string, headers, optional body) and a response (status code, headers, optional body). JSON is the default body format for APIs.

Methods and semantics:

- `GET` reads and must not change state. Safe and idempotent.
- `POST` creates or triggers an action. Not idempotent: retrying may create duplicates.
- `PUT` replaces a resource; idempotent when the request contains the full state.
- `PATCH` partially updates; not necessarily idempotent.
- `DELETE` removes; idempotent in effect (repeating it leaves the resource absent), though the status may differ.
- `HEAD` is `GET` without a body; `OPTIONS` describes capabilities.

Status codes you will use constantly:

| Code | Meaning | Typical use |
| --- | --- | --- |
| 200 | OK | successful GET/PUT/PATCH |
| 201 | Created | successful POST that creates a resource |
| 202 | Accepted | work queued, not finished |
| 204 | No Content | success with no body (often DELETE) |
| 400 | Bad Request | malformed or semantically invalid request |
| 401 | Unauthorized | missing/invalid credentials |
| 403 | Forbidden | authenticated but not allowed |
| 404 | Not Found | resource does not exist |
| 409 | Conflict | duplicate or state conflict |
| 422 | Unprocessable Entity | well-formed but fails validation (FastAPI's default) |
| 429 | Too Many Requests | rate limited |
| 500 | Internal Server Error | bug in your service |
| 502 | Bad Gateway | upstream returned an invalid response |
| 503 | Service Unavailable | dependency unavailable / overloaded |
| 504 | Gateway Timeout | upstream timed out |

`400` versus `422`: both indicate a bad request; FastAPI uses `422` for request-validation failures (wrong types, missing fields, constraint violations) and you use `400` for business-rule failures that are not captured by the schema. `204` responses must not include a body.

Headers carry metadata: `Content-Type` describes the body format, `Accept` states what the client wants, `Authorization` carries credentials, and custom headers like `X-Request-ID` support tracing. Header names are case-insensitive. Never log `Authorization` or API keys (Chapter 3).

FastAPI's request lifecycle: receive request → parse path/query/headers/body → validate against types and Pydantic models (failure → `422`) → resolve dependencies → run the route handler → validate/serialize the response model → send the response. Errors raised as `HTTPException` become the declared status; unexpected exceptions become `500`.

---

## 5.2 A first FastAPI application

```bash
python -m pip install "fastapi[standard]"
fastapi dev app/main.py          # development server with reload
# or
uvicorn app.main:app --reload
```

```python
# app/main.py
from fastapi import FastAPI

app = FastAPI(title="Example API", version="0.1.0")

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

@app.get("/items/{item_id}")
def read_item(item_id: int) -> dict[str, int]:
    return {"item_id": item_id}
```

- `app = FastAPI()` is the application object. `uvicorn app.main:app` means "import `app` from `app/main.py`, then use the `app` object."
- Decorators declare method and path. The function is the handler. Returned dicts/lists/models are serialized to JSON.
- Use `def` handlers for synchronous code (FastAPI runs them in a worker thread) and `async def` only when the handler actually awaits (Chapter 6). Do not call blocking I/O inside `async def`.
- `/docs` serves interactive documentation, `/redoc` alternative docs, and `/openapi.json` the machine-readable schema. They are generated from routes, type hints, and models.
- The default success status is `200`; set `status_code=201` for creation.
- Route matching is in declaration order. Declare specific paths such as `/users/me` before `/users/{user_id}`.
- A path that exists with a different method returns `405 Method Not Allowed`.

Group related routes in `APIRouter` objects:

```python
# app/routers/items.py
from fastapi import APIRouter

router = APIRouter(prefix="/items", tags=["items"])

@router.get("")
def list_items() -> list[dict[str, int]]:
    return [{"id": 1}]
```

```python
# app/main.py
from app.routers import items

app.include_router(items.router)
```

---

## 5.3 Path and query parameters

Function parameter names that appear in the path template are path parameters; other scalar parameters are query parameters.

```python
from typing import Annotated
from fastapi import FastAPI, Path, Query

app = FastAPI()

@app.get("/users/{user_id}")
def get_user(
    user_id: Annotated[int, Path(ge=1)],
    verbose: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict[str, object]:
    return {"user_id": user_id, "verbose": verbose, "limit": limit}
```

- Type conversion happens automatically: `/users/abc` fails validation with `422`.
- Missing required query parameters produce `422`; optional ones need a default, usually `None`.
- Use `Annotated[T, Query(...)]` / `Path(...)` for constraints: `ge`, `gt`, `le`, `lt`, `min_length`, `max_length`, `pattern`.
- `Query(alias="page-size")` maps an external name to a Python-safe parameter.
- Repeated query parameters (`?tag=a&tag=b`) map to `list[str]`:

```python
@app.get("/search")
def search(
    q: Annotated[str, Query(min_length=1)],
    tags: Annotated[list[str], Query()] = [],
) -> dict[str, object]:
    return {"q": q, "tags": tags}
```

- Header parameters use `Header`; underscores are converted to hyphens (`x_request_id` → `X-Request-ID`) unless you set `convert_underscores=False`.
- The `Request` object exposes raw details (`request.headers`, `request.url`) when a typed parameter is not enough.

Validation error shape (FastAPI default):

```json
{"detail": [{"type": "int_parsing", "loc": ["path", "user_id"], "msg": "...", "input": "abc"}]}
```

`loc` identifies where the problem is (`path`, `query`, `header`, `body`). Tests should assert the status, `loc`, and error type rather than exact message wording, which changes across Pydantic versions.

---

## 5.4 Pydantic models and validation

Pydantic models define schemas, validate input, coerce compatible types, and serialize output. FastAPI uses them for request bodies and response models.

```python
from pydantic import BaseModel, Field

class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    age: int = Field(ge=0, le=130)
    tags: list[str] = Field(default_factory=list)

class User(BaseModel):
    id: int
    name: str
    age: int
    tags: list[str]
```

Key rules:

- Fields with no default are required. `x: int` is required; `x: int = 0` is optional with a default; `x: int | None = None` is optional and nullable. `x: int | None` without a default is required but may be `None`.
- Validation errors raise `pydantic.ValidationError`, which FastAPI converts to `422` for request parsing.
- Mutable defaults must use `Field(default_factory=list)`, never `tags: list[str] = []`.
- By default Pydantic ignores unknown fields. To reject them, set `model_config = ConfigDict(extra="forbid")`, which turns typos into `422` errors.
- Nested models validate recursively; error `loc` values show the nesting path, e.g. `["body", "items", 0, "price"]`.
- `model_dump()` → dict (Python objects preserved, e.g. `datetime`); `model_dump(mode="json")` → JSON-compatible primitives; `model_dump_json()` → JSON string.
- `model_validate(obj)` → model from a dict; `model_validate_json(text)` → model from a JSON string.
- `model_copy(update={...})` returns a copy, but note that it does not run validation on the update.

Field constraints (`gt`, `ge`, `lt`, `le`, `min_length`, `max_length`, `pattern`, `multiple_of`) and documentation (`title`, `description`, `examples`) are declared with `Field`:

```python
from pydantic import BaseModel, Field

class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100, description="Display name")
    price_cents: int = Field(gt=0, description="Price in cents")
    sku: str = Field(pattern=r"^[A-Z0-9-]{3,20}$")
```

Custom validation:

```python
from pydantic import BaseModel, field_validator, model_validator

class Window(BaseModel):
    start: int
    end: int

    @field_validator("start", "end")
    @classmethod
    def non_negative(cls, value: int) -> int:
        if value < 0:
            raise ValueError("must be non-negative")
        return value

    @model_validator(mode="after")
    def check_order(self) -> "Window":
        if self.start >= self.end:
            raise ValueError("start must be before end")
        return self
```

Configuration options live in `model_config`:

```python
from pydantic import BaseModel, ConfigDict

class StrictUser(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str
```

Input and output models should usually be separate. `UserCreate` validates input; `User` documents the response without fields the client must not see (password hashes, internal flags). FastAPI's `response_model` filters to exactly the declared fields — a security boundary, not just documentation.

---

## 5.5 Request bodies, responses, and serialization

A Pydantic model parameter is read from the JSON body:

```python
from fastapi import FastAPI, status

app = FastAPI()

class ItemCreate(BaseModel):
    name: str
    price_cents: int

class Item(BaseModel):
    id: int
    name: str
    price_cents: int

@app.post("/items", status_code=status.HTTP_201_CREATED, response_model=Item)
def create_item(payload: ItemCreate) -> Item:
    return Item(id=1, name=payload.name, price_cents=payload.price_cents)
```

- The body must be valid JSON and match the model, otherwise `422`.
- `response_model` validates and serializes the result, and strips undeclared fields. A route cannot accidentally leak `password_hash` if `User` does not include it.
- FastAPI also accepts the return annotation as the response model (`-> Item`), so `response_model` can be omitted when they agree.
- `response_model_exclude_none=True` removes `None` fields from output; `response_model_exclude_unset=True` omits fields the model never received.
- `list[Item]` is a valid response model.
- `status_code=204` means no content; return `None` and set `response_model=None`. `201` is correct for resource creation.
- To set response headers or status dynamically, declare `response: Response` and mutate it:

```python
from fastapi import Response

@app.post("/items")
def create_item(payload: ItemCreate, response: Response) -> Item:
    response.headers["X-Request-ID"] = "abc"
    response.status_code = status.HTTP_201_CREATED
    ...
```

- Multiple body parameters become keys of one JSON object; wrap a single model with `Body(embed=True)` if the client sends `{"item": {...}}`:

```python
from fastapi import Body

@app.post("/orders")
def create_order(item: Annotated[ItemCreate, Body(embed=True)]) -> dict[str, str]:
    return {"status": "created"}
```

- `JSONResponse` and `RedirectResponse` bypass response-model serialization; use them deliberately (custom error formats, redirects).
- Serialization of `datetime`, `date`, `UUID`, and enums is automatic when using `model_dump(mode="json")` or response models.

---

## 5.6 Error handling

Raise `HTTPException` for expected HTTP failures:

```python
from fastapi import HTTPException, status

def get_item_or_404(item_id: int) -> Item:
    item = find_item(item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    return item
```

- `detail` may be a string or a JSON-serializable structure. FastAPI returns `{"detail": ...}`.
- Pass `headers={"WWW-Authenticate": "Bearer"}` for `401` responses.
- Validation failures are handled by FastAPI as `422` with the standard error list. You can customize the handler for `RequestValidationError` if the API needs a different error envelope.

Domain exceptions should not be HTTP-aware. Define a taxonomy and translate at the HTTP boundary:

```python
class UpstreamError(Exception):
    """The external service failed in a non-retryable way."""

class UpstreamTimeout(Exception):
    """The external service did not respond in time."""

from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(UpstreamError)
def handle_upstream(request: Request, exc: UpstreamError) -> JSONResponse:
    logger.warning("upstream failure: %s", exc)
    return JSONResponse(status_code=status.HTTP_502_BAD_GATEWAY,
                        content={"detail": "upstream service failed"})

@app.exception_handler(UpstreamTimeout)
def handle_timeout(request: Request, exc: UpstreamTimeout) -> JSONResponse:
    logger.warning("upstream timeout: %s", exc)
    return JSONResponse(status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                        content={"detail": "upstream timed out"})
```

Rules:

- Register handlers with `@app.exception_handler(...)` or `app.add_exception_handler(...)`. The handler must return a `Response`.
- Handlers are selected by exception type; subclasses match parent handlers unless a more specific handler exists.
- Never return raw exception text, upstream bodies, headers, or stack traces to clients. Log details server-side; return a stable, generic message.
- Unhandled exceptions become `500`. In `TestClient`, they re-raise by default (useful for debugging); instantiate `TestClient(app, raise_server_exceptions=False)` to assert a 500 response.
- `HTTPException` subclasses exception handling; do not wrap it in a broad `except Exception` that turns it into `500`.
- Consistent error envelopes help clients: for example `{"error": {"code": "not_found", "message": "..."}}`. If you change the format, do it with a global handler, not route by route.

---

## 5.7 Dependencies and configuration

FastAPI's dependency injection supplies shared logic and objects to handlers. A dependency is any callable; declare it with `Depends`.

```python
from functools import lru_cache
from typing import Annotated
from fastapi import Depends, FastAPI

@lru_cache
def get_settings() -> Settings:
    return load_settings(dict(os.environ))       # Chapter 3

SettingsDep = Annotated[Settings, Depends(get_settings)]

@app.get("/config-check")
def config_check(settings: SettingsDep) -> dict[str, str]:
    return {"base_url": settings.base_url}
```

- `@lru_cache` builds settings once per process; without it, `get_settings` runs per request. Cache expensive immutable objects, not request-specific state.
- FastAPI caches a dependency's result within a single request by default; different requests call it again (unless it has its own cache).
- Dependencies can depend on other dependencies, read headers, enforce auth, and raise `HTTPException`.
- A `yield` dependency provides setup and cleanup:

```python
def get_client(request: Request) -> Iterator[httpx.Client]:
    client = httpx.Client(base_url=request.app.state.base_url, timeout=10.0)
    try:
        yield client
    finally:
        client.close()

ClientDep = Annotated[httpx.Client, Depends(get_client)]
```

Code after `yield` runs after the response is sent, and runs even when the handler raises. This is the place for closing connections and releasing locks.

- Prefer a single long-lived client created at application startup, stored on `app.state`, and yielded per request without creating a new one:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.client = httpx.Client(base_url=settings.base_url, timeout=10.0)
    yield
    app.state.client.close()

app = FastAPI(lifespan=lifespan)

def get_client(request: Request) -> httpx.Client:
    return request.app.state.client
```

The `async`/`asynccontextmanager` syntax is Chapter 6 material; treat it as the standard startup template for now. The dependency is what handlers and tests interact with.

- Dependency overrides are the testing seam:

```python
app.dependency_overrides[get_settings] = lambda: test_settings
app.dependency_overrides[get_client] = lambda: fake_client
```

Clear overrides after each test to avoid leakage.

- Dependencies can be applied at router or app level: `APIRouter(dependencies=[Depends(verify_token)])`, `FastAPI(dependencies=[...])`. Use this for cross-cutting auth, not for business logic.
- Class-based dependencies (an object with `__call__`) are useful when a dependency needs state; a closure or plain function is usually simpler.
- Keep configuration out of route bodies: inject settings, clients, and services. Route handlers should read like a short orchestration script.

---

## 5.8 Calling external services

Keep HTTP calls in a service/client layer, not inside route bodies. The layer should be testable without FastAPI and should not raise `HTTPException`.

```python
import httpx

class WeatherService:
    def __init__(self, client: httpx.Client):
        self._client = client

    def current(self, city: str) -> dict[str, object]:
        try:
            response = self._client.get("/weather", params={"city": city})
            response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise UpstreamTimeout(f"weather timeout for {city}") from exc
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code >= 500:
                raise UpstreamError(f"weather status {exc.response.status_code}") from exc
            raise UpstreamBadRequest(f"weather rejected city {city}") from exc
        except httpx.RequestError as exc:
            raise UpstreamError("weather connection failed") from exc

        try:
            return response.json()
        except ValueError as exc:
            raise UpstreamError("weather returned invalid JSON") from exc
```

```python
@app.get("/weather/{city}")
def weather(city: str, settings: SettingsDep, client: ClientDep) -> dict[str, object]:
    service = WeatherService(client)
    return service.current(city)
```

- Registration of the service as a dependency is optional; constructing it per request with shared collaborators is cheap.
- Map upstream failures to meaningful local statuses: timeout → `504`, upstream 5xx/invalid body → `502`, upstream 4xx caused by caller input → `400` or `404` depending on meaning. Do not blindly pass a `500` through.
- Always set timeouts. Retry only transient failures (timeouts, connection errors, 429, 5xx) with a small bound; never retry 4xx. The route-level outcome after exhausting retries is typically `503` or `504`.
- Never forward upstream error bodies or headers to clients; they may contain internal details or secrets. Log a sanitized summary.
- Reuse the client (Chapter 3). Creating one per request loses connection pooling.
- Bound response sizes if you parse arbitrary upstream JSON; do not assume the shape. Validate with a Pydantic model when the response feeds business logic.
- Idempotency: retrying a `POST` can duplicate effects. Prefer `PUT`/`DELETE` when designing retryable endpoints, or require an idempotency key (advanced; Chapter 8).

---

## 5.9 Structuring the application

A scalable layout:

```text
app/
├── main.py            # FastAPI(), lifespan, include_router, exception handlers
├── config.py          # Settings + load_settings (Chapter 3)
├── dependencies.py    # get_settings, get_client, auth dependencies
├── schemas.py         # Pydantic request/response models
├── services.py        # business logic + upstream calls; no FastAPI imports
└── routers/
    ├── __init__.py
    ├── items.py
    └── weather.py
```

Principles:

- Route handlers parse/validate, call services, and translate results or domain exceptions into HTTP responses. No database or HTTP client code inline.
- `services.py` contains the logic you can unit test without starting the app. It raises domain exceptions, not `HTTPException`.
- `schemas.py` defines input and output models; keep secrets out of output models.
- `dependencies.py` wires configuration and clients; this is the seam for test overrides.
- `main.py` assembles routers, lifespan, and handlers. Keep it boring.
- Do not let Pydantic models leak into domain logic as mutable state holders; converting to dataclasses/domain objects is optional but useful as complexity grows.
- One router per resource, with `prefix` and `tags`; avoid a 500-line `main.py`.

---

## 5.10 Testing the API

`TestClient` (built on `httpx`) calls the app in-process, with no network and no server process:

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_missing_item():
    response = client.get("/items/999")
    assert response.status_code == 404
    assert response.json() == {"detail": "Item not found"}
```

Testing validation failures:

```python
def test_invalid_user_id():
    response = client.get("/users/abc")
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail[0]["loc"] == ["path", "user_id"]
    assert detail[0]["type"] == "int_parsing"

def test_body_validation():
    response = client.post("/items", json={"name": "", "price_cents": -5})
    assert response.status_code == 422
    locations = {tuple(err["loc"]) for err in response.json()["detail"]}
    assert ("body", "name") in locations
    assert ("body", "price_cents") in locations
```

Rules and tools:

- Use fixtures (Chapter 4) to build a `TestClient` and to install/clear `app.dependency_overrides` around each test.
- Override dependencies instead of patching internals: `app.dependency_overrides[get_client] = lambda: fake_client`. A `yield` fixture clears the dict afterward.
- Test the full contract: status code, response body shape, required headers, and absence of sensitive fields.
- Test error paths: missing resource, invalid path/query/body, conflict, upstream failure, timeout, malformed upstream JSON.
- Use a real `httpx.MockTransport` at the service layer to simulate upstream behavior without network (Chapters 3–4).
- For unhandled exceptions, `TestClient(app, raise_server_exceptions=False)` lets you assert `500`.
- Test services directly (plain unit tests) for mapping logic, and routes for wiring. Do not duplicate every service test at the HTTP layer.
- The OpenAPI schema is testable: `client.get("/openapi.json")` should be `200` and include expected paths and required fields.
- Async app tests via `httpx.AsyncClient(transport=ASGITransport(app=app))` arrive in Chapter 6; `TestClient` is sufficient for synchronous handlers.

---

## 5.11 Common mistakes and conventions

Mistakes to avoid:

1. Returning ORM objects or dicts with extra fields instead of response models (leaks secrets).
2. Missing `response_model`/return annotation, so output shape drifts silently.
3. Catching all exceptions and converting them to `500`, including `HTTPException`.
4. Exposing upstream error bodies, headers, stack traces, or tokens to clients.
5. Forgetting timeouts on external calls.
6. Creating an `httpx.Client` per request; not closing clients.
7. Putting business logic and HTTP calls directly in route functions.
8. Declaring `async def` handlers that call blocking I/O.
9. Using mutable defaults in Pydantic models instead of `default_factory`.
10. Relying on validation-error message text instead of `loc`/`type` in tests.
11. Tests that hit real APIs or depend on environment variables without overriding dependencies.
12. Letting dependency overrides leak across tests.
13. Retrying non-idempotent `POST` requests or retrying `4xx` errors.
14. Using `422` for business-rule failures that belong to `400`/`409`.
15. Adding `response_model` fields that include internal identifiers or secrets.

Conventions to adopt:

- Separate `ItemCreate` (input) from `Item` (output) models.
- `response_model` or return annotations on every route.
- `status_code=201` for creation, `204` for successful empty responses.
- Dependency injection for settings, clients, and auth; override them in tests.
- Domain exceptions in services, mapped to `HTTPException`/handlers at the boundary.
- One router per resource; thin handlers, tested services.
- `TestClient` fixtures plus `dependency_overrides`; `MockTransport` for upstream behavior.
- Structured logs with request IDs; no secrets, no raw upstream bodies.

---

# Exercises

Work each exercise before running code. Groups are ordered from recognition to implementation; within each group, difficulty increases. Do not look up answers — predict, run, reconcile, then rewrite from memory.

For the implementation groups, build a small books API with these resources:

```text
GET    /books                 list books, with filters and pagination
POST   /books                 create a book
GET    /books/{book_id}       read one book
PUT    /books/{book_id}       replace a book
PATCH  /books/{book_id}       partially update a book
DELETE /books/{book_id}       delete a book
GET    /authors/{author_id}   read an author
```

Use in-memory storage (a dict) unless an exercise says otherwise. Keep handlers thin and move validation-heavy or business rules into helpers so each exercise stays focused.

## Group A — HTTP fundamentals and status codes

**A1.** For a bookstore API, choose the method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) for each operation and justify the choice in one sentence:

1. Fetch a list of books by category.
2. Fetch a single book by its identifier.
3. Add a new book.
4. Replace a book with a complete new representation.
5. Change only a book's price.
6. Remove a book.
7. Upload a cover image for a book.
8. Trigger a re-index of the search catalogue.

**A2.** Copy this table and mark each method as safe (does not change server state) and/or idempotent (repeating the same request has the same effect as sending it once). Some boxes will be "no" in both.

| Method | Safe | Idempotent |
| --- | --- | --- |
| `GET` | | |
| `HEAD` | | |
| `POST` | | |
| `PUT` | | |
| `PATCH` | | |
| `DELETE` | | |

Then explain why a `POST` with an idempotency key can be retried safely even though `POST` itself is not idempotent.

**A3.** Choose the most specific status code for each scenario:

1. A book was created successfully.
2. A book was deleted and there is nothing to return.
3. A request body contains `price_cents: "abc"`.
4. A requested book does not exist.
5. A new book reuses an existing ISBN.
6. A request has no `Authorization` header.
7. A request has a valid token for a user who is not an administrator, but the route requires an administrator.
8. A client sends 200 requests in a minute and the limit is 60.
9. An upstream payment provider times out.
10. An upstream catalogue service returns malformed JSON.
11. The service cannot reach its database.
12. The code raises an unhandled `KeyError`.

**A4.** Explain when to use each of these codes and give one scenario each: `400`, `401`, `403`, `404`, `409`, `422`, `429`. For each pair, state the boundary: `400` versus `422`, `401` versus `403`, and `404` versus `409`.

**A5.** Use this mini-spec and predict the status code for each request. Write down the reason before running anything.

```text
GET    /books                     → 200 with a list
GET    /books/{book_id}           → 404 if absent
POST   /books                     → 201 on success; 422 if validation fails
DELETE /books/{book_id}           → 204 on success; 404 if absent
PUT    /books/{book_id}           → 200 on success
PATCH  /books/{book_id}           → 200 on success; extra fields rejected
Validation: limit has ge=1, le=100
Authentication: /admin/* needs a token; role must be "admin"
Business rules: duplicate ISBN → 409; price_cents below 100 → 400
```

Requests:

1. `GET /books/42` where book 42 exists.
2. `GET /books/999` where book 999 does not exist.
3. `POST /books` with a valid body.
4. `POST /books` with `{"title": "Dune"}` where `price_cents` is required.
5. `DELETE /books/42` where book 42 exists.
6. `DELETE /books/42` repeated immediately after request 5.
7. `GET /books?limit=0`.
8. `PUT /books/42` with a complete valid body.
9. `PATCH /books/42` with `{"titel": "Dune"}`.
10. `POST /books` with an ISBN that already exists.
11. `GET /admin/books` with no token.
12. `GET /admin/books` with a valid non-admin token.
13. `POST /books` with a valid body but `price_cents: 50`.

**A6.** A `204 No Content` response is returned from `DELETE /books/42`. Answer:

1. Can the response carry a JSON body? Why or why not?
2. What should `Content-Length` be, if present at all?
3. What does a client's `response.json()` usually do when called on this response?
4. Which assertion would you write in a test to check that no body was returned?
5. Why is `200` with `{"deleted": true}` a worse fit for this endpoint?

**A7.** Classify each header as request-only, response-only, or both when used in normal API traffic: `Content-Type`, `Accept`, `Authorization`, `X-Request-ID`, `Location`, `User-Agent`. For request-only headers, state who typically sets them; for response-only headers, state what the client should do with them.

**A8.** For the URL `https://api.example.com:8443/books?q=sci-fi%20%26%20fantasy&sort=-price#reviews`, identify the scheme, host, port, path, query string, and fragment. Then answer:

1. Which part is not sent to the server by a browser?
2. Why should a space in a query value be percent-encoded, and what is the difference between `+` and `%20` in a query string?
3. Rewrite the query string so `q` has the value `sci-fi & fantasy` and `sort` has the value `-price`, using explicit encoding.
4. Why is building query strings by string concatenation risky when values come from users?

**A9.** Design resource paths for an API with authors, books, and reviews. Books belong to authors, and reviews belong to books. Provide paths for listing, creating, reading, updating, and deleting each resource. Keep nesting to at most two levels and explain where you would expose a top-level `/books` route as well.

**A10.** For each parameter, decide whether it belongs in the path or the query string, and why:

1. The identifier of the book being fetched.
2. A free-text search phrase.
3. A page number and page size.
4. A sort field and direction.
5. A date range filter.
6. A slug used to identify an author profile.
7. A flag to include out-of-print books.
8. A list of category filters.

**A11.** Two clients create books. Client A sends `POST /books`; client B sends `PUT /books/42` with a client-generated identifier. A network timeout occurs and each client retries once.

1. Which request can create a duplicate if the server does not protect against it?
2. Which request is naturally idempotent, and why?
3. How would an idempotency key change the answer for `POST`?
4. Should a retry be attempted for a `422` response? For a `503`? For a `429`? Explain.

**A12.** For each scenario, choose `401` or `403` and explain the distinction:

1. No `Authorization` header is present.
2. The token is expired.
3. The token is valid, but the user's account is suspended.
4. The token is valid, but a regular user calls an admin-only endpoint.
5. The API key is present but unknown.
6. The token is valid and the user may read the resource, but may not delete it.

**A13.** For each case, choose among `400`, `409`, and `422`, then justify:

1. A JSON body is syntactically valid but `price_cents` is a string.
2. A required field is missing.
3. A book's ISBN duplicates an existing book.
4. A request asks to check out a book that is already checked out.
5. A business rule rejects a discount above 50 percent, but the schema has no upper bound.
6. A client sends an unknown field while the model uses `extra="forbid"`.
7. A request would move an order from `shipped` back to `pending`, which the state machine forbids.

**A14.** Your API calls an upstream inventory service. For each upstream failure, choose the status your API should return and explain why it is not simply `500`:

1. The connection is refused.
2. The request times out after 5 seconds.
3. The upstream returns `200` with an HTML error page instead of JSON.
4. The upstream returns `429 Too Many Requests` with `Retry-After`.
5. The upstream returns `404` for a product that your database says exists.

**A15.** Each exchange has at least one problem. Identify it and describe the consequence:

```text
1. GET /books/42 HTTP/1.1
   Content-Type: application/json

   {"include": "reviews"}
```

```text
2. HTTP/1.1 200 OK
   Content-Type: application/json

   {"error": "book not found"}
```

```text
3. HTTP/1.1 204 No Content
   Content-Type: application/json

   {"deleted": true}
```

```text
4. POST /books HTTP/1.1
   Accept: application/json

   title=Dune&price_cents=1999
```

```text
5. HTTP/1.1 201 Created
   Content-Type: application/json

   {"id": 42, "title": "Dune", "price_cents": 1999, "internal_cost_cents": 1200}
```

**A16.** Critique this fictional API contract. List every design problem and propose a corrected status code or convention:

```text
GET    /getBooks              → 200 always, body {"ok": false, "error": "..."} on failure
POST   /createBook            → 200 always
GET    /deleteBook/{id}       → 200 with the deleted book
POST   /books/{id}            → updates a book
GET    /books?limit=0         → 200 with an empty list
POST   /books (duplicate)     → 500
GET    /books/{id} (absent)   → 200 with {"error": "not found"}
```

---

## Group B — FastAPI basics and routing

**B1.** You created `app/main.py` containing `app = FastAPI()`. Answer:

1. What does `uvicorn app.main:app --reload` mean, part by part?
2. What does `fastapi dev app/main.py` add on top of plain `uvicorn`?
3. When would you use `--host 0.0.0.0`?
4. Why is `--reload` unsuitable for production?
5. What happens if the module path is wrong, and what does the traceback usually say?

**B2.** Write a minimal application with:

- `GET /health` returning `{"status": "ok"}`
- `GET /version` returning the string `"0.1.0"`

Then list three URLs you would open after starting the server, and state what each shows.

**B3.** For each handler, predict the response body bytes and the `Content-Type`:

```python
@app.get("/a")
def a() -> dict[str, int]:
    return {"x": 1}

@app.get("/b")
def b() -> list[dict[str, int]]:
    return [{"x": 1}, {"x": 2}]

@app.get("/c")
def c() -> str:
    return "hello"

@app.get("/d")
def d():
    return None
```

Then explain how `response_class=PlainTextResponse` changes `/c` and why `None` is a poor return value without a declared status code.

**B4.** Given this declaration order, predict the result of `GET /users/me` and `GET /users/42`:

```python
@app.get("/users/{user_id}")
def get_user(user_id: int) -> dict[str, int]:
    return {"user_id": user_id}

@app.get("/users/me")
def get_me() -> dict[str, str]:
    return {"user": "me"}
```

Then fix the order and explain the general rule for static and dynamic path segments.

**B5.** For each request against an API that defines only `GET /books` and `DELETE /books/{book_id}`, state `200`, `404`, `405`, or `422`:

1. `GET /books/1`
2. `POST /books`
3. `DELETE /books/1`
4. `DELETE /books/abc`
5. `GET /nope`

**B6.** Define one path `/books/{book_id}` that supports `GET`, `PUT`, and `DELETE` in the same application, using one handler per method. Then answer:

1. How would you declare the same path with `app.api_route`?
2. What happens when a client sends `PATCH` to that path?
3. Why is it usually better to declare separate typed handlers than one handler that inspects `request.method`?

**B7.** Create an `APIRouter` for books:

```python
router = APIRouter(prefix="/books", tags=["books"])
```

Add `GET ""`, `GET "/{book_id}"`, and `POST ""`. Then:

1. What full paths do the three routes produce?
2. What changes if each path starts with `/`?
3. How do you register the router on the app?
4. What do `tags` affect, and what do they not affect?

**B8.** You register the same router twice:

```python
app.include_router(router)
app.include_router(router, prefix="/v2")
```

Answer:

1. What paths exist after both calls?
2. What happens if both registrations resolve to the same final path?
3. Where do the duplicates appear in `/openapi.json`?
4. How would you version the API without duplicating handler code?

**B9.** An endpoint declares `book_id: int` in the path. Predict the status code and the `detail[0].loc` value for each request:

1. `GET /books/42`
2. `GET /books/42/`
3. `GET /books/abc`
4. `GET /books/4.2`
5. `GET /books/-1`

Explain which of these are routing problems and which are validation problems.

**B10.** Add status codes to these routes using the decorator, not by mutating the response:

1. `POST /books` returns `201`.
2. `DELETE /books/{book_id}` returns `204` with no body.
3. `POST /books/{book_id}/publish` returns `202` because publication is queued.

Then predict what happens if the create handler still returns a `Book` model while the status is `204`.

**B11.** Refactor these literals to use `fastapi.status` constants and explain one benefit:

```python
@app.post("/books", status_code=201)
def create_book(...): ...

@app.delete("/books/{book_id}", status_code=204)
def delete_book(...): ...

raise HTTPException(status_code=404, detail="not found")
```

**B12.** Add application metadata: title, version, description, and a contact or license if your version supports it. Then answer:

1. Where does the title appear?
2. Where does the version appear?
3. Does the description support Markdown in `/docs`?
4. Why is a correct version string useful even for an internal service?

**B13.** Open `/openapi.json` for an app with typed routes and Pydantic models. Answer:

1. Where are the paths listed?
2. Where are reusable schemas defined?
3. What does FastAPI generate for a route with `response_model=Book`?
4. What happens to the schema when a parameter is typed `int` versus `str`?
5. Why is the OpenAPI document a contract, and what can break when it changes?

**B14.** For each handler, choose `def` or `async def` and explain:

1. A handler that reads a file with `path.read_text()`.
2. A handler that awaits `httpx.AsyncClient.get()`.
3. A handler that performs a CPU-heavy image resize.
4. A handler that calls a synchronous database driver.
5. A handler that only builds a dict in memory.

Then explain why calling `requests.get()` inside an `async def` handler is harmful.

**B15.** Diagnose each startup failure and state the first thing you would check:

1. `Error loading ASGI app. Could not import module "app.main".`
2. `Address already in use`.
3. `ImportError: cannot import name 'router' from 'app.routers.items'`.
4. `TypeError: FastAPI.__init__() got an unexpected keyword argument ...`.
5. The server starts, but every request returns `404`.

**B16.** An `APIRouter` has `prefix="/books"` and a route declared as `@router.get("")`. A client requests `GET /books/`. Answer:

1. What status does the client receive by default?
2. Where does the redirect point?
3. Which HTTP method does the redirect use, and why does that matter for `POST`?
4. How would you disable slash redirects, and why is that rarely a good idea?

**B17.** Build two routers, `books` and `authors`, each with a prefix and tags. Include both in the app and answer:

1. How are operations grouped in `/docs`?
2. What happens if both routers use the same tag?
3. Can a route have more than one tag?
4. Why should tags be stable across releases?

**B18.** Implement `/health` and `/ready`:

- `/health` returns `200` whenever the process can serve requests.
- `/ready` returns `200` only when the database ping succeeds; otherwise `503`.

Explain the difference for a load balancer and for a container orchestrator, and state which endpoint should trigger a restart.

---

## Group C — Path and query parameters

**C1.** Declare `GET /books/{book_id}` with `book_id: int` and return `{"book_id": book_id}`. Then write the three request URLs a client would use to fetch books 1, 42, and 100, and predict each response body.

**C2.** For an unconstrained `book_id: int`, predict the status and body for `GET /books/42`, `GET /books/042`, `GET /books/4.2`, and `GET /books/forty-two`. Explain which conversion is accepted by Pydantic's lax mode.

**C3.** Change the path parameter to `Annotated[int, Path(ge=1)]`. Predict the status and `loc` for `/books/0`, `/books/1`, and `/books/-5`. Then add an upper bound of `9999` and state which boundary values you would test.

**C4.** Declare `GET /authors/{author_id}/books/{book_id}` with both parameters typed as `int` and required. Answer:

1. What is the function signature?
2. Which URL fetches author 7 and book 12?
3. What happens if the client supplies only one of the two?
4. What happens if the client swaps the order in the URL?

**C5.** Define an enum for a book format with values `hardcover`, `paperback`, and `ebook`. Use it as a path parameter at `GET /formats/{format}`. Predict the status for `/formats/ebook` and `/formats/audiobook`. Then explain how the enum appears in `/docs`.

**C6.** Declare `GET /books` with `q: str | None = None`. Answer:

1. What is the value of `q` for `GET /books`?
2. What is the value for `GET /books?q=dune`?
3. What is the value for `GET /books?q=`?
4. Why are the last two different, and which one is more likely a client bug?
5. How would you treat an empty `q` as absent without changing the URL contract?

**C7.** Declare `GET /books` with a required `q: str` and a required `limit: int`. Request `GET /books?limit=10` with no `q`. Predict the status, the `loc` of the first error, and whether FastAPI validates all missing parameters or stops at the first.

Then rewrite `limit` as optional with a default of `20` and re-answer for `GET /books?q=dune`.

**C8.** A query parameter is declared as `active: bool = True`. Predict `200` or `422` and the parsed value for:

```text
?active=true
?active=True
?active=1
?active=0
?active=yes
?active=no
?active=maybe
?active=
```

Then explain why passing `?active=anything` and treating non-empty strings as truthy is a bad API design.

**C9.** A route declares `tags: Annotated[list[str], Query()] = []`. Predict the parsed value for:

```text
GET /search
GET /search?tags=fantasy
GET /search?tags=fantasy&tags=sci-fi
GET /search?tags=fantasy,sci-fi
GET /search?tags=
```

Then change the route to accept a comma-separated list deliberately. Which approach is clearer for clients, and why?

**C10.** A route uses `page_size: Annotated[int, Query(alias="page-size", ge=1, le=100)] = 20`. Answer:

1. Which query string sets the value to 50?
2. What happens with `?page_size=50`?
3. Why does the Python parameter keep a valid identifier while the API exposes a hyphen?
4. What does `/openapi.json` show as the parameter name?

**C11.** A route declares `limit: Annotated[int, Query(ge=1, le=100)] = 20`. Predict the status for `?limit=1`, `?limit=100`, `?limit=0`, `?limit=101`, `?limit=1.0`, and `?limit=true`. Which values are constrained by the schema and which fail type conversion?

**C12.** A route declares `q: Annotated[str, Query(min_length=3, max_length=50)]`. Predict the status for:

```text
?q=ab
?q=abc
?q=%20%20%20
?q=  dune
```

What does min_length measure: raw bytes, Unicode code points, or trimmed text? Then write a validator or query constraint that trims surrounding whitespace before checking the length.

**C13.** A route needs the caller's request ID:

```python
@app.get("/books")
def list_books(x_request_id: Annotated[str | None, Header()] = None) -> dict[str, str | None]:
    return {"request_id": x_request_id}
```

Answer:

1. Which request header populates `x_request_id`?
2. Write a request that sends `X-Request-ID: abc-123`.
3. What does `convert_underscores=False` change?
4. Why should the request ID be optional here, and why should it be echoed in the response?
5. Where would you store it for logging across the whole request?

**C14.** Design pagination for `GET /books` with `limit` and `offset`. Set `limit` default `20`, range `1..100`, and `offset` default `0`, minimum `0`. Then answer:

1. Which request fetches the first page of 20?
2. Which request fetches the third page of 20?
3. Why is offset pagination unstable when rows are inserted or deleted during browsing?
4. What alternative would you propose for a large, changing dataset?

**C15.** Add a `since: datetime | None = None` query parameter and a `book_id: UUID` path parameter. Predict the status for:

```text
GET /books/550e8400-e29b-41d4-a716-446655440000
GET /books/not-a-uuid
GET /books?since=2024-01-01
GET /books?since=2024-01-01T00:00:00Z
GET /books?since=yesterday
```

Then explain how timezone-aware and naive datetimes should be handled in an API contract.

**C16.** This route uses a path template name that does not match the function parameter:

```python
@app.get("/books/{book_id}")
def get_book(id: int) -> dict[str, int]:
    return {"id": id}
```

Predict how FastAPI interprets `id` and what happens to the `{book_id}` placeholder. Then request `/books/42` and `/books/42?id=7`, run the app, and reconcile your prediction with reality. Finally, state the naming rule you will follow to avoid this class of bug.

**C17.** Add a `sort` query parameter that only accepts `title`, `price`, or `published_at`, and a `direction` parameter that only accepts `asc` or `desc`. Write the type declarations. Then predict the status for `?sort=author`, `?direction=up`, and `?sort=title&direction=desc`.

**C18.** A route ignores unknown query parameters by default. Answer:

1. What happens for `GET /books?limt=10` when the route declares only `limit`?
2. Why can silent ignoring hide client bugs?
3. What are two ways to reject unknown parameters, and what is the trade-off?
4. Should an API reject unknown query parameters on a public, versioned endpoint? Why or why not?

**C19.** Rewrite each declaration using `Annotated` and explicit metadata without changing behavior:

```python
@app.get("/books")
def list_books(q: str = Query(None, min_length=1), limit: int = Query(20, ge=1, le=100)): ...

@app.get("/books/{book_id}")
def get_book(book_id: int = Path(..., ge=1)): ...
```

Then explain why `q: str = Query(None)` is inconsistent and what the corrected type should be.

**C20.** Design the full signature for a search endpoint:

```text
GET /books?q=...&tags=...&tags=...&sort=title|price|published_at&direction=asc|desc&limit=...&offset=...
```

Requirements: `q` optional but at least two characters when present; `tags` repeatable; `sort` and `direction` restricted to enum values; `limit` 1–100 with default 20; `offset` at least 0 with default 0. Write the parameter declarations and the types you would use. Then list the requests you would use to test the boundaries.

---

## Group D — Pydantic models and validation

**D1.** Define a `BookCreate` model with `title: str`, `price_cents: int`, `tags: list[str]`, and `published: bool = False`. Answer:

1. Which fields are required?
2. What happens when `tags` is omitted?
3. Why is `tags: list[str] = []` dangerous, and what should replace it?
4. Instantiate the model with only the required fields and print `model_dump()`.

**D2.** Predict the result of each construction. State whether it raises, and if so which field appears in the error:

```python
class Book(BaseModel):
    title: str
    price_cents: int
    pages: int | None = None

Book(title="Dune", price_cents="1999")
Book(title=123, price_cents=1999)
Book(title="Dune", price_cents=19.99)
Book(title="Dune", price_cents=1999, pages="412")
Book(title="Dune", price_cents=1999, extra="ignored")
```

Then explain Pydantic's default coercion policy for `str`, `int`, and `float`, and when `strict=True` is appropriate.

**D3.** Explain the difference between these three declarations, including what is required at input time and what may be `None`:

```python
a: int
b: int | None
c: int | None = None
d: int = 0
```

Then define a `BookPatch` model where every field is optional and omitted fields are distinguishable from explicit `null`.

**D4.** This model has a mutable default:

```python
class Book(BaseModel):
    title: str
    tags: list[str] = []

one = Book(title="Dune")
one.tags.append("sci-fi")
two = Book(title="Emma")
```

Predict `two.tags`. Then fix the model with `Field(default_factory=list)` and explain why the fix works even though Pydantic v2 often copies defaults.

**D5.** Define an `Author` model with `name` and `country`, and a `Book` model that contains a nested `author: Author`. Answer:

1. Write a nested input payload.
2. What error `loc` do you expect for a bad author country type?
3. What error `loc` do you expect for a missing author name?
4. Does `Book.model_dump()` produce nested dicts?
5. How do you serialize the whole object to a JSON string?

**D6.** A model contains `items: list[BookCreate]`. A request body has 3 items and item at index 1 has `price_cents: -5` with `Field(gt=0)`. Predict:

1. The status code.
2. The `loc` of the error.
3. Whether the other two items are reported as valid.
4. Why the entire body is rejected even though only one element failed.

**D7.** For each field, choose constraints and state which boundary values you would test:

1. `title` non-empty, at most 200 characters.
2. `price_cents` positive and a multiple of 1.
3. `stock` between 0 and 10,000 inclusive.
4. `isbn` exactly 13 digits.
5. `rating` between 0.0 and 5.0.

Then explain the difference between `gt` and `ge` and between `min_length` and `minimum` for a numeric field.

**D8.** A SKU field is declared with `Field(pattern=r"^[A-Z0-9-]{3,20}$")`. Predict pass or fail for `ABC`, `abc`, `AB`, `A1-B2`, `A1_B2`, `A1-B2-C3-D4-E5-F6-G7`, and `A1-B2-C3-D4-E5-F`. Then explain why a pattern constraint is not a substitute for business validation.

**D9.** Write a `field_validator` that normalizes an ISBN by removing hyphens and spaces, then verifies that the result is 13 digits. Answer:

1. Which mode (`before` or `after`) should perform the normalization?
2. What decorator and classmethod signature does Pydantic v2 require?
3. What exception should the validator raise on invalid input?
4. How does FastAPI surface that failure to the client?

**D10.** Write a `model_validator(mode="after")` for a `Window` model that ensures `start < end`. Answer:

1. What does the validator return?
2. What is the error `loc` when the rule fails in a request body?
3. Why is this rule better expressed on the model than in the route handler?
4. Which input pairs would you test: equal values, reversed values, and a valid pair?

**D11.** Write a `model_validator(mode="before")` that accepts either a dict with `title` or a dict with `name` and normalizes it to `title`. Answer:

1. What type does the method receive, and what may it return?
2. Why must the validator handle non-dict input defensively?
3. What error occurs if both keys are missing, and where is it reported?
4. Which mode is the right choice for transforming input shape rather than validating relationships?

**D12.** A model sets `model_config = ConfigDict(extra="forbid")`. Predict the status and error type for a request body with a misspelled field `titel`. Then answer:

1. Why is this a good default for write endpoints?
2. What breaks for clients that send extra analytics fields?
3. How does the error `loc` differ from a missing required field?

**D13.** Pydantic ignores unknown fields by default. Predict what happens when a client sends `{"title": "Dune", "price_cents": 1999, "prcie_cents": 2500}` to a model with `extra="ignore"`. Then explain:

1. Why the typo is dangerous even though validation succeeds.
2. Whether the response should echo unknown fields.
3. Which configuration you would choose for an internal service and why.

**D14.** A model uses `ConfigDict(frozen=True)`. Answer:

1. What happens when code assigns `book.title = "Emma"`?
2. Are nested models frozen too?
3. How do you create a modified copy instead of mutating?
4. Why is immutability useful for configuration and cached data?

**D15.** A model has `price_cents: int = Field(alias="priceCents")`. Answer:

1. Can it be constructed with `priceCents=1999`?
2. Can it be constructed with `price_cents=1999` by default?
3. What does `ConfigDict(populate_by_name=True)` change?
4. How do you serialize using aliases?
5. Why can aliasing be useful when an upstream API uses camelCase?

**D16.** A model has `created_at: datetime`, `book_id: UUID`, and `price: Decimal`. Compare:

```python
book.model_dump()
book.model_dump(mode="json")
book.model_dump_json()
```

Answer which call produces Python objects, which produces JSON-compatible primitives, and which produces a string. Then state the JSON representation of a `Decimal` in Pydantic v2 JSON mode.

**D17.** Answer:

1. What is the difference between `Book.model_validate(data)` and `Book(**data)`?
2. What does `Book.model_validate_json(text)` accept: `str`, `bytes`, or both?
3. What happens if the JSON text is valid but the schema does not match?
4. When would you prefer `model_validate_json` over parsing with `json.loads` first?

**D18.** A model has `price_cents: int = Field(gt=0)`. This code bypasses validation:

```python
book = Book(title="Dune", price_cents=1999)
cheap = book.model_copy(update={"price_cents": -5})
```

Answer:

1. What is `cheap.price_cents`?
2. Why did validation not run?
3. Which method would run validation on the update?
4. Why is this a footgun in a PATCH handler?

**D19.** Add a `computed_field` named `price_dollars` that returns `price_cents / 100`. Answer:

1. What decorators are required in Pydantic v2?
2. Does the field appear in `model_dump()`, `model_dump_json()`, and the OpenAPI schema?
3. Can a client send `price_dollars` in a request body?
4. Should a computed field contain expensive logic? Why or why not?

**D20.** You have ORM objects with attributes, not dicts. Answer:

1. Which `ConfigDict` option lets `Model.model_validate(orm_object)` read attributes?
2. What happens without that option?
3. What is the security or performance risk of exposing ORM objects directly as response models?
4. Why do input models not need `from_attributes`?

**D21.** Catch a `ValidationError` from this model and print each error's `loc`, `type`, `msg`, and `input`:

```python
class Book(BaseModel):
    title: str = Field(min_length=1)
    price_cents: int = Field(gt=0)

try:
    Book.model_validate({"title": "", "price_cents": -5})
except ValidationError as exc:
    ...
```

Answer:

1. How many errors are reported?
2. What does each `loc` contain?
3. Why should tests avoid asserting the exact `msg` text?
4. Which fields of the error are stable enough to assert?

**D22.** Define a discriminated union:

```python
class CardPayment(BaseModel):
    kind: Literal["card"]
    last4: str

class BankPayment(BaseModel):
    kind: Literal["bank"]
    iban: str

Payment = Annotated[CardPayment | BankPayment, Field(discriminator="kind")]
```

Answer:

1. What happens for `{"kind": "card", "last4": "4242"}`?
2. What happens for `{"kind": "cash", "amount": 10}`?
3. What error type and `loc` do you expect?
4. Why is a discriminated union better than a plain union here, for both validation and documentation?

**D23.** Design input, update, and output models for a book:

- `BookCreate`: all writable fields required or defaulted.
- `BookUpdate`: all fields optional for PATCH.
- `BookRead`: includes `id`, `created_at`, and computed values.

Answer:

1. Which fields belong in each model, and why?
2. Why should the output model not inherit from the input model by default?
3. How do you avoid duplicating shared field definitions?
4. Where would a `password_hash`-style internal field leak if you reused the ORM model directly?

**D24.** A PATCH handler receives a `BookUpdate` model and must apply only fields the client actually sent. Answer:

1. How do you obtain only the set fields?
2. How do you distinguish "field omitted" from "field explicitly set to `null`"?
3. What does `model_dump(exclude_unset=True)` do?
4. What does `model_fields_set` contain?
5. Why is `model_dump()` without `exclude_unset` dangerous in a PATCH handler?

---

## Group E — Request bodies, responses, and serialization

**E1.** Implement `POST /books` with a `BookCreate` body model and a `Book` response model. Answer:

1. What content type must the client send?
2. What is the expected JSON shape?
3. What status code should the route declare?
4. What happens if the body is valid JSON but missing a required field?

**E2.** A client sends `POST /books` with no body at all. Predict the status code and the shape of `detail`. Then compare that with sending `{}` and with sending `null`. Which of the three reaches your handler?

**E3.** A client sends a body with a trailing comma, producing invalid JSON. Predict the status and error `type`. Then explain why this is a parsing failure rather than a Pydantic model failure.

**E4.** Implement a route with two body models:

```python
@app.post("/orders")
def create_order(book: BookCreate, coupon: Coupon) -> Order: ...
```

Answer:

1. What JSON shape does FastAPI expect?
2. Where do the keys `book` and `coupon` come from?
3. What happens if the client sends a flat object with fields from both models?
4. When is this shape preferable to one combined model?

**E5.** Rewrite the route so a single model is embedded under the key `item`:

```python
@app.post("/orders")
def create_order(item: Annotated[BookCreate, Body(embed=True)]) -> Order: ...
```

Answer:

1. What JSON shape does the client send?
2. What changes in `/openapi.json`?
3. When would you choose embedding versus a flat body?
4. What happens if the client sends a flat body instead?

**E6.** Define a `BookDetail` response model containing a nested `Author` and a list of reviews. Answer:

1. What does the serialized JSON look like for one book?
2. How does FastAPI document nested schemas in `/docs`?
3. What happens if a review contains an undeclared field and `response_model=BookDetail` is used?
4. How would you model a recursive category tree without infinite serialization?

**E7.** A handler returns this dict while declaring `response_model=BookRead`:

```python
@app.get("/books/{book_id}", response_model=BookRead)
def get_book(book_id: int) -> dict:
    return {
        "id": book_id,
        "title": "Dune",
        "price_cents": 1999,
        "internal_cost_cents": 1200,
        "password_hash": "secret",
    }
```

Answer:

1. Which fields appear in the response?
2. Why is `response_model` a security boundary, not just documentation?
3. What happens if a required field of `BookRead` is missing from the dict?
4. What error does the client see, and what appears in your logs?

**E8.** Remove `response_model` but keep the return annotation `-> BookRead`. Answer:

1. Is the behavior the same as `response_model=BookRead`?
2. What if the annotation is `-> dict` but the handler returns a `Book` model?
3. What if there is no annotation at all and the handler returns a dict with extra keys?
4. Which style do you prefer for a codebase, and why?

**E9.** A list endpoint returns `list[BookRead]`. Answer:

1. What JSON shape is produced?
2. How do you document the response in `/openapi.json`?
3. What happens if one element fails response validation?
4. Should a list endpoint ever silently drop an invalid element? Explain.

**E10.** A create endpoint should return `201` and a `Location` header pointing to the new resource. Answer:

1. Which URL should `Location` contain?
2. How do you set the header with the injected `Response` object?
3. Why is `Location` useful to clients?
4. What should the response body contain, and how does it relate to the header?

**E11.** Implement `DELETE /books/{book_id}` returning `204` with no body. Answer:

1. What should the handler return?
2. What should the decorator declare for `status_code` and `response_model`?
3. What does `TestClient` report for `response.content`?
4. What goes wrong if the handler returns `{"deleted": true}`?
5. Why is returning the deleted object with `200` also defensible, and when would you choose it?

**E12.** A route needs to set a header and a status code dynamically:

```python
@app.post("/books")
def create_book(payload: BookCreate, response: Response) -> Book: ...
```

Answer:

1. How do you set `X-Request-ID`?
2. How do you set the status to `201`?
3. How do you set a cookie?
4. Why does using `Response` not bypass the response model?
5. When would you use `JSONResponse` instead?

**E13.** A handler returns `JSONResponse(content={"id": 1, "secret": "leak"})` while declaring `response_model=BookRead`. Answer:

1. Does `response_model` filtering apply?
2. What does this imply for security-sensitive responses?
3. When is bypassing the response model legitimate?
4. How would you keep the bypass explicit and reviewable in a codebase?

**E14.** A `BookRead` model has `subtitle: str | None = None` and `discount: int | None = None`. Compare the response for a book with both values `None` under default serialization and with `response_model_exclude_none=True`. Then answer:

1. Which is better for a mobile client with slow links?
2. Which is better when clients rely on stable keys?
3. Does `exclude_none` affect nested models recursively?
4. Why is a schema that changes shape based on values hard to consume?

**E15.** A response model has defaults for `published: bool = False` and `tags: list[str] = []`. The handler returns a model constructed without those fields. Compare:

1. Default serialization.
2. `response_model_exclude_unset=True`.
3. `response_model_exclude_defaults=True`.

Then explain the difference between "unset" and "default" and which option a PATCH response usually wants.

**E16.** A route declares `response_model=BookRead, response_model_include={"id", "title"}`. Answer:

1. Which fields appear?
2. What changes with `response_model_exclude={"price_cents"}`?
3. Can include and exclude be combined? What wins?
4. Why is this a brittle way to design different representations, and what should replace it at scale?

**E17.** A handler returns the string `"hello"` with no `response_class`. Answer:

1. What are the body bytes and `Content-Type`?
2. What changes with `response_class=PlainTextResponse`?
3. What changes with `response_class=HTMLResponse`?
4. Why does returning a raw `str` not automatically mean `text/plain`?

**E18.** A response model contains `created_at: datetime`, `book_id: UUID`, and `format: BookFormat` (an enum). Answer:

1. What do these fields look like in JSON?
2. Does the timezone survive serialization?
3. What happens to a naive datetime?
4. How would you enforce a canonical UTC representation on output?

**E19.** A response model contains `price: Decimal`. Compare the JSON produced by:

1. `response_model=BookRead` with a `Decimal` field.
2. `JSONResponse(content=jsonable_encoder(book))`.
3. Returning a plain float.

Then answer which representation avoids binary floating-point surprises, and why clients must know whether prices are strings or numbers.

**E20.** Implement a create-then-read round trip in tests:

1. `POST /books` with a valid body.
2. Read the `id` and `Location` from the response.
3. `GET` the returned URL.
4. Validate the response with the same `BookRead` model.

Answer what should be identical, what may legitimately differ (timestamps, computed fields), and why validating the response with a model is stronger than comparing raw dicts.

**E21.** A PATCH handler receives `BookUpdate` and currently does:

```python
updates = payload.model_dump()
book.update(updates)
```

A client sends `{"title": "Dune Messiah"}` to a book whose `price_cents` is 1999. Predict the bug. Then fix the handler using `exclude_unset=True` and explain how to support clearing a nullable field explicitly.

**E22.** Add a `field_serializer` that renders `price_cents` as a formatted string such as `"19.99"` in responses, while keeping the internal model as integer cents. Answer:

1. What decorator and signature does Pydantic v2 require?
2. Does the serializer affect request validation?
3. Does it affect `model_dump()` in Python mode?
4. Why should the serialized format be part of the API contract and documented?

## Group F — Error handling

**F1.** Implement `GET /books/{book_id}` so a missing book raises `HTTPException` with status `404` and the message `"Book not found"`. Answer:

1. What exact JSON body does the client receive?
2. What `Content-Type` is used?
3. What happens if you raise `HTTPException(status_code=404)` without `detail`?
4. Why should the handler not return `None` with a `404` status code instead?

**F2.** Compare these three `detail` values for a `404`:

```python
raise HTTPException(status_code=404, detail="Book not found")
raise HTTPException(status_code=404, detail={"code": "book_not_found", "book_id": 42})
raise HTTPException(status_code=404, detail=[{"field": "book_id", "error": "missing"}])
```

Answer:

1. What body does each produce?
2. Which shape is easiest for clients to handle programmatically?
3. Why does FastAPI wrap the value in `{"detail": ...}`?
4. When is a string detail acceptable?

**F3.** For each failure, choose the mechanism and status: a schema violation, a missing book, a duplicate ISBN, an invalid state transition, an upstream timeout, an upstream `500`, and an unexpected `KeyError`. Separate failures the framework should validate from those your code must detect.

**F4.** Design a domain exception taxonomy for a books service with at least `BookNotFound`, `DuplicateIsbn`, `InvalidState`, `UpstreamTimeout`, and `UpstreamError`. For each exception:

1. What data should it carry?
2. Which layer raises it?
3. Which HTTP status should the boundary map it to?
4. Why should the service layer not import `fastapi`?

**F5.** Implement exception handlers for `BookNotFound`, `DuplicateIsbn`, and `InvalidState`. Then answer:

1. Where do you register the handlers?
2. What must each handler return?
3. How does FastAPI choose between a handler for a parent and a child exception class?
4. What happens to an exception with no registered handler?

**F6.** This service is HTTP-aware. Refactor it so the service layer is testable without FastAPI:

```python
from fastapi import HTTPException

class BookService:
    def get(self, book_id: int) -> Book:
        book = self.repo.get(book_id)
        if book is None:
            raise HTTPException(status_code=404, detail="Book not found")
        return book
```

Then show how the route or a handler maps the new domain exception to `404`.

**F7.** Customize validation errors to use this envelope:

```json
{"error": {"code": "validation_error", "fields": [{"loc": ["body", "title"], "type": "string_too_short"}]}}
```

Answer:

1. Which exception class do you handle?
2. Which attributes of the exception expose the errors?
3. Why should you preserve `loc` and `type` rather than only `msg`?
4. What does this change break for clients that expected the default envelope?
5. How would you version or document the change?

**F8.** A handler raises `KeyError("isbn")`. Answer:

1. What status does the client receive in production?
2. What does `TestClient(app)` do by default when the app raises?
3. How do you construct a client that returns the `500` response instead?
4. What should the response body say, and what should only appear in logs?
5. Why is a custom `500` handler not a substitute for fixing the bug?

**F9.** Design and implement one consistent error envelope used by `HTTPException`, validation errors, domain exceptions, and unhandled exceptions. Answer:

1. Which fields are required, and which are optional?
2. Where does the request ID come from?
3. Why should the envelope not include a Python traceback?
4. How do clients distinguish retryable from non-retryable errors?
5. How do you test envelope consistency across all error paths?

**F10.** An upstream URL includes an API key in the query string, and an exception message includes the full URL. Answer:

1. Which parts of the error should be logged?
2. Which parts must be redacted?
3. Why is `logger.exception(exc)` risky without sanitizing?
4. What should the client receive instead?
5. How would you add a redaction helper and test it?

**F11.** Add the correct headers to each error response:

1. `401` for missing or invalid bearer credentials.
2. `429` with a retry delay.
3. `405` for a wrong method.
4. `409` when the client uses a stale version.
5. `503` when the service is overloaded.

For each, state whether FastAPI sets the header automatically or you must set it, and why the header helps clients.

**F12.** Register a custom handler for `HTTPException`. Answer:

1. Which attributes give you the status code, detail, and headers?
2. How do you return a response that preserves the status and headers?
3. Why can a badly written handler accidentally turn every `404` into a `200`?
4. Does the custom handler affect validation errors?
5. Should you customize `HTTPException` globally or use domain exceptions for most cases?

**F13.** An authentication dependency raises `HTTPException(401)`. Answer:

1. Is the route handler called?
2. Is the request body parsed and validated first?
3. What appears in the response body?
4. How do you make the dependency apply to every route in a router?
5. Why is raising from a dependency better than checking auth at the top of every handler?

**F14.** A service calls an inventory API and can raise `UpstreamTimeout`, `UpstreamError`, or `UpstreamBadRequest`. Answer:

1. Which status should each map to?
2. Which of these should be retried before returning a response?
3. Where should retries live: route, service, or HTTP client wrapper?
4. Why should the route not catch `httpx` exceptions directly?
5. What should the client see when retries are exhausted?

**F15.** A route declares `response_model=BookRead`, but the handler returns a dict missing `title`. Answer:

1. What status does the client receive?
2. Why is it not `422`, even though validation failed?
3. What appears in the server logs?
4. How would you test this behavior?
5. What does this tell you about testing response models?

**F16.** Critique this handler:

```python
@app.get("/books/{book_id}")
def get_book(book_id: int) -> BookRead:
    try:
        return service.get(book_id)
    except Exception:
        raise HTTPException(status_code=500, detail="error")
```

Answer:

1. Which important exception is swallowed?
2. What information is lost?
3. What status should a missing book produce?
4. How should unexpected exceptions be handled instead?
5. Why is `except Exception` sometimes acceptable at a boundary but not here?

**F17.** An API returns error messages that change with every release, for example `"Book 42 was not found in the catalogue"`. Answer:

1. Why is it risky for clients to assert this text?
2. What should clients assert instead?
3. Design a stable machine-readable error code list for the books API.
4. Where should the human-readable message live?
5. How do you keep codes stable while improving messages?

**F18.** Add a request ID to every response and to every error body. Answer:

1. Should the server trust a client-supplied request ID?
2. What should it do if the header is missing or malformed?
3. Where can the ID be stored so handlers and exception handlers can read it?
4. Why echo it in the response?
5. How do you avoid leaking the ID into unrelated logs or responses?

**F19.** A client updates a book with `If-Match: "v3"`, but the current version is `v5`. Answer:

1. Which status code is appropriate: `409`, `412`, or `428`?
2. What does `If-Match` protect against?
3. What should the response include so the client can recover?
4. How is this different from a duplicate ISBN conflict?
5. Why is optimistic concurrency often better than locking the row?

**F20.** A login endpoint returns `404 "email not registered"` for unknown emails and `401 "wrong password"` for known emails. Answer:

1. What information does this leak?
2. What should the endpoint return in both cases?
3. How does timing still leak information, and what can you do about it?
4. Why is this an error-handling concern rather than only a security concern?

---

## Group G — Dependencies and configuration

**G1.** Write a dependency `get_pagination` that returns a small object with `limit` and `offset`, both validated. Inject it into `GET /books` and `GET /authors`. Answer:

1. What does the dependency function look like?
2. How does the route declare it with `Annotated`?
3. Where do the query parameters appear in `/docs`?
4. What does the route receive if the client omits both parameters?
5. Why is this better than repeating the two parameters in every route?

**G2.** Add a second dependency that requires the `X-API-Version` header and validates that it is `1` or `2`. Answer:

1. How does the dependency read the header?
2. What status should an unsupported version produce?
3. How does a route depend on both `get_pagination` and the version dependency?
4. What happens if a dependency itself has parameters with defaults?
5. Can dependencies share sub-dependencies? Explain the caching implications.

**G3.** A dependency needs the `book_id` path parameter to check ownership. Answer:

1. Write the dependency signature.
2. How does FastAPI pass the path value to it?
3. Does the route need to declare `book_id` again?
4. What happens if the dependency raises `404` before the route runs?
5. Why is ownership checking a good fit for a dependency?

**G4.** Implement a class-based dependency:

```python
class RateLimiter:
    def __init__(self, limit: int) -> None:
        self.limit = limit

    def __call__(self, request: Request) -> None: ...
```

Answer:

1. How do you register it for a route?
2. Where does `limit` come from in a real app?
3. Why must the limiter not store per-request data on `self`?
4. When is a class clearer than a closure?
5. How would you override it in tests?

**G5.** Write a dependency with `yield` that acquires a lock or opens a temporary resource and releases it afterward. Answer:

1. What code runs before the route?
2. What code runs after the response?
3. Does cleanup run when the handler raises `HTTPException`?
4. Does cleanup run when the handler raises an unexpected error?
5. What happens if cleanup itself raises?
6. Why should cleanup not depend on the response being successfully sent?

**G6.** Write an auth dependency that reads `Authorization: Bearer <token>`, validates the token, and injects the current user. Answer:

1. What status and headers should a missing header produce?
2. What status should an invalid token produce?
3. What status should an expired token produce?
4. How does the route receive the user?
5. Why should token validation not happen inside each handler?
6. What information should never appear in the error response?

**G7.** A dependency increments a counter each time it is called. One route depends on it directly and indirectly through another dependency. With default settings, how many times does it run per request? Explain how FastAPI's per-request caching produces that answer, and describe what the counter looks like across two requests.

**G8.** Change the dependency to `Depends(dep, use_cache=False)` in both places. Answer:

1. How many times does it run now?
2. When would you deliberately disable caching?
3. What are the risks of disabling it for a database session?
4. How would you verify the count in a test?

**G9.** A settings loader reads environment variables and is wrapped in `@lru_cache`. Answer:

1. Why cache the result?
2. When is the cache populated?
3. Why can tests leak configuration between each other because of this cache?
4. How do you clear the cache in a test fixture?
5. Why is reading settings at import time worse than reading them through a dependency?

**G10.** Build a `Settings` model that validates `DATABASE_URL`, `UPSTREAM_BASE_URL`, and `TIMEOUT_SECONDS`. Answer:

1. Which field types and constraints do you use?
2. What should happen at startup if a required variable is missing?
3. Why is failing fast better than failing on the first request?
4. How do you provide safe defaults for local development?
5. How do you prevent secrets from appearing in logs or `/docs`?

**G11.** In a test, override `get_settings` and `get_client`. Answer:

1. What is the key in `app.dependency_overrides`?
2. What is the value?
3. Why must you remove the override afterward?
4. What happens if two tests use different overrides and cleanup is missing?
5. Write a fixture that installs the overrides and clears them even when the test fails.

**G12.** You override a `yield` dependency with a plain function. Answer:

1. Does the original dependency's setup code run?
2. Does the original dependency's cleanup code run?
3. Which dependency's value does the route receive?
4. Why does this matter for resources that must be closed?
5. How would you override with a fake that also needs cleanup?

**G13.** Apply an auth dependency at the router level. Answer:

1. Which routes are protected?
2. How do you leave `/health` unprotected?
3. What appears in `/docs` for protected routes?
4. Can a route add another dependency on top of the router-level one?
5. Why is router-level auth safer than remembering to add `Depends` to each route?

**G14.** Apply a dependency at the application level. Answer:

1. Which routes does it affect?
2. Where does it run relative to router-level dependencies?
3. How do you exempt the documentation routes if needed?
4. What happens if the dependency raises for every request?
5. When is app-level injection a good fit, and when is it too broad?

**G15.** A dependency writes a request ID into `request.state`. Answer:

1. Write the dependency.
2. How does a handler read it?
3. How does an exception handler read it?
4. How does `request.state` differ from a module-level global?
5. Why is a global variable unsafe under concurrent requests?

**G16.** Classify each object as safe to create once per process, once per request, or once per test: an immutable settings object, an `httpx.Client`, a database transaction, a request ID, a random fake used only in tests. Explain the lifetime and cleanup for each.

**G17.** This module reads configuration at import time:

```python
# app/config.py
DATABASE_URL = os.environ["DATABASE_URL"]
```

Answer:

1. What happens when the variable is missing during test collection?
2. Why is this hard to override in tests?
3. What is the fix?
4. Does the fix change the production startup behavior?
5. How would you test both a valid and an invalid configuration?

**G18.** Write a dependency `get_book_service` that constructs a `BookService` with the repository and HTTP client dependencies. Answer:

1. How do the nested dependencies resolve?
2. How do you override the service in a test?
3. Why is overriding the service sometimes worse than overriding its collaborators?
4. Which approach keeps tests closer to real wiring?
5. What does the route signature look like?

**G19.** Two dependencies depend on each other. Answer:

1. What error or behavior do you expect at startup?
2. Why is a circular dependency usually a design smell?
3. How would you break the cycle?
4. Which layer should own the shared logic?
5. How can you detect cycles before deploying?

**G20.** A configuration loader supports defaults, environment variables, and explicit overrides for tests. Answer:

1. What precedence order do you choose, and why?
2. How do you test each layer independently?
3. Why should production configuration not rely on defaults for secrets?
4. How do you document required variables?
5. What happens when an environment variable has the wrong type, and where should that error surface?

---

## Group H — Calling external services

**H1.** You need to call a third-party JSON API from a FastAPI service. Answer:

1. Why is `httpx` a natural choice in this chapter, and why is `requests` still acceptable inside a `def` handler?
2. Why must every call have a timeout, and what is the cost of an infinite timeout?
3. Why is creating a client per request inefficient?
4. What does `raise_for_status()` do, and what does it not do?
5. Why should the route not call `httpx` directly?

**H2.** Write a `BookCatalogueService` that takes an `httpx.Client` in its constructor and exposes `get_book(isbn: str) -> CatalogueBook`. Answer:

1. What does the constructor store?
2. What does the method return on success?
3. Where do you call `raise_for_status()`?
4. How would you test the service without starting FastAPI?
5. Why should the service not know about `HTTPException`?

**H3.** Compare these two calls:

```python
client.get(f"/search?q={query}&limit={limit}")
client.get("/search", params={"q": query, "limit": limit})
```

Answer:

1. Which one handles spaces, `&`, `?`, and non-ASCII correctly?
2. Which one is vulnerable to parameter injection?
3. How do you send a repeated parameter with `params`?
4. What does the resulting URL look like for query `"sci-fi & fantasy"`?
5. Why should you avoid manually concatenating URLs in a service?

**H4.** An upstream returns `404`, `400`, `429`, and `503`. Answer:

1. What does `raise_for_status()` raise for each?
2. Which of these should become a local `404`, `400`, `503`, or `502`?
3. Which should be retried?
4. How do you inspect the status without leaking the response body?
5. Why is passing through the upstream status blindly dangerous?

**H5.** Group these `httpx` exceptions by what they indicate and identify their parent classes: `HTTPStatusError`, `TimeoutException`, `ConnectError`, `RequestError`, `ReadTimeout`. Answer:

1. Which are subclasses of which, and which branch is not under `RequestError`?
2. Why does `except httpx.RequestError` catch too much if placed first?
3. Which exception should map to `504`, and which to `502` or `503`?
4. What about `httpx.InvalidURL`?
5. How do you preserve the original exception for debugging without exposing it?

**H6.** Build a retry policy table for these calls: `GET` timeout, `GET` `503`, `GET` `429`, `GET` `400`, `POST` timeout, `POST` `503` with an idempotency key. Answer:

1. Which calls are safe to retry?
2. How many attempts is reasonable?
3. What backoff and jitter would you use?
4. How do you honor `Retry-After`?
5. What is the final local status after retries are exhausted?

**H7.** Write an `httpx.MockTransport` handler that returns `{"isbn": "978...", "title": "Dune"}` for `GET /books/978...`. Answer:

1. How do you construct the `httpx.Client` with the transport?
2. How do you assert the request path and query?
3. How do you return a `404` instead?
4. How do you inspect the request headers inside the handler?
5. Why is `MockTransport` better than monkeypatching `httpx.Client.get`?

**H8.** Simulate each upstream behavior with `MockTransport`: a read timeout, a connection error, a response with invalid JSON, and a response with a huge body. Answer:

1. Which exception do you raise in the handler for a timeout?
2. Which exception for a connection failure?
3. How does the service distinguish invalid JSON from a valid JSON body with the wrong shape?
4. How do you cap the number of bytes read?
5. What local status should each case produce?

**H9.** An upstream returns `{"isbn": "123", "title": null, "price_cents": "free"}`. Answer:

1. Why should you validate this with a Pydantic model rather than indexing keys?
2. Which model configuration fits an upstream that adds fields frequently?
3. What should the service raise when validation fails?
4. Should the client receive the upstream validation errors? Why or why not?
5. How do you log enough to debug without logging the whole payload if it may contain personal data?

**H10.** An upstream can return a 500 MB JSON document. Answer:

1. Why is `response.json()` dangerous here?
2. How would you stream and enforce a byte limit?
3. What status should your API return when the limit is exceeded?
4. Why is a size limit part of reliability, not just performance?
5. What would you log?

**H11.** An upstream error response includes an internal hostname, a stack trace, and a session token. Answer:

1. What may your API forward to the client?
2. What may appear in logs?
3. What must be redacted from both?
4. Why is it safer to return a generic upstream error?
5. How do you keep a correlation ID so support can investigate?

**H12.** Implement a lifespan that creates one `httpx.Client`, stores it on `app.state`, closes it on shutdown, and exposes it through a dependency. Answer:

1. Why is `lifespan` better than creating the client at import time?
2. When exactly is the client closed?
3. What happens if the app fails during startup after creating the client?
4. How do tests replace the client?
5. Why should the dependency not call `client.close()` per request?

**H13.** Explain the cost of this code:

```python
@app.get("/books/{isbn}")
def get_book(isbn: str) -> dict:
    with httpx.Client(base_url="https://catalogue.internal", timeout=5.0) as client:
        return client.get(f"/books/{isbn}").json()
```

Answer:

1. What is paid on every request?
2. What happens under load?
3. How does connection pooling change the picture?
4. Why is the timeout still necessary even with a shared client?
5. What lifecycle should the client have?

**H14.** A client is created with `base_url="https://api.example.com/v1"`. Answer:

1. What URL results from `client.get("/books")`?
2. What URL results from `client.get("books")`?
3. Does `httpx` treat a leading slash as "discard the base path," or does it concatenate? Verify with a `MockTransport`, then compare with `requests` or `urllib.parse.urljoin`, where a leading slash does discard the base path.
4. How do you verify the final URL in a test?
5. Which style would you standardize in a codebase?

**H15.** Send a list of tags to an upstream API using `params={"tag": ["fantasy", "sci-fi"]}`. Answer:

1. What query string does `httpx` produce?
2. What if the upstream expects a comma-separated value instead?
3. How do you encode a value containing a comma or an ampersand?
4. Why should the service own this encoding rather than the route?
5. How do you test the exact query string with `MockTransport`?

**H16.** Implement retries with exponential backoff and jitter for a `GET` request. Answer:

1. What base delay and multiplier do you choose?
2. Why add jitter?
3. What is the maximum number of attempts and total time?
4. How do you honor `Retry-After` when it is present?
5. Why should the retry wrapper be independent of FastAPI?

**H17.** Explain the three states of a circuit breaker and how they help when an upstream is down. Answer:

1. What opens the circuit?
2. What happens to requests while it is open?
3. How does it close again?
4. What status does your API return while the circuit is open?
5. Why is a circuit breaker not a replacement for timeouts and retries?

**H18.** Design an idempotency mechanism for `POST /orders`. Answer:

1. Which header does the client send?
2. What do you store, keyed by that header?
3. What happens when the same key arrives concurrently twice?
4. How long do you keep the record?
5. What status do you return for a replay, and what body?
6. Why can two different request bodies with the same key not both succeed?

**H19.** An upstream returns `429` with `Retry-After: 30`. Answer:

1. Should your API return `429`, `503`, or wait and retry?
2. What header should your response include if you return `503`?
3. Why is it bad to return `200` with an empty result?
4. How does this differ for a user-facing read versus a background job?
5. What do you log at warning level?

**H20.** Write unit tests for the service using `MockTransport` for: success, `404`, timeout, invalid JSON, and an upstream `500`. Answer:

1. How do you assert which domain exception is raised?
2. How do you verify the request path, query, and headers?
3. Why are these tests faster and more reliable than calling the real API?
4. What do these tests not cover?
5. Which layer should test the mapping from domain exceptions to HTTP statuses?

**H21.** A route calls a service that raises `UpstreamTimeout`. Answer:

1. Which handler produces the response?
2. What status and body does the client see?
3. What is logged?
4. How do you test the full path with a fake client that times out?
5. Why should the route not contain a `try/except httpx.TimeoutException`?

**H22.** Choose timeouts for these operations: a fast internal lookup, a third-party search, a file upload, and a bulk export. Answer:

1. What connect, read, write, and pool timeouts would you set?
2. Why is one global timeout value usually wrong?
3. Where do timeout values live: code, settings, or both?
4. How do timeouts interact with retries and the client's total latency budget?
5. What would you monitor to tune them?

---

## Group I — Testing the API

**I1.** Write a `conftest.py` fixture that yields a `TestClient` for the app. Answer:

1. What scope should the fixture use, and why?
2. Why is `TestClient` preferred over starting `uvicorn` in tests?
3. What is the difference between `TestClient(app)` and `httpx.Client(base_url=...)`?
4. What happens to lifespan events when the client is used as a context manager?
5. How do you ensure the client is closed after the test?

**I2.** Write a test for `GET /health` that asserts the status, content type, and exact body. Answer:

1. Which assertion catches an accidental extra field?
2. Why check `response.headers["content-type"]` instead of only the body?
3. What should the test not depend on?
4. How would you test that `/health` works without a database?
5. Why is this test still useful when integration tests exist?

**I3.** Write a test for `POST /books` that asserts `201`, the `Location` header, the response body, and that the new book can be fetched by ID. Answer:

1. Which parts of the response are contract, and which are implementation details?
2. How do you avoid hard-coding an ID that may change?
3. Why follow the `Location` header instead of constructing the URL yourself?
4. What database or storage state does the test assume?
5. How do you make the test repeatable?

**I4.** Write tests for validation failures in the path, query, and body. Answer:

1. Which `loc` values do you assert?
2. Which error `type` values do you assert?
3. Why should you not assert `msg`?
4. What status code do all three produce?
5. How would you assert that multiple body errors are reported at once?

**I5.** Override a settings dependency in a test. Answer:

1. What is the key in `app.dependency_overrides`?
2. What does the override callable return?
3. How does the route receive the fake value?
4. Why is overriding the dependency better than setting environment variables?
5. What must happen after the test?

**I6.** Write a fixture that installs dependency overrides and removes them even if the test raises. Answer:

1. Why is a plain assignment outside a fixture risky?
2. What should the fixture yield?
3. How do you clear all overrides safely?
4. How do you assert the overrides are empty after the test?
5. Why does test order independence depend on this?

**I7.** Write tests for a missing book (`404`) and a duplicate ISBN (`409`). Answer:

1. Which error envelope do you assert?
2. Why should the test not assert the full human-readable message?
3. How do you set up the duplicate condition?
4. How do you clean it up?
5. What service-level test would complement each route test?

**I8.** Write tests for auth: no token (`401`), invalid token (`401`), and valid non-admin token on an admin route (`403`). Answer:

1. Which response header do you assert for `401`?
2. Why are `401` and `403` not interchangeable?
3. How do you generate a valid token in a test without depending on a real identity provider?
4. Why override the auth dependency for some tests but use real tokens for others?
5. What must never appear in the response body?

**I9.** Write a test for `DELETE /books/{book_id}` returning `204`. Answer:

1. What do you assert about `response.content`?
2. What do you assert about `Content-Type`?
3. How do you confirm the book is actually gone?
4. What happens if you call `response.json()`?
5. Why is checking only the status insufficient?

**I10.** Write assertions for response headers on a create endpoint: `Location`, `Content-Type`, and a custom `X-Request-ID`. Answer:

1. Are header lookups case-sensitive in `httpx`?
2. What should `Location` contain?
3. How do you assert that a sensitive header is absent?
4. Why should tests check the absence of secrets, not just the presence of expected fields?
5. How do you test a header that changes per request?

**I11.** Write a test that calls `GET /openapi.json` and asserts that `/books/{book_id}` exists, that `book_id` is a path parameter of type integer, and that `BookRead` has `id` and `title` as required fields. Answer:

1. Why is testing the OpenAPI document useful?
2. Which changes should fail this test?
3. Which changes should not fail it?
4. How do you keep the assertions readable?
5. What does this test not prove about the running API?

**I12.** Write a test that creates a book whose storage record contains `internal_cost_cents` and `password_hash`, and asserts that neither appears in the response. Answer:

1. Why is this a security regression test?
2. Which response model setting makes it pass?
3. How would you write the test so it fails loudly if the model changes?
4. Should the test inspect the raw JSON string as well as the parsed body?
5. Why is this test valuable even if response filtering is already covered elsewhere?

**I13.** Write an integration test for `GET /books/{isbn}` that overrides the HTTP client with a `MockTransport` returning a catalogue payload. Answer:

1. How do you install the transport?
2. Which dependencies do you override?
3. What do you assert about the response?
4. What does this test cover that a service unit test does not?
5. What does it still not cover?

**I14.** Write a test where the upstream times out and assert that the API returns `504`. Answer:

1. Where do you raise the timeout?
2. Which exception type do you use?
3. What body and headers do you assert?
4. How do you confirm the route did not return a `500`?
5. How do you keep the test fast?

**I15.** Write tests where the upstream returns `500` and malformed JSON. Answer:

1. Which status does your API return in each case?
2. Why do both cases map to the same or different local statuses?
3. How do you assert that the upstream body was not forwarded?
4. What do you assert in the logs?
5. Why should the test not assert a specific stack trace?

**I16.** Write a test for an unhandled exception that asserts a `500` response. Answer:

1. What client option is required?
2. What body should the response contain?
3. How do you prove that details were not leaked?
4. Why is this test different from testing a handled domain error?
5. Should the test use the real route or a dedicated test-only route?

**I17.** Explain the difference between testing behavior and testing implementation for an API. Answer:

1. Which of these is implementation-coupled: asserting a service method was called once, or asserting the response body?
2. When is mocking the service appropriate?
3. When is overriding the HTTP client better?
4. Why do tests that patch private methods become brittle?
5. How do you decide the test seam for a route?

**I18.** Write a test for idempotent deletion: first `DELETE` returns `204`, second returns `404`. Answer:

1. Why is this behavior correct even though `DELETE` is idempotent?
2. Which status would be acceptable if the API chose a different contract?
3. How do you test both calls in one test without making it order-dependent?
4. What storage state do you assert between the calls?
5. How would you document the chosen behavior?

**I19.** Tests share an in-memory store. Answer:

1. What symptoms appear when tests leak state?
2. How do you reset the store between tests?
3. Why is a module-level mutable dict risky with parallel test execution?
4. What fixture scope should reset it?
5. How do you prove isolation with a test that would fail if state leaked?

**I20.** Build payload factories for valid and invalid book bodies. Answer:

1. Why is a factory better than copying a dictionary into every test?
2. How do you override one field without mutating the base payload?
3. How do you parametrize invalid bodies?
4. Which fields should the factory never include?
5. How do you keep factories readable as the schema grows?

**I21.** Write a parametrized test that asserts the error envelope is identical in shape for `404`, `409`, and `422`. Answer:

1. Which keys are common?
2. Which keys differ by error type?
3. Why is a shared envelope valuable to clients?
4. How do you avoid asserting transient messages?
5. What would you change if the API needed to support two envelope versions?

**I22.** Decide which of these deserve service-level tests and which deserve route-level tests: duplicate ISBN detection, JSON body parsing, auth dependency, upstream retry, `response_model` filtering, and pagination query validation. Justify each choice and avoid duplicating the same assertion at both levels.

---

## Group J — Structure, TypeScript translations, and mixed realistic tasks

**J1.** Translate this Express route to FastAPI, preserving behavior and status codes:

```ts
app.get("/books/:id", async (req, res) => {
  const book = await books.find(Number(req.params.id));
  if (!book) return res.status(404).json({ error: "not found" });
  res.json(book);
});
```

Answer:

1. Which parts become type annotations?
2. Which parts become a dependency or service?
3. How do you express the `404`?
4. What happens automatically that the Express version does manually?
5. What did the Express version not validate that FastAPI will?

**J2.** Compare TypeScript interfaces with Pydantic models for a `BookCreate` type. Answer:

1. Which one exists at runtime?
2. How does each express optional fields versus nullable fields?
3. How does each express defaults?
4. Which one can validate untrusted JSON without extra code?
5. What is the TypeScript equivalent of `model_dump(mode="json")`?

**J3.** Translate this Zod schema to Pydantic:

```ts
const BookCreate = z.object({
  title: z.string().min(1).max(200),
  priceCents: z.number().int().positive(),
  tags: z.array(z.string()).default([]),
}).strict();
```

Answer:

1. Which Pydantic features correspond to `min`, `max`, `int`, `positive`, `default`, and `strict`?
2. How do the validation error shapes differ?
3. How does FastAPI expose the errors to clients?
4. How do you accept camelCase from the client while keeping snake_case in Python?
5. Which schema would you trust for authorization decisions, and why?

**J4.** Compare Express middleware with FastAPI dependencies. Answer:

1. Which problems do both solve?
2. How does FastAPI express ordering and sub-dependencies?
3. How does each pass data to the handler?
4. How does each short-circuit with an error?
5. Why is dependency injection easier to test than ad-hoc middleware?

**J5.** Translate a NestJS guard that checks an admin role into a FastAPI dependency. Answer:

1. Where does the guard run relative to the handler?
2. How does FastAPI surface a failed check?
3. How do you attach the dependency to a router?
4. How do you test both allowed and denied cases?
5. What is the FastAPI equivalent of a global guard?

**J6.** Translate a typed `fetch` wrapper that throws on non-2xx into an `httpx` service method. Answer:

1. Which exceptions correspond to network failures and HTTP failures?
2. Where do you validate the JSON shape?
3. How do you set timeouts?
4. How do you map errors to domain exceptions?
5. What is the FastAPI equivalent of a TypeScript `unknown` at the boundary?

**J7.** Translate an Express error-handling middleware into FastAPI. Answer:

1. What identifies an error handler in each framework?
2. How does each choose between multiple handlers?
3. How does each preserve status codes for expected errors?
4. What must a FastAPI handler return?
5. How do you ensure the same envelope is used everywhere?

**J8.** In TypeScript, a response type is erased at runtime. Explain how `response_model` differs and why it is stronger for output safety. Then answer:

1. What happens when the handler returns extra fields?
2. What happens when a required field is missing?
3. Which failure is a server bug, and which is a client bug?
4. How do you keep the TypeScript client types in sync with the OpenAPI schema?
5. What is the risk of hand-writing both sides?

**J9.** Refactor a 400-line `main.py` that contains routes, models, HTTP calls, database access, settings, and error handlers into the chapter layout. Answer:

1. Which modules do you create?
2. What moves to `schemas.py`?
3. What moves to `services.py`?
4. What stays in `main.py`?
5. How do you verify behavior did not change during the refactor?

**J10.** Write the full contract for `POST /books`: methods, path, auth, request model, all success and error statuses, response model, headers, and validation rules. Then list the tests derived from the contract. Answer:

1. Which parts are normative for clients?
2. Which errors are schema errors, and which are business errors?
3. What does success return in the body and headers?
4. Which cases are easy to forget in tests?
5. How would you document idempotency or lack thereof?

**J11.** Review this code and list at least ten problems:

```python
from fastapi import FastAPI
import requests

app = FastAPI()

BOOKS = {}

@app.get("/books/{book_id}")
def get_book(book_id, q=None, limit=1000):
    r = requests.get(f"https://catalogue.internal/books/{book_id}")
    data = r.json()
    BOOKS[book_id] = data
    return data

@app.post("/books")
def create_book(data: dict):
    BOOKS[data["id"]] = data
    return {"ok": True}

@app.delete("/books/{book_id}")
def delete_book(book_id):
    del BOOKS[book_id]
```

For each problem, name the category (HTTP semantics, validation, error handling, performance, security, testability, or structure) and the fix.

**J12.** Design an idempotent `POST /books` endpoint. Answer:

1. Which header carries the idempotency key?
2. What do you store and for how long?
3. What happens on a replay with the same body?
4. What happens on a replay with a different body?
5. Which status and body does the replay return?
6. How do you test concurrent duplicates?

**J13.** Compare JSON Merge Patch (`PATCH` with a partial object) and JSON Patch (`PATCH` with operations) for `PATCH /books/{book_id}`. Answer:

1. Which one matches a `BookUpdate` model more naturally?
2. How does each represent deleting a nullable field?
3. Which one is easier to validate with Pydantic?
4. Which one is easier for clients that only send changed fields?
5. What must the contract say about omitted fields and explicit `null`?

**J14.** Design pagination for a large books catalogue. Answer:

1. What are the trade-offs of offset versus cursor pagination?
2. What does the response envelope contain?
3. How does the client request the next page?
4. Why is a stable sort required?
5. How do you prevent an unbounded `limit`?
6. Which pagination scheme fits search results, and which fits an export?

**J15.** Write a security checklist for the books API covering auth, input validation, output filtering, secret handling, error messages, upstream calls, logging, and dependency choices. For each item, name the failure it prevents and one test or control that verifies it.

**J16.** Write an observability checklist for the same API covering request IDs, structured logs, latency, upstream failures, error rates, and health endpoints. For each item, state what you would measure and what alert would be actionable.

**J17.** Plan a versioning strategy for an API whose clients are a web app and a mobile app that updates slowly. Answer:

1. Where does the version live: path, header, or media type?
2. Which changes are backward-compatible?
3. How do you add a required field without breaking old clients?
4. How do you deprecate a field?
5. What must the OpenAPI contract and tests say about versions?
6. How long do you keep the old version alive?

**J18.** Capstone: build the complete books API described at the start of the exercises, including:

- routers for books and authors
- Pydantic create, update, read, and detail models
- validation, pagination, filtering, and sorting
- domain exceptions and consistent error handlers
- an external catalogue service with timeouts and retries
- lifespan-managed `httpx.Client`
- `TestClient` tests for success, validation, auth, conflicts, upstream failures, and secret leakage

Then write a short README section describing the contract, how to run the app, and how to run the tests. Answer:

1. Which parts were hardest to test, and why?
2. Which design decision would you revisit first?
3. Which error path is least covered?
4. Where could a secret leak?
5. What would you change before exposing this API publicly?

**J19.** Trace a `POST /books` request through FastAPI from the TCP connection to the response. Include route matching, parameter extraction, Pydantic validation, dependency resolution, handler execution, response-model validation, serialization, exception handling, and logging. At each stage, name one failure mode and the status or log it produces.

**J20.** Compare FastAPI with TypeScript API ecosystems you may know (Express + Zod, NestJS + class-validator, tRPC). Answer:

1. Where does each place validation?
2. How does each generate documentation or client types?
3. How does each handle dependency injection?
4. Which approach produces the strongest runtime guarantees for untrusted JSON?
5. What does FastAPI make easy that the others require more setup for, and vice versa?

---

## Before moving on

Check yourself against the chapter outcome without looking back at the notes:

- Read and write HTTP exchanges confidently: methods, status codes, headers, idempotency, and the difference between client and server errors.
- Build a FastAPI app with routers, typed path and query parameters, and correct route ordering.
- Define Pydantic v2 models with constraints, defaults, nested models, aliases, custom validators, and input/output separation.
- Validate request bodies, return response models, set status codes and headers, and explain why `response_model` is a security boundary.
- Map schema failures, domain errors, upstream failures, and unexpected exceptions to consistent HTTP responses without leaking internals.
- Inject settings, clients, and services with dependencies; manage client lifetime with lifespan and cleanup; override dependencies in tests.
- Call external services with timeouts, bounded retries, validated responses, sanitized logging, and `MockTransport` tests.
- Structure an application into routers, schemas, services, dependencies, and a thin `main.py`.
- Test the API contract with `TestClient`: success, validation, auth, conflicts, upstream failures, secret leakage, and OpenAPI output.
- Translate Express/NestJS/Zod patterns into FastAPI equivalents and recognize where runtime validation differs from TypeScript types.

If any group felt slow, redo a subset of its exercises from scratch before continuing to Chapter 6.
