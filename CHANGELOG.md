# sandly

## 4.0.0

### Major Changes

- c1053aa: Sandly 4: containers are built from one provider per tag, singletons are enforced, and missing dependencies are named in type errors.

    ### Breaking Changes
    - Building a container (`Container.from`, `ScopedContainer.from`, `childFrom`, `layer.apply`) applies each layer object once, however many composition paths reach it. Previously a shared layer was re-applied on every path and the last registration silently won.
    - Two different layers providing the same tag throw `DuplicateProviderError` at build time, naming both definition sites. Bindings of one tag to the same value (`Layer.value` / `Layer.mock`, compared with `Object.is`) count as one provider.
    - `ContainerBuilder.add` / `ScopedContainerBuilder.add` throw `DuplicateProviderError` for a tag already registered in the same builder. A child scope may still shadow a parent's tag.
    - `Container.from`, `ScopedContainer.from` and `childFrom` infer the layer's requirements and check them with a branded type, so a type error names only the missing tags (`MissingDependencies<typeof Config>`) instead of comparing the full layer types. A generic function that passes its layer parameter on to one of them must type it as `RootLayer<TRequires, TProvides>` or `ChildLayer<TRequires, TProvides, TParentTags>` to forward the check.
    - `container.use(tag, fn)` is renamed to `container.useOnce(tag, fn)`, since it destroys the container afterwards.
    - When the callback (or resolution) in `useOnce` throws and a finalizer throws too, `useOnce` rejects with a `SuppressedError` whose `error` is the `DependencyFinalizationError` and whose `suppressed` is the original error, as `await using` does. Previously the finalization error replaced the original error.
    - `ScopedContainer` no longer extends `Container`; both extend a shared base class, so each declares its own static `builder`, `empty` and `from`. A `ScopedContainer` is still assignable to a `Container` type, but `scopedContainer instanceof Container` is now `false`. The published type declarations no longer report an error in projects that type-check library files (`skipLibCheck: false`).
    - The type declarations use `AsyncDisposable` and `Symbol.asyncDispose`, which come from `@types/node` (or Bun's types) or from `esnext.disposable` in `lib` (TypeScript 5.2+).

    ### New
    - `layer.override(replacement)` replaces providers anywhere in the composition, regardless of nesting depth or position. Throws `DuplicateOverrideError` for two overrides of one tag and `OverrideTargetNotFoundError` for an override with nothing to replace.
    - `Layer.unused(...tags)` satisfies requirements left behind by an override with placeholders that throw `UnusedDependencyResolvedError` if resolved.
    - `Layer.singleton(class, deps, options?)` and `Layer.singleton(layer)` declare a dependency that is built only into a root container. The layer requires `Root<typeof X>`, which only `Container.from` and `ScopedContainer.from` satisfy, so `childFrom` rejects any layer containing a singleton at compile time (`SingletonInChildScope<typeof X>`). Building one into a child scope also throws `SingletonInChildScopeError`.
    - `Layer.values([tag, value], ...)` binds several tags to values in one layer.
    - Containers implement `Symbol.asyncDispose`: `await using container = Container.from(layer)` destroys the container when the scope exits.
    - Exported types: `RootLayer`, `ChildLayer`, `Root`, `MissingDependencies`, `SingletonInChildScope`.

    ### Migration
    - Compositions whose behavior changes now fail at build time instead of changing silently. For each `DuplicateProviderError`, remove one provider, or keep the intended one with `override()` (typically a test stub that previously lost to a provider nested in the production layer).
    - Wrappers that pass a generic layer to `childFrom` add a requirements type parameter and type the layer as `ChildLayer<TRequires, TProvides, TParentTags>`.
    - Wrappers that take a root layer as `Layer<never, T>` add a requirements type parameter and type the layer as `RootLayer<TRequires, T>`, which also accepts singleton layers.
    - Rename `container.use(...)` calls to `container.useOnce(...)`.
    - If the compiler cannot find `AsyncDisposable`, install `@types/node` or add `esnext.disposable` to `lib`.

## 3.0.2

### Patch Changes

- f1870fc: Fix `ValidDepFor` rejecting `ServiceTag` for nullable class params.

        v3.0.1 tuple-wrapped the `extends object` check to prevent distribution
        over string unions, but `[T] extends [object]` is `false` when `T`
        includes `null`/`undefined`, which removed the `ServiceTag` branch for
        nullable class params. `ValidDepFor` now strips nullability via
        `NonNullable<T>` before the object check, so `Layer.service(MyService,

    [..., MyClass])`is accepted when`MyService`declares its dependency as
   `MyClass | null`. Adds a regression test.

## 3.0.1

### Patch Changes

- a739323: Fix `Layer.service` rejecting ValueTags whose value type is a union.

    The internal `ValidDepFor<T>` conditional was a naked conditional, which TypeScript distributes over union `T`. For a parameter typed `'SANDBOX' | 'PRODUCTION'` the dep slot was inferred as `ValueTag<any, 'SANDBOX'> | ValueTag<any, 'PRODUCTION'>`, and a `ValueTag<any, 'SANDBOX' | 'PRODUCTION'>` is not assignable to either branch (ValueTag is invariant in its value type). Wrapping the conditional in a tuple (`[T] extends [object]`) prevents distribution and accepts the union-typed tag as expected.

## 3.0.0

### Major Changes

- 3bfbb34: v3.0.0 - Smart-merge layer composition

    ### Breaking Changes
    - Remove `Layer.provideMerge()` / `layer.provideMerge()` - functionality is now subsumed by `merge`.
    - Change semantics of `Layer.merge()`, `Layer.mergeAll()`, and `layer.merge()` to bidirectionally subtract internally satisfied requirements at the type level. The runtime behavior is unchanged - both layers' factories are added to the builder and resolutions are wired across them. Only the `TRequires` type is narrower.
    - `layer.provide()` now also subtracts requirements satisfied by the target layer's provisions (previously it only subtracted dep-side provisions). This is purely a type-level improvement.

    ### Migration

    Replace any `a.provideMerge(b)` with `a.merge(b)`. With smart-merge you can also drop redundant `.provide()` calls in intra-module wiring where one merged layer satisfies another's requirements.

## 2.1.0

### Minor Changes

- c3f0c91: Introduce Layer.mock() for creating partial mocks in tests

## 2.0.1

### Patch Changes

- 60c9502: Allow Layer.value() to accept ServiceTags with pre-instantiated instances

## 2.0.0

### Major Changes

- dab47e6: v2.0.0 - Complete API redesign

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

## 1.0.1

### Patch Changes

- 9564b5e: Test OIDC publishing

## 1.0.0

### Major Changes

- aebc862: First stable release

## 0.5.3

### Patch Changes

- 845edca: Fix type inference when using service layer on class with static props

## 0.5.2

### Patch Changes

- bf02981: Fix bug with service layer inference when class has static properties

## 0.5.1

### Patch Changes

- 63e4f15: Fix release

## 0.5.0

### Minor Changes

- b9e6553: Various improvements

## 0.4.0

### Minor Changes

- f688e07: Multiple fixes and improvements

## 0.3.2

### Patch Changes

- 84c3fa8: Fix type annotation in value

## 0.3.1

### Patch Changes

- c00bbeb: Value layer type fix

## 0.3.0

### Minor Changes

- f4c2712: Small fixes and improvements

## 0.2.0

### Minor Changes

- dcd3397: Design improvement, bug fixes and autoService layer

## 0.1.0

### Minor Changes

- fed04b7: Initial working release of the library

## 0.0.2

### Patch Changes

- 1089b99: Initial release
