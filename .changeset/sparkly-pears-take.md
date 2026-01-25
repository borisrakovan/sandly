---
'sandly': major
---

v2.0.0 - Complete API redesign

### Breaking Changes

- Remove `has()` and `exists()` methods from Container API
- Remove `constant()`, `dependency()`, `service()`, `autoService()` standalone functions
- Remove `layer()` function - use `Layer.create()` instead
- Remove `InjectSource`, `Inject` types
- Remove `DependencyAlreadyInstantiatedError`
- Move `ScopedContainer` into main container module

### New API

- `Layer.service(Class, deps, options?)` - create layer for a class
- `Layer.value(tag, value)` - create layer for a constant value
- `Layer.create(fn)` - create custom layers
- `Container.builder()` / `ScopedContainer.builder(scope)` - builder pattern
- Export `ContainerBuilder`, `ScopedContainerBuilder`, `IContainerBuilder`

### Improvements

- Simplified, more cohesive API surface
- Better TypeScript inference
- Tests colocated with source files