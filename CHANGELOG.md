# sandly

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
