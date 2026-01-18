import { Container, ContainerTags, IContainer } from './container.js';
import { ScopedContainer } from './scoped-container.js';
import { AnyTag } from './tag.js';
import { Contravariant, Covariant } from './types.js';

/**
 * Replaces the TTags type parameter in a container type with a new type.
 * Preserves the concrete container type (Container, ScopedContainer, or IContainer).
 *
 * Uses contravariance to detect container types:
 * - Any ScopedContainer<X> extends ScopedContainer<never>
 * - Any Container<X> extends Container<never> (but not ScopedContainer<never>)
 * - Falls back to IContainer for anything else
 * @internal
 */
export type WithContainerTags<TContainer, TNewTags extends AnyTag> =
	TContainer extends ScopedContainer<never>
		? ScopedContainer<TNewTags>
		: TContainer extends Container<never>
			? Container<TNewTags>
			: IContainer<TNewTags>;

/**
 * The most generic layer type that accepts any concrete layer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLayer = Layer<any, any>;

/**
 * The type ID for the Layer interface.
 */
export const LayerTypeId: unique symbol = Symbol.for('sandly/Layer');

/**
 * A dependency layer represents a reusable, composable unit of dependency registrations.
 * Layers allow you to organize your dependency injection setup into logical groups
 * that can be combined and reused across different contexts.
 *
 * ## Type Variance
 *
 * The Layer interface uses TypeScript's variance annotations to enable safe substitutability:
 *
 * ### TRequires (covariant)
 * A layer requiring fewer dependencies can substitute one requiring more:
 * - `Layer<never, X>` can be used where `Layer<A | B, X>` is expected
 * - Intuition: A service that needs nothing is more flexible than one that needs specific deps
 *
 * ### TProvides (contravariant)
 * A layer providing more services can substitute one providing fewer:
 * - `Layer<X, A | B>` can be used where `Layer<X, A>` is expected
 * - Intuition: A service that gives you extra things is compatible with expecting fewer things
 *
 * @template TRequires - The union of tags this layer requires to be satisfied by other layers
 * @template TProvides - The union of tags this layer provides/registers
 *
 * @example Basic layer usage
 * ```typescript
 * import { layer, Tag, container } from 'sandly';
 *
 * class DatabaseService extends Tag.Service('DatabaseService') {
 *   query() { return 'data'; }
 * }
 *
 * // Create a layer that provides DatabaseService
 * const databaseLayer = layer<never, typeof DatabaseService>((container) =>
 *   container.register(DatabaseService, () => new DatabaseService())
 * );
 *
 * // Apply the layer to a container
 * const container = Container.empty();
 * const finalContainer = databaseLayer.register(c);
 *
 * const db = await finalContainer.resolve(DatabaseService);
 * ```
 *
 * @example Layer composition with variance
 * ```typescript
 * // Layer that requires DatabaseService and provides UserService
 * const userLayer = layer<typeof DatabaseService, typeof UserService>((container) =>
 *   container.register(UserService, async (ctx) =>
 *     new UserService(await ctx.resolve(DatabaseService))
 *   )
 * );
 *
 * // Compose layers: provide database layer to user layer
 * const appLayer = userLayer.provide(databaseLayer);
 * ```
 */
export interface Layer<
	// Covariant: A layer requiring fewer dependencies can substitute one requiring more
	// Layer<never, X> can be used where Layer<A | B, X> is expected (less demanding is more compatible)
	TRequires extends AnyTag,
	// Contravariant: A layer providing more services can substitute one providing fewer
	// Layer<X, A | B> can be used where Layer<X, A> is expected (more generous is more compatible)
	TProvides extends AnyTag,
> {
	readonly [LayerTypeId]?: {
		readonly _TRequires: Covariant<TRequires>;
		readonly _TProvides: Contravariant<TProvides>;
	};

	/**
	 * Applies this layer's registrations to the given container.
	 *
	 * ## Generic Container Support
	 *
	 * The signature uses `TContainer extends AnyTag` to accept containers with any existing
	 * services while preserving type information. The container must provide at least this
	 * layer's requirements (`TRequires`) but can have additional services (`TContainer`).
	 *
	 * Result container has: `TRequires | TContainer | TProvides` - everything that was
	 * already there plus this layer's new provisions.
	 *
	 * @param container - The container to register dependencies into (must satisfy TRequires)
	 * @returns A new container with this layer's dependencies registered and all existing services preserved
	 *
	 * @example Basic usage
	 * ```typescript
	 * const container = Container.empty();
	 * const updatedContainer = myLayer.register(c);
	 * ```
	 *
	 * @example With existing services preserved
	 * ```typescript
	 * const baseContainer = Container.empty()
	 *   .register(ExistingService, () => new ExistingService());
	 *
	 * const enhanced = myLayer.register(baseContainer);
	 * // Enhanced container has both ExistingService and myLayer's provisions
	 * ```
	 */
	register: <TContainer extends IContainer<TRequires>>(
		container: TContainer
	) => WithContainerTags<TContainer, ContainerTags<TContainer> | TProvides>;

	/**
	 * Provides a dependency layer to this layer, creating a pipeline where the dependency layer's
	 * provisions satisfy this layer's requirements. This creates a dependency flow from dependency → this.
	 *
	 * Type-safe: This layer's requirements must be satisfiable by the dependency layer's
	 * provisions and any remaining external requirements.
	 *
	 * @template TDepRequires - What the dependency layer requires
	 * @template TDepProvides - What the dependency layer provides
	 * @param dependency - The layer to provide as a dependency
	 * @returns A new composed layer that only exposes this layer's provisions
	 *
	 * @example Simple composition
	 * ```typescript
	 * const configLayer = layer<never, typeof ConfigTag>(...);
	 * const dbLayer = layer<typeof ConfigTag, typeof DatabaseService>(...);
	 *
	 * // Provide config to database layer
	 * const infraLayer = dbLayer.provide(configLayer);
	 * ```
	 *
	 * @example Multi-level composition (reads naturally left-to-right)
	 * ```typescript
	 * const appLayer = apiLayer
	 *   .provide(serviceLayer)
	 *   .provide(databaseLayer)
	 *   .provide(configLayer);
	 * ```
	 */
	provide: <TDepRequires extends AnyTag, TDepProvides extends AnyTag>(
		dependency: Layer<TDepRequires, TDepProvides>
	) => Layer<TDepRequires | Exclude<TRequires, TDepProvides>, TProvides>;

	/**
	 * Provides a dependency layer to this layer and merges the provisions.
	 * Unlike `.provide()`, this method includes both this layer's provisions and the dependency layer's
	 * provisions in the result type. This is useful when you want to expose services from both layers.
	 *
	 * Type-safe: This layer's requirements must be satisfiable by the dependency layer's
	 * provisions and any remaining external requirements.
	 *
	 * @template TDepRequires - What the dependency layer requires
	 * @template TDepProvides - What the dependency layer provides
	 * @param dependency - The layer to provide as a dependency
	 * @returns A new composed layer that provides services from both layers
	 *
	 * @example Providing with merged provisions
	 * ```typescript
	 * const configLayer = layer<never, typeof ConfigTag>(...);
	 * const dbLayer = layer<typeof ConfigTag, typeof DatabaseService>(...);
	 *
	 * // Provide config to database layer, and both services are available
	 * const infraLayer = dbLayer.provideMerge(configLayer);
	 * // Type: Layer<never, typeof ConfigTag | typeof DatabaseService>
	 * ```
	 *
	 * @example Difference from .provide()
	 * ```typescript
	 * // .provide() only exposes this layer's provisions:
	 * const withProvide = dbLayer.provide(configLayer);
	 * // Type: Layer<never, typeof DatabaseService>
	 *
	 * // .provideMerge() exposes both layers' provisions:
	 * const withProvideMerge = dbLayer.provideMerge(configLayer);
	 * // Type: Layer<never, typeof ConfigTag | typeof DatabaseService>
	 * ```
	 */
	provideMerge: <TDepRequires extends AnyTag, TDepProvides extends AnyTag>(
		dependency: Layer<TDepRequires, TDepProvides>
	) => Layer<
		TDepRequires | Exclude<TRequires, TDepProvides>,
		TProvides | TDepProvides
	>;

	/**
	 * Merges this layer with another layer, combining their requirements and provisions.
	 * This is useful for combining independent layers that don't have a dependency
	 * relationship.
	 *
	 * @template TOtherRequires - What the other layer requires
	 * @template TOtherProvides - What the other layer provides
	 * @param other - The layer to merge with
	 * @returns A new merged layer requiring both layers' requirements and providing both layers' provisions
	 *
	 * @example Merging independent layers
	 * ```typescript
	 * const persistenceLayer = layer<never, typeof DatabaseService | typeof CacheService>(...);
	 * const loggingLayer = layer<never, typeof LoggerService>(...);
	 *
	 * // Combine infrastructure layers
	 * const infraLayer = persistenceLayer.merge(loggingLayer);
	 * ```
	 *
	 * @example Building complex layer combinations
	 * ```typescript
	 * const appInfraLayer = persistenceLayer
	 *   .merge(messagingLayer)
	 *   .merge(observabilityLayer);
	 * ```
	 */
	merge: <TOtherRequires extends AnyTag, TOtherProvides extends AnyTag>(
		other: Layer<TOtherRequires, TOtherProvides>
	) => Layer<TRequires | TOtherRequires, TProvides | TOtherProvides>;
}

/**
 * Creates a new dependency layer that encapsulates a set of dependency registrations.
 * Layers are the primary building blocks for organizing and composing dependency injection setups.
 *
 * @template TRequires - The union of dependency tags this layer requires from other layers or external setup
 * @template TProvides - The union of dependency tags this layer registers/provides
 *
 * @param register - Function that performs the dependency registrations. Receives a container.
 * @returns The layer instance.
 *
 * @example Simple layer
 * ```typescript
 * import { layer, Tag } from 'sandly';
 *
 * class DatabaseService extends Tag.Service('DatabaseService') {
 *   constructor(private url: string = 'sqlite://memory') {}
 *   query() { return 'data'; }
 * }
 *
 * // Layer that provides DatabaseService, requires nothing
 * const databaseLayer = layer<never, typeof DatabaseService>((container) =>
 *   container.register(DatabaseService, () => new DatabaseService())
 * );
 *
 * // Usage
 * const dbLayerInstance = databaseLayer;
 * ```
 *
 * @example Complex application layer structure
 * ```typescript
 * // Configuration layer
 * const configLayer = layer<never, typeof ConfigTag>((container) =>
 *   container.register(ConfigTag, () => loadConfig())
 * );
 *
 * // Infrastructure layer (requires config)
 * const infraLayer = layer<typeof ConfigTag, typeof DatabaseService | typeof CacheService>(
 *   (container) =>
 *     container
 *       .register(DatabaseService, async (ctx) => new DatabaseService(await ctx.resolve(ConfigTag)))
 *       .register(CacheService, async (ctx) => new CacheService(await ctx.resolve(ConfigTag)))
 * );
 *
 * // Service layer (requires infrastructure)
 * const serviceLayer = layer<typeof DatabaseService | typeof CacheService, typeof UserService>(
 *   (container) =>
 *     container.register(UserService, async (ctx) =>
 *       new UserService(await ctx.resolve(DatabaseService), await ctx.resolve(CacheService))
 *     )
 * );
 *
 * // Compose the complete application
 * const appLayer = serviceLayer.provide(infraLayer).provide(configLayer);
 * ```
 */
export function layer<
	TRequires extends AnyTag = never,
	TProvides extends AnyTag = never,
>(
	register: <TContainer extends AnyTag>(
		container: IContainer<TRequires | TContainer>
	) => IContainer<TRequires | TContainer | TProvides>
): Layer<TRequires, TProvides> {
	const layerImpl: Layer<TRequires, TProvides> = {
		register: <TContainer extends IContainer<TRequires>>(
			container: TContainer
		) =>
			register(container) as WithContainerTags<
				TContainer,
				ContainerTags<TContainer> | TProvides
			>,
		provide(dependency) {
			return createProvidedLayer(dependency, layerImpl);
		},
		provideMerge(dependency) {
			return createComposedLayer(dependency, layerImpl);
		},
		merge(other) {
			return createMergedLayer(layerImpl, other);
		},
	};
	return layerImpl;
}

/**
 * Internal function to create a provided layer from two layers.
 * This implements the `.provide()` method logic - only exposes target layer's provisions.
 *
 * @internal
 */
function createProvidedLayer<
	TRequires1 extends AnyTag,
	TProvides1 extends AnyTag,
	TRequires2 extends AnyTag,
	TProvides2 extends AnyTag,
>(
	dependency: Layer<TRequires1, TProvides1>,
	target: Layer<TRequires2, TProvides2>
): Layer<TRequires1 | Exclude<TRequires2, TProvides1>, TProvides2> {
	// The implementationo of provide is the same as provideMerge, we only need to narrow the return type
	return createComposedLayer(dependency, target) as Layer<
		TRequires1 | Exclude<TRequires2, TProvides1>,
		TProvides2
	>;
}

/**
 * Internal function to create a composed layer from two layers.
 * This implements the `.provideMerge()` method logic - exposes both layers' provisions.
 *
 * @internal
 */
function createComposedLayer<
	TRequires1 extends AnyTag,
	TProvides1 extends AnyTag,
	TRequires2 extends AnyTag,
	TProvides2 extends AnyTag,
>(
	dependency: Layer<TRequires1, TProvides1>,
	target: Layer<TRequires2, TProvides2>
): Layer<
	TRequires1 | Exclude<TRequires2, TProvides1>,
	TProvides1 | TProvides2
> {
	return layer(
		<TContainer extends AnyTag>(
			container: IContainer<
				TRequires1 | Exclude<TRequires2, TProvides1> | TContainer
			>
		) => {
			const containerWithDependency = dependency.register(
				container
				// The type
				// IContainer<TRequires1 | TProvides1 | Exclude<TRequires2, TProvides1> | TContainer>
				// can be simplified to
				// IContainer<TRequires1 | TRequires2 | TProvides1 | TContainer>
			) as IContainer<TRequires1 | TRequires2 | TProvides1 | TContainer>;
			return target.register(containerWithDependency);
		}
	);
}

/**
 * Internal function to create a merged layer from two layers.
 * This implements the `.merge()` method logic.
 *
 * @internal
 */
function createMergedLayer<
	TRequires1 extends AnyTag,
	TProvides1 extends AnyTag,
	TRequires2 extends AnyTag,
	TProvides2 extends AnyTag,
>(
	layer1: Layer<TRequires1, TProvides1>,
	layer2: Layer<TRequires2, TProvides2>
): Layer<TRequires1 | TRequires2, TProvides1 | TProvides2> {
	return layer(
		<TContainer extends AnyTag>(
			container: IContainer<TRequires1 | TRequires2 | TContainer>
		) => {
			const container1 = layer1.register(container);
			const container2 = layer2.register(container1);
			return container2;
		}
	);
}

/**
 * Helper type that extracts the union of all requirements from an array of layers.
 * Used by Layer.mergeAll() to compute the correct requirement type for the merged layer.
 *
 * Works with AnyLayer[] constraint which accepts any concrete layer through variance:
 * - Layer<never, X> → extracts `never` (no requirements)
 * - Layer<A | B, Y> → extracts `A | B` (specific requirements)
 *
 * @internal
 */
type UnionOfRequires<T extends readonly AnyLayer[]> = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[K in keyof T]: T[K] extends Layer<infer R, any> ? R : never;
}[number];

/**
 * Helper type that extracts the union of all provisions from an array of layers.
 * Used by Layer.mergeAll() to compute the correct provision type for the merged layer.
 *
 * Works with AnyLayer[] constraint which accepts any concrete layer through variance:
 * - Layer<X, never> → extracts `never` (no provisions)
 * - Layer<Y, A | B> → extracts `A | B` (specific provisions)
 *
 * @internal
 */
type UnionOfProvides<T extends readonly AnyLayer[]> = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[K in keyof T]: T[K] extends Layer<any, infer P> ? P : never;
}[number];

/**
 * Utility object containing helper functions for working with layers.
 */
export const Layer = {
	/**
	 * Creates an empty layer that provides no dependencies and requires no dependencies.
	 * This is useful as a base layer or for testing.
	 *
	 * @returns An empty layer that can be used as a starting point for layer composition
	 *
	 * @example
	 * ```typescript
	 * import { Layer } from 'sandly';
	 *
	 * const baseLayer = Layer.empty();
	 * const appLayer = baseLayer
	 *   .merge(configLayer)
	 *   .merge(serviceLayer);
	 * ```
	 */
	empty(): Layer<never, never> {
		return layer(
			<TContainer extends AnyTag>(container: IContainer<TContainer>) =>
				container
		);
	},

	/**
	 * Merges multiple layers at once in a type-safe way.
	 * This is equivalent to chaining `.merge()` calls but more convenient for multiple layers.
	 *
	 * ## Type Safety with Variance
	 *
	 * Uses the AnyLayer constraint (Layer<never, AnyTag>) which accepts any concrete layer
	 * through the Layer interface's variance annotations:
	 *
	 * - **Contravariant TRequires**: Layer<typeof ServiceA, X> can be passed because requiring
	 *   ServiceA is more restrictive than requiring `never` (nothing)
	 * - **Covariant TProvides**: Layer<Y, typeof ServiceB> can be passed because providing
	 *   ServiceB is compatible with the general `AnyTag` type
	 *
	 * The return type correctly extracts and unions the actual requirement/provision types
	 * from all input layers, preserving full type safety.
	 *
	 * All layers are merged in order, combining their requirements and provisions.
	 * The resulting layer requires the union of all input layer requirements and
	 * provides the union of all input layer provisions.
	 *
	 * @template T - The tuple type of layers to merge (constrained to AnyLayer for variance)
	 * @param layers - At least 2 layers to merge together
	 * @returns A new layer that combines all input layers with correct union types
	 *
	 * @example Basic usage with different layer types
	 * ```typescript
	 * import { Layer } from 'sandly';
	 *
	 * // These all have different types but work thanks to variance:
	 * const dbLayer = layer<never, typeof DatabaseService>(...);           // no requirements
	 * const userLayer = layer<typeof DatabaseService, typeof UserService>(...); // requires DB
	 * const configLayer = layer<never, typeof ConfigService>(...);        // no requirements
	 *
	 * const infraLayer = Layer.mergeAll(dbLayer, userLayer, configLayer);
	 * // Type: Layer<typeof DatabaseService, typeof DatabaseService | typeof UserService | typeof ConfigService>
	 * ```
	 *
	 * @example Equivalent to chaining .merge()
	 * ```typescript
	 * // These are equivalent:
	 * const layer1 = Layer.mergeAll(layerA, layerB, layerC);
	 * const layer2 = layerA.merge(layerB).merge(layerC);
	 * ```
	 *
	 * @example Building infrastructure layers
	 * ```typescript
	 * const persistenceLayer = layer<never, typeof DatabaseService | typeof CacheService>(...);
	 * const messagingLayer = layer<never, typeof MessageQueue>(...);
	 * const observabilityLayer = layer<never, typeof Logger | typeof Metrics>(...);
	 *
	 * // Merge all infrastructure concerns into one layer
	 * const infraLayer = Layer.mergeAll(
	 *   persistenceLayer,
	 *   messagingLayer,
	 *   observabilityLayer
	 * );
	 *
	 * // Result type: Layer<never, DatabaseService | CacheService | MessageQueue | Logger | Metrics>
	 * ```
	 */
	mergeAll<T extends readonly [AnyLayer, AnyLayer, ...AnyLayer[]]>(
		...layers: T
	): Layer<UnionOfRequires<T>, UnionOfProvides<T>> {
		return layers.reduce((acc, layer) => acc.merge(layer)) as Layer<
			UnionOfRequires<T>,
			UnionOfProvides<T>
		>;
	},

	/**
	 * Merges exactly two layers, combining their requirements and provisions.
	 * This is similar to the `.merge()` method but available as a static function.
	 *
	 * @template TRequires1 - What the first layer requires
	 * @template TProvides1 - What the first layer provides
	 * @template TRequires2 - What the second layer requires
	 * @template TProvides2 - What the second layer provides
	 * @param layer1 - The first layer to merge
	 * @param layer2 - The second layer to merge
	 * @returns A new merged layer requiring both layers' requirements and providing both layers' provisions
	 *
	 * @example Merging two layers
	 * ```typescript
	 * import { Layer } from 'sandly';
	 *
	 * const dbLayer = layer<never, typeof DatabaseService>(...);
	 * const cacheLayer = layer<never, typeof CacheService>(...);
	 *
	 * const persistenceLayer = Layer.merge(dbLayer, cacheLayer);
	 * // Type: Layer<never, typeof DatabaseService | typeof CacheService>
	 * ```
	 */
	merge<
		TRequires1 extends AnyTag,
		TProvides1 extends AnyTag,
		TRequires2 extends AnyTag,
		TProvides2 extends AnyTag,
	>(
		layer1: Layer<TRequires1, TProvides1>,
		layer2: Layer<TRequires2, TProvides2>
	): Layer<TRequires1 | TRequires2, TProvides1 | TProvides2> {
		return layer1.merge(layer2);
	},
};
