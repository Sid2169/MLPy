# Python for Applied AI and Backend Engineering

**Goal:** Achieve practical Python fluency sufficient to build AI services, data pipelines, ML experiments, and production integrations independently.

**Estimated duration:** 25–35 focused hours.

**Prerequisites:** Basic programming knowledge and experience with TypeScript, Node.js, and backend development.

## Chapter 1 — Python Language Fundamentals

- Variables, primitive types, mutability, identity, and equality.
- Strings, numbers, booleans, `None`, and type conversion.
- Lists, tuples, dictionaries, and sets.
- Conditions, loops, comprehensions, and unpacking.
- Functions, arguments, default values, keyword arguments, and return values.
- Scope and basic Python idioms.

**Outcome:** Write small Python programs comfortably and translate familiar TypeScript logic into idiomatic Python.

## Chapter 2 — Functions, Objects, and Python's Data Model

- Modules, imports, packages, and project organization.
- Classes, instances, inheritance, and composition.
- Dataclasses and when to prefer ordinary functions or dictionaries.
- Type hints, unions, generics at a practical level, and `TypedDict`.
- Iterables, iterators, generators, and lazy processing.
- Exceptions, custom exceptions, and resource management with `with`.
- Common Python conventions and readable code.

**Outcome:** Design reusable modules and data structures without overengineering.

## Chapter 3 — Practical Python Development

- Virtual environments and dependency management.
- Installing, pinning, and updating packages.
- Project structure, configuration, environment variables, and secrets.
- Reading and writing files, JSON, CSV, and paths with `pathlib`.
- Logging, debugging, and interpreting tracebacks.
- HTTP requests using a modern HTTP client.
- Basic command-line scripts and configuration validation.

**Outcome:** Create a reproducible Python project that reads data, calls an API, handles errors, and can be run in another environment.

## Chapter 4 — Testing and Code Quality

- Writing tests with `pytest`.
- Assertions, fixtures, parametrized tests, and temporary files.
- Testing successful behavior, edge cases, and exceptions.
- Mocking external APIs and isolating dependencies.
- Unit tests versus integration tests.
- Formatting, linting, and basic static type checking.

**Outcome:** Build and maintain Python modules with repeatable tests rather than relying on manual verification.

## Chapter 5 — HTTP APIs with FastAPI and Pydantic

- HTTP fundamentals, requests, responses, status codes, and headers.
- FastAPI routes, dependency injection, and configuration.
- Pydantic models, validation, serialization, and structured responses.
- Query parameters, path parameters, request bodies, and error handling.
- Calling external services, connection reuse, timeouts, and resource cleanup.
- API testing and separation of route handlers from business logic.

**Outcome:** Build a tested Python API that validates inputs and invokes an external service reliably.

## Chapter 6 — Asynchronous Python and Concurrency

- `async` and `await`, coroutines, and the event loop.
- Concurrent I/O with `asyncio` and asynchronous HTTP clients.
- Tasks, task groups or equivalent structured concurrency, and cancellation.
- Timeouts, exception propagation, and cleanup.
- Concurrency limits, semaphores, and avoiding uncontrolled fan-out.
- When synchronous code, threads, processes, or asynchronous I/O are appropriate.

**Outcome:** Implement concurrent API calls with bounded resource usage and predictable failure handling.

## Chapter 7 — Data Processing for AI and ML

- NumPy arrays, shapes, indexing, and vectorized operations.
- pandas Series and DataFrames, filtering, selection, and transformations.
- Loading CSV and JSON datasets, inspecting schemas, and handling missing values.
- Joins, grouping, aggregation, duplicates, and data type conversion.
- Basic numerical summaries and exploratory data analysis.
- Reproducible transformations, train/test splits, and avoiding data leakage.
- Choosing between ordinary Python structures, NumPy, and pandas.

**Outcome:** Clean, transform, inspect, and validate datasets for model evaluation and ML pipelines.

## Chapter 8 — Python for Production AI Services

- Integrating an LLM provider SDK and normalizing its responses.
- Structured model output, Pydantic validation, and handling malformed responses.
- Timeouts, retry policies, rate limits, and transient versus permanent failures.
- Token usage, latency, cost tracking, and structured logging.
- Configuration, secrets, dependency boundaries, and provider mocking.
- Packaging the service for deployment and running tests in CI.
- Combining FastAPI, asynchronous execution, testing, and data validation in one service.

**Outcome:** Build a small, reliable AI service that can be tested, monitored, and integrated with a TypeScript backend.

## Completion Criteria

You should be able to:

- Write readable, idiomatic Python without repeatedly looking up basic syntax.
- Organize code into modules and choose appropriate data structures.
- Use type hints, exceptions, context managers, and virtual environments correctly.
- Build and test FastAPI endpoints.
- Write asynchronous code with appropriate timeouts and concurrency limits.
- Process tabular data using NumPy and pandas.
- Integrate an LLM API with validation, error handling, logging, and tests.
- Debug unfamiliar Python code and use documentation effectively.

Avoid spending time on advanced metaprogramming, obscure language features, GUI programming, web frameworks beyond FastAPI, and deep Python internals unless a project requires them.