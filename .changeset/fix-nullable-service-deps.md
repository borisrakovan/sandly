---
'sandly': patch
---

Fix `ValidDepFor` rejecting `ServiceTag` for nullable class params.

v3.0.1 tuple-wrapped the `extends object` check to prevent distribution
over string unions, but `[T] extends [object]` is `false` when `T`
includes `null`/`undefined`, which removed the `ServiceTag` branch for
nullable class params. `ValidDepFor` now strips nullability via
`NonNullable<T>` before the object check, so `Layer.service(MyService,
[..., MyClass])` is accepted when `MyService` declares its dependency as
`MyClass | null`. Adds a regression test.
