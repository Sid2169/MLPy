# Chapter 9 — Deep Learning with PyTorch

Chapter 7 gave you array and DataFrame fluency. This chapter adds the mechanics of PyTorch: tensors, automatic differentiation, modules, data loading, training loops, evaluation, checkpointing, device movement, and the debugging habits that prevent silent model bugs.

The examples target PyTorch 2.x and run on CPU. GPU APIs are shown where the device model matters, but every core example is CPU-compatible. Pin the PyTorch version in your project: tensor defaults and checkpoint-loading behavior have changed across releases.

This is not a machine-learning theory chapter. The focus is the Python and PyTorch semantics you need to read, write, and debug training and inference code confidently.

## Contents

1. Tensors, dtypes, shapes, and devices
2. Indexing, views, reshaping, and broadcasting
3. Autograd and gradient mechanics
4. Modules, layers, and parameters
5. Loss functions, logits, and metrics
6. Datasets and DataLoader
7. The training loop
8. Evaluation, regularization, and reproducibility
9. Saving, loading, and inference
10. Devices, performance, and mixed precision
11. Debugging and common mistakes
12. Exercises (Groups A–J)

---

## 9.1 Tensors, dtypes, shapes, and devices

A `torch.Tensor` is an n-dimensional array with a dtype, a shape, a device, and optionally an autograd history. It resembles a NumPy array, but adds GPU support, automatic differentiation, and a large neural-network ecosystem.

```python
import torch

a = torch.tensor([1, 2, 3])          # int64
b = torch.tensor([1.0, 2.0, 3.0])    # float32
c = torch.tensor([True, False])      # bool
d = torch.tensor([[1, 2], [3, 4]])   # int64, shape (2, 2)

print(a.dtype, a.shape, a.ndim, a.numel())
print(a.device)
```

PyTorch's default floating dtype is `torch.float32`, not Python's `float` (`float64`). Integer literals infer `torch.int64`. This matters because:

- `nn.Linear` parameters are `float32` by default; feeding `float64` inputs raises a dtype error.
- `CrossEntropyLoss` expects integer class targets, not floats.
- Integer tensors cannot require gradients.

```python
print(torch.get_default_dtype())      # torch.float32

torch.set_default_dtype(torch.float64)
print(torch.tensor([1.0]).dtype)      # torch.float64
```

`set_default_dtype` is process-global. Avoid changing it inside library code; it surprises unrelated modules.

Creation functions:

```python
torch.zeros(2, 3)
torch.ones(2, 3)
torch.full((2, 3), 7.0)
torch.arange(0, 10, 2)               # [0, 2, 4, 6, 8]
torch.linspace(0, 1, 5)              # [0.00, 0.25, 0.50, 0.75, 1.00]
torch.randn(2, 3)                    # standard normal
torch.empty(2, 3)                    # uninitialized values
```

Never use `torch.empty` when you need meaningful values; it contains whatever was in memory. `torch.zeros` and `torch.full` are safe defaults.

A zero-dimensional tensor is a scalar-like tensor with shape `()`:

```python
loss = torch.tensor(1.5)
print(loss.shape, loss.ndim)         # torch.Size([]) 0
print(loss.item())                   # 1.5
```

`.item()` works only for a single-element tensor and synchronizes with the device when the tensor is on a GPU. Call it when you need a Python number, not once per element.

### Dtypes and casting

Use explicit dtypes at boundaries:

```python
x = torch.tensor([1, 2, 3])
xf = x.float()                       # float32
xi = xf.long()                       # int64 (truncates)
xb = x.bool()                        # nonzero -> True

y = torch.tensor([1.5, 2.5], dtype=torch.float64)
z = xf + y                           # promotes to float64
```

Type promotion follows rules similar to NumPy: a floating type usually wins over an integer type, and a wider floating type wins over a narrower one. Do not rely on implicit promotion inside a model; make the dtype match the module explicitly.

Constructing a tensor from Python data copies it. Constructing from NumPy can share memory:

```python
import numpy as np

arr = np.array([1.0, 2.0])
shared = torch.from_numpy(arr)       # shares CPU memory
shared[0] = 99.0
print(arr)                           # [99.  2.]

copied = torch.tensor(arr)           # copies
copied[0] = -1.0
print(arr)                           # [99.  2.]
```

`torch.as_tensor(arr)` tries to avoid a copy when dtype and device already match. Memory sharing is useful for zero-copy ingestion, but dangerous if you mutate one representation expecting the other to be independent.

### Devices

Tensors live on a device such as `"cpu"`, `"cuda"`, or `"mps"`. Operations require all participating tensors to be on the same device.

```python
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
x = torch.ones(3, device=device)
print(x.device)
```

`tensor.to(device)` returns a tensor on the target device; if no move or cast is needed it may return the same object. `module.to(device)` moves all registered parameters and buffers and returns the module. Keep the rule simple: move both the model and every input batch to the same device before the forward pass.

```python
model = model.to(device)
batch = {name: value.to(device) for name, value in batch.items()}
```

Do not create a tensor on the GPU inside a dataset's `__getitem__` when using multiple workers unless you have measured that it helps; it complicates worker behavior and can waste memory.

---

## 9.2 Indexing, views, reshaping, and broadcasting

Basic indexing follows NumPy syntax, with a crucial PyTorch difference: basic indexing returns views that share storage.

```python
x = torch.arange(6).reshape(2, 3)
row = x[0]              # view, shape (3,)
row[0] = 99
print(x)                # row 0 now starts with 99
```

Slicing is also a view:

```python
block = x[:, 1:]        # view
block.zero_()
print(x)
```

Advanced indexing with an integer tensor or boolean mask returns a copy:

```python
x = torch.arange(6).reshape(2, 3)
selected = x[[0, 1]]
selected[0, 0] = -1
print(x[0, 0])          # unchanged
```

Indexing rules worth remembering:

- A Python integer removes a dimension; a slice keeps it.
- `None` adds a dimension: `x[:, None]` has shape `(2, 1, 3)` for a `(2, 3)` input.
- `...` fills in missing dimensions.
- Boolean masks must broadcast to the indexed shape.
- Integer-tensor indexing gathers entries; the result is a copy.
- Assignment through basic indexing mutates the original; assignment through advanced indexing does not.

### Reshape, view, and contiguity

`reshape` changes shape when the number of elements is unchanged. It may return a view or a copy. `view` requires compatible strides and fails on non-contiguous tensors.

```python
x = torch.arange(6)
print(x.view(2, 3).shape)       # OK: contiguous
print(x.view(-1).shape)         # -1 infers one dimension

t = torch.arange(6).reshape(2, 3).T
print(t.shape)                  # (3, 2)
print(t.is_contiguous())        # False
# t.view(-1)                    # RuntimeError: incompatible strides
print(t.reshape(-1).shape)      # (6,) works; may copy
print(t.contiguous().view(-1))  # explicit copy then view
```

`transpose` swaps dimensions but does not move data; it changes strides. Calling `.contiguous()` forces a dense copy. Prefer `reshape` unless you specifically need a view and know the tensor is contiguous.

`flatten`, `squeeze`, and `unsqueeze`:

```python
x = torch.ones(2, 3)
print(x.flatten().shape)        # (6,)
print(x.unsqueeze(0).shape)     # (1, 2, 3)
print(x.unsqueeze(1).shape)     # (2, 1, 3)
print(x.unsqueeze(0).squeeze(0).shape)  # (2, 3)
```

`torch.cat` joins along an existing dimension; `torch.stack` adds a new dimension:

```python
a = torch.zeros(2, 3)
b = torch.ones(2, 3)
print(torch.cat([a, b], dim=0).shape)    # (4, 3)
print(torch.cat([a, b], dim=1).shape)    # (2, 6)
print(torch.stack([a, b], dim=0).shape)  # (2, 2, 3)
```

### Broadcasting

Broadcasting aligns dimensions from the right. A dimension of size 1 expands to match the other operand, and missing leading dimensions are treated as size 1.

```python
x = torch.ones(2, 3)
v = torch.tensor([1.0, 2.0, 3.0])
print((x + v).shape)             # (2, 3)

col = torch.tensor([[1.0], [2.0]])   # (2, 1)
print((x + col).shape)           # (2, 3)

outer = torch.zeros(2, 1) + torch.zeros(1, 3)
print(outer.shape)               # (2, 3)
```

Incompatible trailing dimensions raise an error:

```python
# torch.ones(2, 3) + torch.ones(4)   # RuntimeError
```

`expand` creates a view with stride 0 along expanded dimensions; `repeat` copies data:

```python
base = torch.zeros(1, 3)
expanded = base.expand(4, 3)     # no copy
repeated = base.repeat(4, 1)     # copy
print(expanded.stride())         # (0, 1)
```

In-place operations on broadcast-expanded views are restricted. Avoid writing to an `expand`ed tensor; it is intended for read-only broadcasting.

---

## 9.3 Autograd and gradient mechanics

PyTorch records operations on tensors whose `requires_grad` is `True` and builds a dynamic computation graph. Calling `.backward()` on a scalar output propagates gradients to leaf tensors.

```python
x = torch.tensor(2.0, requires_grad=True)
y = x ** 2
y.backward()
print(x.grad)                    # tensor(4.)
```

Only floating-point and complex tensors can require gradients:

```python
# torch.tensor([1, 2], requires_grad=True)  # RuntimeError
```

### Leaves, non-leaves, and `.grad`

A tensor created by the user with `requires_grad=True` is a leaf. Results of operations are non-leaf tensors with a `grad_fn`.

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = x * 3
print(x.is_leaf, y.is_leaf)      # True False
print(type(y.grad_fn).__name__)  # MulBackward0
```

After `y.sum().backward()`, gradients are stored in the `.grad` attribute of leaf tensors by default, not in non-leaf tensors:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = (x * 3).sum()
y.backward()
print(x.grad)                    # tensor([3., 3.])
```

If you need the gradient of a non-leaf tensor, call `.retain_grad()` before backward, or use `torch.autograd.grad`.

### Gradient accumulation

Gradients accumulate by default. Calling backward twice without clearing doubles them:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
for _ in range(2):
    (x * 2).sum().backward()
print(x.grad)                    # tensor([4., 4.])
```

The standard training loop clears gradients before each backward:

```python
optimizer.zero_grad(set_to_none=True)
loss.backward()
optimizer.step()
```

`set_to_none=True` releases gradient tensors instead of filling them with zeros. It is the modern default in PyTorch 2.x, but some code still checks for `None` before inspecting `.grad`.

Gradient accumulation intentionally uses this behavior to simulate a larger batch:

```python
optimizer.zero_grad()
for i, batch in enumerate(loader):
    loss = compute_loss(batch)
    (loss / accumulation_steps).backward()
    if (i + 1) % accumulation_steps == 0:
        optimizer.step()
        optimizer.zero_grad()
```

Scale the loss by `accumulation_steps` so the effective gradient magnitude stays comparable to a full batch.

### Stopping gradients

- `tensor.detach()` returns a tensor sharing storage that is detached from the graph.
- `with torch.no_grad():` disables graph recording inside the block.
- `torch.inference_mode()` is stricter and faster for inference, but its tensors have restrictions if you later try to use them in autograd.

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
with torch.no_grad():
    y = x * 2
print(y.requires_grad)           # False
```

`detach()` is for stopping gradient flow while keeping values; `.item()` and `.cpu()` are for extracting data. Detaching does not copy: mutations to a detached tensor can affect the original's storage. If you need an independent value, clone it.

### Non-scalar outputs

Calling `.backward()` on a tensor with more than one element requires an explicit upstream gradient:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = x * 2

y.sum().backward()               # OK, scalar after sum
# y.backward()                   # RuntimeError

y = x * 2
y.backward(torch.tensor([1.0, 10.0]))
print(x.grad)                    # tensor([2., 20.])
```

Most training code reduces the loss to a scalar (mean or sum) before backward.

### Graph lifetime and `retain_graph`

By default, the graph is freed after backward. Calling backward again on the same graph raises an error unless you pass `retain_graph=True` or recompute the forward pass.

```python
x = torch.tensor(1.0, requires_grad=True)
y = (x * 2).sum()
y.backward()
# y.backward()                   # RuntimeError: graph already freed
```

Use `retain_graph=True` only for legitimate multi-pass needs. In training loops, prefer a fresh forward pass for every backward.

### `torch.autograd.grad`

`torch.autograd.grad` returns gradients without populating `.grad`:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = (x ** 2).sum()
(g,) = torch.autograd.grad(y, x)
print(g)                         # tensor([2., 4.])
print(x.grad)                    # None
```

It is useful for inspecting gradients, gradient penalties, and custom optimization.

### Common autograd errors

- **In-place operation on a leaf requiring grad:** `x += 1` raises an error. Use `x = x + 1` or modify under `torch.no_grad()`.
- **In-place operation on a tensor needed for backward:** may raise “a variable needed for gradient computation has been modified by an inplace operation.”
- **Detaching too early:** if you detach logits before computing the loss, weights receive no gradient.
- **Using `.data`:** it bypasses autograd's safety checks. Prefer `.detach()` when you intentionally want an unconnected tensor.
- **Forgetting `zero_grad`:** gradients accumulate across steps.

---

## 9.4 Modules, layers, and parameters

Subclass `torch.nn.Module` for models with parameters or child modules. Assigning a `Parameter` or another `Module` as an attribute registers it; assigning an ordinary tensor does not.

```python
import torch
from torch import nn

class MLP(nn.Module):
    def __init__(self, in_features: int, hidden: int, out_features: int):
        super().__init__()
        self.fc1 = nn.Linear(in_features, hidden)
        self.act = nn.ReLU()
        self.fc2 = nn.Linear(hidden, out_features)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.fc2(self.act(self.fc1(x)))

model = MLP(4, 16, 3)
```

Rules:

- Call `super().__init__()` before assigning child modules.
- Define the computation in `forward`.
- Call `model(x)`, not `model.forward(x)`. The `__call__` path runs hooks and bookkeeping; directly calling `forward` skips them.
- Layers are objects with their own parameters; they are not functions.
- Module attributes are registered by assignment. Use `nn.ModuleList` for a list of layers, not a plain Python list, or the layers will not appear in `parameters()`.

### Linear layer shapes

`nn.Linear(in_features, out_features)` stores `weight` with shape `(out_features, in_features)` and `bias` with shape `(out_features,)`.

```python
layer = nn.Linear(3, 1)
print(layer.weight.shape)        # torch.Size([1, 3])
print(layer.bias.shape)          # torch.Size([1])

x = torch.randn(4, 3)            # batch of 4, 3 features
print(layer(x).shape)            # torch.Size([4, 1])
```

The layer applies `x @ weight.T + bias`. For inputs with more dimensions, the last dimension is transformed:

```python
x = torch.randn(2, 5, 3)
print(layer(x).shape)            # torch.Size([2, 5, 1])
```

### Parameters and state

```python
for name, param in model.named_parameters():
    print(name, tuple(param.shape), param.requires_grad)

print(len(list(model.parameters())))
print(model.state_dict().keys())
```

`state_dict()` includes parameters and registered buffers. Buffers are tensors that belong to the module but are not trained, such as running statistics in batch normalization.

```python
class Counter(nn.Module):
    def __init__(self):
        super().__init__()
        self.register_buffer("steps", torch.tensor(0))

    def forward(self, x):
        self.steps += 1
        return x
```

Plain tensor attributes are not registered:

```python
class Bad(nn.Module):
    def __init__(self):
        super().__init__()
        self.scale = torch.tensor(2.0)   # not a parameter or buffer
```

`Bad().to("cpu")` will not move `scale`; `state_dict()` will not include it. Use `nn.Parameter` for learnable values and `register_buffer` for persistent non-learnable state.

### Train and eval modes

`model.train()` and `model.eval()` set a flag recursively on the module and its children. They do not enable or disable gradient computation; use `torch.no_grad()` for that.

The flag changes the behavior of layers such as `Dropout` and `BatchNorm`:

```python
drop = nn.Dropout(p=0.5)
x = torch.ones(10)
print(drop.train()(x))           # some entries are zero, others scaled by 2
print(drop.eval()(x))            # all ones
```

Always switch to eval mode for validation, testing, and inference. Forgetting this produces stochastic predictions with dropout and uses batch statistics instead of running statistics in batch normalization.

### Initialization

Default initialization is usually adequate, but custom initialization uses `torch.nn.init`:

```python
def init_weights(module: nn.Module) -> None:
    if isinstance(module, nn.Linear):
        nn.init.kaiming_uniform_(module.weight, nonlinearity="relu")
        nn.init.zeros_(module.bias)

model.apply(init_weights)
```

`model.apply(fn)` calls `fn` on every submodule, including the model itself. Initialization must happen before training and before loading a checkpoint.

### Freezing parameters

Set `requires_grad=False` to freeze a parameter. The optimizer may still contain it, but no gradient is produced, so no update occurs.

```python
for param in model.fc1.parameters():
    param.requires_grad = False
```

After unfreezing, gradients resume on the next forward pass. If you create an optimizer before freezing, verify that its parameter groups contain what you expect.

---

## 9.5 Loss functions, logits, and metrics

A model normally outputs **logits** — unnormalized scores. Loss functions such as `CrossEntropyLoss` and `BCEWithLogitsLoss` apply the appropriate transformation internally for numerical stability. Do not apply softmax or sigmoid before these losses unless the loss explicitly expects probabilities.

### Multiclass classification

`nn.CrossEntropyLoss` combines `log_softmax` and negative log likelihood. It expects:

- input shape `(N, C)` for `C` classes, or `(N, C, d1, d2, ...)` for higher-dimensional inputs
- target shape `(N,)` or `(N, d1, d2, ...)` with integer class indices
- target dtype `torch.int64` (or `torch.uint8` in some versions)

```python
logits = torch.tensor([[2.0, 0.0, 0.0],
                       [0.0, 2.0, 0.0]])
target = torch.tensor([0, 1])

loss_fn = nn.CrossEntropyLoss()
loss = loss_fn(logits, target)
print(loss.item())                # ~0.2395
```

The calculation is stable because it uses log-softmax internally. Applying softmax first and then taking a log can underflow.

```python
probs = torch.softmax(logits, dim=1)
print(probs.sum(dim=1))           # tensor([1., 1.])
```

`CrossEntropyLoss` options:

- `reduction="mean"` (default), `"sum"`, or `"none"`.
- `ignore_index=-100` ignores targets with that value.
- `weight` assigns per-class weights for imbalance.
- `label_smoothing` softens targets.

Targets must not contain out-of-range class indices; that raises an error.

### Binary and multilabel classification

For binary classification with one logit per example, use `nn.BCEWithLogitsLoss`:

```python
logits = torch.tensor([0.0, 2.0])
targets = torch.tensor([0.0, 1.0])   # float dtype, same shape

loss = nn.BCEWithLogitsLoss()(logits, targets)
print(loss.item())                    # ~0.4100
```

It combines sigmoid and binary cross entropy. If you already have probabilities, use `nn.BCELoss`, but avoid taking `log(0)` manually. For multilabel problems, use one logit per label and `BCEWithLogitsLoss`; do not use softmax across labels.

### Regression

```python
pred = torch.tensor([1.0, 2.0, 3.0])
target = torch.tensor([1.5, 2.0, 2.5])

print(nn.MSELoss()(pred, target))
print(nn.L1Loss()(pred, target))
```

MSE penalizes large errors more heavily; L1 is more robust to outliers. Both expect matching shapes or broadcastable shapes.

### Metrics

Accuracy for multiclass predictions:

```python
preds = logits.argmax(dim=1)
correct = (preds == target).sum().item()
accuracy = correct / target.numel()
```

For binary predictions:

```python
probs = torch.sigmoid(logits)
preds = (probs >= 0.5).long()
```

Keep metric tensors detached and preferably on CPU:

```python
correct += (preds == target).sum().item()   # Python int, no graph
```

If you accumulate a tensor such as `total_loss += loss`, detach it with `total_loss += loss.detach()`. Otherwise you retain computation graphs and consume memory.

For imbalanced data, accuracy can be misleading. Track precision, recall, F1, and the confusion matrix. A model that predicts the majority class can have high accuracy and zero recall for the minority class.

A confusion matrix for binary labels:

```python
tp = ((preds == 1) & (target == 1)).sum().item()
tn = ((preds == 0) & (target == 0)).sum().item()
fp = ((preds == 1) & (target == 0)).sum().item()
fn = ((preds == 0) & (target == 1)).sum().item()

precision = tp / (tp + fp) if tp + fp else 0.0
recall = tp / (tp + fn) if tp + fn else 0.0
f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
```

Guard against division by zero; an undefined precision should be reported explicitly, not turned into `NaN` silently.

---

## 9.6 Datasets and DataLoader

A map-style dataset implements `__len__` and `__getitem__`:

```python
from torch.utils.data import Dataset

class ToyDataset(Dataset):
    def __init__(self, x: torch.Tensor, y: torch.Tensor):
        assert len(x) == len(y)
        self.x = x
        self.y = y

    def __len__(self) -> int:
        return len(self.x)

    def __getitem__(self, index: int):
        return self.x[index], self.y[index]
```

A `DataLoader` batches samples, optionally shuffles, and optionally uses worker processes:

```python
from torch.utils.data import DataLoader

ds = ToyDataset(torch.randn(100, 4), torch.randint(0, 3, (100,)))
loader = DataLoader(ds, batch_size=8, shuffle=True, drop_last=False)

xb, yb = next(iter(loader))
print(xb.shape, yb.shape)        # (8, 4) (8,)
```

Important behavior:

- The default collate function stacks tensor samples along a new batch dimension.
- `len(loader)` is `ceil(N / batch_size)` when `drop_last=False`, and `floor(N / batch_size)` when `drop_last=True`.
- If `drop_last=True` and the dataset is smaller than the batch size, the loader yields zero batches.
- `shuffle=True` uses the global random number generator; pass a `generator` for controlled shuffling.
- Iterating a loader creates a fresh iterator and reshuffles when `shuffle=True`.
- `num_workers=0` reads data in the main process. Positive values use worker processes; the dataset and collate function must be picklable, and worker-side mutations are not reflected in the parent process.
- `persistent_workers=True` keeps workers alive between epochs and requires `num_workers > 0`.
- `pin_memory=True` can speed up CPU-to-GPU transfers; it is unnecessary for CPU-only training.
- `drop_last=True` avoids a final batch of size 1, which can break batch normalization.

For reproducible shuffling:

```python
g = torch.Generator().manual_seed(42)
loader = DataLoader(ds, batch_size=8, shuffle=True, generator=g)
```

For variable-length sequences, write a custom `collate_fn` that pads or truncates explicitly. The default collate function expects compatible shapes and raises when it cannot stack them.

```python
def pad_collate(batch):
    xs, ys = zip(*batch)
    lengths = torch.tensor([len(x) for x in xs])
    padded = torch.nn.utils.rnn.pad_sequence(xs, batch_first=True)
    return padded, torch.stack(ys), lengths
```

Batching is not just a performance detail. It changes gradient noise, batch-normalization statistics, and the meaning of a “step.” Report whether your metrics are per batch or per epoch, and weight batch losses by batch size when aggregating.

Avoid fitting normalization statistics on the full dataset before splitting. Compute means and standard deviations on the training split only, then apply them to validation and test data. This is the same leakage rule from Chapter 7.

---

## 9.7 The training loop

A minimal training loop has a strict order:

```python
model.train()

for epoch in range(num_epochs):
    for xb, yb in train_loader:
        xb = xb.to(device)
        yb = yb.to(device)

        optimizer.zero_grad(set_to_none=True)
        logits = model(xb)
        loss = loss_fn(logits, yb)
        loss.backward()
        optimizer.step()
```

The order matters:

1. Clear old gradients.
2. Forward pass.
3. Compute loss.
4. Backward pass.
5. Update parameters.

Forgetting `zero_grad` accumulates gradients across batches. Updating before `backward` uses stale gradients or no gradients at all.

### Loss reporting

`loss` is a tensor connected to the graph. Convert it to a Python float for logging:

```python
running_loss += loss.item() * xb.size(0)
num_examples += xb.size(0)

epoch_loss = running_loss / num_examples
```

Multiplying by the batch size gives the correct weighted average when the final batch is smaller. Averaging per-batch losses equally overweights small batches.

### Optimizers

```python
optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=0.01)
```

- `SGD` with momentum is a strong baseline.
- `Adam` adapts per-parameter step sizes; `AdamW` decouples weight decay from the gradient update.
- `weight_decay` in Adam and AdamW is not identical to L2 regularization.
- Create the optimizer after moving the model to its device and after any freezing decisions.
- Parameter groups allow different learning rates for different parts of a model:

```python
optimizer = torch.optim.SGD([
    {"params": model.fc1.parameters(), "lr": 1e-3},
    {"params": model.fc2.parameters(), "lr": 1e-2},
], momentum=0.9)
```

### Learning-rate schedulers

Schedulers adjust the learning rate over time. The usual pattern is:

```python
scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=5, gamma=0.1)

for epoch in range(num_epochs):
    train_one_epoch(...)
    validate(...)
    scheduler.step()
```

Some schedulers are stepped per batch; check the documentation. Calling `scheduler.step()` before the first `optimizer.step()` can skip the initial learning rate in older versions. Use the scheduler and optimizer together deliberately, and record the learning rate in logs.

### Gradient clipping

Clip gradients after backward and before the optimizer step:

```python
torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
optimizer.step()
```

Gradient clipping limits exploding gradients; it does not fix a learning rate that is too high or a loss that is already `NaN`.

### Gradient accumulation

For a large effective batch with limited memory:

```python
optimizer.zero_grad(set_to_none=True)

for step, (xb, yb) in enumerate(loader):
    logits = model(xb)
    loss = loss_fn(logits, yb) / accumulation_steps
    loss.backward()

    if (step + 1) % accumulation_steps == 0:
        optimizer.step()
        optimizer.zero_grad(set_to_none=True)
```

If the dataset length is not divisible by `accumulation_steps`, handle the final partial group; otherwise its gradients are discarded without a step. Batch normalization statistics also see only the micro-batch, not the effective batch.

### Validation

```python
model.eval()
total_loss = 0.0
total_correct = 0
total = 0

with torch.no_grad():
    for xb, yb in val_loader:
        xb = xb.to(device)
        yb = yb.to(device)
        logits = model(xb)
        loss = loss_fn(logits, yb)
        total_loss += loss.item() * xb.size(0)
        total_correct += (logits.argmax(dim=1) == yb).sum().item()
        total += yb.numel()

val_loss = total_loss / total
val_accuracy = total_correct / total
```

Switch back to `model.train()` before the next training epoch. Never update parameters during validation.

### Sanity checks

Before trusting a long run:

1. Overfit a tiny batch. A correct model should drive the loss close to zero on a handful of examples.
2. Check that the loss is finite and roughly plausible at initialization.
3. Verify that predictions change after an optimizer step.
4. Verify that validation uses `model.eval()` and `no_grad`.
5. Verify that the number of optimizer steps matches your expectation.

If the model cannot overfit a tiny batch, suspect a bug in shapes, labels, loss, optimizer wiring, or gradient flow before tuning hyperparameters.

---

## 9.8 Evaluation, regularization, and reproducibility

### Splits and leakage

Use three splits when possible:

- **Train:** fit parameters.
- **Validation:** choose hyperparameters, early stopping, thresholds.
- **Test:** estimate final performance once.

Fit preprocessing, feature selection, and normalization on the training split only. If rows are grouped by user, patient, document, or time, split by group or time rather than randomly. A random split can leak information from the same entity into both training and validation.

### Overfitting and underfitting

Signals:

- Training loss falls while validation loss rises: overfitting.
- Both losses stay high: underfitting or a bug.
- Training and validation are both perfect: the task may be too easy, or there is leakage.

Tools:

- More data or augmentation.
- Weight decay.
- Dropout.
- Early stopping.
- Smaller model.
- Label smoothing.
- Better features.

Dropout is active only in training mode:

```python
model.train()
# dropout samples a mask

model.eval()
# dropout is the identity
```

Batch normalization behaves differently in train and eval mode. In training it uses batch statistics and updates running estimates; in eval it uses the stored running statistics. A model evaluated in train mode can produce unstable or leaky results.

### Early stopping

```python
best_val = float("inf")
patience = 3
bad_epochs = 0

for epoch in range(max_epochs):
    train_one_epoch(...)
    val_loss = evaluate(...)

    if val_loss < best_val:
        best_val = val_loss
        bad_epochs = 0
        torch.save(model.state_dict(), "best.pt")
    else:
        bad_epochs += 1
        if bad_epochs >= patience:
            break
```

Early stopping uses the validation set, not the test set. Saving the best checkpoint is part of the loop, not an afterthought.

### Metrics and thresholds

For binary classification, the default threshold 0.5 is not sacred. Choose a threshold on validation data based on the cost of false positives versus false negatives. Report the threshold alongside precision and recall.

Calibration is separate from ranking: a model can rank examples well while its probabilities are systematically too high or too low. If downstream decisions use probabilities, evaluate calibration; do not assume softmax or sigmoid outputs are calibrated.

For imbalanced classes, consider:

- class weights in the loss
- a weighted sampler
- threshold tuning
- metrics other than accuracy

### Reproducibility

Seeds:

```python
import random

def seed_everything(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
```

`torch.manual_seed` seeds CPU and all CUDA devices. NumPy has its own generator; seed it separately if you use NumPy randomness.

DataLoader workers:

```python
g = torch.Generator().manual_seed(seed)
loader = DataLoader(ds, batch_size=32, shuffle=True, generator=g)
```

Each worker derives its own seed from the base seed. If you use randomness inside `__getitem__`, set a seed in `worker_init_fn` or use a dedicated `torch.Generator`; otherwise worker behavior may vary.

Deterministic algorithms:

```python
torch.use_deterministic_algorithms(True)
```

This can make some operations raise when no deterministic implementation exists, and it can reduce performance. Set the required environment variable for CUDA matrix multiplications when the documentation asks for it. Reproducibility is a spectrum: record the seed, library versions, hardware, and nondeterministic operations rather than promising bitwise identity on every machine.

---

## 9.9 Saving, loading, and inference

The recommended format is a state dictionary, not the whole model object:

```python
torch.save(model.state_dict(), "model.pt")

new_model = MLP(4, 16, 3)
state = torch.load("model.pt", map_location="cpu")
new_model.load_state_dict(state)
new_model.eval()
```

Why `state_dict`:

- It contains only tensors and buffers, not Python class references.
- It loads reliably when the module is importable and the architecture is known.
- It separates the model definition from the weights.

Saving the whole model with `torch.save(model)` pickles class paths and is brittle when code moves or refactors. Use it only for throwaway local experiments.

`load_state_dict` checks keys:

```python
result = new_model.load_state_dict(state, strict=False)
print(result.missing_keys)
print(result.unexpected_keys)
```

`strict=False` does not make a mismatch safe; inspect the missing and unexpected keys. A missing key often means a renamed layer or a different architecture; an unexpected key often means a checkpoint from another model.

Checkpoints for resuming training should include more than weights:

```python
checkpoint = {
    "model": model.state_dict(),
    "optimizer": optimizer.state_dict(),
    "scheduler": scheduler.state_dict() if scheduler else None,
    "epoch": epoch,
    "best_val_loss": best_val,
    "seed": seed,
    "config": config,
}
torch.save(checkpoint, "checkpoint.pt")
```

Loading a checkpoint:

```python
checkpoint = torch.load("checkpoint.pt", map_location=device, weights_only=True)
model.load_state_dict(checkpoint["model"])
optimizer.load_state_dict(checkpoint["optimizer"])
start_epoch = checkpoint["epoch"] + 1
```

Recent PyTorch versions default `torch.load` to `weights_only=True` for security. A checkpoint containing arbitrary Python objects may require `weights_only=False`, which should be used only for trusted files. Never load an untrusted pickle. Verify the behavior of your installed version instead of assuming.

### Inference

```python
model.eval()
model.to(device)

with torch.inference_mode():
    for xb, _ in inference_loader:
        logits = model(xb.to(device))
        probs = torch.softmax(logits, dim=1)
        predictions = probs.argmax(dim=1).cpu()
```

Inference rules:

- Call `model.eval()`.
- Disable autograd with `torch.inference_mode()` or `torch.no_grad()`.
- Move inputs and model to the same device.
- Convert outputs to CPU before passing them to Python code that expects CPU tensors.
- Do not call `.item()` per element in a loop when vectorized conversion works.
- Keep the input preprocessing identical to training preprocessing.

`map_location` matters when loading a GPU checkpoint on a CPU-only machine or a checkpoint saved on a different device.

---

## 9.10 Devices, performance, and mixed precision

### Device mismatches

A typical error:

```text
RuntimeError: Expected all tensors to be on the same device, but found at least two devices, cuda:0 and cpu!
```

Check three places:

1. The model's parameters.
2. The input batch.
3. Constants or buffers created inside `forward` without a device.

Move the model once, then move each batch:

```python
model = model.to(device)

for xb, yb in loader:
    xb = xb.to(device, non_blocking=True)
    yb = yb.to(device, non_blocking=True)
```

`non_blocking=True` only helps with pinned memory and asynchronous transfers; it does not make CPU-only training faster.

### Dtype mismatches

A model initialized with `float32` parameters expects `float32` inputs:

```python
model = MLP(4, 16, 3).double()
x = torch.randn(8, 4)               # float32
# model(x)                          # RuntimeError: mat1 and mat2 must have the same dtype
```

Convert the input or the model, and keep the choice consistent through training and inference.

### Mixed precision

On CUDA, mixed precision uses lower-precision arithmetic for many operations while keeping master weights in higher precision. The modern API is:

```python
scaler = torch.amp.GradScaler("cuda")

for xb, yb in loader:
    optimizer.zero_grad(set_to_none=True)
    with torch.amp.autocast(device_type="cuda", dtype=torch.float16):
        logits = model(xb)
        loss = loss_fn(logits, yb)

    scaler.scale(loss).backward()
    scaler.step(optimizer)
    scaler.update()
```

`GradScaler` reduces the risk of underflow in gradients. CPU mixed precision uses `bfloat16` where supported and does not use the same scaling strategy. Treat mixed precision as an optimization: verify numerical parity on a validation batch before trusting it, and benchmark rather than assuming it is faster.

### Performance habits

- Measure before optimizing. A short profiler run beats guessing.
- Use a `DataLoader` with an appropriate `num_workers`; too many workers can thrash CPU and memory.
- Avoid per-batch Python loops over individual elements.
- Avoid `.item()` and `.cpu()` inside hot loops; they synchronize.
- Use `torch.inference_mode()` for inference.
- Use `torch.compile(model)` only after correctness is established; it adds compile time and can interact with dynamic shapes.
- Do not retain computation graphs in metrics or logs.
- Keep batch size and sequence length within memory; use gradient accumulation when needed.

---

## 9.11 Debugging and common mistakes

### Shape errors

Print shapes at the boundary:

```python
print("input", xb.shape)
print("logits", logits.shape)
print("target", yb.shape)
```

Common causes:

- `Linear` receives the wrong last dimension.
- `CrossEntropyLoss` receives one-hot targets instead of class indices.
- A model expects `(N, C, L)` but receives `(N, L)`.
- A flatten operation removes the batch dimension.
- Concatenation uses the wrong `dim`.

### Device and dtype errors

- Move the model and batch to the same device.
- Match floating dtypes between inputs and parameters.
- Integer targets stay integer; do not cast them to float for classification loss.
- Boolean masks must have compatible shapes.

### `NaN` or infinite loss

Check:

- learning rate too high
- `log(0)` or division by zero
- exploding gradients
- invalid inputs (NaN/Inf)
- loss computed on the wrong scale
- mixed-precision overflow without scaling

```python
torch.autograd.set_detect_anomaly(True)
```

Anomaly detection is slow; use it temporarily to locate the offending operation. Check gradients after backward:

```python
for name, param in model.named_parameters():
    if param.grad is not None:
        print(name, param.grad.norm().item())
```

### Loss not decreasing

Suspects:

- missing `optimizer.zero_grad`
- optimizer created before parameters were registered
- parameters frozen or detached
- learning rate far too high or too low
- labels and logits misaligned
- using `BCELoss` with logits
- evaluating in train mode with dropout
- data pipeline returning the same batch every time
- loss computed under `no_grad`

### Silent gradient problems

If a parameter has `grad is None` after backward:

- it was not used in the forward pass
- it was detached
- it has `requires_grad=False`
- the loss does not depend on it
- an in-place operation broke the graph

### Common mistakes

1. Calling `model.forward(x)` instead of `model(x)`.
2. Forgetting `model.train()` or `model.eval()`.
3. Applying softmax before `CrossEntropyLoss`.
4. Passing float targets to `CrossEntropyLoss`.
5. Forgetting `optimizer.zero_grad()`.
6. Accumulating loss tensors without `.detach()`.
7. Moving the model to a device but not the inputs.
8. Creating a tensor on the GPU inside a worker process without need.
9. Using `view` on a non-contiguous tensor.
10. Assigning layers in a Python list instead of `nn.ModuleList`.
11. Saving the whole model object instead of `state_dict`.
12. Loading a checkpoint with mismatched keys and ignoring the warning.
13. Evaluating with dropout active.
14. Fitting normalization statistics on validation or test data.
15. Reporting accuracy on imbalanced data without precision and recall.
16. Tuning the threshold on the test set.
17. Trusting a single random seed as proof of reproducibility.
18. Assuming a GPU is faster for a tiny model without measuring.
19. Keeping computation graphs alive through stored metrics.
20. Tuning hyperparameters before confirming the model can overfit a tiny batch.

### Conventions

- Use explicit dtypes and devices at boundaries.
- Keep datasets returning CPU tensors; move batches in the training loop.
- Keep model code free of data loading and metric logging.
- Use `state_dict` checkpoints with model, optimizer, scheduler, and metadata.
- Log learning rate, loss, metrics, and gradient norms.
- Use a fixed seed and record it with the run.
- Validate shapes with small, hand-checked examples.
- Prefer clear, small modules over deeply nested `nn.Sequential` structures.
- Write a test that overfits one batch before launching a long training run.

---

# Exercises

Work each exercise before running code. Groups are ordered from recognition to implementation; within each group, difficulty increases. Do not look up answers — predict, run, reconcile, then rewrite from memory.

Use PyTorch 2.x on CPU unless an exercise explicitly discusses another device. Pin the version in your project, and inspect `torch.__version__` when an exercise depends on a version-sensitive default. Keep tensors small so you can check results by hand.

## Group A — Tensors, dtypes, shapes, and devices

**A1.** For each tensor, state the dtype, shape, `ndim`, and `numel()`:

```python
a = torch.tensor([1, 2, 3])
b = torch.tensor([1.0, 2.0, 3.0])
c = torch.tensor([True, False])
d = torch.tensor([1, 2.5])
e = torch.tensor([[1, 2], [3, 4]])
```

Explain why `d` has the dtype it does.

**A2.** For each expression, state the shape, `ndim`, `numel()`, and whether `.item()` works:

```python
torch.tensor(3)
torch.tensor(3.0)
torch.tensor([3])
torch.tensor([[3]])
```

**A3.** Predict the values, shape, and dtype of each:

```python
torch.zeros(2, 3)
torch.ones(2, 3)
torch.full((2, 2), 7)
torch.arange(0, 10, 2)
torch.arange(0, 1, 0.3)
torch.linspace(0, 1, 5)
```

Then explain the difference between `arange` and `linspace` when floating-point steps are involved.

**A4.** Why is `torch.empty(2, 3)` dangerous when you need known values? Answer:

1. What does it contain?
2. When is it appropriate?
3. Why can tests sometimes pass with `empty` and then fail elsewhere?
4. Which creation functions are safer defaults?

**A5.** Predict the dtype of each tensor:

```python
print(torch.get_default_dtype())
a = torch.tensor([1.0])
torch.set_default_dtype(torch.float64)
b = torch.tensor([1.0])
torch.set_default_dtype(torch.float32)
c = torch.tensor([1.0])
print(a.dtype, b.dtype, c.dtype)
```

Explain why library code should not call `set_default_dtype` internally.

**A6.** Predict the values and dtypes:

```python
a = torch.tensor([3, 4]) / 2
b = torch.tensor([3, 4]) // 2
c = torch.tensor([3.0, 4.0]) / 2
d = torch.tensor([3.0, 4.0]) // 2
```

Explain why `/` and `//` differ for integer tensors.

**A7.** Predict the dtype of each result:

```python
a = torch.tensor([1, 2], dtype=torch.float32) + 1
b = torch.tensor([1, 2], dtype=torch.int64) + torch.tensor([1.0, 2.0])
c = torch.tensor([1.0], dtype=torch.float32) + torch.tensor([1.0], dtype=torch.float64)
d = torch.tensor([True, False]) + 1
```

**A8.** For `x = torch.arange(24).reshape(2, 3, 4)`, state the result of each:

```python
x.shape
x.ndim
x.numel()
x.dtype
x.device
```

Then state the shape of `x[0]`, `x[:, 0]`, `x[:, :, 0]`, and `x[0, 1]`.

**A9.** Predict whether each reshape succeeds, and state the resulting shape:

```python
x = torch.arange(12)
x.reshape(3, 4)
x.reshape(4, -1)
x.reshape(-1, 6)
x.reshape(5, -1)
x.reshape(3, 3)
```

For the failures, explain the rule that was violated.

**A10.** Predict the shapes:

```python
x = torch.ones(2, 3)
x.unsqueeze(0)
x.unsqueeze(1)
x.unsqueeze(2)
x.unsqueeze(0).squeeze(0)
x[:, None]
x[..., None]
```

Explain the difference between `None` and `...` in indexing.

**A11.** Predict the shapes:

```python
a = torch.zeros(2, 3)
b = torch.ones(2, 3)
torch.cat([a, b], dim=0)
torch.cat([a, b], dim=1)
torch.stack([a, b], dim=0)
torch.stack([a, b], dim=1)
```

Then explain when to use `cat` instead of `stack`.

**A12.** Predict what each `print` shows:

```python
import numpy as np

arr = np.array([1.0, 2.0])
t = torch.from_numpy(arr)
t[0] = 99.0
print(arr)

arr2 = np.array([1.0, 2.0])
u = torch.tensor(arr2)
u[0] = -1.0
print(arr2)
```

Explain the memory relationship in each case.

**A13.** Compare `torch.tensor(numpy_array)` and `torch.as_tensor(numpy_array)`. Answer:

1. When can each avoid a copy?
2. What happens if the NumPy dtype is `float64` and PyTorch expects `float32`?
3. Why is memory sharing useful and dangerous?
4. How do you guarantee an independent tensor?

**A14.** Predict the outcome and explain why:

```python
x = torch.tensor([1, 2], requires_grad=True)
```

Then answer which dtypes can require gradients and why integer tensors are excluded.

**A15.** Write a snippet that selects a device:

1. Use CUDA when available.
2. Fall back to MPS when available.
3. Otherwise use CPU.
4. Print the selected device and whether CUDA is available.

**A16.** Predict each boolean and explain the difference:

```python
x = torch.tensor([1.0, 2.0])
print(x.to("cpu") is x)
print(x.to(torch.float32) is x)
print(x.to(torch.float64) is x)
print(x.float() is x)
```

**A17.** What happens in each case?

```python
torch.tensor([1.0, 2.0]).item()
torch.tensor([1.0]).item()
torch.tensor([[1.0]]).item()
torch.tensor([]).item()
```

Explain why `.item()` is restricted to single-element tensors.

**A18.** Predict the result of:

```python
x = torch.tensor([[1, 2], [3, 4]])
print(x.tolist())
print(type(x.tolist()))
print(type(x.tolist()[0]))
```

Then explain the difference between `.tolist()` and `.numpy()`.

**A19.** Predict the boolean values:

```python
torch.tensor([0, 1, -1, 0.0, 2.5]).bool()
torch.tensor([0.0, float("nan")]).bool()
```

Explain why `nan` converts the way it does.

**A20.** Predict each result:

```python
x = torch.tensor([float("nan"), float("inf"), -float("inf"), 1.0])
torch.isnan(x)
torch.isinf(x)
torch.isfinite(x)
```

Then explain why checking `x != x` is not a reliable general replacement for `torch.isnan`.

**A21.** For `x = torch.arange(6).reshape(2, 3)`, state the shape and strides of `x` and `x.T`. Then explain why `x.T` is not contiguous.

**A22.** Are `torch.Size` objects tuples? Predict:

```python
s = torch.tensor([[1, 2], [3, 4]]).shape
print(type(s))
print(s[0])
print(s + (5,))
print(len(s))
```

**A23.** A model's parameters are `float32`, but the input is created with:

```python
x = torch.tensor([[1.0, 2.0]], dtype=torch.float64)
```

Answer:

1. What error occurs when the input reaches a `float32` `nn.Linear`?
2. How do you fix it at the input boundary?
3. Why is silently casting inside `forward` often a bad habit?
4. How do you check the model's parameter dtype?

**A24.** Write a function `describe(t: torch.Tensor) -> str` that returns a short description containing dtype, shape, device, and whether the tensor requires grad. Then answer why printing a tensor's values is not enough when debugging a pipeline.

---

## Group B — Indexing, views, reshaping, and broadcasting

**B1.** For `x = torch.arange(12).reshape(3, 4)`, predict each result exactly:

```python
x[0]
x[1, 2]
x[:, 1]
x[1:, :2]
x[::2, ::2]
```

**B2.** Predict the shape and values:

```python
x = torch.arange(6).reshape(2, 3)
x[:, 1:]
x[0, None]
x[None, :, 1]
```

**B3.** Predict the outcome:

```python
x = torch.arange(6).reshape(2, 3)
x[:, ::-1]
```

Then write the correct PyTorch expression to reverse the columns. Explain why negative-step slicing behaves differently from Python lists and NumPy.

**B4.** Predict each result and shape:

```python
x = torch.arange(6).reshape(2, 3)
mask = x > 2
x[mask]
x[x % 2 == 0]
```

Explain why the output is one-dimensional.

**B5.** Predict the shape and values:

```python
x = torch.arange(6).reshape(2, 3)
idx = torch.tensor([0, 1, 0])
x[idx]
```

Then explain the difference between `x[idx]` and `x[:, idx]` for this `x`.

**B6.** Predict the result:

```python
x = torch.arange(6).reshape(2, 3)
x[[0, 1], [1, 2]]
```

Explain why the result has shape `(2,)` rather than `(2, 2)`.

**B7.** Predict what is printed:

```python
x = torch.arange(6).reshape(2, 3)
row = x[0]
row[0] = 99
print(x)
```

Then explain why `row` is a view and how to obtain an independent row.

**B8.** Predict what is printed:

```python
x = torch.arange(6).reshape(2, 3)
rows = x[[0, 1]]
rows[0, 0] = -1
print(x)
```

Explain why the mutation does not affect `x`.

**B9.** Predict what is printed:

```python
x = torch.arange(6).reshape(2, 3)
block = x[:, 1:]
block.zero_()
print(x)
```

Then answer whether assigning `block = torch.zeros_like(block)` would have the same effect.

**B10.** For each expression, state whether it works and why:

```python
x = torch.arange(12).reshape(3, 4)
x.view(2, 6)
x.T.view(-1)
x.T.reshape(-1)
x[:, ::2].view(-1)
x[:, ::2].reshape(-1)
```

**B11.** Predict the shapes and whether each tensor is contiguous:

```python
x = torch.arange(12).reshape(3, 4)
a = x.T
b = x.T.contiguous()
print(a.is_contiguous(), b.is_contiguous())
print(a.shape, b.shape)
print(a.stride(), b.stride())
```

**B12.** For `x = torch.arange(6).reshape(2, 3)`, predict the order of values in `x.T.reshape(-1)`. Then explain why `x.T.reshape(-1)` differs from `x.reshape(-1)`.

**B13.** State the resulting shape or the error:

```python
a = torch.ones(2, 3) + torch.ones(3)
b = torch.ones(2, 1) + torch.ones(1, 3)
c = torch.ones(2, 3) + torch.ones(2, 1)
d = torch.ones(2, 3) + torch.ones(4)
e = torch.ones(2, 3) + torch.ones(1,)
```

**B14.** Predict the result of `torch.broadcast_shapes((2, 1, 3), (4, 1))`. Then explain the right-alignment rule, including what happens to missing leading dimensions.

**B15.** Predict the shape and strides of each:

```python
base = torch.zeros(1, 3)
a = base.expand(4, 3)
b = base.repeat(4, 1)
print(a.shape, a.stride())
print(b.shape, b.stride())
```

Explain why `expand` can use stride 0 and why that is not a copy.

**B16.** Predict the shape and whether the data is copied:

```python
x = torch.tensor([[1, 2, 3]])
x.repeat(2, 1)
x.repeat(1, 2)
x.expand(2, 3)
```

Then explain when to prefer `expand` over `repeat`.

**B17.** Predict the outcome:

```python
base = torch.zeros(1, 3)
expanded = base.expand(4, 3)
expanded += 1
```

Then write a correct way to add 1 to the expanded values while keeping an independent result.

**B18.** Predict the shapes and values:

```python
x = torch.arange(6).reshape(2, 3)
x.sum(dim=0)
x.sum(dim=1)
x.sum(dim=1, keepdim=True)
x.sum()
```

**B19.** Predict the outcome and explain:

```python
x = torch.arange(6).reshape(2, 3)
x.mean()
x.sum() / x.numel()
x.float().mean()
```

**B20.** Predict each result:

```python
x = torch.arange(6).reshape(2, 3)
torch.where(x > 2, x, torch.zeros_like(x))
torch.where(x > 2, x, -x)
```

Then explain the required relationship between the condition and the two value tensors.

**B21.** Predict the result and shape:

```python
x = torch.arange(6).reshape(2, 3)
torch.masked_select(x, x > 2)
```

Explain how `masked_select` differs from boolean-mask indexing.

**B22.** Predict the values and indices:

```python
values, indices = torch.topk(torch.tensor([1.0, 5.0, 3.0, 2.0]), 2)
print(values)
print(indices)
```

Then state the default `dim` for a one-dimensional tensor and what happens when `largest=False`.

**B23.** Predict the values and indices:

```python
values, indices = torch.sort(torch.tensor([3.0, 1.0, 2.0]))
print(values)
print(indices)
```

Then explain how to sort rows independently along `dim=1`.

**B24.** Predict the shapes:

```python
x = torch.arange(6)
[t.shape for t in x.split(2)]
[t.shape for t in x.chunk(3)]
[t.shape for t in x.split([1, 4, 1])]
```

Then explain the difference between `split` and `chunk` when the sizes do not divide evenly.

**B25.** Predict the shapes or error:

```python
a = torch.zeros(2, 3)
b = torch.ones(2, 3)
torch.cat([a, b], dim=0)
torch.cat([a, b], dim=1)
torch.cat([a, b], dim=2)
torch.cat([a, torch.ones(3, 3)], dim=1)
```

**B26.** Predict the shapes:

```python
a = torch.zeros(2, 3)
b = torch.ones(2, 3)
torch.stack([a, b], dim=0)
torch.stack([a, b], dim=1)
torch.stack([a, b], dim=2)
```

Then explain why `stack` with `dim=2` produces shape `(2, 3, 2)`.

---

## Group C — Autograd and gradients

**C1.** Predict `x.grad`:

```python
x = torch.tensor(2.0, requires_grad=True)
y = x ** 2
y.backward()
print(x.grad)
```

Then answer what would happen if `x` were an integer tensor.

**C2.** Predict `x.grad`:

```python
x = torch.tensor(3.0, requires_grad=True)
y = 3 * x + 1
y.backward()
print(x.grad)
```

**C3.** Predict both gradients:

```python
x = torch.tensor(2.0, requires_grad=True)
y = torch.tensor(3.0, requires_grad=True)
z = x * y
z.backward()
print(x.grad, y.grad)
```

Then explain why the gradients are different even though the forward values are symmetric in the product.

**C4.** Predict the outcome:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = x * 2
y.backward()
```

Then write the smallest change that makes the backward pass valid.

**C5.** Predict `x.grad`:

```python
x = torch.tensor([1.0, 2.0, 3.0], requires_grad=True)
y = x.sum()
y.backward()
print(x.grad)
```

**C6.** Predict `x.grad`:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = x * 2
y.backward(torch.tensor([1.0, 10.0]))
print(x.grad)
```

Explain the meaning of the upstream gradient.

**C7.** Predict the final gradient and explain:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
(x * 2).sum().backward()
(x * 2).sum().backward()
print(x.grad)
```

Then modify the snippet so the final gradient is `[2., 2.]`.

**C8.** What does each print?

```python
x = torch.tensor([1.0], requires_grad=True)
y = (x * 2).sum()
y.backward()
x.grad.zero_()
print(x.grad)

x.grad = None
print(x.grad)
```

Explain the difference between zeroing and setting to `None`.

**C9.** Predict what is printed and whether gradients flow:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = x.detach()
z = (y * 2).sum()
try:
    z.backward()
except RuntimeError as exc:
    print(type(exc).__name__)
print(x.grad)
```

**C10.** Predict `y.requires_grad`:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
with torch.no_grad():
    y = x * 2
print(y.requires_grad)
```

Then explain how to compute values without tracking gradients but still use the result later in a separate graph.

**C11.** Predict the outcome:

```python
with torch.inference_mode():
    x = torch.ones(2)

x.requires_grad_(True)
```

Then explain the difference between `no_grad` and `inference_mode`.

**C12.** Predict each printed value:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = x * 2
print(x.is_leaf, y.is_leaf)
print(x.grad_fn, y.grad_fn)
print(x.requires_grad, y.requires_grad)
```

**C13.** Predict the outcome:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = x * 2
y.requires_grad_(True)
```

Then explain why the restriction exists.

**C14.** Predict the output:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
print(x.grad)
y = (x ** 2).sum()
print(x.grad)
y.backward()
print(x.grad)
```

**C15.** Predict `x.grad`:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = (x ** 2).mean()
y.backward()
print(x.grad)
```

**C16.** Predict the shape of `w.grad`:

```python
x = torch.arange(6, dtype=torch.float32).reshape(2, 3)
w = torch.ones(3, requires_grad=True)
y = (x @ w).sum()
y.backward()
print(w.grad, w.grad.shape)
```

Then state the general rule for the gradient shape of a parameter.

**C17.** Predict `x.grad` at `x = 0.0`:

```python
x = torch.tensor(0.0, requires_grad=True)
y = torch.sigmoid(3 * x)
y.backward()
print(x.grad)
```

**C18.** Predict the outcome without changing the code:

```python
x = torch.tensor(1.0, requires_grad=True)
y = (x * 2).sum()
y.backward()
y.backward()
```

Then write a version that intentionally performs two backward passes, and explain when that is appropriate.

**C19.** Predict both prints:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = (x ** 2).sum()
(g,) = torch.autograd.grad(y, x)
print(g)
print(x.grad)
```

**C20.** Predict both derivatives:

```python
x = torch.tensor(2.0, requires_grad=True)
y = x ** 3
(g,) = torch.autograd.grad(y, x, create_graph=True)
(g2,) = torch.autograd.grad(g, x)
print(g, g2)
```

Then explain what `create_graph=True` enables.

**C21.** Predict the outcome:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
x += 1
```

Then write two correct alternatives: one that keeps gradient tracking and one that intentionally updates the values without tracking.

**C22.** Predict whether the backward pass succeeds:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = x * 2
y += 1
y.sum().backward()
print(x.grad)
```

Then explain why in-place operations are more dangerous on non-leaf tensors than on ordinary values.

**C23.** Predict the result:

```python
x = torch.tensor([1, 2, 3])
y = x * 2
print(y.requires_grad)
y.sum().backward()
```

Then explain which operations can participate in autograd.

**C24.** For the following linear-regression step, predict the shapes of `w.grad` and `b.grad` and state whether each gradient is positive, negative, or zero when `prediction < target`:

```python
x = torch.tensor([[1.0], [2.0], [3.0]])
y = torch.tensor([[2.0], [4.0], [6.0]])
w = torch.tensor([[0.0]], requires_grad=True)
b = torch.tensor([0.0], requires_grad=True)

pred = x @ w + b
loss = ((pred - y) ** 2).mean()
loss.backward()
```

Then write the update for one step of SGD with learning rate `0.1`.

**C25.** Predict the clipped gradients:

```python
a = torch.tensor([3.0, 4.0], requires_grad=True)
b = torch.tensor([-3.0, 4.0], requires_grad=True)
loss = (a ** 2).sum() + (b ** 2).sum()
loss.backward()
torch.nn.utils.clip_grad_norm_([a, b], max_norm=1.0)
print(a.grad, b.grad)
```

Explain why clipping each tensor independently would produce a different result from clipping them together.

**C26.** Predict what is printed:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
y = x.detach()
y[0] = 99.0
print(x)
print(x.requires_grad, y.requires_grad)
```

Then explain why `detach()` is not a copy.

---

## Group D — Modules, layers, and parameters

**D1.** For `layer = torch.nn.Linear(3, 1)`, predict the shapes of `weight`, `bias`, and `layer(torch.randn(4, 3))`.

**D2.** For `layer = torch.nn.Linear(4, 2)` and input shape `(8, 4)`, predict the output shape. Then predict the output shape for input `(2, 5, 4)`.

**D3.** A `nn.Linear(10, 3)` receives input `(32, 10)`. Answer:

1. Which dimension is the batch?
2. Which dimension is the feature?
3. What does the layer do to the last dimension?
4. What error occurs if the input last dimension is 9?

**D4.** For the following model, count trainable parameters and list the parameter shapes:

```python
model = torch.nn.Sequential(
    torch.nn.Linear(4, 8),
    torch.nn.ReLU(),
    torch.nn.Linear(8, 2),
)
```

Include biases.

**D5.** Predict the keys in `model.state_dict()` for:

```python
class Model(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.fc = torch.nn.Linear(3, 2)
        self.register_buffer("steps", torch.tensor(0))

    def forward(self, x):
        return self.fc(x)
```

Then explain why `steps` appears in the state dictionary.

**D6.** Predict what `named_parameters()` contains:

```python
class Model(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.scale = torch.tensor(2.0)
        self.fc = torch.nn.Linear(3, 1)

    def forward(self, x):
        return self.fc(x) * self.scale
```

Then explain why `scale` is not trained or moved by `model.to(device)`.

**D7.** Compare two modules:

```python
class WithList(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = [torch.nn.Linear(2, 2) for _ in range(3)]

class WithModuleList(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = torch.nn.ModuleList([torch.nn.Linear(2, 2) for _ in range(3)])
```

For each, state:

1. How many parameters appear in `parameters()`?
2. Whether `state_dict()` contains the layers.
3. Whether `model.to(device)` moves them.
4. What happens during `train()`/`eval()`.

**D8.** Predict the output shape of:

```python
model = torch.nn.Sequential(
    torch.nn.Flatten(),
    torch.nn.Linear(3 * 8 * 8, 16),
    torch.nn.ReLU(),
    torch.nn.Linear(16, 5),
)
x = torch.randn(4, 3, 8, 8)
model(x).shape
```

Then explain what `Flatten()` does to the batch dimension.

**D9.** Predict the flags after each call:

```python
model = torch.nn.Sequential(
    torch.nn.Linear(2, 2),
    torch.nn.Dropout(0.5),
)
print(model.training)
model.eval()
print(model.training, model[0].training, model[1].training)
model.train()
print(model.training, model[1].training)
```

**D10.** A dropout layer has `p=0.5`. Predict its behavior in each case:

```python
drop = torch.nn.Dropout(0.5)
x = torch.ones(4)

drop.train()
a = drop(x)

drop.eval()
b = drop(x)
```

Answer whether `a` is deterministic, what values it can contain, and what `b` contains.

**D11.** A batch-normalization layer is evaluated on a batch of 8 examples. Answer:

1. Which statistics does it use in training mode?
2. Which statistics does it use in eval mode?
3. Why can evaluating in training mode give different results from validation?
4. What happens to the running statistics in eval mode?
5. Why is `model.eval()` required before inference?

**D12.** Predict the outcome:

```python
model = torch.nn.Linear(2, 2).double()
x = torch.randn(3, 2)
model(x)
```

Then write two fixes: one that changes the model and one that changes the input. Explain which is usually preferable on a model boundary.

**D13.** Predict `requires_grad` for each parameter:

```python
model = torch.nn.Linear(3, 1)
print(model.weight.requires_grad, model.bias.requires_grad)
```

Then explain what happens to the optimizer if you set both to `False`.

**D14.** Freeze the first layer of a two-layer model before creating the optimizer:

```python
model = torch.nn.Sequential(
    torch.nn.Linear(4, 8),
    torch.nn.ReLU(),
    torch.nn.Linear(8, 2),
)
```

Write code that freezes `model[0]` and leaves `model[2]` trainable. Answer:

1. Does `model[0].weight.grad` become `None` or zero after backward?
2. Does an optimizer built from `model.parameters()` after freezing still contain the frozen parameters?
3. What must you verify about the optimizer's parameter groups?

**D15.** Predict the number of parameter groups and their learning rates:

```python
model = torch.nn.Linear(4, 2)
optimizer = torch.optim.SGD([
    {"params": model.weight, "lr": 0.01},
    {"params": model.bias, "lr": 0.1},
], momentum=0.9)
print(len(optimizer.param_groups))
print([g["lr"] for g in optimizer.param_groups])
```

Then explain why passing `model.parameters()` and a list of dictionaries are different.

**D16.** Predict the output shape:

```python
model = torch.nn.Sequential(
    torch.nn.Conv2d(3, 6, kernel_size=3),
    torch.nn.ReLU(),
    torch.nn.Flatten(),
    torch.nn.Linear(6 * 6 * 6, 10),
)
x = torch.randn(5, 3, 8, 8)
model(x).shape
```

Then explain which dimension `Flatten()` preserves.

**D17.** Predict the shape and dtype of:

```python
emb = torch.nn.Embedding(100, 16)
idx = torch.tensor([1, 2, 3])
emb(idx).shape
```

Then explain why `torch.tensor([1.0, 2.0])` is invalid as embedding indices.

**D18.** Predict the output shape and explain why the addition works:

```python
class Block(torch.nn.Module):
    def __init__(self, dim: int):
        super().__init__()
        self.fc1 = torch.nn.Linear(dim, dim)
        self.fc2 = torch.nn.Linear(dim, dim)

    def forward(self, x):
        return x + self.fc2(torch.relu(self.fc1(x)))

block = Block(8)
x = torch.randn(4, 8)
print(block(x).shape)
```

**D19.** Predict how many distinct weight tensors exist and whether gradients accumulate:

```python
shared = torch.nn.Linear(4, 4)
model = torch.nn.Sequential(shared, torch.nn.ReLU(), shared)
x = torch.randn(8, 4)
y = model(x).sum()
y.backward()
```

Then explain why weight tying affects the parameter count.

**D20.** Predict how many times `init` is called for:

```python
model = torch.nn.Sequential(
    torch.nn.Linear(2, 2),
    torch.nn.ReLU(),
    torch.nn.Linear(2, 1),
)
count = 0

def init(module):
    global count
    count += 1
    if isinstance(module, torch.nn.Linear):
        torch.nn.init.zeros_(module.bias)

model.apply(init)
print(count)
```

Then explain which modules `apply` visits.

**D21.** A module has a registered buffer initialized on CPU. Predict whether each operation moves it:

```python
class M(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.register_buffer("mean", torch.zeros(3))

m = M()
m.to(torch.float64)
m.to("cpu")
```

Then answer how the buffer's dtype and device compare with the parameters.

**D22.** A module stores a tensor as a plain attribute instead of a buffer. Predict what `state_dict()` contains and what `model.to(...)` does to it. Then write the corrected module using `register_buffer`.

**D23.** Predict the output:

```python
model = torch.nn.Linear(2, 2)
called = []

model.register_forward_hook(lambda module, inputs, output: called.append("hook"))
model(torch.ones(1, 2))
print(called)

model.forward(torch.ones(1, 2))
print(called)
```

Then explain why calling `model(x)` and `model.forward(x)` differ.

**D24.** Write a function that initializes every `nn.Linear` in a model with zero bias and Xavier-uniform weights. Answer:

1. Which function traverses the modules?
2. Why must initialization happen before loading a checkpoint?
3. Why should you not reinitialize a layer that you intend to freeze?
4. How would you verify the bias is zero?

---

## Group E — Loss functions, logits, and metrics

**E1.** For logits of shape `(8, 5)` and class-index targets of shape `(8,)`, predict the shape of the loss under each reduction: `"none"`, `"sum"`, `"mean"`.

**E2.** Predict the outcome and explain why:

```python
logits = torch.tensor([[2.0, 0.0], [0.0, 2.0]])
target = torch.tensor([0.0, 1.0])
torch.nn.CrossEntropyLoss()(logits, target)
```

Then write the correct target tensor.

**E3.** Predict the outcome:

```python
logits = torch.tensor([[2.0, 0.0], [0.0, 2.0]])
target = torch.tensor([0, 2])
torch.nn.CrossEntropyLoss()(logits, target)
```

Then explain why out-of-range targets are not silently clamped.

**E4.** Predict the three losses exactly:

```python
logits = torch.tensor([[2.0, 0.0, 0.0], [0.0, 2.0, 0.0]])
target = torch.tensor([0, 1])
for reduction in ("none", "sum", "mean"):
    print(reduction, torch.nn.CrossEntropyLoss(reduction=reduction)(logits, target))
```

Then explain how the sum relates to the mean.

**E5.** Explain `ignore_index` in `CrossEntropyLoss`. Answer:

1. Which target value is ignored by default?
2. How does an ignored sample affect the mean denominator?
3. What happens if every target is ignored?
4. When is this useful?

**E6.** A dataset has classes 0, 1, and 2 with very different frequencies. Answer:

1. What shape must the `weight` argument have?
2. How does weighting change the loss?
3. Why can weighting improve minority recall but hurt accuracy?
4. How do class weights interact with the `reduction` setting?

**E7.** A developer applies `torch.softmax(logits, dim=1)` and then passes the probabilities to `CrossEntropyLoss`. Answer:

1. What conceptual mistake was made?
2. Why can the result still look plausible?
3. What numerical problem can occur?
4. What should be passed instead?

**E8.** Predict the loss:

```python
logits = torch.tensor([0.0, 2.0])
target = torch.tensor([0.0, 1.0])
loss = torch.nn.BCEWithLogitsLoss()(logits, target)
print(loss.item())
```

Then explain why the input is called “logits” rather than “probabilities.”

**E9.** Predict the outcome:

```python
probs = torch.tensor([0.5, 0.8808])
target = torch.tensor([0.0, 1.0])
torch.nn.BCELoss()(probs, target)
```

Then explain when `BCELoss` is appropriate and why `BCEWithLogitsLoss` is usually preferred.

**E10.** Predict the outcome and explain:

```python
logits = torch.tensor([0.0, 2.0])
target = torch.tensor([0, 1])
torch.nn.BCEWithLogitsLoss()(logits, target)
```

Then write the target tensor with the correct dtype.

**E11.** Predict the probabilities and predictions at threshold `0.5`:

```python
logits = torch.tensor([-2.0, 0.0, 2.0])
probs = torch.sigmoid(logits)
preds = (probs >= 0.5).long()
print(probs)
print(preds)
```

Then explain why thresholding logits directly at 0 is equivalent for this loss.

**E12.** Predict each result:

```python
x = torch.tensor([[1.0, 2.0, 3.0]])
torch.softmax(x, dim=0)
torch.softmax(x, dim=1)
torch.softmax(x, dim=1).sum(dim=1)
```

Then explain why choosing the wrong `dim` can silently produce a valid but meaningless normalization.

**E13.** Predict both losses and explain why they match:

```python
logits = torch.tensor([[2.0, 0.0, 0.0], [0.0, 2.0, 0.0]])
target = torch.tensor([0, 1])
ce = torch.nn.CrossEntropyLoss()(logits, target)
nll = torch.nn.NLLLoss()(torch.log_softmax(logits, dim=1), target)
print(ce, nll)
```

**E14.** Predict the MSE:

```python
pred = torch.tensor([1.0, 2.0, 3.0])
target = torch.tensor([1.5, 2.0, 2.5])
torch.nn.MSELoss()(pred, target)
```

Then compute the result by hand and explain why the loss is not the average absolute error.

**E15.** Predict the L1 loss for the same tensors in E14. Then explain one situation where L1 is preferable to MSE.

**E16.** Predict the accuracy:

```python
logits = torch.tensor([[0.1, 0.5, 0.4],
                       [0.8, 0.1, 0.1]])
target = torch.tensor([1, 0])
preds = logits.argmax(dim=1)
print(preds)
print((preds == target).float().mean())
```

**E17.** For binary predictions and targets below, compute TP, TN, FP, and FN:

```python
preds = torch.tensor([1, 0, 1, 1, 0, 1])
target = torch.tensor([1, 0, 0, 1, 1, 0])
```

Then compute precision, recall, and F1 by hand.

**E18.** Explain why the following code can produce a division-by-zero warning or `NaN`:

```python
precision = tp / (tp + fp)
recall = tp / (tp + fn)
f1 = 2 * precision * recall / (precision + recall)
```

Then write a version that handles zero denominators explicitly.

**E19.** A binary classifier predicts class 0 for every example. The dataset has 95 negative and 5 positive examples. Answer:

1. What is its accuracy?
2. What is its recall for the positive class?
3. Why is accuracy misleading here?
4. Which metrics would you report instead?

**E20.** Predict the top-1 and top-2 accuracy for:

```python
logits = torch.tensor([[0.1, 0.5, 0.4],
                       [0.8, 0.1, 0.1],
                       [0.3, 0.5, 0.2]])
target = torch.tensor([1, 0, 0])
```

Then explain why top-k accuracy is useful for some retrieval or ranking tasks but not for single-label deployment decisions.

**E21.** A multilabel classifier predicts four independent labels per example. Answer:

1. Should the output have one logit or four logits per example?
2. Which loss should be used?
3. Why is softmax across the four labels wrong?
4. What does a threshold of 0.5 mean in this setting?
5. How would you compute per-label precision?

**E22.** Predict what happens:

```python
x = torch.tensor([0.0])
torch.log(x)
torch.nn.BCELoss()(torch.tensor([0.0]), torch.tensor([1.0]))
```

Then explain why `BCEWithLogitsLoss` is more numerically stable.

**E23.** Given per-example losses `torch.tensor([1.0, 3.0, 2.0])`, compute the mean and sum reductions by hand. Then explain how a batch-size-weighted epoch average differs from averaging per-batch means when the last batch is smaller.

**E24.** Explain why this metric update can retain computation graphs across batches:

```python
total_loss = torch.tensor(0.0)
for xb, yb in loader:
    loss = loss_fn(model(xb), yb)
    total_loss += loss
```

Then write a version that accumulates correctly and safely.

## Group F — Datasets and DataLoader

**F1.** For the following dataset, predict `len(ds)`, the shape of `ds[0]`, and the types returned:

```python
from torch.utils.data import TensorDataset

x = torch.randn(100, 4)
y = torch.randint(0, 3, (100,))
ds = TensorDataset(x, y)
```

**F2.** Write a custom map-style dataset for a list of texts and integer labels. Answer:

1. Which methods must it implement?
2. What should `__getitem__` return?
3. Why should it not return a batch?
4. How do you verify that the dataset is indexable and has the correct length?

**F3.** For a dataset of 100 examples and `batch_size=8`, predict:

```python
len(loader)
len(loader_with_drop_last)
```

Then state the shape of the final batch in each case.

**F4.** A dataset has 5 examples and the loader uses `batch_size=8, drop_last=True`. Answer:

1. What is `len(loader)`?
2. How many batches does iteration yield?
3. Why can this silently produce an empty training epoch?
4. What should you check before training?

**F5.** Predict whether the two loops see the same order:

```python
g1 = torch.Generator().manual_seed(0)
g2 = torch.Generator().manual_seed(0)

loader1 = DataLoader(ds, batch_size=4, shuffle=True, generator=g1)
loader2 = DataLoader(ds, batch_size=4, shuffle=True, generator=g2)
```

Then explain what happens if both loaders share the same generator object.

**F6.** If `shuffle=False`, how does the order change across epochs? If `shuffle=True`, when is the order decided, and what happens when you call `iter(loader)` twice?

**F7.** A dataset stores an open file handle in `__init__` and uses `num_workers=4`. Answer:

1. What can go wrong on platforms that spawn workers?
2. Why must the dataset be picklable?
3. Why are mutations inside `__getitem__` not visible in the parent process?
4. What should be opened inside the worker instead?

**F8.** A dataset uses `random.random()` inside `__getitem__` for augmentation. Answer:

1. Why can two epochs produce different augmentation sequences even with the same global seed?
2. How do workers derive their seeds?
3. How can `worker_init_fn` make behavior reproducible?
4. What is the tradeoff between reproducibility and worker parallelism?

**F9.** Explain what the default collate function does for a batch of:

1. tensors with identical shapes
2. Python integers
3. Python strings
4. dictionaries with tensor values

Then state when you need a custom `collate_fn`.

**F10.** You have variable-length 1D tensors. Explain why the default collate fails. Then write a custom collate function that pads sequences to the longest item in the batch and returns the original lengths.

**F11.** Predict the shapes from the custom collate in F10 for a batch with lengths `[3, 5, 4]` and `batch_first=True`.

**F12.** Given a dataset and `indices = [3, 1, 4]`, predict what `Subset(ds, indices)` returns for `len(subset)` and `subset[0]`. Explain which original indices are used.

**F13.** Use `torch.utils.data.random_split(ds, [80, 20], generator=g)` with a seeded generator. Answer:

1. What are the lengths of the two subsets?
2. Are the splits guaranteed disjoint?
3. Does the split shuffle the original data in place?
4. How do you make the split reproducible?

**F14.** Explain when to use `ConcatDataset`. Answer:

1. What does it require of the component datasets?
2. How are indices mapped?
3. How do lengths combine?
4. What can go wrong if the datasets have different sample formats?

**F15.** Compare map-style and iterable-style datasets. Answer:

1. Which methods does each implement?
2. Which one supports `shuffle=True` natively?
3. How does `num_workers > 0` affect an `IterableDataset`?
4. How do you shard an iterable dataset across workers?
5. Which style suits a stream of records from a database or message queue?

**F16.** Explain the purpose of `pin_memory=True` and `non_blocking=True`. Answer:

1. Which device benefits?
2. Does `pin_memory` help CPU-only training?
3. What must be true for `non_blocking` to overlap transfer?
4. Why can pinning too much memory hurt?

**F17.** Explain `persistent_workers=True` and `prefetch_factor`. Answer:

1. What does each do?
2. What constraint does `persistent_workers` have?
3. When does prefetching help?
4. When can it waste memory or startup time?

**F18.** A loader is created once outside the epoch loop. Answer:

1. Does `iter(loader)` restart from the beginning each epoch?
2. What happens to shuffling?
3. What happens to worker state?
4. Why should you not reuse a single iterator across epochs when you intend to restart?

**F19.** You normalize features using the mean and standard deviation of the full dataset before splitting. Answer:

1. What leakage occurs?
2. Why can validation performance look too optimistic?
3. Where should the statistics be computed?
4. How do you apply the training statistics to validation and test sets?

**F20.** A dataset performs an expensive image resize in `__getitem__`. Answer:

1. Why can this bottleneck training?
2. What are two ways to reduce the cost?
3. What is the risk of caching preprocessed data?
4. How do you measure whether data loading is the bottleneck?

**F21.** A loader uses `batch_size=1` and the model contains `BatchNorm1d`. Answer:

1. What error can occur in training mode?
2. Why does eval mode avoid it?
3. What are two fixes?
4. Why is `drop_last=True` not a complete solution for a dataset with one example?

**F22.** Convert a pandas DataFrame with numeric feature columns and an integer label column into a `TensorDataset`. Answer:

1. Which NumPy dtype should features use?
2. Which dtype should labels use?
3. Why should you avoid letting pandas choose object dtypes?
4. How do you verify the tensor shapes and dtypes before training?

**F23.** You want to measure whether `num_workers=0`, `2`, or `4` is fastest. Describe a benchmark that:

1. uses the real dataset
2. warms up the loader
3. measures batches per second
4. checks that the data is identical across settings
5. avoids drawing conclusions from a single run

**F24.** Predict the outcome:

```python
loader = DataLoader(ds, batch_size=4, shuffle=True, sampler=my_sampler)
```

Then explain why `shuffle` and a `sampler` are mutually exclusive in the common case.

---

## Group G — The training loop

**G1.** Put the following operations in the correct order and explain why each position matters:

```python
optimizer.step()
loss.backward()
optimizer.zero_grad()
logits = model(xb)
loss = loss_fn(logits, yb)
```

**G2.** A training loop omits `optimizer.zero_grad()`. Answer:

1. What happens to gradients across batches?
2. Why can the loss still decrease for a while?
3. What symptom suggests this bug?
4. How does `set_to_none=True` change the state before backward?

**G3.** A developer writes `loss += batch_loss` without `.item()` or `.detach()`. Answer:

1. What remains attached to the accumulated value?
2. Why can memory grow across batches?
3. How do you accumulate a scalar loss safely?
4. Why is `loss.item()` not ideal for every metric?

**G4.** Define an epoch, a step, and a batch. Then answer how the number of optimizer steps changes with gradient accumulation and `drop_last`.

**G5.** A training set has 100 examples and batches of 8. The final batch has 4 examples. Explain how to compute the epoch loss correctly, and why averaging per-batch means equally gives a different result.

**G6.** A developer creates the optimizer before moving the model to a device. Answer:

1. Why is this ordering commonly discouraged, and what should you verify after the move?
2. How can a stale reference to the old model object cause problems?
3. Why is creating the optimizer after `model.to(device)` the simpler convention?
4. How can you inspect which parameter tensors the optimizer references?

**G7.** For `weight = 1.0`, gradient `2.0`, and learning rate `0.1`, compute the updated weight under plain SGD. Then compute it with momentum `0.9` and initial velocity zero, showing the intermediate velocity.

**G8.** Compare `Adam` and `AdamW`. Answer:

1. What does each adapt?
2. How does AdamW handle weight decay?
3. Why can the same `weight_decay` value behave differently?
4. When would you choose SGD with momentum instead?

**G9.** Explain momentum in one paragraph. Then answer why momentum can overshoot and how a scheduler or learning-rate warmup can help.

**G10.** Explain the difference between L2 regularization and weight decay in adaptive optimizers. Then answer why `weight_decay` is not a complete substitute for validation.

**G11.** Put gradient clipping in the correct place relative to `backward()` and `optimizer.step()`. Then explain what `max_norm` controls and why clipping every parameter tensor separately differs from clipping the global norm.

**G12.** A loop uses gradient accumulation with `accumulation_steps=4`, but the loss is not divided by 4. Answer:

1. How does the effective gradient scale compare with a full batch?
2. What symptoms might appear?
3. How do you fix the scaling?
4. Why is dividing by the number of micro-batches not always exactly equivalent to a full batch?

**G13.** A dataset yields 10 batches and `accumulation_steps=4`. Describe exactly when `optimizer.step()` is called if the final partial group is not flushed. Then explain how to flush it.

**G14.** A `StepLR` has `step_size=2` and `gamma=0.1`, initial learning rate `0.1`. Predict the learning rate used in epochs 0 through 4 if the scheduler is stepped after each epoch. Then explain what happens if it is stepped before the optimizer.

**G15.** A scheduler is intended to update every batch, but the code calls it once per epoch. Answer:

1. What is the effective schedule?
2. Why can the model under-train or over-train?
3. How do you confirm the intended frequency?
4. Where should the learning rate be logged?

**G16.** Explain why validation should use `torch.no_grad()` even though `model.eval()` is also called. Then answer whether `model.eval()` alone disables gradient computation.

**G17.** A loop calls `model.eval()` for validation but never calls `model.train()` again. Answer:

1. What happens to dropout in the next epoch?
2. What happens to batch normalization?
3. What symptom might you observe?
4. Where should the mode switches be placed?

**G18.** A model is on CUDA but the batch stays on CPU. Predict the error category, then answer which three objects should be checked when diagnosing a device mismatch.

**G19.** A model fails to overfit a batch of 8 examples. List five likely causes and the first diagnostic you would run for each.

**G20.** Explain why `shuffle=True` for training and `shuffle=False` for validation are common defaults. Then answer when shuffling validation can be useful and when it is harmful.

**G21.** Write a `seed_everything(seed)` function for Python, PyTorch, CUDA, and NumPy. Then explain why seeding alone does not guarantee identical results across machines.

**G22.** A training loop saves the checkpoint after the last epoch rather than the best validation epoch. Answer:

1. Why is this often a mistake?
2. What should the checkpoint contain?
3. How do you avoid overwriting the best checkpoint with a worse one?
4. Why should the test set not be used to choose the best epoch?

**G23.** A loop accumulates `correct += (preds == yb).sum()` as a tensor. Answer:

1. What is attached to that tensor?
2. Why can memory grow?
3. How do you fix it?
4. Why is a Python integer often preferable for counts?

**G24.** After the first optimizer step, the loss becomes `nan`. List four likely causes and the first check for each. Include one cause specific to mixed precision.

**G25.** A dataset is 95% negative. Answer:

1. How can class weights be passed to the loss?
2. How can a weighted sampler change the batches?
3. Why must you not apply both without understanding the combined effect?
4. Which validation metrics would you monitor?

**G26.** Write a complete training function with:

- `model.train()`
- device transfer
- `zero_grad(set_to_none=True)`
- forward, loss, backward, step
- batch-size-weighted loss accumulation
- gradient clipping optional
- return of the average loss

Then write the matching validation function using `eval()` and `no_grad()`.

**G27.** A model's loss oscillates wildly and sometimes becomes `nan` after increasing the learning rate from `1e-4` to `1.0`. Explain what happened and describe a controlled experiment to find a stable learning rate.

**G28.** After one optimizer step, how can you verify that the parameters actually changed? Write a check using a clone of one parameter and a comparison after the step. Then explain why comparing only the loss is insufficient.

---

## Group H — Evaluation, generalization, and reproducibility

**H1.** Explain the roles of training, validation, and test sets. Answer:

1. Which set is used to fit parameters?
2. Which set is used for early stopping and thresholds?
3. Which set estimates final performance?
4. Why is repeatedly tuning on the test set a form of leakage?

**H2.** Give three examples of data leakage in a PyTorch pipeline. For each, state where the leak occurs and how to prevent it.

**H3.** A dataset contains multiple rows per user. Explain why a random row-level split can overstate performance. Then describe how to construct a group-aware split.

**H4.** A dataset contains time-ordered events. Explain why random shuffling before splitting is invalid. Then describe a time-based split and one preprocessing step that must also respect time order.

**H5.** Training loss is `0.08`, validation loss is `0.95`, and validation accuracy is falling. Diagnose the pattern and list three interventions. Then explain why adding more capacity is unlikely to help.

**H6.** Both training and validation loss are high and nearly equal. Diagnose the pattern and list three interventions. Then explain how an underfitting diagnosis differs from a bug in the training loop.

**H7.** A model uses `Dropout(0.5)`. Predict the effect on validation metrics if evaluation forgets `model.eval()`. Then explain why the metrics may be noisy rather than consistently wrong.

**H8.** A model uses batch normalization. Predict the effect on validation metrics if evaluation forgets `model.eval()`. Then explain why a small validation batch can make the results especially unstable.

**H9.** Write an early-stopping loop that tracks the best validation loss, saves a checkpoint, and stops after `patience` epochs without improvement. Answer:

1. What counts as an improvement?
2. Should the counter reset on a tie?
3. Which checkpoint is kept?
4. Why should the test set not drive patience?

**H10.** Validation loss improves for three epochs, worsens for two, then improves again. Explain how `patience=1`, `patience=3`, and `patience=10` would behave. Then answer which is “correct” and why the answer depends on the run's noise.

**H11.** A team evaluates twenty hyperparameter configurations on the test set and reports the best result. Answer:

1. Why is the reported score optimistic?
2. What should have been used for selection?
3. How can a held-out test set be protected?
4. What is the cost of protecting it?

**H12.** For probabilities `[0.2, 0.4, 0.6, 0.8]` and targets `[0, 1, 0, 1]`, compute predictions and accuracy at thresholds `0.3`, `0.5`, and `0.7`. Then compute precision and recall at `0.5` and explain how the threshold changes the tradeoff.

**H13.** Explain calibration. Answer:

1. What does it mean for a model to be calibrated?
2. How can a model rank well but be poorly calibrated?
3. What does a reliability diagram show?
4. Why does calibration matter for cost-sensitive decisions?

**H14.** A model has high accuracy but low recall on the minority class. List three interventions and explain how each changes the precision-recall tradeoff.

**H15.** Describe k-fold cross-validation for a PyTorch model. Answer:

1. How many times is the model trained?
2. Where does the validation fold come from?
3. How are metrics aggregated?
4. Why must preprocessing be fit inside each fold?
5. What is the computational cost?

**H16.** A run is reproducible on one machine but not another. List five sources of nondeterminism and the seed or setting that controls each.

**H17.** Explain `torch.use_deterministic_algorithms(True)`. Answer:

1. What does it enforce?
2. Why can it raise instead of silently producing a different result?
3. What performance cost can it impose?
4. Why is it not a complete reproducibility guarantee across hardware?

**H18.** A dataset's `__getitem__` uses randomness, and `num_workers=4`. Explain why the same global seed can still produce different augmentation sequences across runs. Then describe two fixes.

**H19.** Sketch learning curves for:

1. a model that is overfitting
2. a model that is underfitting
3. a model with a data pipeline bug

For each, state what you would inspect next.

**H20.** Data augmentation is applied to validation and test data. Answer:

1. Why is this usually wrong?
2. When can test-time augmentation be legitimate?
3. How does it change the meaning of the validation metric?
4. What should be applied identically to training and inference?

**H21.** Explain how weight decay can reduce overfitting. Then answer why increasing it can also cause underfitting and why its optimal value depends on the optimizer.

**H22.** A small fraction of training labels are wrong. List three symptoms and three mitigations. Then explain why a very low training loss is not proof that the labels are correct.

**H23.** A model performs well on random validation data but poorly on data from a new customer segment. Answer:

1. What kind of problem is this?
2. How can you detect it before deployment?
3. Which metrics should be monitored after deployment?
4. Why is a random split not sufficient evidence of robustness?

**H24.** Write a short evaluation report containing loss, accuracy, precision, recall, F1, confusion-matrix counts, threshold, and the size of each split. Then answer why reporting only a single accuracy number is inadequate.

---

## Group I — Saving, loading, inference, and debugging

**I1.** Predict the keys in `state_dict()` for:

```python
model = torch.nn.Sequential(
    torch.nn.Linear(4, 8),
    torch.nn.ReLU(),
    torch.nn.Linear(8, 2),
)
```

Then explain why `state_dict()` does not contain the `ReLU` parameters.

**I2.** Write a save-and-load round trip using `state_dict()`. Answer:

1. Which object is saved?
2. Which object is loaded?
3. Why must the architecture be constructed before loading?
4. How do you verify that predictions match after the round trip?

**I3.** Explain why saving the whole model with `torch.save(model)` is less robust than saving a state dictionary. Answer:

1. What does pickling include?
2. What breaks when the class path changes?
3. What security risk does loading a pickle introduce?
4. When might whole-model saving still be acceptable?

**I4.** Predict the values in `missing_keys` and `unexpected_keys` when loading a checkpoint with:

- a renamed layer
- an extra layer in the checkpoint
- a missing buffer

Then explain why `strict=False` does not make the model correct.

**I5.** A checkpoint was saved on a CUDA machine and loaded on a CPU-only machine. Answer:

1. What does `map_location="cpu"` do?
2. What happens without it?
3. How do you then move the model and optimizer state to another device?
4. Why should the checkpoint record the original device?

**I6.** List the contents of a resumable training checkpoint. Include model, optimizer, scheduler, epoch, best metric, seed, configuration, and any RNG state you need. Then explain why saving only the model weights is insufficient for exact continuation.

**I7.** A resumed run produces a different loss curve even though the weights and optimizer state were restored. Answer:

1. Which RNG states might be missing?
2. How does the data sampler state affect the next batch?
3. Why can worker processes complicate exact continuation?
4. What is the practical standard for “resumable” versus “bitwise identical”?

**I8.** Explain why `model.eval()` and `torch.inference_mode()` are both used for inference. Answer:

1. Which one changes layer behavior?
2. Which one disables graph recording?
3. What happens if you use only `eval()`?
4. What happens if you use only `inference_mode()` while dropout is still active?

**I9.** Write a batched inference function that:

- calls `eval()`
- uses `inference_mode()`
- moves batches to the model's device
- returns probabilities and predictions on CPU
- preserves the original order

Then answer why `shuffle=False` matters for matching predictions to inputs.

**I10.** Predict the error category and the fix:

```python
model = torch.nn.Linear(2, 1).to("cuda")
x = torch.randn(4, 2)
model(x)
```

Assume CUDA is available. Then describe the CPU-only equivalent you can test locally.

**I11.** A checkpoint was trained with `float32` weights, but inference passes `float64` inputs. Answer:

1. What error occurs?
2. What is the safest fix at the inference boundary?
3. Why is casting to the layer's dtype better than casting to a hardcoded `float32`?
4. How do you inspect the expected dtype?

**I12.** A `Linear(10, 3)` receives an input with last dimension 4. Answer:

1. What error occurs?
2. Which shape should you print first?
3. How do you fix the data pipeline rather than the layer?
4. Why can a flattening mistake affect the batch dimension?

**I13.** A loss becomes `nan` after a few steps. Describe a debugging sequence that checks inputs, logits, loss, gradients, and learning rate. Then explain why `torch.autograd.set_detect_anomaly(True)` is a temporary tool rather than a production setting.

**I14.** The training loss does not decrease. List six possible causes and the first check for each. Include one cause involving parameter registration and one involving mode.

**I15.** A model cannot overfit a single batch. Explain why this is a useful diagnostic and list the components you would inspect in order.

**I16.** Predict the error and explain:

```python
x = torch.tensor(1.0, requires_grad=True)
y = (x * 2).sum()
y.backward()
y.backward()
```

Then explain when `retain_graph=True` is genuinely needed.

**I17.** Predict the error and explain:

```python
x = torch.tensor([1.0, 2.0], requires_grad=True)
x += 1
```

Then explain why in-place updates under `torch.no_grad()` are sometimes used for parameter updates outside an optimizer.

**I18.** Predict the error and write the fix:

```python
x = torch.arange(12).reshape(3, 4)
x.T.view(-1)
```

Then explain why `reshape` succeeds where `view` fails.

**I19.** A training loop appends `loss` tensors to a list for plotting. Answer:

1. Why does memory grow?
2. What is retained by each tensor?
3. How do you store the values instead?
4. Why is CPU-only training also affected?

**I20.** A parameter has `grad is None` after backward. List five possible causes and a diagnostic for each.

**I21.** Describe how to benchmark inference correctly. Answer:

1. Why is the first call often slower?
2. Why should you synchronize CUDA before timing?
3. How many repetitions are needed?
4. Why should you compare against a CPU baseline?
5. What should be reported besides average latency?

**I22.** Explain when `torch.compile(model)` is worth trying and when it is not. Answer:

1. What does it optimize?
2. Why can compilation take a long time?
3. How can dynamic shapes affect it?
4. Why must correctness tests run before and after compilation?

**I23.** Explain the security implications of `torch.load`. Answer:

1. Why is pickle unsafe for untrusted files?
2. What does `weights_only=True` restrict?
3. When might a legitimate checkpoint need `weights_only=False`?
4. How should checkpoints be stored and verified in production?

**I24.** A model performs well during training but poorly in an inference script. The preprocessing code was rewritten independently. List four differences to check and explain why preprocessing parity is part of model correctness.

---

## Group J — Integration, TypeScript comparisons, and capstone

**J1.** Compare a TypeScript `number[]` with a PyTorch tensor for a batch of features. Answer:

1. Which one carries shape and dtype metadata?
2. Which one supports GPU execution?
3. Which one tracks gradients?
4. Why does the tensor's shape need to be explicit at model boundaries?
5. What is the Python equivalent of validating an array's length and element types?

**J2.** Compare mutability in TypeScript arrays and PyTorch tensors. Answer:

1. Which operations return views?
2. Why can an innocuous assignment mutate a parent tensor?
3. How does this differ from typical immutable data flow in TypeScript?
4. How do you make an independent copy?

**J3.** PyTorch convolutions expect channels-first `(N, C, H, W)`, while many TypeScript image libraries use `(H, W, C)`. Answer:

1. Where should the permutation happen?
2. How do you permute a tensor?
3. Why must the same convention be used in training and inference?
4. How would you write a test that catches a channel-order bug?

**J4.** Propose a module layout for a small PyTorch project with config, data, model, training, evaluation, and inference modules. For each module, state one responsibility and one thing it should not do.

**J5.** Define a dataclass for training configuration containing seed, batch size, learning rate, epochs, device, and checkpoint path. Answer:

1. Which defaults are safe?
2. Which values should be validated?
3. How do you serialize the config with a checkpoint?
4. Why is a dataclass better than a dictionary for this purpose?

**J6.** Add command-line arguments for the configuration in J5. Answer:

1. Which parser would you use?
2. How do you keep CLI values and defaults consistent?
3. How do you avoid passing secrets on the command line?
4. How do you print the resolved configuration without leaking sensitive values?

**J7.** Define the log fields for a training run. Include epoch, step, learning rate, training loss, validation loss, validation accuracy, gradient norm, and elapsed time. Answer why per-step logging of every metric can be noisy and expensive.

**J8.** Write three unit tests for a model:

1. output shape
2. parameter count or registration
3. deterministic behavior in eval mode

Then explain why these tests are useful even when they do not measure model quality.

**J9.** Make a tiny training test deterministic. Answer:

1. Which seeds do you set?
2. Which loader settings matter?
3. How do you avoid dropout randomness?
4. Why should the test assert a range or exact value carefully?

**J10.** Create a synthetic classification dataset with two informative features and three classes. Answer:

1. How do you generate labels from features?
2. How do you split train and validation?
3. How do you verify that the task is learnable?
4. Why should the test not rely on real data downloads?

**J11.** Implement an MLP classifier with one hidden layer, ReLU, dropout, and an output layer. Train it on the synthetic data. Answer:

1. Which loss and optimizer did you choose?
2. How do you compute accuracy?
3. How do you detect overfitting?
4. What happens if you remove the hidden nonlinearity?

**J12.** Evaluate the trained model from J11. Report loss, accuracy, and a confusion matrix. Then answer whether accuracy alone is sufficient and why.

**J13.** Save the model from J11 with `state_dict`, reload it into a fresh model instance, and compare predictions on a fixed batch. Answer:

1. Why must you call `eval()` before comparing?
2. Why should the comparison use `torch.allclose` or exact equality on argmax rather than raw floats?
3. What can cause small differences?
4. What should the checkpoint include besides weights?

**J14.** Write an inference function that accepts a batch of raw Python features, validates shapes and dtypes, normalizes using training statistics, and returns class probabilities. Answer:

1. Where should normalization statistics come from?
2. Why should the function not mutate the caller's data?
3. How do you handle a single example?
4. What should happen for an empty batch?

**J15.** A service receives one request at a time. Answer:

1. Why is per-request model loading unacceptable?
2. How do you batch concurrent requests?
3. What latency and throughput tradeoff does batching introduce?
4. How do you bound the batch size and wait time?
5. Why should inference run outside the autograd graph?

**J16.** Define input validation for an inference endpoint. Answer:

1. Which shape checks are required?
2. Which dtype checks are required?
3. What should happen for NaN or infinite values?
4. How do you return a useful error without leaking model internals?
5. Why is client-side validation insufficient?

**J17.** Explain autograd to a TypeScript developer in one paragraph. Include the forward graph, `requires_grad`, `backward()`, leaf gradients, and why inference disables graph recording.

**J18.** A trained model's validation accuracy is 0.90, but a manual evaluation script reports 0.60. List five likely causes and the first check for each. Include mode, preprocessing, label mapping, and device issues.

**J19.** Capstone: build a complete small PyTorch project. Requirements:

- synthetic or local tabular dataset with train/validation/test splits
- explicit preprocessing fit on the training split
- `Dataset` and `DataLoader` with reproducible shuffling
- MLP with configurable hidden size and dropout
- training loop with device handling, gradient clipping, and validation
- early stopping and best-checkpoint saving
- loss, accuracy, precision, recall, F1, and confusion matrix
- `state_dict` round-trip and a batched inference function
- deterministic unit tests for shapes and a tiny overfit run
- a short report of metrics, configuration, seed, and PyTorch version

Implement it, then answer:

1. Which bug was hardest to detect?
2. What happens when the learning rate is ten times larger?
3. What happens when normalization is fit on the full dataset?
4. How do you know the saved checkpoint is the best one?
5. Which part would you change first for a real dataset?

**J20.** Explain this chapter to a TypeScript backend developer in one page. Cover tensors and dtypes, views and broadcasting, autograd, modules, losses and logits, DataLoader, the training loop, eval mode, checkpoints, device movement, and debugging. Include one thing that is easy in TypeScript but subtle in PyTorch, and one thing PyTorch makes easier than a typical Node data pipeline.

---

## Before moving on

Check yourself against the chapter outcome without looking back at the notes:

- Create tensors with explicit dtypes and move models and inputs to the same device.
- Predict shapes through indexing, broadcasting, `cat`, `stack`, and `Linear`.
- Distinguish views from copies and know when `view` fails.
- Explain leaf tensors, gradient accumulation, `detach`, `no_grad`, and `inference_mode`.
- Build `nn.Module` subclasses and register parameters, buffers, and child modules correctly.
- Use `CrossEntropyLoss` with logits and integer targets, and `BCEWithLogitsLoss` for binary or multilabel tasks.
- Build map-style datasets and loaders with reproducible shuffling and correct collation.
- Write a training loop in the correct order, with validation, mode switches, and weighted loss reporting.
- Diagnose overfitting, underfitting, leakage, and common shape, dtype, and device errors.
- Save and load `state_dict` checkpoints, resume training, and run batched inference.
- Explain why evaluation uses `eval()` plus `no_grad()` or `inference_mode()`.

If any group felt slow, redo a subset of its exercises from scratch before continuing to Chapter 10.
