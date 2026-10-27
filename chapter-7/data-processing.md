# Chapter 7 — Data Processing for AI and ML

Chapters 1–6 built Python fluency, APIs, and asynchronous services. This chapter adds the data layer: NumPy arrays for numerical work, pandas Series and DataFrames for labeled tabular data, CSV/JSON loading, missing-value handling, joins, grouping, exploratory analysis, and reproducible train/test splits that avoid data leakage.

Modern NumPy (2.x) and pandas (2.2+ or 3.x) are assumed. Where behavior differs between pandas 2 and 3, the lesson says so explicitly.

## Contents

1. Choosing between plain Python, NumPy, and pandas
2. NumPy arrays, shapes, and dtypes
3. Indexing, slicing, views, and copies
4. Broadcasting, vectorization, and reductions
5. pandas Series, DataFrames, and alignment
6. Loading, inspecting, and cleaning data
7. Transformations, strings, dates, and grouping
8. Joins, concatenation, and reshaping
9. Summaries, splits, reproducibility, and leakage
10. Common mistakes and conventions
11. Exercises (Groups A–J)

---

## 7.1 Choosing between plain Python, NumPy, and pandas

| Structure | Best for | Avoid when |
| --- | --- | --- |
| `list`, `dict`, `tuple` | small heterogeneous data, config, JSON-like trees | numeric loops over large data |
| `numpy.ndarray` | dense homogeneous numbers, arrays, linear algebra | labeled rows/columns, heterogeneous columns |
| `pandas.Series` | one labeled column with an index | pure numeric vector math with no labels |
| `pandas.DataFrame` | tabular data with named columns, joins, grouping, missing values | tiny records, deeply nested JSON, graph data |

A typical ML data pipeline:

```text
load → inspect schema → clean → transform → split → fit preprocessing on train → train/evaluate
```

Each stage should be reproducible and testable. Most production data bugs are not exotic: wrong dtypes, silently coerced values, missing rows, duplicated keys, leakage across splits, and non-deterministic ordering.

Use NumPy when the shape is the point. Use pandas when the labels and column names are the point. Use plain Python when the data is small and heterogeneous, or when the structure is recursive.

---

## 7.2 NumPy arrays, shapes, and dtypes

```python
import numpy as np

a = np.array([1, 2, 3])
b = np.array([[1.0, 2.0], [3.0, 4.0]])

print(a.dtype, a.shape, a.ndim, a.size)   # int64 (64, 3) 1 3
print(b.dtype, b.shape, b.ndim)           # float64 (2, 2) 2
```

Creating arrays:

```python
np.zeros((2, 3))                 # float64 zeros
np.ones((2, 3), dtype=np.int32)
np.full((2, 2), 7)
np.eye(3)                        # identity
np.arange(0, 10, 2)              # [0 2 4 6 8]
np.linspace(0, 1, 5)             # 5 evenly spaced values, endpoints included
rng = np.random.default_rng(42)
rng.normal(size=(2, 3))
rng.integers(0, 10, size=5)
```

- `dtype` is the element type. Arrays are homogeneous; assigning a float into an int array truncates or fails depending on context.
- `shape` is a tuple of dimension lengths. `reshape` changes it without changing the number of elements.
- `astype` converts dtype and normally returns a copy: `a.astype(np.float64)`.
- Use `np.random.default_rng(seed)` for new code. It avoids the global state of `np.random.seed`.
- `np.arange` with floats can include floating-point drift; use `np.linspace` when you need an exact count.

Shape manipulation:

```python
a = np.arange(6)              # shape (6,)
b = a.reshape(2, 3)           # shape (2, 3)
c = a.reshape(-1, 2)          # (3, 2); -1 infers the other dimension
d = b.T                       # (3, 2)
e = b.ravel()                 # flattened, view when possible
f = b.flatten()               # flattened copy
```

`reshape` raises `ValueError` if the element count does not match. Use `-1` for at most one dimension.

Dtype pitfalls:

```python
np.array([1, 2, 3]).dtype                  # int64 on typical 64-bit builds
np.array([1, 2.5]).dtype                   # float64: one float promotes the array
np.array([True, False]).dtype              # bool
np.array([1, "2"]).dtype                   # <U21: strings, numbers converted to text
np.uint8(250) + np.uint8(10)               # overflow wraps to 4
```

Do not mix strings and numbers in a numeric array. Fix the data before constructing the array.

Memory:

```python
arr = np.zeros((1000, 1000), dtype=np.float64)
arr.nbytes          # 8,000,000 bytes
arr.itemsize        # 8 bytes per element
```

---

## 7.3 Indexing, slicing, views, and copies

1D indexing and slicing:

```python
a = np.array([10, 20, 30, 40, 50])

a[0]          # 10
a[-1]         # 50
a[1:4]        # [20 30 40]
a[::2]        # [10 30 50]
a[::-1]       # reversed
```

2D indexing:

```python
m = np.array([[1, 2, 3],
              [4, 5, 6]])

m[0, 1]       # 2 (row 0, column 1)
m[1]          # row 1: [4 5 6]
m[:, 1]       # column 1: [2 5]
m[0:2, 1:]    # submatrix [[2, 3], [5, 6]]
m[..., 0]     # all preceding axes, index 0 on the last axis
```

Boolean masks:

```python
a = np.array([1, 2, 3, 4])
mask = a > 2
a[mask]                  # [3 4]
a[a % 2 == 0]            # [2 4]
a[(a > 1) & (a < 4)]     # parentheses are required with & and |
```

Use `&`, `|`, and `~` for elementwise boolean logic. Python's `and`, `or`, and `not` do not work on arrays.

Fancy indexing:

```python
a[[0, 2, 3]]             # [1 3 4]
a[[-1, 0]]               # [4 1]
m[[0, 1], [2, 0]]        # [3, 4]: pairs (0,2) and (1,0)
```

Views versus copies:

- Basic slicing (`a[1:4]`, `m[:, 0]`) returns a view: changing it changes the original.
- Boolean masks and fancy indexing return copies: changing the result does not change the original.
- `reshape` and `ravel` return a view when possible; `flatten` and `.copy()` always copy.

```python
a = np.arange(6)
view = a[::2]
view[0] = 99
print(a)                 # [99 1 2 3 4 5]

copy = a[[0, 2]]
copy[0] = -1
print(a)                 # unchanged at that position
```

Assignment with masks:

```python
a = np.array([1, -2, 3, -4])
a[a < 0] = 0             # [1 0 3 0]
```

`np.where` selects elementwise:

```python
np.where(a > 0, a, 0)
```

Sorting and searching:

```python
a = np.array([3, 1, 2])
np.sort(a)               # returns a sorted copy
a.sort()                 # sorts in place
np.argsort(a)            # indices that would sort
a.argmax(), a.argmin()
np.unique(a, return_counts=True)
```

`np.isnan(a)` builds a mask; `a == np.nan` is always false.

---

## 7.4 Broadcasting, vectorization, and reductions

Broadcasting aligns shapes from the right. Two dimensions are compatible if they are equal or one of them is `1`.

```python
m = np.array([[1, 2, 3],
              [4, 5, 6]])        # shape (2, 3)

m + 10                          # scalar broadcast
m + np.array([10, 20, 30])      # (3,) broadcasts across rows
m + np.array([[10], [20]])      # (2, 1) broadcasts across columns
m * 2
m / 2
```

Incompatible shapes raise `ValueError`:

```python
np.ones((2, 3)) + np.ones((2, 2))   # ValueError
```

Reductions and `axis`:

```python
m.sum()             # all elements
m.sum(axis=0)       # per column, result shape (3,)
m.sum(axis=1)       # per row, result shape (2,)
m.mean(axis=0, keepdims=True)   # shape (1, 3)
```

- `axis=0` reduces rows, producing one value per column.
- `axis=1` reduces columns, producing one value per row.
- `keepdims=True` preserves the reduced dimension as length 1, which helps with broadcasting.

NumPy reductions use `ddof=0` by default for standard deviation (population). pandas uses `ddof=1` (sample). Do not compare them casually.

```python
a = np.array([1.0, 2.0, np.nan])
a.mean()          # nan
np.nanmean(a)     # 1.5
np.nansum(a)      # 3.0
```

Vectorization:

```python
a = np.arange(1_000_000)

total = 0
for x in a:              # slow Python loop
    total += x

total = a.sum()          # fast C loop
```

Use ufuncs and array expressions (`a * 2 + 1`, `np.sqrt(a)`, `np.clip(a, 0, 1)`) instead of Python loops. Vectorized code is shorter, faster, and less error-prone, but it materializes intermediate arrays; for very large data, process in batches.

Matrix operations:

```python
A = np.array([[1, 2], [3, 4]])
B = np.array([[5, 6], [7, 8]])

A * B            # elementwise
A @ B            # matrix product
np.dot(A, B)     # matrix product for 2D
```

Use `@` for matrix multiplication. `*` is always elementwise.

A useful broadcasting example, row normalization:

```python
rows = np.array([[1.0, 2.0], [3.0, 4.0]])
totals = rows.sum(axis=1, keepdims=True)   # shape (2, 1)
normalized = rows / totals                 # (2, 2) / (2, 1)
```

Numerically stable softmax:

```python
def softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - logits.max(axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=-1, keepdims=True)
```

Subtracting the maximum prevents overflow. Broadcast along the last axis with `keepdims=True`.

---

## 7.5 pandas Series, DataFrames, and alignment

```python
import pandas as pd

s = pd.Series([10, 20, 30], index=["a", "b", "c"], name="score")
df = pd.DataFrame({
    "title": ["Dune", "Emma", "Dracula"],
    "price_cents": [1999, 899, 1299],
    "in_stock": [True, True, False],
})
```

Key attributes:

```python
s.values        # NumPy array (use s.to_numpy() for clarity)
s.index         # Index(['a', 'b', 'c'])
s.name          # 'score'
df.columns      # Index([...])
df.index        # RangeIndex(start=0, stop=3, step=1)
df.shape        # (3, 3)
df.dtypes       # dtype per column
```

Selection:

```python
df["title"]              # Series
df[["title", "price_cents"]]   # DataFrame
df.loc[0, "title"]       # label-based; row label 0, column label "title"
df.iloc[0, 1]            # position-based; row 0, column 1
df.loc[df["in_stock"], ["title"]]
df.iloc[0:2, 0:2]
```

- `.loc` uses labels. Slices include both endpoints.
- `.iloc` uses integer positions. Slices follow Python's exclusive-end rule.
- `df[boolean_series]` filters rows.
- `df["col"] = value` assigns a column.
- `df.loc[mask, "col"] = value` assigns conditionally.

Multiple conditions require parentheses:

```python
df[(df["price_cents"] > 1000) & df["in_stock"]]
df[df["title"].isin(["Dune", "Emma"])]
df.query("price_cents > 1000 and in_stock")
```

Index alignment is a core pandas semantic. Operations combine rows by index label, not by position:

```python
a = pd.Series([1, 2], index=["x", "y"])
b = pd.Series([10, 20], index=["y", "x"])
a + b
# x    21
# y    22
```

If labels do not match, the result includes the union of labels with missing values:

```python
c = pd.Series([1, 2], index=["x", "y"])
d = pd.Series([10], index=["y"])
c + d
# x    NaN
# y     12
```

Use `.reindex()`, `.reset_index(drop=True)`, or `.align()` when you need explicit control.

Copy-on-write and chained assignment:

```python
df["price_cents"][0] = 1          # does not update df; raises ChainedAssignmentError warning
df.loc[0, "price_cents"] = 1      # correct
df.loc[df["in_stock"], "price_cents"] = 999
```

Pandas 3 enables copy-on-write by default, and pandas 2.x can enable it. Under copy-on-write, a chained assignment such as `df["col"][mask] = value` modifies a temporary object and never updates the original DataFrame. Always assign through `.loc` in one step. Methods such as `drop`, `rename`, and `assign` return new objects; `inplace=True` is discouraged.

---

## 7.6 Loading, inspecting, and cleaning data

CSV loading:

```python
df = pd.read_csv(
    "books.csv",
    usecols=["isbn", "title", "price_cents", "published_at"],
    dtype={"isbn": "string", "price_cents": "Int64"},
    parse_dates=["published_at"],
    na_values=["", "NA", "N/A", "null"],
)
```

Useful options:

- `dtype` prevents unwanted inference. IDs with leading zeros must be strings: otherwise `"00123"` becomes `123`.
- `parse_dates` converts date columns. Without it, dates remain strings.
- `na_values` declares which tokens mean missing.
- `usecols` reduces memory and catches schema drift early.
- `nrows` is useful for inspection; `chunksize` streams large files.
- `sep`, `decimal`, `encoding`, and `quotechar` handle regional CSV formats.

JSON loading:

```python
df = pd.read_json("books.json", orient="records")
df = pd.read_json("events.ndjson", lines=True)
```

For nested JSON, normalize before building a DataFrame:

```python
records = [
    {"id": 1, "author": {"name": "Frank Herbert", "country": "US"}},
    {"id": 2, "author": {"name": "Jane Austen", "country": "UK"}},
]
df = pd.json_normalize(records)
# columns: id, author.name, author.country
```

Inspection:

```python
df.head()
df.tail()
df.sample(5, random_state=42)
df.info()                 # columns, non-null counts, dtypes, memory
df.describe()             # numeric summaries
df.describe(include="all")
df.shape
df.columns
df.dtypes
df.isna().sum()
df["title"].value_counts(dropna=False)
df.nunique()
```

Missing values:

```python
df.isna()
df.notna()
df.dropna()                                  # any column missing
df.dropna(how="all")                         # drop only fully empty rows
df.dropna(subset=["title", "price_cents"])   # require key fields
df.fillna({"price_cents": 0, "title": "unknown"})
df["price_cents"].fillna(df["price_cents"].median())
df["price_cents"].ffill()
```

- `NaN` is a float; integer columns with missing values become float unless you use nullable dtypes.
- `pd.NA` is pandas' nullable missing value; `Int64`, `boolean`, and `string` dtypes use it.
- `np.nan == np.nan` is false. Use `isna()`.
- `pd.NA == pd.NA` produces `pd.NA`, which is not a valid boolean; use `isna()` too.

Dtype conversion:

```python
df["price_cents"] = pd.to_numeric(df["price_cents"], errors="coerce")
df["published_at"] = pd.to_datetime(df["published_at"], errors="coerce")
df["isbn"] = df["isbn"].astype("string")
df["category"] = df["category"].astype("category")
```

`errors="coerce"` turns unparseable values into missing values. Without it, conversion raises. Decide deliberately which behavior you want, and log how many values were coerced.

Duplicates:

```python
df.duplicated().sum()
df.duplicated(subset=["isbn"]).sum()
df.drop_duplicates()
df.drop_duplicates(subset=["isbn"], keep="last")
```

A duplicate key before a merge silently multiplies rows. Check keys before joining.

Schema checks before modeling:

```python
required = {"isbn", "title", "price_cents"}
missing = required - set(df.columns)
if missing:
    raise ValueError(f"missing columns: {sorted(missing)}")

if not df["isbn"].is_unique:
    raise ValueError("isbn must be unique")
```

Libraries such as pandera can formalize these checks; plain assertions are enough to start.

---

## 7.7 Transformations, strings, dates, and grouping

Column operations:

```python
df = df.assign(
    price_dollars=df["price_cents"] / 100,
    title_upper=df["title"].str.upper(),
)
df = df.rename(columns={"price_cents": "price_cents"})
df = df.drop(columns=["unused"])
df = df[["isbn", "title", "price_dollars"]]
df = df.sort_values(["in_stock", "price_cents"], ascending=[False, True])
```

`apply` is flexible but slow:

```python
df["title_length"] = df["title"].apply(len)          # Series.apply
df["score"] = df.apply(lambda row: row["a"] + row["b"], axis=1)   # row-wise, slow
```

Prefer vectorized operations, `.str` methods, `.dt` accessors, `np.where`, and `map` when possible.

String methods:

```python
df["title"].str.lower()
df["title"].str.contains("dune", case=False, na=False)
df["title"].str.startswith("The")
df["title"].str.strip()
df["tags"].str.split(",")
df["tags"].str.split(",").explode()          # one row per tag
df["title"].str.extract(r"^(?P<series>[A-Za-z]+) #(?P<number>\d+)$")
df["title"].str.replace(r"\s+", " ", regex=True)
```

Datetime:

```python
df["published_at"] = pd.to_datetime(df["published_at"], utc=True)
df["year"] = df["published_at"].dt.year
df["month"] = df["published_at"].dt.month
df["weekday"] = df["published_at"].dt.day_name()
df["age_days"] = (pd.Timestamp.now(tz="UTC") - df["published_at"]).dt.days
df["published_month"] = df["published_at"].dt.to_period("M")
```

Binning and categoricals:

```python
df["price_band"] = pd.cut(
    df["price_cents"],
    bins=[0, 1000, 2000, float("inf")],
    labels=["cheap", "mid", "expensive"],
    right=False,
)
df["quartile"] = pd.qcut(df["price_cents"], q=4, labels=False)
df["category"] = df["category"].astype("category")
```

Grouping follows split-apply-combine:

```python
df.groupby("category")["price_cents"].mean()
df.groupby(["category", "in_stock"]).size()
df.groupby("category").agg(
    count=("isbn", "size"),
    mean_price=("price_cents", "mean"),
    max_price=("price_cents", "max"),
)
df.groupby("category")["price_cents"].transform("mean")   # same index as df
df.groupby("category").filter(lambda g: len(g) > 10)
```

- `size()` counts rows including missing group keys; `count()` counts non-null values per column.
- `transform` returns a result aligned to the original index, suitable for adding a column.
- `agg` with named aggregation gives clear column names.
- For categorical group keys, pass `observed=True` explicitly if you want only observed categories. Modern pandas defaults to that behavior; older versions may warn.

Useful aggregations: `sum`, `mean`, `median`, `min`, `max`, `std`, `var`, `count`, `nunique`, `first`, `last`.

---

## 7.8 Joins, concatenation, and reshaping

Merge:

```python
books = pd.DataFrame({"isbn": ["a", "b"], "title": ["Dune", "Emma"]})
sales = pd.DataFrame({"isbn": ["a", "a", "c"], "units": [2, 3, 1]})

pd.merge(books, sales, on="isbn", how="inner")
pd.merge(books, sales, on="isbn", how="left")
pd.merge(books, sales, on="isbn", how="outer", indicator=True)
```

Merge rules:

- `how`: `inner`, `left`, `right`, `outer`, `cross`.
- `on` must exist in both frames; `left_on`/`right_on` handle different names.
- `suffixes` resolves overlapping non-key columns.
- `validate` catches cardinality mistakes: `"one_to_one"`, `"one_to_many"`, `"many_to_one"`, `"many_to_many"`.
- `indicator=True` adds `_merge` with `left_only`, `right_only`, or `both`.
- If the right frame has duplicate keys, a left join multiplies rows. Check uniqueness first.
- Merge keys should have compatible dtypes. `1` and `"1"` do not match.

Set operations:

```python
books.merge(sales, on="isbn", how="left", indicator=True).query("_merge == 'left_only'")
books[books["isbn"].isin(sales["isbn"])]
```

Concatenation:

```python
pd.concat([df1, df2], ignore_index=True)          # rows
pd.concat([df1, df2], axis=1)                     # columns, aligned by index
pd.concat([df1, df2], keys=["train", "test"])     # MultiIndex labels
```

Column-wise concatenation aligns on the index. Row-wise concatenation aligns on columns; missing columns become NaN unless you validate them first.

Reshaping:

```python
long = df.melt(
    id_vars=["isbn"],
    value_vars=["price_q1", "price_q2"],
    var_name="quarter",
    value_name="price",
)

wide = long.pivot(index="isbn", columns="quarter", values="price")
summary = df.pivot_table(
    index="category",
    columns="in_stock",
    values="price_cents",
    aggfunc="mean",
    fill_value=0,
)
```

`pivot` fails on duplicate index/column pairs; `pivot_table` aggregates them. Validate that the reshape did not silently drop or duplicate rows.

---

## 7.9 Summaries, splits, reproducibility, and leakage

Exploratory summaries:

```python
df.describe()
df["price_cents"].mean(), df["price_cents"].median()
df["price_cents"].quantile([0.25, 0.5, 0.75, 0.95])
df["category"].value_counts(normalize=True, dropna=False)
pd.crosstab(df["category"], df["in_stock"], normalize="index")
df[["price_cents", "pages"]].corr(method="pearson")
df[["price_cents", "pages"]].corr(method="spearman")
```

Correlation is not causation and Pearson only captures linear relationships. Check scatter plots and group-level patterns. For categorical targets, compare distributions across classes and slices.

Outliers:

```python
q1, q3 = df["price_cents"].quantile([0.25, 0.75])
iqr = q3 - q1
lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
outliers = df[(df["price_cents"] < lower) | (df["price_cents"] > upper)]
```

Do not delete outliers by reflex; they may be valid or the most important examples. Decide based on the problem and document the rule.

Reproducible splits:

```python
rng = np.random.default_rng(42)
indices = rng.permutation(len(df))
n_train = int(0.8 * len(df))
train_idx = indices[:n_train]
test_idx = indices[n_train:]

train = df.iloc[train_idx].copy()
test = df.iloc[test_idx].copy()
```

Or use scikit-learn:

```python
from sklearn.model_selection import train_test_split

train, test = train_test_split(
    df,
    test_size=0.2,
    random_state=42,
    stratify=df["label"],
)
```

- Set and record a seed. `random_state` on every stochastic operation.
- Stratify classification splits to preserve class proportions.
- Group splits keep all rows from one entity (patient, user, document) in one split. Random row splits leak information across splits when rows are correlated.
- Time-based splits: train on the past, test on the future. Never shuffle time series across the boundary.
- Split before fitting imputers, scalers, encoders, feature selectors, and target encoders. Fit on train only.
- Duplicate rows across train and test inflate scores. Deduplicate before splitting or group by content.

Leakage examples:

- A feature derived from the target (for example, `refund_amount` when predicting `refunded`).
- Aggregate statistics computed on the full dataset (mean imputation, scaling, target encoding).
- Future information (using next month's totals to predict this month).
- IDs that encode the outcome or time.
- Rows from the same user or document in both train and test.
- Selecting features using the full dataset before splitting.

A safe preprocessing sequence:

```text
split rows (grouped/stratified/time-aware)
→ fit imputer/scaler/encoder on train
→ transform train and test with the fitted objects
→ fit model on train
→ evaluate on test
```

Save preprocessing with the model (a pipeline or an artifact directory) so inference uses identical transformations. Record data version, schema, seed, and split logic.

---

## 7.10 Common mistakes and conventions

Mistakes to avoid:

1. Chained assignment (`df["a"][mask] = x`); use `.loc`.
2. Comparing to `np.nan` or `pd.NA` instead of using `isna()`.
3. Using `and`/`or` instead of `&`/`|` on boolean Series/arrays.
4. Forgetting parentheses around conditions.
5. Assuming DataFrame arithmetic aligns by position instead of by label.
6. Letting pandas infer IDs or dates from CSV and losing leading zeros or timezones.
7. Using `float` for money; store integer cents or `Decimal`.
8. Using `iterrows()` or row-wise `apply` for large data instead of vectorized operations.
9. Dropping rows with any missing value before understanding why they are missing.
10. Filling missing values with statistics computed on the full dataset before splitting.
11. Merging without checking key uniqueness and silently multiplying rows.
12. Ignoring dtype changes after a merge or concat.
13. Splitting randomly when rows are grouped by user, patient, or document.
14. Shuffling time-ordered data.
15. Deleting outliers without documenting a rule.
16. Forgetting `random_state`/seed and getting unreproducible splits.
17. Treating correlation as causation or assuming Pearson captures nonlinearity.
18. Exposing a DataFrame's index or internal columns as model features by accident.

Conventions to adopt:

- Load with explicit dtypes, date parsing, and missing-value tokens.
- Validate schema, key uniqueness, and row counts at every stage.
- Keep raw data immutable; write transformed data to new frames/files.
- Prefer vectorized operations; measure before optimizing.
- Name columns clearly and avoid spaces/duplicates.
- Split first, fit preprocessing on train, then transform the rest.
- Log shapes, missingness, and class balance per split.
- Store seed, data version, and transformation code together.
- Test transformation functions on small, hand-checked frames.

---

# Exercises

Work each exercise before running code. Groups are ordered from recognition to implementation; within each group, difficulty increases. Do not look up answers — predict, run, reconcile, then rewrite from memory.

Use modern NumPy and pandas. Some dtype details differ between pandas 2.x and 3.x (especially the default string dtype); when a question depends on that, inspect the installed version instead of guessing. Keep the example DataFrames small so you can check results by hand.

## Group A — NumPy creation, shapes, and dtypes

**A1.** For each array, state `dtype`, `shape`, `ndim`, and `size`:

```python
import numpy as np

a = np.array([1, 2, 3])
b = np.array([[1.0, 2.0], [3.0, 4.0]])
c = np.array([True, False])
d = np.array([1, "2", 3.5])
```

Explain why `d` has the dtype it does.

**A2.** Predict the contents and `dtype` of each:

```python
np.arange(0, 10, 2)
np.arange(5)
np.linspace(0, 1, 5)
np.linspace(0, 1, 5, endpoint=False)
```

Then explain when to prefer `linspace` over `arange`.

**A3.** Predict the dtype and contents of:

```python
np.zeros((2, 3))
np.ones(4, dtype=np.int32)
np.full((2, 2), 7)
np.empty((2, 2))
```

Why is `np.empty` different from `np.zeros`, and when should you not rely on its values?

**A4.** Create a 4×4 identity matrix with `np.eye` and with `np.zeros` plus assignment. Then answer:

1. What is the dtype of `np.eye(4)`?
2. What is the difference between `np.eye` and `np.identity`?
3. How do you shift the diagonal?

**A5.** Predict the shapes:

```python
a = np.arange(12)
b = a.reshape(3, 4)
c = a.reshape(-1, 2)
d = a.reshape(2, -1)
e = a.reshape(5, -1)
```

Which line raises, and why?

**A6.** Explain the difference between `reshape`, `ravel`, and `flatten` in terms of shape and memory sharing. Then predict whether each mutation affects the original array:

```python
a = np.arange(6)
b = a.reshape(2, 3)
c = a.ravel()
d = a.flatten()

b[0, 0] = 99
c[1] = 88
d[2] = 77
```

**A7.** Predict each conversion:

```python
np.array([1.9, -1.9]).astype(np.int64)
np.array([1, 2, 3]).astype(np.float32)
np.array([1, 0, 2]).astype(bool)
np.array([1.5, np.nan]).astype(np.int64)
```

Which conversions lose information, and which raise?

**A8.** Predict the dtype of each and explain the promotion rules:

```python
np.array([1, 2.5])
np.array([1, True])
np.array([1, "2"])
np.array([1, 2], dtype=np.float32) + np.array([1, 2], dtype=np.float64)
```

**A9.** Predict the result of `np.uint8(250) + np.uint8(10)`. Explain why the result is not 260, and how to avoid the overflow.

**A10.** Predict `itemsize` and `nbytes` for:

```python
a = np.zeros((100, 50), dtype=np.float32)
b = np.zeros((100, 50), dtype=np.int64)
```

Then state which is more memory-efficient and whether the precision trade-off is acceptable for model features.

**A11.** Predict whether the two arrays are equal:

```python
rng1 = np.random.default_rng(42)
rng2 = np.random.default_rng(42)
a = rng1.normal(size=3)
b = rng2.normal(size=3)
```

Then explain why `np.random.seed(42)` is discouraged in new code.

**A12.** Predict `len(np.arange(0, 1, 0.1))` and the last value. Then explain why `np.linspace(0, 1, 10)` is a safer way to get exactly 10 values.

**A13.** Compare a 0-dimensional array, a NumPy scalar, and a Python scalar:

```python
a = np.array(5)
b = np.int64(5)
c = 5
```

Answer their types, shapes, and whether they support indexing. Why does this matter when writing functions that accept "a number or an array"?

**A14.** Predict the shapes:

```python
a = np.zeros((2, 3))
b = np.zeros((3, 4))
np.concatenate([a, np.zeros((1, 3))], axis=0).shape
np.concatenate([a, np.zeros((2, 4))], axis=1).shape
np.stack([a, a]).shape
np.stack([a, a], axis=1).shape
```

Then explain the difference between `concatenate` and `stack`.

**A15.** Use `np.split` to split `np.arange(12)` into three equal parts, then into chunks of size 5. Answer what happens when the array cannot be divided evenly and how `np.array_split` differs.

**A16.** Predict:

```python
a = np.array([1, 2, 3], dtype=np.int8)
b = np.array([100, 100, 100], dtype=np.int8)
a + b
```

State the result and explain integer overflow. Then write a safe version using a wider dtype.

**A17.** Create an array of 1,000,000 sequential floats with `np.arange`, then compute:

1. The sum with a Python loop.
2. The sum with `a.sum()`.
3. The mean with `a.mean()`.
4. The count of values above 500,000 using a vectorized expression.

State which versions are vectorized and why they are faster.

**A18.** Given `a = np.arange(6)`, write vectorized expressions for:

1. `[0, 2, 4]`
2. `[1, 3, 5]`
3. `[1, 4, 9, 16, 25]`
4. `[0, 0, 1, 1, 2, 2]`

Use slicing, reshaping, or arithmetic, not Python loops.

**A19.** Predict the dtype and shape:

```python
np.array([1, 2, 3], dtype=object)
np.array([1, None], dtype=object)
np.array([1, None], dtype=np.float64)
np.array([1, np.nan], dtype=np.int64)
```

Explain why object arrays are slow and when they are unavoidable.

**A20.** Given a boolean array `mask = np.array([True, False, True, True])`, predict:

```python
mask.sum()
mask.mean()
(~mask).sum()
np.where(mask, 1, 0)
```

Then explain how boolean masks are used for counting and selecting.

**A21.** Write a function `standardize(x)` that returns `(x - mean) / std` for a 1D float array, using `keepdims` where appropriate for a 2D input. State what happens when the standard deviation is zero.

**A22.** Write a function that creates a one-hot matrix for an integer label array:

```python
labels = np.array([0, 2, 1, 2])
# expected shape (4, 3)
```

Use `np.eye` and fancy indexing. Then explain why this is more efficient than a Python loop.

---

## Group B — NumPy indexing, slicing, views, and copies

**B1.** Given `a = np.array([10, 20, 30, 40, 50])`, predict:

```python
a[0], a[-1], a[1:4], a[::2], a[::-1], a[10]
```

Which expressions raise, and which produce unexpected results instead?

**B2.** Predict whether each slice is a view or a copy, then verify by mutating it:

```python
a = np.arange(10)
b = a[2:5]
c = a[::2]
d = a[[2, 4, 6]]
e = a[a > 5]
```

**B3.** Predict the final contents of `a`:

```python
a = np.arange(6)
a[1:4] = 0
a[::2] = -1
a[[0, 5]] = [100, 200]
print(a)
```

**B4.** Given `m = np.array([[1, 2, 3], [4, 5, 6], [7, 8, 9]])`, predict each:

```python
m[0, 1]
m[1]
m[:, 1]
m[1:, :2]
m[::2, ::2]
m[..., -1]
```

**B5.** Explain the difference between `m[0][1]` and `m[0, 1]`. For a 3D array, explain what `m[0][1][2]` does and why the comma form is clearer.

**B6.** Predict the output:

```python
m = np.arange(9).reshape(3, 3)
print(m[m > 4])
print(m[(m > 2) & (m < 7)])
print(m[(m > 2) | (m < 2)])
```

Then explain why `m[m > 2 and m < 7]` raises.

**B7.** Predict the shape and contents of `np.where(m > 4, m, 0)` for a 3×3 `m`. Then compare it with `m[m > 4]` and explain when each form is useful.

**B8.** Predict the result of fancy indexing with pairs:

```python
m = np.array([[1, 2, 3],
              [4, 5, 6],
              [7, 8, 9]])
rows = np.array([0, 2])
cols = np.array([1, 0])
m[rows, cols]
m[rows][:, cols]
```

Explain why the two results differ.

**B9.** Predict whether the following modifies `m`:

```python
m = np.arange(9).reshape(3, 3)
rows = [0, 1]
cols = [1, 2]
m[rows, cols] = 0
```

Then compare with `m[rows][:, cols] = 0`, which does not modify `m`. Explain why.

**B10.** Given `a = np.array([3, 1, 4, 1, 5, 9, 2, 6])`, predict:

```python
np.sort(a)
a.sort()
a
np.argsort(a)
a.argmax()
a.argmin()
```

Then state which operations return copies and which mutate.

**B11.** Predict the outputs:

```python
a = np.array([1, 2, 2, 3, 3, 3])
np.unique(a)
np.unique(a, return_counts=True)
np.bincount(a)
```

Then explain how to get the most frequent value.

**B12.** Predict the masks and selected values:

```python
a = np.array([1.0, np.nan, 3.0, np.inf])
np.isnan(a)
a[np.isnan(a)]
a[np.isfinite(a)]
np.nan_to_num(a)
```

Then explain why `a == np.nan` does not work.

**B13.** Predict the result of:

```python
a = np.array([0, 1, 2, 3])
a[np.array([True, False, True, False])]
a[np.array([1, 0])]
a[-2:]
```

Which use boolean indexing, which use fancy indexing, and which use basic slicing?

**B14.** Predict whether these raise or return a result:

```python
a = np.arange(5)
a[[0, 10]]
a[0:10]
a[-10:]
```

Explain the difference between out-of-bounds fancy indexing and out-of-bounds slicing.

**B15.** Predict the final array:

```python
a = np.arange(9).reshape(3, 3)
b = a.T
b[0, 1] = 99
print(a)
```

Explain the relationship between `a` and `b`.

**B16.** Predict the final array:

```python
a = np.arange(6)
b = a.reshape(2, 3)
b[0, 0] = 99
print(a)
c = b.reshape(3, 2)
c[1, 1] = 77
print(b)
```

Then state when `reshape` can return a copy.

**B17.** Predict the result of:

```python
a = np.array([0, 0, 1, 0, 2])
np.nonzero(a)
a[np.nonzero(a)]
```

Then rewrite the selection with a boolean mask.

**B18.** Compare list slicing and NumPy slicing:

```python
lst = [1, 2, 3, 4]
arr = np.array([1, 2, 3, 4])

lst_slice = lst[1:3]
arr_slice = arr[1:3]
lst_slice[0] = 99
arr_slice[0] = 99
```

Predict `lst` and `arr`, and explain the semantic difference.

**B19.** Use a mask to replace all negative values in an array with `0`, and all values above a threshold with the threshold. Then write the same logic using `np.clip` and compare.

**B20.** Given an array of scores, select the indices of the top 3 values. Answer:

1. Which function returns the sorted indices?
2. How do you get the top 3 in descending order?
3. How do you select the values themselves?
4. What happens with ties?

**B21.** Given a 2D array, select the last column for every row, and the first row for every column. Then explain why `arr[:, -1]` and `arr[-1]` are different.

**B22.** Explain the difference between `a[..., 0]`, `a[:, 0]`, and `a[0]` for a 3D array. Then state which axes each selects.

**B23.** Predict:

```python
a = np.arange(5)
a[1:3] = [10, 20, 30]
```

What happens, and why is the shape of the assignment important?

**B24.** Write a function that returns a copy of an array with all values above the 95th percentile clipped to that percentile. Answer whether clipping should be computed on the whole array or on training data only in an ML pipeline.

---

## Group C — Broadcasting, vectorization, and reductions

**C1.** Predict the shapes and contents:

```python
m = np.array([[1, 2, 3], [4, 5, 6]])
m + 10
m * 2
m / 2
m ** 2
```

**C2.** Predict the result and shape of each:

```python
m = np.ones((2, 3))
m + np.array([10, 20, 30])
m + np.array([[10], [20]])
m + np.array([[10, 20, 30]])
```

Which add a row, which add a column, and which add a scalar to every element?

**C3.** Predict which expressions raise and why:

```python
np.ones((3, 4)) + np.ones((3,))
np.ones((3, 4)) + np.ones((4,))
np.ones((3, 4)) + np.ones((3, 1))
np.ones((3, 4)) + np.ones((2, 4))
```

State the broadcasting rule in one sentence.

**C4.** Predict the output shape of:

```python
a = np.arange(3).reshape(3, 1)
b = np.arange(4).reshape(1, 4)
a + b
```

Then explain how this creates an outer-sum table.

**C5.** Given a 2D array of shape `(100, 5)`, compute:

1. The sum of each column.
2. The sum of each row.
3. The mean of each column.
4. The maximum of each row.
5. The overall mean.

For each, state the `axis` argument and the result shape.

**C6.** Predict the shapes with and without `keepdims`:

```python
a = np.ones((3, 4))
a.sum(axis=1).shape
a.sum(axis=1, keepdims=True).shape
a.mean(axis=0).shape
a.mean(axis=0, keepdims=True).shape
```

Then explain why `keepdims=True` simplifies normalization.

**C7.** Predict:

```python
a = np.array([1.0, 2.0, 3.0])
a.mean()
a.mean(axis=0)
np.std(a)
np.std(a, ddof=1)
```

Then explain why pandas `std()` differs from NumPy `std()` by default.

**C8.** Predict:

```python
a = np.array([1.0, np.nan, 3.0])
a.mean()
np.mean(a)
np.nanmean(a)
np.nansum(a)
np.nanstd(a)
```

Then explain when to use nan-aware reductions and when to investigate missingness instead.

**C9.** Predict:

```python
m = np.array([[1, 2, 3], [4, 5, 6]])
m.argmax()
m.argmax(axis=0)
m.argmax(axis=1)
np.unravel_index(m.argmax(), m.shape)
```

Explain why the flattened index is not the same as a row/column pair.

**C10.** Predict:

```python
a = np.array([1, 2, 3, 4])
a.cumsum()
a.cumprod()
np.diff(a)
np.diff(a, n=2)
```

Then explain how cumulative sums can compute a running total in one pass.

**C11.** Predict:

```python
A = np.array([[1, 2], [3, 4]])
B = np.array([[5, 6], [7, 8]])
A * B
A @ B
np.dot(A, B)
```

Then state when `*` and `@` are interchangeable.

**C12.** Normalize each row of a 2D array to sum to 1. Answer:

1. Which axis computes row totals?
2. Why is `keepdims=True` useful?
3. What happens for a row of zeros?
4. How would you avoid division by zero?

**C13.** Implement a stable softmax for a 2D array of logits. Answer:

1. Why subtract the maximum per row?
2. Which axis do you use?
3. What shape must `keepdims=True` preserve?
4. What happens with large logits if you skip the shift?

**C14.** Predict:

```python
a = np.array([-2, -1, 0, 1, 2])
np.clip(a, 0, 1)
np.clip(a, -1, 1)
np.maximum(a, 0)
np.minimum(a, 1)
```

Then compare `np.clip` with `np.where`.

**C15.** Predict:

```python
a = np.array([1.2, 1.5, 1.8, -1.5])
np.round(a)
np.floor(a)
np.ceil(a)
np.trunc(a)
```

Then explain why rounding half values can surprise you and how `np.rint` differs from `round`.

**C16.** Predict:

```python
a = np.array([1.0, np.e, 10.0])
np.log(a)
np.log1p(a)
np.exp(a)
np.expm1(a)
```

Which functions are numerically safer for small values, and why?

**C17.** Compute a pairwise Euclidean distance matrix for 3 points in 2D using broadcasting. Answer:

1. What shapes are involved?
2. How do you avoid `sqrt` of negative values?
3. Why is `np.sum((a - b) ** 2, axis=1)` preferable to a Python loop?
4. What is the memory cost of the broadcast?

**C18.** Create a one-hot encoding for `labels = np.array([0, 2, 1])` using `np.eye(3)[labels]`. Then answer what happens for a label equal to 3 and how to validate labels first.

**C19.** Predict:

```python
scores = np.array([0.2, 0.8, 0.5])
np.where(scores > 0.5, 1, 0)
(scores > 0.5).astype(int)
```

Then explain which form is clearer for producing a binary prediction array.

**C20.** Compare the timing of a Python loop and a vectorized expression for `a * 2 + 1` on one million elements. Answer:

1. Which is faster?
2. Why?
3. Which creates fewer Python objects?
4. When might the vectorized version use more memory?

**C21.** Predict the output shape:

```python
a = np.arange(6).reshape(2, 3, 1)
b = np.arange(4).reshape(1, 1, 4)
(a + b).shape
```

Then state which dimensions were broadcast.

**C22.** Write a function `zscore_columns(x)` for a 2D float array that standardizes each column using `axis=0` and handles zero-variance columns without producing NaNs. State whether the mean and std should be computed on training data only.

**C23.** A function receives `x` of shape `(n,)` or `(n, 1)`. Write code that produces a column vector of shape `(n, 1)` in both cases, then explain why `reshape(-1, 1)` is often clearer than adding dimensions manually.

**C24.** Implement `batch_mean` that processes a large array in chunks along axis 0 and computes the overall mean without concatenating the chunks. State why the chunk size affects memory but not the result.

---

## Group D — pandas Series, indexes, and alignment

**D1.** Predict the index, values, dtype, and name:

```python
import pandas as pd

s = pd.Series([10, 20, 30])
t = pd.Series([10, 20, 30], index=["a", "b", "c"], name="score")
```

Then explain what the index represents and why it is not just a row number.

**D2.** Construct a Series from a dict `{"a": 1, "b": 2, "c": 3}` and from a list with an explicit index. Answer:

1. What index does the dict version use?
2. What happens if the list is shorter than the index?
3. What happens if the index contains duplicates?
4. How do you rename a Series?

**D3.** Compare `s.values`, `s.to_numpy()`, and `list(s)`. Answer:

1. Which returns a NumPy array?
2. Which may share memory with the Series?
3. Which creates Python objects?
4. Which is safest for passing to a library?

**D4.** Given `s = pd.Series([10, 20, 30], index=["a", "b", "c"])`, predict:

```python
s["b"]
s.loc["b"]
s.iloc[1]
s[1]
```

Which forms are label-based, which are positional, and why is `s[1]` ambiguous or discouraged?

**D5.** Predict the result and index:

```python
a = pd.Series([1, 2, 3], index=["x", "y", "z"])
b = pd.Series([10, 20, 30], index=["z", "y", "x"])
a + b
```

Then explain why the values are not added positionally.

**D6.** Predict:

```python
s = pd.Series([1, 2], index=["a", "b"])
s.reindex(["b", "c", "a"])
s.reindex(["b", "c", "a"], fill_value=0)
```

Then explain when `reindex` is preferable to `reset_index`.

**D7.** Predict:

```python
a = pd.Series([1, 2], index=["x", "y"])
b = pd.Series([10], index=["y"])
a + b
a.add(b, fill_value=0)
```

Then explain why missing labels appear as NaN and how `fill_value` changes the result.

**D8.** Predict the dtype and output of:

```python
s = pd.Series(["a", "b", None])
s.dtype
s.isna()
s.fillna("unknown")
```

Compare the dtype in pandas 2.x and 3.x if you have both available. Then explain why relying on `object` dtype for strings is brittle.

**D9.** Predict the results:

```python
s = pd.Series([1, 2, 3, 4])
s > 2
(s > 2).sum()
(s > 2).mean()
s[s > 2]
```

Then explain how boolean Series are used for filtering and counting.

**D10.** Given `s = pd.Series(["low", "high", "low", "mid"])`, predict:

```python
s.map({"low": 1, "mid": 2, "high": 3})
s.replace({"low": 1, "mid": 2, "high": 3})
s.value_counts()
s.value_counts(normalize=True)
```

Then explain the difference between `map` and `replace` for unmapped values.

**D11.** Given a numeric Series, compare `s.apply(lambda x: x * 2)` with `s * 2`. Answer which is idiomatic and why.

**D12.** Predict the index and values:

```python
s = pd.Series([3, 1, 2], index=["c", "a", "b"])
s.sort_index()
s.sort_values()
s.nlargest(2)
```

Then explain why sorting the index is sometimes necessary before merging or concatenating.

**D13.** A Series has a duplicate index: `pd.Series([1, 2], index=["a", "a"])`. Predict what `s.loc["a"]` returns. Then explain why duplicate indexes make joins and assignments surprising.

**D14.** Predict:

```python
s = pd.Series([1, 2, 3], index=["a", "b", "c"])
s.reset_index()
s.reset_index(drop=True)
s.to_frame("value")
```

Then explain when you need to preserve the old index as a column.

**D15.** Predict:

```python
s = pd.Series([10, 20], index=["a", "b"])
s.set_index(pd.Index(["x", "y"]))
```

Then explain the difference between setting a new index and assigning a new index via `.index`.

**D16.** Compare `s.iloc[0:2]` and `s.loc["a":"b"]` for a Series with index `["a", "b", "c"]`. Answer which slice is inclusive and why.

**D17.** Predict the result of `s + 10` on a numeric Series, and `s.astype(str) + "!"` on a string Series. Then explain how dtype affects operator behavior.

**D18.** A Series contains `[1, None]` created without a dtype. Answer:

1. What dtype results?
2. What dtype results with `dtype="Int64"`?
3. How do you test for missing values in each?
4. Why can a nullable integer column be better for IDs?

**D19.** Write code that takes a Series of raw category strings, strips whitespace, lowercases them, and maps unknown values to `"other"`. Then state which operations are vectorized.

**D20.** Build a DataFrame from a dict of Series with different indexes and predict the resulting index and missing values. Then explain the column and index alignment rules.

---

## Group E — DataFrame selection, filtering, assignment, and copy semantics

**E1.** Predict the columns, index, shape, and dtypes:

```python
df = pd.DataFrame({
    "title": ["Dune", "Emma"],
    "price_cents": [1999, 899],
    "in_stock": [True, False],
})
```

Then explain why the index is not one of the columns.

**E2.** Build the same DataFrame from a list of records. Answer:

1. How are keys used?
2. What happens when records have different keys?
3. How do you control column order?
4. What is the index in this construction?

**E3.** Given a DataFrame, write expressions for:

1. Selecting one column as a Series.
2. Selecting two columns as a DataFrame.
3. Selecting the first row by position.
4. Selecting the row with index label `"a"`.
5. Selecting the value at row `"a"`, column `"price"`.

**E4.** Predict the types of:

```python
df["price_cents"]
df[["price_cents"]]
df.loc[:, "price_cents"]
df.iloc[:, 1]
```

Then explain why `df["col"]` and `df[["col"]]` behave differently.

**E5.** Predict the output of `df.loc[0]`, `df.loc[[0]]`, `df.loc[0, "title"]`, and `df.loc[:, ["title", "price"]]`. Then state the return type of each.

**E6.** Predict the output of `df.iloc[0]`, `df.iloc[[0]]`, `df.iloc[0, 1]`, and `df.iloc[0:2, 0:2]`. Then explain why `iloc` does not include the end of a slice.

**E7.** A DataFrame has a string index `["a", "b", "c"]`. Predict `df.loc["a":"b"]` and `df.iloc[0:2]`. Which includes both endpoints, and why?

**E8.** Given a DataFrame with numeric columns, write filters for:

1. Rows where price is above 1000.
2. Rows where the title contains "Dune".
3. Rows where price is above 1000 and in stock.
4. Rows where price is above 1000 or the title is "Emma".
5. Rows where the title is not "Dune".

Use parentheses where required.

**E9.** Predict whether each filter works:

```python
df[df["price"] > 1000 and df["in_stock"]]
df[(df["price"] > 1000) & (df["in_stock"])]
df[df["price"] > 1000 & df["in_stock"]]
df[~df["title"].isin(["Dune"])]
```

Explain the operator precedence problem in the third expression.

**E10.** Use `.isin` to filter rows with categories `["fantasy", "sci-fi"]`. Then compare with chained `==` conditions. Which scales better with many values?

**E11.** Rewrite this filter with `.query`:

```python
df[(df["price_cents"] > 1000) & (df["in_stock"])]
```

Then answer what happens if a column name contains a space and how `query` handles it.

**E12.** Use `.between` to select prices between 500 and 2000 inclusive. Answer whether the bounds are inclusive and how to make them exclusive.

**E13.** Predict the effect of:

```python
df["price_dollars"] = df["price_cents"] / 100
df = df.assign(price_dollars=df["price_cents"] / 100)
```

Then explain which mutates `df` and which returns a new DataFrame.

**E14.** Given a mask, write a single `.loc` assignment that sets `in_stock` to `False` for all rows where price is above 5000. Then explain why `df[mask]["in_stock"] = False` is wrong.

**E15.** Predict whether `df` changes:

```python
df["price_cents"][0] = 1
```

Then state the correct `.loc` form and the warning you may see. Explain how copy-on-write changes the consequence of chained assignment.

**E16.** Compare:

```python
view = df[["title"]]
copy = df[["title"]].copy()
```

Then mutate `view` and `copy` and explain which affects `df`. Why is explicitly copying important when you intend to modify data?

**E17.** Given a DataFrame, write expressions to drop:

1. A column.
2. Two columns.
3. Rows with index labels `[0, 2]`.
4. Rows where a value is missing in a key column.
5. Duplicate rows.

Then explain which operations return a new frame.

**E18.** Rename columns with `rename`, then reorder columns. Answer what happens if two columns end up with the same name and why duplicate column names cause ambiguous selection.

**E19.** Predict:

```python
df = pd.DataFrame({"id": [10, 20], "value": [1, 2]})
df.set_index("id")
df.reset_index()
```

Then explain how to reset an index without turning it into a column.

**E20.** Given a DataFrame, sort by `in_stock` descending and `price_cents` ascending. Answer:

1. How do you specify mixed directions?
2. Is the sort stable?
3. How do you sort by index instead?
4. What happens to the old index after sorting?

**E21.** Use `nlargest` to get the top 3 books by price. Then compare with `sort_values(...).head(3)` and explain when `nlargest` is preferable.

**E22.** Use `sample(frac=0.2, random_state=42)` to take a random subset. Answer:

1. What does `frac` mean?
2. What does `random_state` guarantee?
3. What is the difference between `sample` and `train_test_split`?
4. Why is sampling without a seed a reproducibility bug?

**E23.** Predict `df.head()`, `df.tail(2)`, and `df.sample(2, random_state=0)` for a small frame. Then explain what each is useful for during inspection.

**E24.** Transpose a DataFrame with mixed dtypes. Answer:

1. What happens to dtypes?
2. Why can a transpose turn a numeric column into an object column?
3. When is transposing a DataFrame a sign that the data shape is wrong?
4. What is the pandas equivalent of a NumPy transpose?

## Group F — Loading, inspecting, and cleaning data

**F1.** A CSV has a header row, comma separators, and an `isbn` column containing values like `"00123"`. Predict what happens with `pd.read_csv("books.csv")` and explain three ways the leading zeros can be lost or preserved.

**F2.** A CSV has no header and columns in the order `isbn, title, price`. Write the `read_csv` call that assigns those names. Then answer how the resulting index differs from the default.

**F3.** Use `usecols` to load only `title` and `price_cents`. Answer:

1. What happens if one requested column is missing?
2. Why is `usecols` useful beyond memory savings?
3. Does it change the row order?
4. How would you keep the ISBN as the index?

**F4.** Load a CSV with `dtype={"isbn": "string", "price_cents": "Int64"}`. Answer:

1. What does the `Int64` dtype allow that `int64` does not?
2. What happens when a price cell is empty?
3. Why is `float` a poor choice for money?
4. How would you validate that prices are non-negative?

**F5.** Compare loading a date column with and without `parse_dates`. Answer:

1. What dtype results in each case?
2. What operations become possible only after parsing?
3. What happens to an unparseable date?
4. How do you handle mixed date formats?

**F6.** A CSV uses `"N/A"`, `"-"`, and empty strings for missing values. Write the `na_values` configuration and explain how it interacts with `keep_default_na`.

**F7.** A European CSV uses semicolons as separators and commas as decimal marks. Write the `read_csv` call. Then answer what happens if you forget `decimal` and why `"1,50"` might become a string.

**F8.** Compare `nrows=100` with `chunksize=100`. Answer:

1. Which loads a small sample?
2. Which returns an iterator of DataFrames?
3. How do you compute a running count per chunk?
4. Why is chunking useful for files larger than memory?

**F9.** A JSON file is a list of records. Answer which `orient` value to pass and why you should pass it explicitly rather than relying on the default.

**F10.** An NDJSON file has one JSON object per line. Answer which `read_json` option is required and what error or shape results without it.

**F11.** Run `df.info()` and answer what it reports for:

1. Column names and dtypes.
2. Non-null counts.
3. Memory usage.
4. Why `info()` is often the first inspection command.

**F12.** Compare `df.describe()` with `df.describe(include="all")`. Answer:

1. Which columns are included by default?
2. What statistics are shown for numeric columns?
3. What changes for categorical/string columns?
4. Why can the output be misleading for ID columns?

**F13.** Write expressions for the number and percentage of missing values per column. Then answer why `df.isna().sum()` is better than `df.isnull().any()` for planning cleaning.

**F14.** Predict the difference between:

```python
df.dropna()
df.dropna(how="all")
df.dropna(subset=["title", "price_cents"])
df.dropna(thresh=3)
```

Then state which is safest for a dataset where some optional columns are usually missing.

**F15.** Fill missing `price_cents` with the median computed on the same DataFrame. Answer:

1. Why is this acceptable for EDA but dangerous before a train/test split?
2. Where must the median be computed in an ML pipeline?
3. What happens if the test set has a different distribution?
4. How would you store the training median for inference?

**F16.** Compare `ffill()` and `bfill()` on a time-ordered Series. Answer:

1. Which direction each propagates values?
2. Why are they dangerous when rows are not actually ordered?
3. How do you limit the propagation distance?
4. What should happen to leading values with `ffill`?

**F17.** Predict:

```python
s = pd.Series([1.0, np.nan, 3.0])
s == np.nan
s.isna()
s.fillna(0)
```

Then explain why `s == np.nan` returns all `False`.

**F18.** Predict what happens when `pd.NA` is used in an `if` condition or as a boolean mask, and state the error. Then show the correct check with `isna()`.

**F19.** Compare `int64`, `Int64`, `float64`, and `boolean` for a column with missing values. Answer:

1. Which one can store an integer ID and `pd.NA`?
2. What happens to `int64` when a value is missing?
3. Which dtype should be used for a true/false flag with missing values?
4. How do these behave in arithmetic and aggregation?

**F20.** Predict the result of:

```python
pd.to_numeric(pd.Series(["1", "2", "x"]), errors="coerce")
pd.to_numeric(pd.Series(["1", "2", "x"]), errors="raise")
pd.to_numeric(pd.Series(["1", "2", "x"]), errors="ignore")
```

State what your installed pandas version does for the third call. Then explain why silently leaving unparseable values unconverted is a bad default for production data, regardless of whether the option still exists.

**F21.** Predict:

```python
df = pd.DataFrame({"isbn": ["a", "a", "b"], "price": [1, 1, 2]})
df.duplicated()
df.duplicated(subset=["isbn"])
df.duplicated(subset=["isbn"], keep=False)
```

Then explain what `keep=False` marks.

**F22.** Use `drop_duplicates(subset=["isbn"], keep="last")` and explain the order of operations. Then answer what happens if the duplicate rows have different prices.

**F23.** Predict `value_counts()` with and without `dropna=False`. Answer:

1. Which value is excluded by default?
2. How do you get proportions?
3. How do you sort by index instead of count?
4. Why can `value_counts` hide a data-quality problem?

**F24.** Write a schema check that verifies required columns exist, the row count is positive, `isbn` is unique, and `price_cents` is non-negative. Answer where this check belongs in a pipeline and what it should do on failure.

**F25.** Normalize this nested record with `pd.json_normalize` and predict the resulting column names:

```python
records = [
    {"id": 1, "author": {"name": "Frank Herbert", "country": "US"}},
    {"id": 2, "author": {"name": "Jane Austen", "country": "UK"}},
]
```

Then explain how to flatten a list of tags into one row per tag.

**F26.** A CSV contains commas inside quoted titles and a non-UTF-8 encoding. Answer:

1. Which `read_csv` parameters matter?
2. What happens if quoting is misinterpreted?
3. How do you detect an encoding problem?
4. Why should you not silently replace undecodable bytes?

---

## Group G — Transformations, strings, dates, and grouping

**G1.** Given a DataFrame, write one `assign` call that adds:

- `price_dollars` as cents divided by 100.
- `title_length` as the string length.
- `is_expensive` as a boolean above 2000 cents.

Then explain why `assign` is convenient for reproducible transformations.

**G2.** Predict:

```python
s = pd.Series(["low", "high", "unknown"])
s.map({"low": 1, "high": 2})
s.replace({"low": 1, "high": 2})
```

Then explain when to use `map` and when to use `replace`.

**G3.** Write a row-wise `apply` that labels a book as `"cheap"`, `"mid"`, or `"expensive"` from its price. Then rewrite it with `pd.cut` and compare readability and performance.

**G4.** Given a title Series, write vectorized expressions for:

1. Lowercase all titles.
2. Find titles containing "dune" case-insensitively.
3. Remove leading and trailing whitespace.
4. Replace multiple spaces with one.
5. Count characters after trimming.

State which operations use the `.str` accessor.

**G5.** A `tags` column contains comma-separated values such as `"fantasy, adventure"`. Write code to create one row per tag, then count tag frequency. Answer which pandas methods are involved.

**G6.** Use a regex to extract a series name and number from titles like `"Dune #1"` and `"Emma #2"`. Answer:

1. Which method returns a DataFrame of groups?
2. How do named groups affect column names?
3. What happens to non-matching rows?
4. How do you avoid leaking the regex into unrelated columns?

**G7.** Convert a string date column with mixed formats to datetime. Answer:

1. Which function parses dates?
2. What does `errors="coerce"` do?
3. How do you handle timezones?
4. Why is `dayfirst` important for ambiguous dates?

**G8.** Given a datetime column, write expressions for year, month, day of week, and a `YYYY-MM` period. Answer which accessor provides these features and whether the result is numeric, string, or categorical.

**G9.** Compute the number of days between two datetime columns. Answer:

1. What type results from subtraction?
2. How do you get an integer number of days?
3. What happens when one column is timezone-aware and the other is naive?
4. Why can calendar months not be computed as a fixed number of days?

**G10.** Compare `tz_localize` and `tz_convert`. Answer:

1. Which adds a timezone to naive timestamps?
2. Which converts an aware timestamp to another timezone?
3. What happens if you localize an already-aware column?
4. Why should storage use UTC and display use local time?

**G11.** Use `pd.cut` to bin prices into `[0, 1000)`, `[1000, 2000)`, and `[2000, ∞)`. Answer:

1. What does `right=False` change?
2. What happens to a value exactly 1000?
3. How do you keep the bin labels as strings?
4. What happens to missing values?

**G12.** Use `pd.qcut` to split prices into quartiles. Answer:

1. What does `q=4` mean?
2. How do ties affect bin edges?
3. What does `labels=False` return?
4. Why is qcut useful for balanced bins but dangerous on tiny datasets?

**G13.** Convert a low-cardinality string column to `category`. Answer:

1. What memory benefit is expected?
2. What operations still work?
3. How do you control category order?
4. What happens when grouping with unobserved categories, and how does `observed` matter?

**G14.** Sort a DataFrame by category and then price. Answer:

1. How do you sort a categorical column by its category order rather than alphabetically?
2. How do you sort descending on one column and ascending on another?
3. What happens to the index after sorting?
4. How do you sort by the index?

**G15.** Given a DataFrame with `category` and `price_cents`, compute total and average price per category. Answer which methods you use and what the resulting index is.

**G16.** Write a named aggregation that returns `count`, `mean_price`, and `max_price` per category, with clear output column names. Then explain why named aggregation is more maintainable than renaming afterward.

**G17.** Compare `groupby(...).mean()` with `groupby(...).transform("mean")`. Answer:

1. Which returns one row per group?
2. Which returns one row per original row?
3. How is the result aligned?
4. When would you use `transform` to add a feature?

**G18.** Use `groupby(...).filter(...)` to keep only categories with more than 10 rows. Answer how `filter` differs from boolean row filtering and what it returns.

**G19.** Predict the difference between `groupby("category").size()` and `groupby("category")["price"].count()`. Then explain why one includes missing values and the other does not.

**G20.** Group by two columns and compute a sum. Answer:

1. What kind of index results?
2. How do you flatten it back to columns?
3. How do you sort the result?
4. What happens with missing keys by default?

**G21.** Use `groupby("category", dropna=False)` on a column with missing categories. Answer how the output changes and why the default drops them.

**G22.** Build a pivot table of mean price by category and stock status. Answer:

1. Which function is appropriate?
2. What happens to missing category/stock combinations?
3. How do you fill them?
4. Why is `pivot_table` safer than `pivot` when keys repeat?

**G23.** Convert a wide quarterly price table to long format with `melt`. Answer:

1. Which columns are ID variables?
2. What are the output column names?
3. How do you rename them?
4. How would you reverse the operation?

**G24.** Replace sentinel values such as `-1` and `"unknown"` with missing values. Answer why this should happen before imputation and how it affects dtype.

**G25.** Compare `df.where(cond, other)` and `df.mask(cond, other)`. Answer which replaces values where the condition is true and which replaces where it is false.

**G26.** Clip a numeric column to a plausible range. Answer:

1. How do you use `clip` with lower and upper bounds?
2. Why is clipping sometimes better than dropping outliers?
3. What must you compute on training data only?
4. How do you record the clipping bounds for inference?

---

## Group H — Joins, concatenation, and reshaping

**H1.** Given `books` and `sales` with a shared `isbn` column, predict the result of an inner merge. Answer:

1. Which rows survive?
2. What happens to duplicate ISBNs on either side?
3. How do you verify the merge key is unique before joining?
4. What index does the result have?

**H2.** Compare `how="left"`, `how="right"`, and `how="outer"` for the same two frames. Answer which rows survive and how missing matches are represented.

**H3.** Use `indicator=True` and predict the values of the `_merge` column. Then write a query that returns only rows that exist on the left but not the right.

**H4.** Both frames have a non-key column named `price`. Answer what happens by default and how `suffixes` changes the result. Then explain why duplicate column names are dangerous after a merge.

**H5.** Use the `validate` argument with `"one_to_one"`, `"one_to_many"`, and `"many_to_one"`. Answer which cardinality each permits and what error is raised when the data violates it.

**H6.** A left frame has one row per book, and the right frame has three rows per ISBN (sales records). Predict the row count after a left merge. Then explain how to aggregate the right frame first to avoid duplication.

**H7.** One frame has an integer `id`; the other has a string `id`. Predict the merge result and explain why silently converting one side is dangerous.

**H8.** Merge two frames where the right frame's key is its index. Answer which methods you can use and how `left_on`/`right_index` differ from `join`.

**H9.** Concatenate two DataFrames with the same columns and `ignore_index=True`. Answer:

1. What happens to the original indexes?
2. What happens without `ignore_index`?
3. How do you keep track of the source frame?
4. How would you validate that the columns match?

**H10.** Concatenate two frames with `axis=1`. Answer:

1. How are rows aligned?
2. What happens with mismatched indexes?
3. What happens with duplicate column names?
4. Why can this silently introduce NaNs?

**H11.** Concatenate frames with `keys=["train", "test"]`. Answer what kind of index results and how to select one group from it.

**H12.** Concatenate frames with different columns. Answer what fills the missing columns and why it is better to align the schema explicitly first.

**H13.** Merge on two keys, `isbn` and `edition`. Answer:

1. How do you pass multiple keys?
2. What happens if one key matches but the other does not?
3. How do you validate the cardinality?
4. Why is a single join key often insufficient?

**H14.** Write an anti-join that returns books with no sales. Answer two approaches: one with `merge` plus `indicator`, one with `isin`.

**H15.** Write a semi-join that returns books that have at least one sale, without duplicating books. Answer why a plain inner merge can duplicate rows and how to avoid it.

**H16.** Create a cross join of two small frames. Answer:

1. Which `how` value produces it?
2. How many rows result?
3. When is a cross join useful?
4. Why is it dangerous on large frames?

**H17.** Use `pivot` to turn a long table with `isbn`, `quarter`, and `price` into a wide table. Answer what happens when the same `isbn`/`quarter` pair appears twice.

**H18.** Explain the error from `pivot` on duplicate index/column pairs and how `pivot_table` resolves it. Then state what aggregation function `pivot_table` uses by default.

**H19.** Build a `pivot_table` showing mean price by category (rows) and in-stock status (columns). Answer how to fill missing combinations and how to flatten the resulting columns.

**H20.** Use `melt` to convert the wide table back to long format. Answer how to name the variable and value columns, and why round-tripping through `pivot` and `melt` can lose information.

**H21.** Explain the difference between `stack` and `unstack` conceptually. Answer what happens to the index and columns, and why modern pandas encourages `melt`/`pivot` for many reshaping tasks.

**H22.** Before merging a product table with a sales table, write the checks you would run on key uniqueness, dtypes, missing values, and expected row counts. Then explain which check should run in production and which can stay in tests.

---

## Group I — Splits, reproducibility, and data leakage

**I1.** Split a DataFrame into 80% train and 20% test using a seeded permutation. Write the code and answer:

1. Why shuffle before splitting?
2. Why keep the original index or reset it?
3. What must be recorded for reproducibility?
4. What does `df.iloc[indices]` assume?

**I2.** Two runs use `random_state=42` in `train_test_split`. Answer:

1. Are the splits identical?
2. Does the model training also need a seed?
3. What other sources of randomness exist?
4. Why is a seed not a substitute for deterministic data ordering?

**I3.** Create train/validation/test splits of 70/15/15. Answer:

1. How do you compute the sizes without rounding errors?
2. Why is a validation set useful?
3. What should never influence the test set?
4. How do you report metrics per split?

**I4.** Implement a stratified split that preserves class proportions. Answer:

1. How do you group by the label?
2. How do you sample within each group?
3. How do you verify the proportions after splitting?
4. When is stratification essential?

**I5.** Split by user ID so all rows for a user are in exactly one split. Answer:

1. Why does random row splitting leak information?
2. How do you choose the unique users to split?
3. How do you assign rows to splits from the user assignment?
4. What is the analogue for patients, documents, or sessions?

**I6.** Split time-ordered data into train and test. Answer:

1. Which rows go to train?
2. Why must you not shuffle across the boundary?
3. How do you handle multiple entities with different timelines?
4. What is a rolling-origin evaluation?

**I7.** A time series is split by random shuffle, and the model scores extremely well. Explain the likely leakage and how to fix the split. Then state why the same problem can occur with grouped data even without time.

**I8.** Fit a `StandardScaler` on the full dataset before splitting. Answer:

1. What information leaks into the test set?
2. How can the score become optimistic?
3. Where should `fit` happen?
4. What should be saved for inference?

**I9.** Compute the median income on the full dataset, then fill missing values before splitting. Answer the leakage mechanism and the correct sequence.

**I10.** Target encoding replaces a category with the mean target computed on all rows. Answer:

1. Why is this leakage?
2. How do you compute it safely for training?
3. What is out-of-fold encoding?
4. What happens to unseen categories at inference?

**I11.** Duplicate rows appear in both train and test. Answer:

1. How do you detect duplicates?
2. Why can duplicates inflate test scores?
3. Should duplicates be removed before or after splitting?
4. How do near-duplicates complicate the answer?

**I12.** Give three examples of features that leak the target in a churn dataset. For each, explain whether the feature would be available at prediction time.

**I13.** A feature is computed from next month's activity to predict this month's churn. Answer which leakage category applies and how to redesign the feature.

**I14.** Feature selection is performed on the full dataset before splitting. Answer why this leaks and how to perform selection inside a pipeline on training folds only.

**I15.** List the correct order for: split, impute, scale, encode, select features, fit model, evaluate. Then explain which steps must be fit on training data only and which can be applied to all rows.

**I16.** Save a preprocessing pipeline together with the model. Answer:

1. Why is saving only the model insufficient?
2. What must be saved for categorical encoders?
3. How do you version the artifact?
4. How do you test that inference preprocessing matches training?

**I17.** Compute a checksum of a raw dataset before training. Answer:

1. Which hashing approach would you use?
2. What does the checksum prove?
3. What does it not prove?
4. Why should the checksum be recorded with the model and metrics?

**I18.** Write schema tests for a training dataset covering required columns, dtypes, ranges, uniqueness, and allowed categories. Answer which failures should stop the pipeline and which should only warn.

**I19.** A binary target has 2% positives. Answer:

1. Why can accuracy be misleading?
2. Which metrics are more informative?
3. How does stratification help?
4. What happens if you resample before splitting?

**I20.** A model scores 0.98 on train and 0.62 on test. List plausible explanations and the checks you would run. Then state why "the model is bad" is not a diagnosis.

**I21.** Build a leakage checklist for a tabular ML project. Include split strategy, preprocessing fit scope, duplicate handling, time boundaries, target-derived features, ID features, and evaluation probes.

**I22.** You perform extensive EDA, choose features based on it, and then split the data. Answer why this can bias evaluation and what discipline reduces the risk. Then state whether EDA is forbidden before splitting.

---

## Group J — Mixed EDA, structure choices, and TypeScript translations

**J1.** For each dataset, choose plain Python, NumPy, or pandas and justify:

1. A 50-row configuration file with nested keys.
2. One million sensor readings with timestamps.
3. A 10-column customer table with joins and missing values.
4. A 3×3 matrix for a linear algebra example.
5. A list of API responses with irregular nested fields.

**J2.** Compare using NumPy arrays and pandas DataFrames for a numeric feature matrix. Answer:

1. Which stores column names?
2. Which handles missing values more ergonomically?
3. Which is better for matrix multiplication?
4. Which is better for grouped summaries?
5. How do you convert between them?

**J3.** This loop is slow:

```python
total = 0
for _, row in df.iterrows():
    total += row["price_cents"] * row["quantity"]
```

Rewrite it with vectorized pandas operations. Then explain why `iterrows` materializes Series objects per row and when, if ever, it is acceptable.

**J4.** Compare `df["col"].apply(func)` with a vectorized expression for a simple arithmetic transform. Answer:

1. Which is faster?
2. Which is easier to test?
3. When is `apply` genuinely necessary?
4. How can `np.where` replace a simple if/else apply?

**J5.** Translate these TypeScript operations to pandas:

```ts
const expensive = rows.filter((r) => r.priceCents > 1000);
const titles = expensive.map((r) => r.title);
const total = rows.reduce((sum, r) => sum + r.priceCents, 0);
```

Answer which pandas operations correspond and what changes about mutation.

**J6.** Load `books.csv`, inspect it, drop rows missing `title` or `price_cents`, parse the date, and print shape, dtypes, missing counts, and a summary by category. Write the full sequence and explain the order of operations.

**J7.** Join a books table with an authors table and a sales table. Then compute total sales per author. Answer:

1. Which joins are needed?
2. How do you prevent row multiplication?
3. Which aggregation produces the final table?
4. How do you handle authors with no sales?

**J8.** A numeric feature has 30% missing values. Compare dropping, mean imputation, median imputation, a missing indicator, and model-based imputation. For each, state an assumption and a risk.

**J9.** Prices contain a few extreme values. Compare dropping, clipping, log-transforming, and using a robust model. Answer which choice depends on whether the extremes are errors or real, and how you would document the decision.

**J10.** A correlation matrix shows a feature correlated with the target at 0.8. Answer why this is not enough to include it, and list three checks before trusting it.

**J11.** Compute a summary metric per category and per time period. Answer:

1. How do you group by two dimensions?
2. How do you handle categories with too few rows?
3. Why can aggregate metrics hide subgroup failures?
4. How would you compare train and test slices?

**J12.** Write a short EDA report for a tabular dataset: row/column counts, dtypes, missingness, duplicate keys, target balance, numeric summaries, top categories, and suspicious values. State which findings would block modeling.

**J13.** Refactor a notebook-style sequence of mutations into small functions that take and return DataFrames. Answer:

1. Why should functions avoid mutating their inputs?
2. How do you test each step?
3. Where do you validate schema?
4. How do you keep the pipeline reproducible?

**J14.** Predict whether each operation mutates the original DataFrame: `df.drop(...)`, `df.rename(...)`, `df.sort_values(...)`, `df.loc[...] = ...`, `df.fillna(...)`, `df.assign(...)`. Then explain how copy-on-write and `inplace` affect the answer.

**J15.** A DataFrame uses `object` for strings and `int64` for small integers. Answer:

1. Which columns could use `category`?
2. Which could use `Int32` or `Int16`?
3. What are the risks of downcasting before splitting?
4. How do you measure the memory savings?

**J16.** A JSON response contains nested author objects and lists of tags. Write code to produce a flat DataFrame with one row per book and a separate table with one row per tag. Answer why mixing both shapes in one DataFrame is a mistake.

**J17.** Read a CSV, transform a column, and write it back. Answer:

1. Which `to_csv` options preserve the index or omit it?
2. How do you preserve dtypes across a CSV round trip?
3. What information is lost when writing dates or missing values?
4. Why is CSV a poor format for nested data?

**J18.** Review this pipeline for leakage and reproducibility bugs:

```python
df = pd.read_csv("data.csv")
df = df.dropna()
df["feature"] = (df["x"] - df["x"].mean()) / df["x"].std()
train = df.sample(frac=0.8, random_state=42)
test = df.drop(train.index)
model.fit(train[["feature"]], train["y"])
score = model.score(test[["feature"]], test["y"])
```

List every problem and the corrected sequence.

**J19.** Capstone: build an ML-ready dataset from raw books, authors, sales, and reviews. Requirements:

- validate schema and key uniqueness
- handle missing values deliberately
- join the tables without row multiplication
- aggregate review and sales features
- split by author to avoid leakage
- fit imputation/scaling on training data only
- produce train/validation/test frames and a reproducibility record
- write tests for the transformations and splits

Describe the module structure and run it on a small synthetic dataset. Answer which step is most likely to leak and how you would prove it does not.

**J20.** Explain this chapter to a TypeScript developer in one page. Cover mutability, label alignment, vectorization, missing values, dtype surprises, joins, and leakage. Use at least one comparison between `Array.map/filter/reduce` and pandas operations, and one warning that has no direct TypeScript analogue.

---

## Before moving on

Check yourself against the chapter outcome without looking back at the notes:

- Choose between plain Python, NumPy, and pandas based on shape, labels, and data size.
- Create arrays, inspect shapes and dtypes, and reshape, slice, mask, and broadcast without relying on Python loops.
- Explain views versus copies and avoid accidental mutation or chained assignment.
- Build and select pandas Series/DataFrames with label alignment, boolean masks, `.loc`, and `.iloc`.
- Load CSV and JSON with explicit dtypes, date parsing, and missing-value handling.
- Inspect schemas, handle missing values and duplicates, and validate keys before joining.
- Transform columns with vectorized string, datetime, binning, and categorical operations.
- Group, aggregate, join, concatenate, pivot, and melt while checking cardinality and row counts.
- Compute summaries and EDA without mistaking correlation for causation or hiding subgroup failures.
- Split data reproducibly with stratification, grouping, or time boundaries, and fit all preprocessing on training data only.
- Detect and explain leakage from target-derived features, full-data statistics, duplicates, and future information.
- Test transformations and splits on small, hand-checked frames and record seeds, schema, and data versions.

If any group felt slow, redo a subset of its exercises from scratch before continuing to Chapter 8.
