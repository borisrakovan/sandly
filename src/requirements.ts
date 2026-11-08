import type { Layer } from './layer.js';
import { type AnyTag, TagTypeKey, ValueTagIdKey } from './tag.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- type-only brand
declare const RootId: unique symbol;

/**
 * Requirement carried by every `Layer.singleton()` layer. Only root containers
 * (`Container.from`, `ScopedContainer.from`) satisfy it, so a composition that
 * contains a singleton cannot be built in a child scope.
 *
 * Nothing provides a `Root`; it propagates through `provide()` and `merge()`
 * like any other requirement.
 *
 * @template T - The tags the singleton provides
 */
export interface Root<T extends AnyTag> {
	readonly [ValueTagIdKey]: typeof RootId;
	readonly [TagTypeKey]: T;
}

/**
 * Compile-time brand required of a layer whose requirements its container
 * cannot satisfy. The compiler error names the missing tags, e.g.
 * "Property ''sandly/missing-dependencies'' is missing in type 'Layer<...>'
 * but required in type 'MissingDependencies<typeof Config>'".
 *
 * @template TTags - The missing tags
 */
export interface MissingDependencies<TTags> {
	readonly 'sandly/missing-dependencies': TTags;
}

/**
 * Compile-time brand required of a layer passed to a child scope when the
 * layer contains a `Layer.singleton()`. The compiler error names the
 * singleton's tags.
 *
 * @template TTags - The singleton's tags
 */
export interface SingletonInChildScope<TTags> {
	readonly 'sandly/singleton-in-child-scope': TTags;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRoot = Root<any>;

type IsAny<T> = 0 extends 1 & T ? true : false;

type RootTags<T> = T extends Root<infer TTags> ? TTags : never;

type MissingCheck<TTags> = [TTags] extends [never]
	? unknown
	: MissingDependencies<TTags>;

type SingletonCheck<TTags> = [TTags] extends [never]
	? unknown
	: SingletonInChildScope<TTags>;

/**
 * Requirement check for a layer built into a root container: every
 * requirement other than {@link Root} is missing.
 *
 * Resolves to `unknown` when the requirements are satisfied, and to
 * {@link MissingDependencies} otherwise.
 */
export type SatisfiedAtRoot<TRequires extends AnyTag> =
	IsAny<TRequires> extends true
		? unknown
		: MissingCheck<Exclude<TRequires, AnyRoot>>;

/**
 * Requirement check for a layer built into a child scope: requirements the
 * parent does not provide are missing, and a {@link Root} requirement means
 * the layer contains a singleton.
 *
 * Resolves to `unknown` when the check passes, and to
 * {@link MissingDependencies} and/or {@link SingletonInChildScope} otherwise.
 */
export type SatisfiedByParent<
	TRequires extends AnyTag,
	TParentTags extends AnyTag,
> =
	IsAny<TRequires> extends true
		? unknown
		: MissingCheck<Exclude<TRequires, TParentTags | AnyRoot>> &
				SingletonCheck<RootTags<Extract<TRequires, AnyRoot>>>;

/**
 * A layer a root container (`Container.from`, `ScopedContainer.from`) can
 * build: it may contain singletons, and every other requirement is
 * satisfied. Otherwise the compiler error names the missing tags.
 *
 * Type a generic wrapper's layer parameter with it to forward the check:
 *
 * @example
 * ```typescript
 * function createApp<TRequires extends AnyTag, TProvides extends AnyTag>(
 *   layer: RootLayer<TRequires, TProvides>
 * ) {
 *   return Container.from(layer);
 * }
 * ```
 */
export type RootLayer<
	TRequires extends AnyTag,
	TProvides extends AnyTag,
> = Layer<TRequires, TProvides> & SatisfiedAtRoot<TRequires>;

/**
 * A layer `childFrom` can build on a parent providing `TParentTags`: the
 * parent provides every requirement, and the layer contains no singleton.
 * Otherwise the compiler error names the missing tags or the singleton.
 *
 * Type a generic wrapper's layer parameter with it to forward the check
 * (see {@link RootLayer}).
 */
export type ChildLayer<
	TRequires extends AnyTag,
	TProvides extends AnyTag,
	TParentTags extends AnyTag,
> = Layer<TRequires, TProvides> & SatisfiedByParent<TRequires, TParentTags>;
