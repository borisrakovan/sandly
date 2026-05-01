---
'sandly': major
---

v3.0.0 - Smart-merge layer composition

### Breaking Changes

- Remove `Layer.provideMerge()` / `layer.provideMerge()` - functionality is now subsumed by `merge`.
- Change semantics of `Layer.merge()`, `Layer.mergeAll()`, and `layer.merge()` to bidirectionally subtract internally satisfied requirements at the type level. The runtime behavior is unchanged - both layers' factories are added to the builder and resolutions are wired across them. Only the `TRequires` type is narrower.
- `layer.provide()` now also subtracts requirements satisfied by the target layer's provisions (previously it only subtracted dep-side provisions). This is purely a type-level improvement.

### Migration

Replace any `a.provideMerge(b)` with `a.merge(b)`. With smart-merge you can also drop redundant `.provide()` calls in intra-module wiring where one merged layer satisfies another's requirements.
