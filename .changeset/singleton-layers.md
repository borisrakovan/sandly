---
'sandly': major
---

Add singleton layers and name missing dependencies in type errors.

### Breaking Changes

- `Container.from`, `ScopedContainer.from` and `childFrom` infer the layer's requirements and check them with a branded type, so a type error names only the missing tags (`MissingDependencies<typeof Config>`) instead of comparing the full layer types. A generic function that passes its layer parameter on to one of them must forward the check with `SatisfiedAtRoot` or `SatisfiedByParent`.

### New

- `Layer.singleton(class, deps, options?)` and `Layer.singleton(layer)` declare a dependency that is built only into a root container. The layer requires `Root<typeof X>`, which only `Container.from` and `ScopedContainer.from` satisfy, so `childFrom` rejects any layer containing a singleton at compile time (`SingletonInChildScope<typeof X>`). Building one into a child scope also throws `SingletonInChildScopeError`.
- Exported types: `Root`, `MissingDependencies`, `SingletonInChildScope`, `SatisfiedAtRoot`, `SatisfiedByParent`.

### Migration

- Wrappers that pass a generic layer to `childFrom` add a requirements type parameter and intersect the layer with `SatisfiedByParent<TRequires, TParentTags>`.
- Wrappers that take a root layer as `Layer<never, T>` accept singleton layers once typed `Layer<Root<AnyTag>, T>`.
