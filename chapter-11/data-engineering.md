# Chapter 11 — Data Engineering

Chapter 7 gave you NumPy and pandas. This chapter turns those tools into pipelines: reading and writing durable files, enforcing schemas, querying with SQL, transforming data safely, loading incrementally, orchestrating dependent tasks, checking data quality, and operating the result.

The examples use the Python standard library, SQLite, and pandas. They run locally without a warehouse or orchestration service. The same ideas apply to Parquet, DuckDB, Postgres, object storage, and workflow frameworks.

The central rule: data pipelines are defined by their contracts, their keys, and their retries. A transformation that works once on a clean file is not a pipeline until it behaves correctly when run twice, when input arrives late, and when a step fails halfway through.

## Contents

1. Pipeline shapes and data contracts
2. Files, formats, encodings, and atomic writes
3. Schemas, validation, and type boundaries
4. SQL and relational thinking
5. pandas ingestion, transforms, and joins
6. Incremental loads, idempotency, and upserts
7. Orchestration, DAGs, retries, and checkpoints
8. Data quality and contracts
9. Testing pipelines
10. Observability, lineage, privacy, and cost
11. Common mistakes and conventions
12. Exercises (Groups A–J)

---

## 11.1 Pipeline shapes and data contracts

A data pipeline moves data from a source to a trusted output:

```text
source
  → raw / bronze: landed as received, immutable
  → validated / silver: typed, deduplicated, conformed
  → modeled / gold: joined, aggregated, ready for serving
  → consumers: analytics, ML features, APIs, reports
```

The names vary by organization; the responsibilities do not:

- **Raw:** preserve the source bytes and extraction metadata. Do not “fix” data before landing it.
- **Validated:** enforce schema and quality rules; quarantine bad records.
- **Modeled:** join, aggregate, and shape for a consumer.
- **Serving:** publish with freshness, lineage, and access controls.

Pipeline shapes:

- **Batch:** process a bounded window, often hourly or daily.
- **Micro-batch:** process small windows frequently.
- **Streaming:** process records continuously with state and watermarks.
- **Backfill:** reprocess historical windows with the current code.
- **Snapshot:** replace a full dataset.
- **Incremental:** process only changes since a checkpoint.

A contract describes what a producer promises and what a consumer requires:

- schema and field types
- nullability and allowed values
- primary key or deduplication key
- freshness and update frequency
- volume expectations
- semantics of timestamps and status fields
- ownership and escalation path

Write the contract down. Validate it at the boundary. A schema that exists only in a wiki is not enforced.

A minimal batch record should carry lineage:

```python
from dataclasses import dataclass
from datetime import datetime

@dataclass(frozen=True)
class BatchMetadata:
    batch_id: str
    source: str
    extracted_at: datetime
    row_count: int
    checksum: str
    schema_version: str
```

Use deterministic batch IDs when replaying the same window. Random IDs make idempotency harder.

---

## 11.2 Files, formats, encodings, and atomic writes

### CSV

CSV is text, not a typed format. Every value is a string until you parse it. A reader does not know whether `007` is an ID, an integer, or a version.

```python
import csv

with open("events.csv", "r", encoding="utf-8-sig", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        print(row["event_id"], row["amount"])
```

Key rules:

- Pass `newline=""` when using `csv`; otherwise quoted newlines can be mishandled on some platforms.
- Specify the encoding. `utf-8-sig` removes a UTF-8 byte-order mark if present.
- Use `csv.DictReader` when headers are present; `csv.reader` when they are not.
- CSV quoting handles commas, quotes, and newlines, but not types or nested data.
- A header-only file yields no rows; an empty file may raise or return nothing depending on the reader.
- A malformed row can break a whole batch; decide whether to quarantine it or fail the run.
- Never infer that `"007"` is an integer. Declare the schema explicitly.

Writing:

```python
with open("out.csv", "w", encoding="utf-8", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["id", "amount"])
    writer.writeheader()
    writer.writerows(rows)
```

`newline=""` also matters when writing, especially on Windows.

### JSON and JSON Lines

JSON supports nested objects and arrays. JSON Lines (JSONL) stores one JSON value per line, which is easier to stream:

```python
import json

def read_jsonl(path: str):
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)
```

`json.load` reads an entire document; `json.loads` parses a string. `json.dump` writes a Python object; `json.dumps` returns a string.

JSON numbers become Python `int` or `float`. Floats can lose precision; do not store money as a binary float if exactness matters. Dates are strings unless you parse them. Duplicate keys in a JSON object are not reliably preserved by all parsers; avoid relying on them.

Use `ensure_ascii=False` when you want readable Unicode output and the downstream system supports UTF-8.

### Parquet

Parquet is columnar, typed, and compressed. It is usually a better interchange format than CSV for analytics:

- column pruning and predicate pushdown
- compact compression
- explicit schemas
- efficient scans of selected columns

Parquet is not human-readable and requires a library such as pyarrow. Schema evolution rules matter: adding a nullable column is usually easier than changing a type or renaming a field.

Partition layout often looks like:

```text
events/date=2026-01-01/part-000.parquet
events/date=2026-01-02/part-000.parquet
```

Partition columns should match common filters. Too many small files cause overhead; too few huge files reduce parallelism.

### Atomic writes

A partially written file is worse than no file. Write to a temporary path in the same directory, flush, then replace atomically:

```python
import os
import tempfile
from pathlib import Path

def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=path.name,
        suffix=".tmp",
    )
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
```

`os.replace` is atomic within a filesystem. For durability, also fsync the directory after replacement on POSIX systems. Do not write directly to the final path if consumers may read it concurrently.

### Compression and checksums

Compression reduces storage and network cost, but it adds CPU work and makes files non-seekable in some formats. Use gzip for compatibility, zstd for a better speed/ratio tradeoff where supported, and Parquet's internal compression for columnar data.

Record checksums for landed files:

```python
import hashlib

def sha256_file(path: Path, chunk_size: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()
```

Checksums detect corruption and support idempotent ingestion. Compare the checksum before reprocessing a file.

### Paths and file discovery

Use `pathlib` rather than string concatenation:

```python
from pathlib import Path

root = Path("/data/events")
part = root / "date=2026-01-01" / "part-000.parquet"
```

`Path.glob("**/*.parquet")` finds nested files. Sort results explicitly when order matters; filesystem order is not guaranteed. Canonicalize and validate paths that come from users or model output to prevent directory traversal.

---

## 11.3 Schemas, validation, and type boundaries

A schema is a set of field names, types, nullability rules, and constraints. Validate as early as possible: at ingestion, before transformation, and again before serving.

Explicit types prevent silent corruption:

```python
import pandas as pd

df = pd.read_csv(
    "orders.csv",
    dtype={
        "order_id": "string",
        "customer_id": "string",
        "amount_cents": "int64",
        "status": "string",
    },
    parse_dates=["created_at"],
    na_values=["", "NULL", "null"],
    keep_default_na=False,
)
```

Rules:

- Read identifiers as strings; leading zeros and long numeric IDs are not arithmetic values.
- Read money as integer cents or `Decimal`, not binary float.
- Parse dates explicitly and decide on timezone awareness.
- Use nullable integer and boolean dtypes when missing values are possible.
- Do not let pandas infer critical columns from a sample.
- Reject unknown enum values or map them deliberately.

Null semantics differ:

- pandas may use `NaN`, `NaT`, or `pd.NA` depending on dtype.
- Python `None` is not the same as `float("nan")`.
- SQL `NULL` means unknown; comparisons with `NULL` yield unknown, not true.
- JSON `null` becomes `None`.
- CSV empty strings may mean missing, zero, or an empty string; decide per column.

A small validation model can be a dataclass plus explicit checks:

```python
from dataclasses import dataclass
from datetime import datetime

@dataclass(frozen=True)
class Order:
    order_id: str
    customer_id: str
    amount_cents: int
    created_at: datetime

    def __post_init__(self) -> None:
        if not self.order_id:
            raise ValueError("order_id is required")
        if self.amount_cents < 0:
            raise ValueError("amount_cents must be non-negative")
        if self.created_at.tzinfo is None:
            raise ValueError("created_at must be timezone-aware")
```

Pydantic is convenient at API boundaries; dataclasses are enough for internal records. The important part is that invalid records do not silently enter the trusted layer.

Schema evolution:

- Adding an optional field is usually backward-compatible.
- Adding a required field is breaking unless consumers have a default.
- Renaming a field breaks consumers unless both names are supported during a transition.
- Changing a type, unit, or timezone is a semantic change even if the name is unchanged.
- Removing a field is breaking unless no consumer reads it.

Record a schema version with the data. Validate the contract before publishing.

---

## 11.4 SQL and relational thinking

SQL is the default language for joins, aggregation, and set operations. pandas is convenient for local exploration; SQL is often clearer and more scalable for relational work.

SQLite is built into Python and supports transactions, constraints, indexes, CTEs, and window functions:

```python
import sqlite3

con = sqlite3.connect("pipeline.db")
con.row_factory = sqlite3.Row
con.execute("PRAGMA foreign_keys = ON")

with con:
    con.execute(
        "INSERT INTO docs (id, title, updated_at) VALUES (?, ?, ?)",
        ("doc-1", "Intro", "2026-01-01T00:00:00Z"),
    )
```

Rules:

- Never interpolate values into SQL strings. Use parameters (`?` for SQLite, `%s` for many drivers).
- Use a transaction for multi-statement changes. `with con:` commits on success and rolls back on exception.
- Enable foreign keys in SQLite; they are off by default.
- Use `executemany` for batches instead of a Python loop of `execute`.
- Set a busy timeout and handle lock contention.
- Use `row_factory` to access columns by name, but convert to plain data before it leaks across layers.

### NULL semantics

```sql
SELECT COUNT(*) FROM orders;          -- counts rows
SELECT COUNT(customer_id) FROM orders; -- counts non-NULL customer_id
```

`NULL = NULL` is unknown, not true. Use `IS NULL` and `IS DISTINCT FROM` where supported. `NOT IN` with a subquery that returns `NULL` can produce unexpected empty results; filter nulls or use `NOT EXISTS`.

### Joins and fanout

An inner join returns matching rows. A left join keeps all left rows and fills unmatched right columns with `NULL`.

A join on a non-unique key multiplies rows. That is sometimes intended, but usually it is a bug:

```sql
SELECT o.id, c.segment
FROM orders AS o
LEFT JOIN customers AS c
  ON c.customer_id = o.customer_id;
```

Before joining, check key uniqueness:

```sql
SELECT customer_id, COUNT(*) AS n
FROM customers
GROUP BY customer_id
HAVING COUNT(*) > 1;
```

Validate join cardinality in pandas too:

```python
merged = orders.merge(
    customers,
    on="customer_id",
    how="left",
    validate="many_to_one",
)
```

`validate` raises when the relationship is not what you expected. Use it.

### Aggregation and windows

```sql
SELECT
    customer_id,
    COUNT(*) AS orders,
    SUM(amount_cents) AS total_cents
FROM orders
GROUP BY customer_id
HAVING SUM(amount_cents) > 10000;
```

Window functions keep row detail while computing across a partition:

```sql
SELECT
    id,
    doc_id,
    updated_at,
    ROW_NUMBER() OVER (
        PARTITION BY doc_id
        ORDER BY updated_at DESC, id DESC
    ) AS rn
FROM documents;
```

Filter the window result in an outer query or CTE; you cannot use a window alias in `WHERE` at the same query level.

```sql
WITH ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY doc_id
               ORDER BY updated_at DESC, id DESC
           ) AS rn
    FROM documents
)
SELECT * FROM ranked WHERE rn = 1;
```

Use deterministic tie-breakers. Without `id DESC`, two rows with the same timestamp have no defined order.

### Indexes and transactions

An index speeds reads at the cost of writes and storage. Add indexes for selective filters and join keys, then inspect the query plan:

```sql
EXPLAIN QUERY PLAN
SELECT * FROM orders WHERE customer_id = ?;
```

Transactions protect atomicity. For a read-modify-write sequence that must not interleave, SQLite supports `BEGIN IMMEDIATE`. Keep transactions short; do not hold them open while calling an external API.

### SQL versus pandas

Use SQL when:

- data is already in a relational store
- joins and aggregations are large
- the database can filter and aggregate before transfer
- other teams need a shared, inspectable definition

Use pandas when:

- data is small enough to fit in memory
- you need exploratory transformations
- the logic is easier to express with arrays or time series
- you are preparing a local fixture or test

Do not pull an entire table into pandas just to filter it; push filters into SQL.

---

## 11.5 pandas ingestion, transforms, and joins

Read only the columns and rows you need:

```python
df = pd.read_csv(
    path,
    usecols=["order_id", "customer_id", "amount_cents", "created_at"],
    dtype={"order_id": "string", "customer_id": "string", "amount_cents": "int64"},
    parse_dates=["created_at"],
    chunksize=100_000,
)
```

With `chunksize`, the result is an iterator of DataFrames. Process each chunk and release it; do not append every chunk to a list unless the data is small.

Memory habits:

- Prefer `category` for low-cardinality string columns.
- Use nullable dtypes for integer/boolean columns with missing values.
- Drop unused columns early.
- Avoid `object` columns when a typed dtype will do.
- Avoid `iterrows` and row-wise `apply` for large data; vectorize or use SQL.
- Convert to NumPy only when the operation benefits.

Cleaning:

```python
df["email"] = df["email"].str.strip().str.lower()
df["status"] = df["status"].astype("category")
df["amount_cents"] = pd.to_numeric(df["amount_cents"], errors="raise")
```

`errors="raise"` is usually better than silently turning bad values into `NaN`. Decide explicitly whether invalid values should fail, quarantine, or map to a known value.

Duplicates:

```python
df = df.drop_duplicates(subset=["order_id"], keep="last")
```

`keep="last"` assumes the file is ordered by recency. If it is not, sort by an explicit timestamp and tie-breaker first.

Joins:

```python
merged = orders.merge(
    customers,
    on="customer_id",
    how="left",
    validate="many_to_one",
    indicator=True,
)
```

`indicator=True` adds `_merge` with `left_only`, `right_only`, or `both`. Use it to detect missing dimensions instead of silently dropping them.

Aggregation:

```python
summary = (
    orders.groupby(["customer_id", "status"], observed=True)
    .agg(
        orders=("order_id", "nunique"),
        total_cents=("amount_cents", "sum"),
    )
    .reset_index()
)
```

Use `observed=True` with categorical groupers to avoid empty category combinations. Name aggregations clearly; avoid MultiIndex columns that confuse downstream consumers.

### Datetimes and timezones

- Parse timestamps with an explicit format when possible.
- Decide whether to store UTC or local time; usually store UTC.
- Keep timezone-aware timestamps until you deliberately convert.
- Do not compare naive and aware datetimes.
- Use `pd.Timestamp`/`datetime` rather than strings for arithmetic.
- Record the source timezone if it differs from UTC.

```python
df["created_at"] = pd.to_datetime(df["created_at"], utc=True)
df["created_date"] = df["created_at"].dt.date
```

### Writing

CSV is for interchange and inspection. Parquet is for typed analytical storage. When writing Parquet, preserve dtypes and partition deliberately.

```python
df.to_parquet("gold/orders.parquet", index=False)
```

Avoid writing many tiny files. Aim for file sizes that match the storage and query engine; compact small files during maintenance.

pandas is not a distributed system. If the data does not fit in memory, push work into SQL, process in chunks, or use a distributed engine. Do not rely on swap space as a scaling strategy.

---

## 11.6 Incremental loads, idempotency, and upserts

An incremental pipeline processes changes since a checkpoint.

A watermark is the high-water mark of processed data:

```sql
SELECT *
FROM orders
WHERE updated_at > :last_watermark
ORDER BY updated_at, order_id;
```

Use `>` or `>=` deliberately:

- `>` avoids reprocessing the boundary row, but can miss rows with the same timestamp.
- `>=` reprocesses the boundary, so the write must be idempotent.
- A common compromise is `>=` with an overlap window and deduplication by key and version.

Late-arriving data is the hard part. A row with an old `updated_at` can arrive after the watermark has moved past it. Options:

- maintain an overlap window (reprocess the last N minutes/hours)
- use a source sequence number instead of a timestamp
- run periodic reconciliation
- accept bounded lateness and document it

Idempotency means running the same batch twice has the same effect as running it once. Techniques:

- deterministic batch and file names
- content hashes
- unique keys and constraints
- upserts keyed by primary key and source version
- staging tables plus a single merge
- delete-and-reinsert inside a transaction for a bounded partition
- exactly-once consumption is not free; at-least-once delivery plus idempotent writes is usually the practical design

SQLite upsert:

```sql
INSERT INTO documents (id, text, updated_at, source_version)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    text = excluded.text,
    updated_at = excluded.updated_at,
    source_version = excluded.source_version
WHERE excluded.source_version >= documents.source_version;
```

The `WHERE` prevents an older record from overwriting a newer one. Choose `>` or `>=` based on whether equal versions can differ. Include a tie-breaker if the source version is not unique.

Staging and merge:

```text
1. Load the batch into a staging table.
2. Validate and deduplicate staging rows.
3. Merge into the target in one transaction.
4. Record the batch ID and watermark only after commit.
```

If the process crashes after the merge but before recording the watermark, the next run reprocesses the batch. The upsert must make that safe.

Deletes:

- A full snapshot can detect deletions by comparing keys.
- An incremental feed may send delete events or soft-delete flags.
- Hard deletes need tombstones or a reconciliation job.
- Never infer deletion from absence in a partial batch.

Backfills:

- Replay a historical window with the current code.
- Write to a staging location or a separate partition first.
- Validate row counts and metrics before swapping.
- Keep the old output until the new output is verified.
- Make the backfill idempotent so it can be retried.

Incremental aggregation is harder than incremental row loading. If an order changes from `pending` to `paid`, a naive `SUM` over only new rows is wrong. Recompute the affected aggregates from the source of truth, or maintain a changelog and apply deltas with correction logic.

Schema evolution in an incremental pipeline:

- Add nullable columns with defaults.
- Read old and new schemas in the transformation layer.
- Version the target table and migrate deliberately.
- Do not silently coerce a changed unit (cents to dollars, seconds to milliseconds).

---

## 11.7 Orchestration, DAGs, retries, and checkpoints

A pipeline is a directed acyclic graph of tasks:

```text
extract → validate → transform → load → quality_check → publish
```

Dependencies must be explicit. A cycle is a configuration bug.

A minimal topological runner:

```python
from collections import defaultdict, deque

def topological_order(graph: dict[str, set[str]]) -> list[str]:
    nodes = set(graph) | {dep for deps in graph.values() for dep in deps}
    indegree = {node: 0 for node in nodes}
    children: dict[str, set[str]] = defaultdict(set)

    for node, deps in graph.items():
        for dep in deps:
            indegree[node] += 1
            children[dep].add(node)

    queue = deque(sorted(node for node, degree in indegree.items() if degree == 0))
    order = []

    while queue:
        node = queue.popleft()
        order.append(node)
        for child in sorted(children[node]):
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)

    if len(order) != len(nodes):
        raise ValueError("cycle detected")
    return order
```

Task rules:

- A task must be idempotent: rerunning it must not duplicate side effects.
- Retry transient failures with bounded exponential backoff and jitter.
- Do not retry validation failures, permission errors, or malformed input indefinitely.
- Persist a checkpoint only after the task's side effect commits.
- Record run ID, batch ID, attempt, start/end time, row counts, and error class.
- Limit concurrency to protect the source, warehouse, and downstream services.
- Use a lock or a unique run key to prevent overlapping runs for the same window.
- On partial failure, rerun only the failed task and its dependents.

Scheduling:

- Use timezone-aware schedules; daylight-saving transitions matter.
- Define catchup/backfill behavior explicitly.
- Do not let a failed run silently skip its window.
- Align windows to the source's update semantics, not just midnight.
- Separate extract, transform, and publish so each can be retried independently.

Frameworks such as Airflow, Prefect, and Dagster add scheduling, retries, backfills, metadata, and UI. The concepts are the same; a framework does not make a non-idempotent task safe.

Backpressure:

- Bound the number of in-flight records and concurrent requests.
- Apply rate limits when reading from APIs.
- Write in batches, not one row per transaction.
- Handle a slow consumer without unbounded memory growth.

Dead letters:

- Quarantine records that cannot be processed.
- Include the error class, row payload, batch ID, and timestamp.
- Provide a replay path after the bug is fixed.
- Do not let a single malformed row block an entire batch unless the contract requires it.

---

## 11.8 Data quality and contracts

Data quality checks are executable expectations:

- schema: required columns, types, nullability
- uniqueness: primary keys and deduplication keys
- completeness: null rate, required fields
- validity: ranges, enums, formats
- consistency: cross-field rules, units, timezone
- referential integrity: foreign keys
- freshness: maximum age of the newest record
- volume: row-count bounds compared with history
- distribution: category proportions or numeric ranges

Classify severity:

- **error:** block publication; data is not trustworthy.
- **warn:** publish with a visible warning and investigate.
- **info:** record for trend analysis.

A simple expectation framework:

```python
from dataclasses import dataclass
from typing import Callable, Literal
import pandas as pd

@dataclass(frozen=True)
class Expectation:
    name: str
    severity: Literal["error", "warn", "info"]
    check: Callable[[pd.DataFrame], bool]
```

Checks should return evidence, not only a boolean:

```python
def no_duplicate_order_ids(df: pd.DataFrame) -> tuple[bool, dict]:
    duplicated = df["order_id"].duplicated(keep=False)
    sample = df.loc[duplicated, "order_id"].head(10).tolist()
    return not duplicated.any(), {"count": int(duplicated.sum()), "sample": sample}
```

Quarantine instead of silently dropping bad rows. A quarantine record should include the raw payload, the failed expectation, the batch ID, and enough context to reproduce the failure. Quarantined data needs an owner and a replay process.

Schema drift:

- New columns may be additive or unexpected.
- Missing columns are usually breaking.
- Changed types are breaking.
- Changed nullability can break consumers.
- Changed units or timezones are semantic breaks.

Fail the contract when a breaking change appears. Do not let a pipeline infer a new schema and continue silently.

Data quality metrics should be monitored over time:

- null rate by column
- duplicate rate by key
- row count versus the same weekday last week
- freshness lag
- rejected/quarantined rows
- distribution shift by category

A quality check that never fails is not necessarily healthy; it may be too weak or never running.

---

## 11.9 Testing pipelines

Test the pure transformation first:

```python
def normalize_status(value: str) -> str:
    mapping = {"paid": "paid", "PAID": "paid", "pending": "pending"}
    if value not in mapping:
        raise ValueError(f"unknown status: {value!r}")
    return mapping[value]
```

Unit tests should use small, hand-checked fixtures. Include:

- empty input
- all-null column
- duplicate keys
- boundary timestamps
- unexpected enum values
- Unicode and whitespace
- large/small batch boundaries
- idempotent rerun

For SQL, use a temporary SQLite database:

```python
import sqlite3

def make_db() -> sqlite3.Connection:
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript("""
        CREATE TABLE orders (
            order_id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            amount_cents INTEGER NOT NULL
        );
    """)
    return con
```

Test the pipeline end to end on temporary files and a temporary database. Assert:

- output schema and dtypes
- row count and key uniqueness
- expected values for a few hand-checked rows
- idempotency after running twice
- incremental behavior with late data
- quarantine behavior for invalid rows
- failure rollback

Failure injection:

- make the loader raise after the first batch
- close the database during a write
- provide a malformed file
- simulate a stale checkpoint
- run two workers on the same window

Golden files are useful for stable serialized output, but normalize volatile fields (timestamps, random IDs, file paths) before comparing. Otherwise the tests fail for irrelevant reasons.

Property-based tests are useful for parsers and invariants: round-trip serialization, chunk boundaries, deduplication, and ordering.

Determinism:

- inject a clock instead of calling `datetime.now()` directly
- inject an ID generator instead of using random UUIDs
- sort outputs where order is not semantically meaningful
- seed any randomness
- pin library versions

Do not use production data in tests. Use synthetic fixtures or a privacy-safe sample.

---

## 11.10 Observability, lineage, privacy, and cost

A pipeline needs to answer:

- Did it run?
- How long did it take?
- How many rows were read, written, rejected?
- How fresh is the output?
- Which source and code version produced it?
- Who consumes it?
- Did quality or cost change?

Logs should be structured:

```python
import logging

logger = logging.getLogger(__name__)
logger.info(
    "batch_complete",
    extra={
        "batch_id": batch_id,
        "source": source,
        "rows_in": rows_in,
        "rows_out": rows_out,
        "rows_quarantined": rows_quarantined,
        "duration_ms": duration_ms,
    },
)
```

Metrics:

- rows processed and rejected
- freshness lag
- task duration and retries
- checkpoint position
- bytes read/written
- cost per run or per tenant
- quality expectation failures

Lineage:

- source dataset and version
- transformation code version
- prompt/model version if applicable
- output dataset and partition
- downstream consumers
- schema version

Lineage makes it possible to answer “which outputs are affected by this bad input?” without guessing.

Privacy:

- minimize PII at ingestion
- hash or tokenize identifiers when raw values are not needed
- restrict access to raw layers
- set retention and deletion policies
- avoid logging raw payloads
- test that deleted records do not reappear after a replay
- separate tenant data physically or logically

Cost:

- partition by common filters
- compress columnar files
- avoid tiny files
- prune old partitions
- push filters into SQL
- avoid repeatedly scanning the same large table
- cache or materialize expensive intermediate results
- measure bytes scanned, not just rows

A pipeline that is correct but scans ten times more data than necessary is still a production problem.

---

## 11.11 Common mistakes and conventions

Mistakes to avoid:

1. Reading IDs as numbers and losing leading zeros.
2. Letting pandas infer dtypes for critical columns.
3. Comparing naive and timezone-aware datetimes.
4. Using floats for money.
5. Treating CSV as a typed format.
6. Writing output directly to the final path.
7. Assuming a file write is atomic across filesystems.
8. Retrying a non-idempotent task.
9. Recording a checkpoint before the write commits.
10. Using `>` watermarks without handling equal timestamps or late data.
11. Joining on a non-unique key and silently multiplying rows.
12. Using `NOT IN` with NULLs.
13. Building SQL with f-strings.
14. Fetching a whole table into pandas just to filter it.
15. Using `iterrows` for large transforms.
16. Dropping invalid rows without quarantine or metrics.
17. Inferring deletion from absence in a partial batch.
18. Letting schema drift pass silently.
19. Holding a transaction open during a network call.
20. Running overlapping jobs for the same window.
21. Backfilling directly into production without validation.
22. Writing many tiny files.
23. Logging raw PII or secrets.
24. Testing only the happy path.
25. Treating a successful job as proof that the data is correct.

Conventions:

- Land raw data immutably; validate before transforming.
- Declare schemas and contracts explicitly.
- Use stable keys, deterministic batch IDs, and idempotent writes.
- Use transactions for multi-statement changes.
- Check join cardinality before merging.
- Record watermarks only after successful commits.
- Quarantine bad records with enough context to replay.
- Test empty, duplicate, late, and malformed inputs.
- Emit row counts, freshness, quality, and lineage for every run.
- Keep PII out of logs and minimize it in storage.
- Partition and compress for the queries you actually run.
- Prefer the simplest pipeline that meets the freshness and volume requirements.

---

# Exercises

Work each exercise before running code. Groups are ordered from recognition to implementation; within each group, difficulty increases. Do not look up answers — predict, run, reconcile, then rewrite from memory.

Use only local files, temporary directories, in-memory SQLite, and small pandas DataFrames. Do not test against production data or a real warehouse. When an exercise depends on pandas behavior, inspect the installed version and dtypes instead of assuming.

## Group A — Files, formats, encodings, and atomic writes

**A1.** A CSV file contains:

```text
id,note
1,"hello, world"
2,"line1
line2"
```

Predict the number of rows returned by `csv.DictReader` and the value of `note` for each row. Then explain why `newline=""` is recommended when opening the file.

**A2.** A UTF-8 file begins with a byte-order mark. Answer:

1. What is the byte sequence of the BOM?
2. What does `encoding="utf-8"` do with it?
3. What does `encoding="utf-8-sig"` do?
4. How can the BOM corrupt a header name?
5. How do you detect the problem in a pipeline?

**A3.** Predict the types and values of each field after reading:

```python
with open("orders.csv", encoding="utf-8", newline="") as f:
    row = next(csv.DictReader(f))
```

The file contains:

```text
order_id,amount,is_paid,created_at
007,10,false,2026-01-01T00:00:00Z
```

Then explain which conversions the pipeline must perform explicitly.

**A4.** Write a CSV row containing a comma, a double quote, and a newline in one field using `csv.DictWriter`. Answer:

1. Which characters are quoted?
2. How are embedded quotes escaped?
3. Why is manual string concatenation unreliable?
4. What does `newline=""` change on Windows?

**A5.** Predict the Python values:

```python
import json

doc = json.loads('{"id": "1", "tags": ["a", "b"], "meta": {"ok": true}, "value": null}')
print(doc["tags"][1], doc["meta"]["ok"], doc["value"])
```

Then explain why JSON object keys are always strings.

**A6.** Write a JSONL reader that skips blank lines. Answer:

1. Why is JSONL easier to stream than a single JSON array?
2. What happens if one line is malformed?
3. How do you report the line number?
4. Why should the reader yield records lazily?

**A7.** Predict the difference between:

```python
json.dumps({"name": "Zoë"})
json.dumps({"name": "Zoë"}, ensure_ascii=False)
```

Then answer which form is usually better for a UTF-8 file and which is safer for a system that only supports ASCII.

**A8.** Predict the output of:

```python
print(json.dumps({"amount": 0.1 + 0.2}))
print(json.loads('{"amount": 0.1}')["amount"] + json.loads('{"amount": 0.2}')["amount"])
```

Then explain why money should not be stored as a binary float.

**A9.** For each expression, state the result and whether it touches the filesystem:

```python
p = Path("/data/events") / "2026" / "part-000.csv"
p.name
p.parent
p.suffix
p.stem
p.with_suffix(".json")
```

**A10.** A user supplies `../../etc/passwd` as a file name. Answer:

1. What happens with `Path("/data/uploads") / user_name`?
2. What does `.resolve()` show?
3. How do you confine access to the upload directory?
4. Why is checking for `..` in the string insufficient?

**A11.** Explain the order of operations in the atomic write function from the chapter. Answer:

1. Why create the temporary file in the same directory?
2. Why flush and fsync before `os.replace`?
3. What does `os.replace` guarantee?
4. What should happen if the process crashes before replacement?
5. Why should consumers never read a partially written final path?

**A12.** Write a gzip-compressed JSONL file and read it back line by line. Answer:

1. Which module handles gzip?
2. Why should you not load the whole decompressed file if it is large?
3. What happens to the file size and CPU cost?
4. How do you detect a truncated gzip stream?

**A13.** A file's SHA-256 checksum is recorded at ingestion. Answer:

1. What does a changed checksum indicate?
2. Why is comparing the checksum useful before replaying a batch?
3. How do you compute the checksum without loading the whole file?
4. What does a checksum not prove?

**A14.** Design a partition path for daily event data with a tenant, date, and part number. Answer:

1. Which order of partition keys supports common queries?
2. Why should the tenant be a path component or an explicit partition field?
3. What are the risks of too many partitions?
4. How do you prevent a tenant name from escaping the path?

**A15.** Predict the order of:

```python
paths = list(Path("data").glob("**/*.csv"))
print([p.name for p in sorted(paths)])
```

Then explain why you should sort rather than rely on filesystem order.

**A16.** Explain how `csv.Sniffer` can guess a dialect. Answer:

1. What can it detect?
2. Why can it guess wrong?
3. When should you use it?
4. Why is an explicit dialect safer for a production pipeline?

**A17.** A 50 GB JSONL file must be processed on a machine with 16 GB of RAM. Answer:

1. Which approach should you avoid?
2. How do you stream the file?
3. How do you process it in batches?
4. How do you handle one bad line without losing the rest?

**A18.** A CSV exported on Windows contains `\r\n` line endings. Answer:

1. What does `newline=""` do?
2. What can happen if you omit it while writing?
3. Why should you not strip all `\r` characters blindly?
4. How do you verify round-trip behavior?

**A19.** Predict the behavior of `csv.DictReader` for:

1. an empty file
2. a file with only a header
3. a file with a header and one blank line
4. a file with duplicate header names

**A20.** A CSV row has too many fields. Answer:

1. Where does `DictReader` put the extra value?
2. What happens when a row has too few fields?
3. How do you detect either case?
4. Should the pipeline fail or quarantine the row?

**A21.** A CSV column contains ZIP codes `"01234"` and `"12345"`. Answer:

1. What happens if pandas infers the column as an integer?
2. How do you preserve the strings?
3. Why does this matter for joins?
4. How do you test the fix?

**A22.** Compare CSV and Parquet for a 100-million-row analytical table. Answer:

1. Which stores types?
2. Which supports column pruning?
3. Which is easier to inspect by hand?
4. Which is usually smaller and faster to scan?
5. Why might CSV still be required at an ingestion boundary?

**A23.** Compare gzip, zstd, and uncompressed Parquet. Answer:

1. Which usually gives the best compression ratio?
2. Which is easiest to stream?
3. Which supports predicate pushdown?
4. How do you choose based on CPU, storage, and interoperability constraints?

**A24.** Implement `read_jsonl(path: Path) -> Iterator[dict]` with:

- UTF-8 decoding
- blank-line skipping
- line-numbered errors
- a maximum line length
- a check that each decoded value is a JSON object

Then explain how you would test each failure mode.

---

## Group B — Schemas, validation, and type boundaries

**B1.** Write an explicit dtype mapping for a CSV with order ID, customer ID, amount in cents, status, and created timestamp. Answer:

1. Which fields should be strings?
2. Which should be integers?
3. Which should be parsed as dates?
4. Which should be categorical?
5. Why should you avoid relying on inference?

**B2.** Predict the outcome:

```python
pd.read_csv("data.csv", dtype={"amount_cents": "int64"})
```

when one value in `amount_cents` is empty. Then explain how a nullable integer dtype changes the behavior.

**B3.** A timestamp column contains `2026-01-01T00:00:00Z` and `2026-01-01T00:00:00` in different rows. Answer:

1. What does `pd.to_datetime(..., utc=True)` do?
2. Why is mixing naive and aware timestamps dangerous?
3. What should the pipeline do with the ambiguous row?
4. How do you store the result?

**B4.** Explain why money should be represented as integer cents or `Decimal`. Answer:

1. What error can binary floats introduce?
2. How do you parse a decimal string safely?
3. Why is `Decimal(0.1)` different from `Decimal("0.1")`?
4. When is a float acceptable?

**B5.** A boolean column contains `true`, `false`, `1`, `0`, `yes`, `no`, and an empty string. Answer:

1. How do you define the accepted values?
2. What should happen to an unknown value?
3. Why is `bool("false")` wrong?
4. How do you test all accepted variants?

**B6.** Define null tokens for a CSV. Answer:

1. Which strings should map to missing?
2. Why is an empty string ambiguous?
3. How do `keep_default_na` and `na_values` interact?
4. How do you verify the null count per column?

**B7.** The `Order` dataclass in the chapter validates `amount_cents >= 0` and a timezone-aware `created_at`. Answer:

1. Where is validation triggered?
2. What happens if an invalid record is constructed?
3. Why is a frozen dataclass useful here?
4. What validation is still missing for a real order?

**B8.** A schema requires `order_id`, `customer_id`, and `amount_cents`. Answer:

1. How do you detect a missing column?
2. How do you detect a missing value in a row?
3. What should the error contain?
4. Should validation stop at the first bad row?

**B9.** A new producer adds an extra column. Answer:

1. Is this usually a breaking change?
2. What should the consumer do?
3. How do you distinguish an expected addition from an unexpected one?
4. How do you record the schema version?

**B10.** A value `"10"` arrives for an integer column. Answer:

1. What is the difference between coercion and validation?
2. When is coercion acceptable?
3. When should the pipeline reject the row?
4. How do you make the policy explicit?

**B11.** Define a range check for `amount_cents` and `created_at`. Answer:

1. Which bounds are business rules?
2. What happens to future timestamps?
3. How do you report the offending values?
4. Should a range violation fail the batch or quarantine the row?

**B12.** A table should have one row per `order_id`. Answer:

1. How do you check uniqueness?
2. Which row wins if duplicates exist?
3. How does a primary key enforce the rule?
4. What should happen when the source violates the contract?

**B13.** Define referential integrity between orders and customers. Answer:

1. What does a foreign key enforce?
2. How do you find orphan orders?
3. Why can a left join hide orphans?
4. What should the pipeline do with an orphan?

**B14.** A status column allows `pending`, `paid`, `refunded`, and `cancelled`. Answer:

1. How do you validate the enum?
2. How should case and whitespace be handled?
3. What happens to an unknown status?
4. Why should the enum be versioned with the schema?

**B15.** A dataset has a `schema_version` field. Answer:

1. Why is a version string useful?
2. Where should it be stored?
3. How do consumers use it?
4. What should happen when the version is missing?

**B16.** Which schema changes are additive, and which are breaking?

1. adding a nullable column
2. adding a required column
3. renaming a column
4. widening an integer type
5. changing cents to dollars
6. changing a timestamp from local to UTC

**B17.** A producer changes `amount` from cents to dollars without renaming the field. Answer:

1. Why is this a breaking semantic change?
2. How can validation catch it?
3. What would you require from the producer?
4. How do you migrate existing data?

**B18.** Compare `None`, `float("nan")`, `pd.NA`, and `pd.NaT`. Answer:

1. Which belongs to which type?
2. Why does `x == x` fail for `NaN`?
3. How do you test for missing values uniformly?
4. Why should JSON and SQL null semantics be treated separately?

**B19.** A customer name arrives in decomposed Unicode form. Answer:

1. What is Unicode normalization?
2. Why can two visually identical names have different hashes?
3. Where should normalization happen?
4. What should be stored if the original spelling matters?

**B20.** A row fails validation. Answer:

1. What information should the error include?
2. How do you avoid logging the entire sensitive row?
3. How do you identify the row in the source?
4. How do you replay it after a fix?

**B21.** Design a quarantine table for invalid records. Include raw payload, error, expectation name, batch ID, and timestamp. Answer:

1. Why store the raw payload?
2. How do you prevent the quarantine from containing secrets forever?
3. How do you track replay status?
4. Who owns the quarantine?

**B22.** Compare a dataclass validator with a Pydantic model for ingestion. Answer:

1. Which gives more built-in coercion?
2. Which is lighter for internal records?
3. Which produces structured error locations?
4. Why should the choice be consistent at a boundary?

**B23.** A source reports distances in kilometers, but the schema does not record the unit. Answer:

1. Why is this a contract bug?
2. How do you represent units explicitly?
3. What should validation do when the unit is missing?
4. How do you migrate existing rows?

**B24.** Implement `validate_rows(rows: Iterable[dict], schema) -> tuple[list[Order], list[RejectedRow]]`. Answer:

1. How do you handle the first invalid row?
2. How do you keep processing the rest?
3. What does `RejectedRow` contain?
4. How do you test a file where every row is invalid?

---

## Group C — SQL and relational thinking

**C1.** Write a connection helper for SQLite that:

- uses an in-memory database for tests
- enables foreign keys
- returns rows as mappings
- sets a busy timeout

Then answer why `PRAGMA foreign_keys = ON` must be executed per connection.

**C2.** Rewrite this unsafe query using parameters:

```python
query = f"SELECT * FROM orders WHERE customer_id = '{customer_id}'"
```

Answer:

1. Which placeholder style does SQLite use?
2. Where do the parameters go?
3. Why is string escaping insufficient?
4. How do you test the injection path?

**C3.** Predict the result of:

```sql
SELECT * FROM orders WHERE id = '1' OR '1' = '1';
```

Then explain how parameterization prevents the second condition from being interpreted as SQL.

**C4.** Predict what is committed after:

```python
with con:
    con.execute("INSERT INTO t VALUES (1)")
    raise ValueError("boom")
```

Then explain the role of `with con:` in sqlite3.

**C5.** Compare `con.commit()`, `con.rollback()`, and letting the context manager exit with an exception. Answer:

1. Which operations are atomic?
2. What happens to uncommitted changes on close?
3. Why should you not leave a transaction open during a network call?
4. How do you test rollback?

**C6.** Rewrite a loop of 10,000 `execute` calls using `executemany`. Answer:

1. What are the arguments?
2. Why is it faster?
3. Is it automatically atomic?
4. How do you handle one bad row?

**C7.** A table has `order_id TEXT PRIMARY KEY`. Answer:

1. Does SQLite allow duplicate `order_id` values?
2. Does it allow `NULL` in a primary key column?
3. What happens on a duplicate insert?
4. How do you make a composite key?

**C8.** Predict the effect:

```sql
INSERT INTO documents (id, text, version)
VALUES (?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    text = excluded.text,
    version = excluded.version
WHERE excluded.version >= documents.version;
```

Then explain what happens when the incoming version is older.

**C9.** For a table with `customer_id` values `1`, `NULL`, and `2`, predict:

```sql
SELECT COUNT(*) FROM orders;
SELECT COUNT(customer_id) FROM orders;
SELECT COUNT(DISTINCT customer_id) FROM orders;
```

**C10.** Explain why this query may return no rows even though `2` is not in the subquery:

```sql
SELECT 2
WHERE 2 NOT IN (SELECT customer_id FROM orders);
```

Assume `orders.customer_id` contains a `NULL`. Then write a safe alternative.

**C11.** Compare an inner join and a left join for orders and customers. Answer:

1. Which rows are dropped by an inner join?
2. How are unmatched left rows represented?
3. How do you find customers with no orders?
4. Why can a left join still multiply rows?

**C12.** A customer table has two rows for customer `42`. Answer:

1. What happens when orders are joined to it?
2. How do you detect the duplicate?
3. Why is `validate="many_to_one"` useful in pandas?
4. What is the correct business decision?

**C13.** Write a query that returns customers with more than five orders and a total amount above 10,000 cents. Answer:

1. Which clause filters rows before grouping?
2. Which clause filters groups?
3. Why can you not use `WHERE total > 10000` on an aggregate alias?
4. How do you handle customers with no orders?

**C14.** Write a query that keeps the latest document row per `doc_id` using `ROW_NUMBER()`. Answer:

1. What does `PARTITION BY` do?
2. Why is `id DESC` needed as a tie-breaker?
3. Why must the window filter be outside the same `WHERE` clause?
4. How would you do this with a CTE?

**C15.** Write a query that shows each order's previous order amount for the same customer using `LAG`. Answer:

1. Which partition and order define “previous”?
2. What is the first row's `LAG` value?
3. How do you handle ties?
4. How would you compute a running total instead?

**C16.** Write a query that computes a running total of `amount_cents` per customer ordered by `created_at`. Answer:

1. Which window frame applies by default?
2. How do you include ties deterministically?
3. Why is row order important for a running total?
4. How does this differ from `GROUP BY` plus `SUM`?

**C17.** Explain why a CTE is useful for a multi-step query. Answer:

1. Does a CTE always materialize?
2. How does it improve readability?
3. How do you avoid repeating a window expression?
4. When might a subquery be preferable?

**C18.** A query filters on `customer_id`. Answer:

1. Which index would help?
2. How do you inspect the query plan in SQLite?
3. Why can an index slow down writes?
4. Why might the planner choose a scan anyway?

**C19.** A child table references a parent table. Answer:

1. What does `PRAGMA foreign_keys = ON` enable?
2. What happens when inserting a child with a missing parent?
3. What happens when deleting a referenced parent?
4. How do you test the constraint?

**C20.** Write SQLite queries for:

1. the current UTC timestamp
2. truncating a timestamp to a date
3. adding one day
4. filtering the last seven days

Then answer why storing timestamps as text requires a consistent format.

**C21.** Describe a staging-table merge for an upsert. Answer:

1. Which table is loaded first?
2. How do you deduplicate staging?
3. What is the transaction boundary?
4. When do you record the batch ID?
5. What happens if the process crashes after the merge?

**C22.** Compare hard delete, soft delete, and tombstone records. Answer:

1. Which preserves history?
2. Which complicates uniqueness?
3. How do downstream consumers know a row was deleted?
4. Why can absence from a partial batch not imply deletion?

**C23.** Two processes write to the same SQLite database. Answer:

1. What error can occur?
2. How does `busy_timeout` help?
3. Why is `BEGIN IMMEDIATE` useful for read-modify-write?
4. Why is SQLite often the wrong choice for high write concurrency?

**C24.** Predict the stored value and type affinity for inserting `"123"` into an `INTEGER` column. Then explain SQLite's type affinity and why it can mask schema mistakes.

**C25.** Implement a function that returns orders for a customer using a parameterized query and converts rows to dataclasses. Answer:

1. Where does the connection come from?
2. How do you avoid leaking `sqlite3.Row` objects to callers?
3. How do you handle an empty result?
4. How do you test with an in-memory database?

**C26.** For a filtering and aggregation task, compare doing the work in SQL versus loading the table into pandas. Answer:

1. Which approach reduces data transfer?
2. Which is easier to test locally?
3. Which scales better as the table grows?
4. When is pandas the better choice?

---

## Group D — pandas ingestion, transforms, and joins

**D1.** Predict the result of:

```python
reader = pd.read_csv("events.csv", chunksize=3)
print(type(reader))
print(len(list(reader)))
```

for a file with 10 data rows. Then explain how to process each chunk without holding all chunks in memory.

**D2.** Why should you use `usecols` when reading a wide CSV? Answer:

1. What does it save?
2. What happens to columns not listed?
3. How can it hide a schema change?
4. How do you validate the expected columns before dropping others?

**D3.** Predict the dtype and values after:

```python
pd.read_csv(path, dtype={"zip": "string", "amount_cents": "Int64"})
```

when one amount is missing. Then explain the difference between `int64` and `Int64`.

**D4.** A date column contains mixed formats. Answer:

1. What does `pd.to_datetime` do by default?
2. Why should you specify a format when possible?
3. How do you handle malformed dates?
4. Why can timezone inference be dangerous?

**D5.** Predict how `na_values=["", "NULL", "null"]` and `keep_default_na=False` affect an empty string. Then explain why the combination matters for identifiers.

**D6.** Convert a low-cardinality status column to `category`. Answer:

1. What memory benefit can it provide?
2. What happens to unknown values?
3. Why does `groupby` need `observed=True`?
4. When is `category` a poor choice?

**D7.** Estimate the memory of a DataFrame with 1,000,000 rows and columns:

- `id`: string, 20 bytes average
- `amount_cents`: int64
- `status`: category with 5 values
- `created_at`: datetime64

State your assumptions. Then explain why the estimate is only approximate.

**D8.** Predict the result:

```python
df = pd.DataFrame({"id": ["a", "a", "b"], "v": [1, 2, 3]})
print(df.drop_duplicates(subset=["id"], keep="last"))
```

Then explain what `keep=False` does.

**D9.** A table has duplicate order IDs with different timestamps. Answer:

1. How do you detect all duplicates?
2. How do you keep the latest row?
3. Why must you sort by a tie-breaker?
4. How can duplicates affect downstream metrics?

**D10.** Compare `fillna`, `dropna`, and explicit rejection. Answer:

1. When is each appropriate?
2. Why can filling with the mean leak information?
3. What should happen to a missing primary key?
4. How do you record the chosen policy?

**D11.** Predict the result of:

```python
s = pd.Series([1, None, 3], dtype="Int64")
print(s)
print(s.dtype)
print(s.sum())
```

Then explain how nullable dtypes differ from NumPy integer arrays.

**D12.** Predict the output of:

```python
s = pd.Series(["  Paid ", "paid", "PENDING"])
print(s.str.strip().str.lower().tolist())
```

Then explain why normalization should be applied before enum validation.

**D13.** Rewrite a row-wise loop:

```python
for _, row in df.iterrows():
    df.loc[_, "total"] = row["price"] * row["quantity"]
```

using a vectorized expression. Answer:

1. Why is the loop slow?
2. What happens if the index is not unique?
3. How do you handle nulls?
4. When is a vectorized expression harder to read?

**D14.** Predict the outcome:

```python
orders.merge(customers, on="customer_id", validate="many_to_one")
```

when `customers` has duplicate `customer_id` values. Then explain how the validation protects a pipeline.

**D15.** Explain what `indicator=True` adds to a merge. Answer:

1. Which values can appear?
2. How do you find left rows without a match?
3. How do you find right rows without a match?
4. Why is this safer than dropping unmatched rows silently?

**D16.** Compare `pd.concat([a, b])` and `pd.concat([a, b], ignore_index=True)`. Answer:

1. What happens to the index?
2. When does duplicate index matter?
3. How do you preserve source provenance?
4. Why is a reset index not a substitute for deduplication?

**D17.** Write a grouped aggregation that returns order count, unique customers, and total amount for each status. Answer:

1. Which aggregation functions are used?
2. How do you name the output columns?
3. Why should you use `observed=True` with categories?
4. How do you verify the result for one group by hand?

**D18.** Explain the difference between `groupby(...).agg(...)` and `groupby(...).transform(...)`. Answer:

1. Which returns one row per group?
2. Which returns the original shape?
3. How can `transform` be used to compute a group share?
4. Why can `transform` be more expensive?

**D19.** Predict the shape and index of:

```python
df.pivot_table(index="customer", columns="status", values="amount", aggfunc="sum", fill_value=0)
```

Then explain why duplicate `(customer, status)` rows do not raise by default.

**D20.** Explain when to use `pivot_table` versus `crosstab`. Answer:

1. What does `crosstab` count by default?
2. How do you pass values and an aggregation?
3. Why do categorical columns need care?
4. Which is easier for a frequency table?

**D21.** A DataFrame has a timezone-aware timestamp index. Predict the result of `.resample("D").sum()`. Then explain why the index must be sorted and how to handle irregular timestamps.

**D22.** Explain how a rolling window differs from a resample. Answer:

1. Which preserves the original frequency?
2. Which produces fixed calendar buckets?
3. How do you avoid leaking future data?
4. Why does the first window contain fewer observations?

**D23.** A timestamp column is in `America/New_York`. Answer:

1. How do you convert it to UTC?
2. What happens during a daylight-saving transition?
3. Why should you store the original timezone?
4. How do you group by local date without losing UTC?

**D24.** Explain how copy-on-write affects:

```python
subset = df[df["status"] == "paid"]
subset["amount_cents"] = subset["amount_cents"] * 2
```

Answer:

1. Is `subset` a view or a copy?
2. Does the assignment affect `df`?
3. Why should you use `.loc` for assignment?
4. How do modern pandas versions reduce ambiguity?

**D25.** Write a DataFrame to Parquet and read it back. Answer:

1. Which dtypes are preserved?
2. What happens to the index?
3. How do you verify the round trip?
4. Why is Parquet preferable to CSV for typed output?

**D26.** Process a 20 GB CSV with pandas. Answer:

1. How do you avoid loading the whole file?
2. How do you write partitioned output?
3. How do you handle an error in the middle of a chunk?
4. Why is a distributed engine or database often a better choice?

---

## Group E — Joins, aggregation, and windows

**E1.** Before joining orders to customers, how do you verify that `customers.customer_id` is unique? Write the check in SQL and pandas. Then explain why a unique constraint is stronger than a one-time check.

**E2.** Predict the result of `validate="many_to_one"` when the left key has duplicates and the right key is unique. Explain why this is allowed.

**E3.** A left table has three rows with the same key, and the right table has two rows with that key. Predict the number of joined rows. Then explain why this is a fanout bug unless the business meaning requires it.

**E4.** Write a left join and then count rows with no match. Answer:

1. Which column becomes null for unmatched rows?
2. Why can `COUNT(*)` not distinguish a match from an unmatched row?
3. How do you count unmatched rows correctly?
4. How does this differ from an anti-join?

**E5.** Write an anti-join that returns customers with no orders. Answer:

1. Which join type and filter produce the result?
2. How do you handle null keys?
3. How would you express it with `NOT EXISTS`?
4. Why is `NOT IN` risky here?

**E6.** Explain the difference between a semi-join and an inner join. Answer:

1. Which one can duplicate left rows?
2. How do you implement a semi-join in pandas?
3. How do you implement one in SQL?
4. When is a semi-join the right abstraction?

**E7.** Write a groupby on `(customer_id, status)` that counts rows. Answer:

1. What does the resulting index look like?
2. How do you flatten it?
3. Why should you use `observed=True` for categories?
4. How do you include groups with zero rows?

**E8.** Explain the difference between:

```python
df.groupby("customer").agg(total=("amount", "sum"), n=("id", "count"))
```

and a dictionary-style aggregation. Answer:

1. Which form names the output columns?
2. How do you apply different functions to different columns?
3. Why can MultiIndex columns complicate downstream code?
4. How do you flatten them?

**E9.** Compare `WHERE` and `HAVING`. Answer:

1. Which runs before grouping?
2. Which can reference aggregates?
3. Why can `WHERE amount > 0` be more efficient than filtering after aggregation?
4. How do you filter on a `SUM`?

**E10.** Write a query that ranks orders by amount within each customer using `RANK()` and another using `ROW_NUMBER()`. Answer:

1. How do ties differ?
2. Which produces gaps in the ranking?
3. Which is better for “top 3” with ties?
4. Why must the ordering be deterministic?

**E11.** Deduplicate a table to one row per `doc_id`, keeping the latest `updated_at` and breaking ties by the largest `id`. Write both a pandas expression and a SQL window query. Then explain why the tie-breaker matters.

**E12.** Write a running total of `amount_cents` per customer ordered by `created_at`. Answer:

1. Which window frame does the default use?
2. How do you include ties?
3. How do you compute a running count instead?
4. Why must the input be sorted or the window ordered explicitly?

**E13.** Explain `LAG` and `LEAD`. Answer:

1. What does each return for the first/last row?
2. How do you compute the difference from the previous order?
3. What happens with ties?
4. How do you handle a null previous value?

**E14.** Compute each customer's share of total revenue. Answer:

1. Which aggregate gives the denominator?
2. How do you avoid dividing by zero?
3. Why can a window `SUM` be simpler than a separate aggregation?
4. How do you round for presentation without changing the stored value?

**E15.** Predict the shape of a pivot table with 10 customers, 4 statuses, and `fill_value=0`. Then explain why duplicate `(customer, status)` rows do not cause an error.

**E16.** Use `melt` to turn wide monthly columns into long rows. Answer:

1. Which arguments identify the ID columns?
2. What are the output column names?
3. How do you preserve the month as a sortable value?
4. Why is long format often better for aggregation?

**E17.** Compare `pd.concat` with SQL `UNION ALL`. Answer:

1. Does either deduplicate?
2. How do you deduplicate after concatenation?
3. What happens to source columns that do not match?
4. How do you preserve provenance?

**E18.** Compare `UNION` and `UNION ALL`. Answer:

1. Which removes duplicates?
2. Which is usually faster?
3. How does SQL treat NULLs in duplicate removal?
4. When would you intentionally use `UNION ALL`?

**E19.** Truncate timestamps to day and month in SQL and pandas. Answer:

1. Which timezone should be used?
2. How do you avoid losing the original timestamp?
3. Why can date truncation change grouping results around midnight?
4. How do you test a daylight-saving boundary?

**E20.** Build a simple cohort table: for each customer's first order month, count orders in subsequent months. Answer:

1. How do you find the first order?
2. How do you compute the cohort month?
3. How do you compute the month offset?
4. How do you handle customers with only one order?

**E21.** Return the top 3 orders by amount per customer. Answer:

1. Which window function do you use?
2. How do you handle ties?
3. Why can a global `ORDER BY ... LIMIT` not solve this?
4. How do you include customers with fewer than three orders?

**E22.** Predict how `GROUP BY` treats `NULL` keys. Answer:

1. Are nulls grouped together?
2. How does pandas handle null group keys?
3. Why can this differ from SQL in edge cases?
4. How do you make the behavior explicit?

**E23.** For a small dataset, implement the same aggregation in SQL and pandas and compare the results. Answer:

1. Which output order is guaranteed?
2. Which null semantics differ?
3. How do you compare floating-point totals?
4. Which implementation would you keep in production?

**E24.** Implement a report that joins orders and customers, filters to paid orders, groups by segment, and returns order count, unique customers, and revenue. Use `validate` or a pre-join uniqueness check. Then explain how you would test the report with three hand-checked rows.

## Group F — Incremental loads, idempotency, and upserts

**F1.** A watermark is `2026-01-01T10:00:00Z`. Compare:

```sql
WHERE updated_at > :watermark
WHERE updated_at >= :watermark
```

Answer:

1. Which form can miss rows that share the boundary timestamp?
2. Which form reprocesses the boundary row?
3. Why does the second form require an idempotent write?
4. How can a tie-breaker on the primary key help?

**F2.** A pipeline reprocesses the last 30 minutes on every run to catch late data. Answer:

1. Why is this safer than a strict watermark?
2. What must the write do to avoid duplicates?
3. How do you choose the overlap window?
4. What happens at the boundary of the window?

**F3.** A row with an old `updated_at` arrives after the pipeline has advanced its checkpoint. Answer:

1. Why is this a late-arriving record?
2. Which strategies can recover it?
3. Why is a periodic full reconciliation useful?
4. How do you measure lateness?

**F4.** Define a deduplication key for a document feed where documents can be updated. Answer:

1. Which columns identify the entity?
2. Which column identifies the version?
3. What happens if two rows have the same key and version but different content?
4. How do you make the winner deterministic?

**F5.** Write an upsert for a `documents` table with `id`, `text`, `updated_at`, and `version`. Answer:

1. Which conflict target do you use?
2. What does `excluded` refer to?
3. How do you prevent an older version from overwriting a newer one?
4. What happens when the incoming version is equal?

**F6.** Explain a staging-table merge. Answer:

1. Why load into staging first?
2. How do you validate and deduplicate staging?
3. Which transaction contains the merge?
4. When is the batch marked complete?
5. What happens if the merge fails halfway?

**F7.** A full snapshot is loaded daily, and some rows have disappeared. Answer:

1. How do you detect deletions?
2. Why is comparing row counts insufficient?
3. How do you handle a partial snapshot?
4. What should happen to downstream references to deleted rows?

**F8.** A batch is replayed after an operator error. Answer:

1. What does idempotency guarantee?
2. Which operations must be idempotent?
3. How do you verify it with a test?
4. What should the batch metadata show?

**F9.** Explain “exactly-once” versus “at-least-once plus idempotent writes.” Answer:

1. Which is usually practical?
2. What failure mode does at-least-once allow?
3. What must the sink enforce?
4. Why is exactly-once hard across independent systems?

**F10.** Design a deterministic batch ID for a daily window. Answer:

1. Which fields should it include?
2. Why not use a random UUID?
3. What happens when the same window is reprocessed with different code?
4. Should the code version be part of the ID?

**F11.** A backfill reprocesses one year of data. Answer:

1. Where should the output go first?
2. How do you validate it?
3. How do you swap it into production?
4. How do you make the backfill resumable?
5. What do you do with downstream aggregates?

**F12.** The loader crashes after writing rows but before updating its checkpoint. Answer:

1. What happens on the next run?
2. Why is this safe if the write is idempotent?
3. What happens if the write is not idempotent?
4. Where should the checkpoint update occur?

**F13.** A new nullable column appears in the source. Answer:

1. Is this usually safe for incremental loading?
2. What must the target table do?
3. How do old rows represent the new column?
4. How do you test old and new files together?

**F14.** A daily partition is rewritten. Answer:

1. Why is writing directly to the live partition dangerous?
2. How do you stage and swap?
3. What happens to readers during the swap?
4. How do you keep the operation idempotent?

**F15.** A pipeline writes `events.parquet` directly. Answer:

1. What can a reader observe during the write?
2. How does a temporary file plus `os.replace` help?
3. What must be true about the temporary file's directory?
4. How do you handle a crash before replacement?

**F16.** Where should the checkpoint be updated relative to the target commit? Answer:

1. Before, after, or in the same transaction?
2. What happens if the checkpoint is updated first?
3. What happens if the target commits first?
4. Which failure is easier to recover from?

**F17.** A source provides a monotonically increasing `sequence` number instead of `updated_at`. Answer:

1. Why can a sequence be a better watermark?
2. What happens when sequence numbers have gaps?
3. What happens when they reset?
4. How do you handle multiple source partitions?

**F18.** Two rows have the same `updated_at`. Answer:

1. Why is `ORDER BY updated_at` insufficient for determinism?
2. What tie-breaker would you add?
3. How does the tie-breaker affect deduplication?
4. How do you test the tie case?

**F19.** A source sends a soft-delete flag instead of removing rows. Answer:

1. How should the target represent deletion?
2. How do downstream queries exclude deleted rows?
3. How does this interact with uniqueness constraints?
4. Why is a soft delete easier to audit?

**F20.** Explain slowly changing dimension type 2. Answer:

1. What does each row represent?
2. Which columns track validity?
3. How do you close the previous version?
4. How do you handle late-arriving changes?
5. Why is this harder than a simple upsert?

**F21.** An incremental order pipeline updates order status from `pending` to `paid`. A daily revenue aggregate only sums new rows. Answer:

1. Why is the aggregate wrong?
2. How can you recompute affected aggregates?
3. What is a changelog approach?
4. How do you test the correction?

**F22.** Write a test that runs an incremental loader twice on the same input and asserts the target is unchanged after the second run. Answer:

1. Which rows do you compare?
2. How do you handle timestamps?
3. What should the row count be?
4. What should the test do about side effects?

**F23.** A transaction inserts into a target table and updates a checkpoint table. Answer:

1. Why should both happen in one transaction?
2. What happens if they use separate transactions?
3. How do you test the crash between them?
4. Why should external API calls not be inside the transaction?

**F24.** Two workers run the same daily job at once. Answer:

1. What can happen to the target?
2. How does a unique run key help?
3. How does a database lock help?
4. What should the second worker do?

**F25.** Implement an idempotent loader that:

- reads a batch with a deterministic batch ID
- validates rows
- upserts by key and version
- records the checkpoint only after commit
- can be safely retried

Then answer which failure points you would inject in tests.

**F26.** List five incremental-load bugs and one control for each. Include a watermark mistake, a missing tie-breaker, and an early checkpoint.

---

## Group G — Orchestration, DAGs, retries, and checkpoints

**G1.** Define a DAG for a pipeline with extract, validate, transform, load, quality check, and publish. Answer:

1. Which tasks can run in parallel?
2. Which task must run last?
3. Where should a failure stop the run?
4. Where should quarantine branch off?

**G2.** Given dependencies `{b: {a}, c: {a}, d: {b, c}}`, list a valid topological order. Answer:

1. Which nodes have indegree zero initially?
2. Why are multiple valid orders possible?
3. How do you make the order deterministic?
4. What happens if `d` runs before `c`?

**G3.** Detect a cycle in `{a: {b}, b: {c}, c: {a}}`. Answer:

1. What does a topological sort return?
2. How do you report the cycle?
3. Why is a cycle a configuration bug?
4. How can a dynamic dependency create a cycle?

**G4.** A task fails with a transient timeout. Answer:

1. Should it retry?
2. How many attempts?
3. What backoff?
4. What must be true about the task's side effects?
5. What should happen after the final failure?

**G5.** Classify each as retryable or not: HTTP 503, HTTP 400, disk full, permission denied, database deadlock, malformed CSV row, rate limit. Explain each choice.

**G6.** A retry policy uses exponential backoff with a base of 1 second and a factor of 2. Answer:

1. What are the delays before attempts 2, 3, and 4?
2. Why add jitter?
3. What is a maximum-delay cap for?
4. Why should retries have a total deadline?

**G7.** Explain why every task should be idempotent even if it is retried only on failure. Answer:

1. What happens when a task succeeds but its acknowledgement is lost?
2. How does idempotency simplify catchup?
3. Which task types are hardest to make idempotent?
4. How do idempotency keys help?

**G8.** A scheduled run fails for three days. Answer:

1. What is catchup?
2. Should the pipeline run all missed windows?
3. How do you prevent a flood of concurrent backfills?
4. What happens if the source only retains seven days?

**G9.** A task can process 100 items concurrently. Answer:

1. Why limit concurrency?
2. Where does the limit live?
3. What happens when the queue is full?
4. How do you measure the effect?

**G10.** Two schedulers start the same job. Answer:

1. Why is a lock needed?
2. What should the lock key be?
3. What happens if a worker dies while holding the lock?
4. Why should the lock have a timeout?

**G11.** A long pipeline checkpoints after each stage. Answer:

1. What should a checkpoint contain?
2. When is it safe to resume?
3. What happens if the checkpoint is stale?
4. How do you avoid repeating a side effect?

**G12.** Define run metadata. Include run ID, pipeline version, batch ID, window, attempt, start/end, row counts, status, and error class. Answer:

1. Which fields are searchable?
2. Which fields are sensitive?
3. How long is it retained?
4. How does it support debugging?

**G13.** One task fails while independent tasks succeed. Answer:

1. Should the whole run be marked failed?
2. Can successful outputs be published?
3. How do downstream tasks know?
4. What should be rerun?

**G14.** A record cannot be parsed after three attempts. Answer:

1. Where should it go?
2. What metadata should accompany it?
3. How do you prevent it from blocking the batch?
4. How do you replay it later?

**G15.** A daily job is scheduled at midnight local time. Answer:

1. What happens during a daylight-saving transition?
2. Why is UTC scheduling often simpler?
3. How do you handle a missing or duplicated local hour?
4. How do you test the schedule?

**G16.** A dependency fails and downstream tasks are skipped. Answer:

1. What state should downstream tasks have?
2. How do you rerun from the failed point?
3. Why should skipped tasks not be marked successful?
4. What should alerts say?

**G17.** A pipeline publishes partial results before all quality checks pass. Answer:

1. What can consumers observe?
2. How do you stage output before publishing?
3. How do you make publishing atomic?
4. What should happen if a check fails after publication?

**G18.** Compare one large task with ten small tasks. Answer:

1. Which is easier to retry?
2. Which has more scheduling overhead?
3. Which gives better failure isolation?
4. How do you choose granularity?

**G19.** Explain how Airflow, Prefect, or Dagster differ from a cron script. Answer:

1. Which features do they add?
2. Do they make tasks idempotent automatically?
3. How do they represent dependencies?
4. What operational cost do they introduce?

**G20.** Implement a small DAG runner that:

- validates the graph
- runs tasks in dependency order
- retries transient failures
- stops on permanent failure
- records task results

Then explain how you would test a diamond-shaped graph.

**G21.** Write a test for retry behavior using a function that fails twice and succeeds on the third attempt. Answer:

1. How do you avoid real sleeping?
2. What should the test assert about attempt counts?
3. How do you test that a permanent error is not retried?
4. How do you test the total deadline?

**G22.** A producer writes faster than the consumer can process. Answer:

1. What is backpressure?
2. How do you bound the queue?
3. What happens when the queue is full?
4. Why is dropping data silently unacceptable?

**G23.** A retry storm overloads a source. Answer:

1. How does jitter help?
2. How does a circuit breaker help?
3. How do you cap total concurrency?
4. What should the pipeline do while the source is unavailable?

**G24.** List five orchestration mistakes and one control for each. Include non-idempotent tasks, early checkpoints, and unbounded concurrency.

---

## Group H — Data quality and contracts

**H1.** Define a data contract for an orders dataset. Include schema, key, freshness, volume, and ownership. Answer:

1. Which parts are machine-checkable?
2. Which parts require a human agreement?
3. How do you version the contract?
4. What happens when the producer breaks it?

**H2.** Define a null-rate expectation for a required column. Answer:

1. What threshold triggers an error?
2. Why can a zero-null rule be wrong for optional fields?
3. How do you report the offending rows?
4. What should happen to a single null in a billion rows?

**H3.** Define a uniqueness expectation for `order_id`. Answer:

1. Which columns form the key?
2. How do you count duplicates?
3. What should happen to duplicate rows?
4. Why is a database constraint stronger than a periodic check?

**H4.** Define range expectations for `amount_cents` and `created_at`. Answer:

1. Which bounds are inclusive?
2. Should future timestamps be allowed?
3. How do you handle a known historical outlier?
4. What is the difference between a warning and an error?

**H5.** Define a referential-integrity expectation for orders and customers. Answer:

1. Which side may be missing?
2. How do you count orphans?
3. What should happen to an orphan order?
4. How do you distinguish a late dimension row from a real orphan?

**H6.** The newest event is from 09:40 and the current time is 10:00. Compute freshness lag. Then answer what threshold would indicate a problem for an hourly pipeline.

**H7.** Yesterday's row count was 100,000. Today's is 60,000. Answer:

1. What kinds of causes are possible?
2. How do you compare against the same weekday?
3. What threshold should trigger an alert?
4. Why is a raw count insufficient without a baseline?

**H8.** A table has 5 duplicate keys out of 100 rows. Compute the duplicate rate. Then explain why the rate alone does not tell you whether the duplicates are harmful.

**H9.** Design a quarantine flow for records that fail validation. Answer:

1. Which fields does the quarantine record need?
2. Who reviews it?
3. How do you prevent duplicate quarantines?
4. How do you replay after a fix?
5. How do you expire quarantine data?

**H10.** Classify each quality failure as error, warn, or info: one null in an optional field, 40% nulls in a required field, a duplicate primary key, a new enum value, a freshness lag of two minutes. Explain each choice.

**H11.** Compare failing the pipeline with publishing with a warning. Answer:

1. When is a warning acceptable?
2. What must consumers see?
3. Who is accountable?
4. How do you prevent warning fatigue?

**H12.** A new source column appears and an old column disappears. Answer:

1. Which change is additive?
2. Which change is breaking?
3. How does the contract detect it?
4. What should the pipeline do before writing?

**H13.** Explain data profiling. Answer:

1. Which statistics would you compute per column?
2. How do you detect a sudden distribution change?
3. Why is profiling not the same as validation?
4. How often should it run?

**H14.** A numeric column's mean doubles but stays within its allowed range. Answer:

1. Which expectation catches this?
2. Why is a range check insufficient?
3. How do you compare with a historical baseline?
4. What action should an anomaly trigger?

**H15.** Define quality metrics to emit per run. Include null rate, duplicate rate, row count, quarantine count, freshness, and expectation failures. Answer:

1. Which are dimensions and which are values?
2. How do you avoid high-cardinality labels?
3. How do you alert on a trend rather than a single run?
4. How do you tie a metric to a batch ID?

**H16.** Write a contract test for a DataFrame schema. Answer:

1. Which columns and dtypes do you assert?
2. How do you handle optional columns?
3. How do you test nullability?
4. What should the failure message contain?

**H17.** Define ownership for a dataset. Answer:

1. Who is on call?
2. Who approves schema changes?
3. Who consumes the data?
4. Where is this recorded?

**H18.** A quality check fails after a deployment. Answer:

1. What do you inspect first?
2. How do you determine whether the code or the data changed?
3. How do you roll back?
4. What test prevents recurrence?

**H19.** A backfill produces different row counts from the original run. Answer:

1. Why can this be legitimate?
2. Which counts should match?
3. How do you investigate the difference?
4. When should the backfill be blocked?

**H20.** A quality report includes raw email addresses. Answer:

1. Why is this a privacy issue?
2. What should be reported instead?
3. How do you restrict access?
4. How do you test redaction?

**H21.** Define a cross-field expectation: `refunded_at` must be null when status is `pending`, and non-null when status is `refunded`. Answer:

1. How do you express the rule?
2. What happens for other statuses?
3. How do you report violations?
4. How do you test all branches?

**H22.** A timestamp column mixes UTC and local time. Answer:

1. Which quality check catches it?
2. How can the offset be inferred?
3. Why is silently converting dangerous?
4. What should the pipeline do?

**H23.** Implement three expectations: unique key, non-negative amount, and a freshness bound. Each should return evidence, not only a boolean. Then answer how to combine them into one report.

**H24.** Write a data quality report for one run containing expectation name, severity, row count, sample failures, and overall status. Answer:

1. What should the overall status be if one warning fails?
2. What should it be if one error fails?
3. How do you make the report machine-readable?
4. How do you link it to the batch and run ID?

---

## Group I — Testing, observability, lineage, privacy, and cost

**I1.** Write a unit test for a pure function that normalizes a status string. Answer:

1. Which cases are required?
2. How do you assert an exception?
3. Why should the test not need a database?
4. How do you parametrize it in pytest?

**I2.** Design fixture data for an orders pipeline. Answer:

1. Which rows are mandatory?
2. How do you represent nulls and duplicates?
3. How do you keep the fixture privacy-safe?
4. How do you make the expected output obvious?

**I3.** Write a test using an in-memory SQLite database. Answer:

1. Where is the schema created?
2. How do you isolate tests from each other?
3. How do you test a rollback?
4. Why is `:memory:` convenient but not identical to production?

**I4.** Explain golden-file testing for pipeline output. Answer:

1. What makes a good golden file?
2. Which fields must be normalized?
3. How do you update a golden file intentionally?
4. Why can a large golden file be hard to review?

**I5.** Describe a property-based test for a chunker or serializer. Answer:

1. Which property should hold for any input?
2. How do you generate valid and invalid inputs?
3. How do you shrink a failing case?
4. When is property-based testing overkill?

**I6.** Write an idempotency test for an upsert loader. Answer:

1. How many times do you run it?
2. Which state do you compare?
3. How do you handle timestamps?
4. What should the final row count be?

**I7.** Write a test for late-arriving data. Answer:

1. What is the initial watermark?
2. Which row arrives late?
3. What should the final table contain?
4. How do you assert that the late row updated the aggregate?

**I8.** Describe three failure-injection tests. Include a crash after write, a malformed file, and a stale checkpoint. Then explain what each test proves.

**I9.** Write a test for schema drift. Answer:

1. Which new column do you add?
2. Which missing column do you remove?
3. What should the pipeline do in each case?
4. How do you assert the error message?

**I10.** A pipeline calls `datetime.now()` inside a transform. Answer:

1. Why is the test flaky?
2. How do you inject a clock?
3. What should the production clock return?
4. How do you test a timezone boundary?

**I11.** A pipeline uses `uuid.uuid4()` for output IDs. Answer:

1. Why is this hard to test?
2. How do you inject an ID generator?
3. What should the deterministic test use?
4. When is a random ID still appropriate?

**I12.** Tests need realistic customer records. Answer:

1. Why should you not copy production PII?
2. How do you generate synthetic records?
3. How do you preserve realistic distributions?
4. What must never appear in test fixtures?

**I13.** Describe an integration test for an end-to-end batch. Answer:

1. Which real components does it use?
2. Which external systems are replaced?
3. What does it assert?
4. How long should it take?

**I14.** Define the structured log fields for a batch run. Include run ID, batch ID, stage, rows in/out, duration, and error class. Answer:

1. Which fields are high-cardinality?
2. Which fields should be indexed?
3. Which fields are sensitive?
4. How do you avoid logging every row?

**I15.** Define pipeline metrics. Answer:

1. Which are counters?
2. Which are gauges?
3. Which are histograms?
4. Which labels are safe?

**I16.** Explain lineage for a batch. Answer:

1. Which inputs and outputs are linked?
2. Which code version is recorded?
3. How does lineage help during an incident?
4. How do you represent lineage for a backfill?

**I17.** Define freshness and lag metrics. Answer:

1. What is the difference?
2. Where does the timestamp come from?
3. How do you alert on a stalled pipeline?
4. Why can a successful run still be stale?

**I18.** Define row-count monitoring. Answer:

1. Which baseline do you compare against?
2. How do you handle seasonality?
3. What threshold triggers an alert?
4. Why is a sudden increase as suspicious as a decrease?

**I19.** A dataset contains emails, phone numbers, and account IDs. Answer:

1. Which fields are PII?
2. Which can be hashed?
3. Which must be retained for business reasons?
4. How do you restrict access?
5. How do you test that logs exclude them?

**I20.** Define a retention policy for raw, validated, and serving layers. Answer:

1. Which layer is kept longest?
2. Which contains the most sensitive data?
3. How do backups affect deletion?
4. How do you prove a record was deleted?

**I21.** Define access control for a data lake. Answer:

1. Who can read raw data?
2. Who can read serving data?
3. How do you isolate tenants?
4. How do you audit access?

**I22.** Define cost metrics for a pipeline. Answer:

1. Which costs are per run?
2. Which are per byte scanned?
3. Which are per external API call?
4. How do you attribute cost to a team or tenant?
5. Which optimization would you try first?

**I23.** A pipeline writes 100,000 small Parquet files per day. Answer:

1. Why is this inefficient?
2. How do you compact them?
3. What file size should you target?
4. How do you preserve partitioning?

**I24.** Implement a pipeline observability record containing run ID, batch ID, row counts, freshness, quarantine count, duration, and lineage. Then answer how you would emit it without logging raw records.

---

## Group J — Integration, TypeScript contracts, and capstone

**J1.** Compare a Python dataclass with a TypeScript interface for a dataset contract. Answer:

1. Which one validates at runtime?
2. Which one is erased at runtime?
3. How do you represent optional fields?
4. Why should the contract be defined once and generated or checked?

**J2.** Define a JSON contract for a data pipeline status endpoint. Include run ID, dataset, status, row counts, freshness, quality status, and error code. Answer:

1. Which fields are required?
2. Which fields can change without a version bump?
3. How does a TypeScript client discriminate status?
4. How do you avoid leaking internal paths?

**J3.** Define a Python interface for a pipeline stage. Answer:

1. Which method should it expose?
2. What are its inputs and outputs?
3. Where do validation and metrics live?
4. How do you test a stage in isolation?

**J4.** Compare implementing a transformation in SQL versus pandas. Answer:

1. Which is easier to inspect?
2. Which pushes work to the database?
3. Which is easier to unit test locally?
4. When should both exist?

**J5.** Define configuration for a pipeline. Include source path, database URL, batch size, concurrency, watermark overlap, and quality thresholds. Answer:

1. Which values are secrets?
2. Which values differ by environment?
3. Which should be recorded with each run?
4. How do you validate the configuration at startup?

**J6.** A pipeline needs database credentials and an API token. Answer:

1. Where should they be stored?
2. How do you inject them?
3. How do you prevent them from appearing in logs or DAGs?
4. How do you rotate them?

**J7.** Define a CLI for the pipeline. Answer:

1. Which arguments are required?
2. How do you specify the window?
3. How do you support dry runs?
4. How do you prevent an accidental production run?

**J8.** Define logging for a pipeline run. Answer:

1. Which events are logged?
2. Which fields are structured?
3. How do you correlate logs with metrics and lineage?
4. What should never be logged?

**J9.** Define the test layers for a pipeline. Answer:

1. Which tests are pure unit tests?
2. Which use a temporary database?
3. Which hit an external system?
4. Which run in CI?
5. Which are manual?

**J10.** Define CI for a data pipeline. Answer:

1. Which checks run on every pull request?
2. How do you test SQL against a temporary database?
3. How do you prevent CI from touching production?
4. How do you test a scheduled job without waiting for the schedule?

**J11.** Explain data versioning. Answer:

1. What should be versioned?
2. How do you reference a dataset version downstream?
3. How do you reproduce a past output?
4. Why is a timestamp alone insufficient?

**J12.** Capstone: build a small batch pipeline. Requirements:

- land raw JSONL files immutably
- validate records with explicit schema and quarantine invalid rows
- load into SQLite with primary keys and transactions
- deduplicate and upsert by key and version
- compute a daily revenue aggregate
- record a watermark and batch metadata
- run quality checks for uniqueness, nullability, range, and freshness
- make reruns idempotent
- write structured logs and a lineage record
- test with temporary files and an in-memory database

Implement it, then answer:

1. Which failure was hardest to make idempotent?
2. What happens when a late record arrives?
3. How do you prove that a second run changes nothing?
4. Which quality check would you add first?
5. What would you change before handling 100 times more data?

**J13.** A pipeline reports success but the downstream dashboard shows stale data. Answer:

1. Which stages do you inspect?
2. How do you check the watermark?
3. How do you verify the publish step?
4. What log or metric would have caught it?
5. What test prevents recurrence?

**J14.** A backfill must reprocess six months of orders after a bug fix. Answer:

1. How do you avoid double-counting revenue?
2. Which partitions do you rewrite?
3. How do you validate before swapping?
4. How do you keep downstream consumers available?
5. How do you roll back?

**J15.** A pandas transformation uses too much memory. Answer:

1. Which columns can be dropped?
2. Which dtypes can be narrowed?
3. How do you process in chunks?
4. When should the work move to SQL?
5. How do you verify the chunked result matches the full result?

**J16.** Explain data engineering to a TypeScript backend developer in one page. Cover files and schemas, SQL, pandas, incremental loads, idempotency, orchestration, quality checks, and observability.

**J17.** Compare a TypeScript ETL script with a Python pipeline for this chapter. Answer:

1. Which libraries would each use?
2. How do types differ at runtime?
3. Which parts are easier in Python?
4. Which parts are easier in TypeScript?
5. Why does the data contract matter more than the language?

**J18.** Review this design: “A cron job downloads a CSV, overwrites the table every hour, and sends an email on failure.” List five problems and propose a corrected design.

**J19.** Write a runbook for a failed daily pipeline. Include diagnosis, safe retry, backfill, communication, and rollback. Answer:

1. Who is notified?
2. Which commands are safe to run?
3. How do you verify recovery?
4. What is recorded afterward?

**J20.** Explain this chapter to a TypeScript backend developer in one page. Cover immutable landing, explicit schemas, SQL joins and windows, pandas limits, watermarks, idempotent upserts, DAG retries, quarantine, testing, and cost. Include one thing that is easy in TypeScript but subtle in Python, and one thing Python/SQL makes easier.

---

## Before moving on

Check yourself against the chapter outcome without looking back at the notes:

- Land raw data immutably and write outputs atomically.
- Read CSV, JSONL, and Parquet with explicit encodings, schemas, and dtypes.
- Validate required fields, types, nullability, ranges, enums, uniqueness, and referential integrity.
- Use parameterized SQL, transactions, constraints, joins, aggregation, and window functions correctly.
- Push filters and aggregation into SQL when pandas would load too much data.
- Join on validated keys and detect fanout before it corrupts metrics.
- Use watermarks, overlap windows, deterministic batch IDs, and idempotent upserts.
- Record checkpoints only after successful commits and recover safely from partial failure.
- Build a DAG with retries, timeouts, concurrency limits, dead letters, and run metadata.
- Quarantine bad records with evidence and a replay path.
- Test pure transforms, SQL, idempotency, late data, schema drift, and failure injection.
- Emit row counts, freshness, quality, lineage, and cost without logging PII.
- Explain the contract, API response, and runbook to a TypeScript client.

If any group felt slow, redo a subset of its exercises from scratch before continuing to Chapter 12.
