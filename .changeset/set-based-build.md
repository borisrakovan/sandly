---
'sandly': major
---

Build containers from one provider per tag instead of replaying layers.

### Breaking Changes

- Building a container (`Container.from`, `ScopedContainer.from`, `childFrom`, `layer.apply`) applies each layer object once, however many composition paths reach it. Previously a shared layer was re-applied on every path and the last registration silently won.
- Two different layers providing the same tag now throw `DuplicateProviderError` at build time, naming both definition sites. Bindings of one tag to the same value (`Layer.value` / `Layer.mock`, compared with `Object.is`) count as one provider.
- `ContainerBuilder.add` / `ScopedContainerBuilder.add` throw `DuplicateProviderError` for a tag already registered in the same builder. A child scope may still shadow a parent's tag.

### New

- `layer.override(replacement)` replaces providers anywhere in the composition, regardless of nesting depth or position. Throws `DuplicateOverrideError` for two overrides of one tag and `OverrideTargetNotFoundError` for an override with nothing to replace.
- `Layer.unused(...tags)` satisfies requirements left behind by an override with placeholders that throw `UnusedDependencyResolvedError` if resolved.

### Migration

Compositions whose behavior changes now fail at build time instead of changing silently. For each `DuplicateProviderError`, remove one provider, or keep the intended one with `override()` (typically a test stub that previously lost to a provider nested in the production layer).
