import {
	Container,
	ContainerBuilder,
	type Finalizer,
	type IContainer,
	type IContainerBuilder,
	type ResolutionContext,
	ScopedContainer,
	ScopedContainerBuilder,
} from './container.js';
import { AnyTag, ServiceTag, Tag, TagType, ValueTag } from './tag.js';
import { Contravariant, Covariant } from './types.js';

/**
 * Replaces the TTags type parameter in a container type with a new type.
 * Preserves the concrete container type (Container, ScopedContainer, or IContainer).
 * @internal
 */
export type WithContainerTags<
	TContainer,
	TNewTags extends AnyTag,
> = TContainer extends ScopedContainer
	? ScopedContainer<TNewTags>
	: TContainer extends Container
		? Container<TNewTags>
		: IContainer<TNewTags>;

/**
 * Replaces the TTags type parameter in a builder type with a new type.
 * Preserves the concrete builder type (ContainerBuilder or ScopedContainerBuilder).
 * @internal
 */
export type WithBuilderTags<
	TBuilder,
	TNewTags extends AnyTag,
> = TBuilder extends ScopedContainerBuilder
	? ScopedContainerBuilder<TNewTags>
	: TBuilder extends ContainerBuilder
		? ContainerBuilder<TNewTags>
		: IContainerBuilder<TNewTags>;

/**
 * Defines what constitutes a valid dependency for a given parameter type T.
 * A valid dependency is either:
 * - A ServiceTag (class) whose instances are assignable to T
 * - A ValueTag whose value type is assignable to T
 * - A raw value of type T
 * @internal
 */
type ValidDepFor<T> =
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	| (T extends object ? ServiceTag<T> | ValueTag<any, T> : ValueTag<any, T>)
	| T;

/**
 * Maps constructor parameters to valid dependency types.
 * Each parameter type T becomes ValidDepFor<T>.
 * @internal
 */
type ValidDepsFor<TParams extends readonly unknown[]> = {
	readonly [K in keyof TParams]: ValidDepFor<TParams[K]>;
};

/**
 * Extracts only the tags from a dependency array (filters out raw values).
 * Used to determine layer requirements.
 * @internal
 */
type ExtractTags<T extends readonly unknown[]> = {
	[K in keyof T]: T[K] extends AnyTag ? T[K] : never;
}[number];

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
 * Helper type that extracts the union of all requirements from an array of layers.
 * @internal
 */
type UnionOfRequires<T extends readonly AnyLayer[]> = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[K in keyof T]: T[K] extends Layer<infer R, any> ? R : never;
}[number];

/**
 * Helper type that extracts the union of all provisions from an array of layers.
 * @internal
 */
type UnionOfProvides<T extends readonly AnyLayer[]> = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[K in keyof T]: T[K] extends Layer<any, infer P> ? P : never;
}[number];

/**
 * A dependency layer represents a reusable, composable unit of dependency registrations.
 * Layers allow you to organize your dependency injection setup into logical groups
 * that can be combined and reused across different contexts.
 *
 * ## Type Variance
 *
 * - **TRequires (covariant)**: A layer requiring fewer dependencies can substitute one requiring more
 * - **TProvides (contravariant)**: A layer providing more services can substitute one providing fewer
 *
 * @template TRequires - The union of tags this layer requires
 * @template TProvides - The union of tags this layer provides
 *
 * @example
 * ```typescript
 * // Create layers using Layer.service(), Layer.value(), or Layer.create()
 * const dbLayer = Layer.service(Database, []);
 * const userLayer = Layer.service(UserService, [Database]);
 *
 * // Compose layers
 * const appLayer = userLayer.provide(dbLayer);
 *
 * // Create container from layer
 * const container = Container.from(appLayer);
 * ```
 */
export interface Layer<TRequires extends AnyTag, TProvides extends AnyTag> {
	readonly [LayerTypeId]?: {
		readonly _TRequires: Covariant<TRequires>;
		readonly _TProvides: Contravariant<TProvides>;
	};

	/**
	 * Applies this layer's registrations to a container builder.
	 * Works with both ContainerBuilder and ScopedContainerBuilder.
	 * @internal
	 */
	apply: <TBuilder extends IContainerBuilder<TRequires>>(
		builder: TBuilder
	) => WithBuilderTags<TBuilder, TRequires | TProvides>;

	/**
	 * Provides a dependency layer to this layer, creating a pipeline.
	 * The result only exposes this layer's provisions (not the dependency's).
	 *
	 * @example
	 * ```typescript
	 * const appLayer = apiLayer
	 *   .provide(serviceLayer)
	 *   .provide(databaseLayer);
	 * ```
	 */
	provide: <TDepRequires extends AnyTag, TDepProvides extends AnyTag>(
		dependency: Layer<TDepRequires, TDepProvides>
	) => Layer<TDepRequires | Exclude<TRequires, TDepProvides>, TProvides>;

	/**
	 * Provides a dependency layer and merges both layers' provisions.
	 * Unlike `.provide()`, this exposes both this layer's and the dependency's provisions.
	 *
	 * @example
	 * ```typescript
	 * const infraLayer = dbLayer.provideMerge(configLayer);
	 * // Provides both Database and Config
	 * ```
	 */
	provideMerge: <TDepRequires extends AnyTag, TDepProvides extends AnyTag>(
		dependency: Layer<TDepRequires, TDepProvides>
	) => Layer<
		TDepRequires | Exclude<TRequires, TDepProvides>,
		TProvides | TDepProvides
	>;

	/**
	 * Merges this layer with another independent layer.
	 * Combines their requirements and provisions.
	 *
	 * @example
	 * ```typescript
	 * const infraLayer = persistenceLayer.merge(loggingLayer);
	 * ```
	 */
	merge: <TOtherRequires extends AnyTag, TOtherProvides extends AnyTag>(
		other: Layer<TOtherRequires, TOtherProvides>
	) => Layer<TRequires | TOtherRequires, TProvides | TOtherProvides>;
}

/**
 * Creates a layer from a builder function.
 * @internal
 */
function createLayer<TRequires extends AnyTag, TProvides extends AnyTag>(
	applyFn: <TBuilder extends IContainerBuilder<TRequires>>(
		builder: TBuilder
	) => WithBuilderTags<TBuilder, TRequires | TProvides>
): Layer<TRequires, TProvides> {
	const layerImpl: Layer<TRequires, TProvides> = {
		apply: applyFn,

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
 * Creates a layer that only exposes the target's provisions.
 * @internal
 */
function createProvidedLayer<
	TDepRequires extends AnyTag,
	TDepProvides extends AnyTag,
	TRequires extends AnyTag,
	TProvides extends AnyTag,
>(
	dependency: Layer<TDepRequires, TDepProvides>,
	target: Layer<TRequires, TProvides>
): Layer<TDepRequires | Exclude<TRequires, TDepProvides>, TProvides> {
	// Implementation is the same as provideMerge, we only narrow the return type
	return createComposedLayer(dependency, target) as Layer<
		TDepRequires | Exclude<TRequires, TDepProvides>,
		TProvides
	>;
}

/**
 * Creates a composed layer that exposes both layers' provisions.
 * @internal
 */
function createComposedLayer<
	TDepRequires extends AnyTag,
	TDepProvides extends AnyTag,
	TRequires extends AnyTag,
	TProvides extends AnyTag,
>(
	dependency: Layer<TDepRequires, TDepProvides>,
	target: Layer<TRequires, TProvides>
): Layer<
	TDepRequires | Exclude<TRequires, TDepProvides>,
	TDepProvides | TProvides
> {
	return {
		apply: (builder) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const withDep = dependency.apply(builder as any);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return
			return target.apply(withDep as any) as any;
		},
		provide(dep) {
			return createProvidedLayer(dep, this);
		},
		provideMerge(dep) {
			return createComposedLayer(dep, this);
		},
		merge(other) {
			return createMergedLayer(this, other);
		},
	};
}

/**
 * Creates a merged layer from two independent layers.
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
	return {
		apply: (builder) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const with1 = layer1.apply(builder as any);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return
			return layer2.apply(with1 as any) as any;
		},
		provide(dep) {
			return createProvidedLayer(dep, this);
		},
		provideMerge(dep) {
			return createComposedLayer(dep, this);
		},
		merge(other) {
			return createMergedLayer(this, other);
		},
	};
}

/**
 * Consolidated Layer API for creating and composing dependency layers.
 *
 * @example
 * ```typescript
 * // Define services
 * class Database {
 *   query(sql: string) { return []; }
 * }
 *
 * class UserService {
 *   constructor(private db: Database) {}
 *   getUsers() { return this.db.query('SELECT * FROM users'); }
 * }
 *
 * // Create layers
 * const dbLayer = Layer.service(Database, []);
 * const userLayer = Layer.service(UserService, [Database]);
 *
 * // Compose and create container
 * const appLayer = userLayer.provide(dbLayer);
 * const container = Container.from(appLayer);
 *
 * const users = await container.resolve(UserService);
 * ```
 */
export const Layer = {
	/**
	 * Creates a layer that provides a class service with automatic dependency injection.
	 *
	 * The dependencies array must match the constructor parameters exactly (order and types).
	 * This is validated at compile time.
	 *
	 * @param cls - The service class
	 * @param deps - Array of dependencies (tags or raw values) matching constructor params
	 * @param options - Optional cleanup function for the service
	 *
	 * @example
	 * ```typescript
	 * class UserService {
	 *   constructor(private db: Database, private apiKey: string) {}
	 * }
	 *
	 * const ApiKeyTag = Tag.of('apiKey')<string>();
	 *
	 * // Dependencies must match constructor: (Database, string)
	 * const userLayer = Layer.service(UserService, [Database, ApiKeyTag]);
	 *
	 * // Also works with raw values
	 * const userLayer2 = Layer.service(UserService, [Database, 'my-api-key']);
	 * ```
	 */
	service<TClass extends ServiceTag, const TDeps extends readonly unknown[]>(
		cls: TClass,
		deps: TDeps & ValidDepsFor<ConstructorParameters<TClass>>,
		options?: { cleanup?: Finalizer<InstanceType<TClass>> }
	): Layer<ExtractTags<TDeps>, TClass> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return createLayer((builder: any) => {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
			return builder.add(cls, {
				create: async (
					ctx: ResolutionContext<ExtractTags<TDeps>>
				): Promise<InstanceType<TClass>> => {
					// Resolve tags, pass through raw values
					const args = await Promise.all(
						deps.map((dep) =>
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							Tag.isTag(dep) ? ctx.resolve(dep as any) : dep
						)
					);

					return new cls(...args) as InstanceType<TClass>;
				},
				cleanup: options?.cleanup,
			});
		});
	},

	/**
	 * Creates a layer that provides a constant value or pre-instantiated instance.
	 *
	 * Works with both ValueTags (for constants) and ServiceTags (for pre-instantiated instances, useful in tests).
	 *
	 * @param tag - The tag (ValueTag or ServiceTag) to register
	 * @param value - The value or instance to provide
	 *
	 * @example ValueTag (constant)
	 * ```typescript
	 * const ApiKeyTag = Tag.of('apiKey')<string>();
	 * const ConfigTag = Tag.of('config')<{ port: number }>();
	 *
	 * const configLayer = Layer.value(ApiKeyTag, 'secret-key')
	 *   .merge(Layer.value(ConfigTag, { port: 3000 }));
	 * ```
	 *
	 * @example ServiceTag (pre-instantiated instance, useful for testing)
	 * ```typescript
	 * class UserService {
	 *   getUsers() { return []; }
	 * }
	 *
	 * const mockUserService = new UserService();
	 * const testLayer = Layer.value(UserService, mockUserService);
	 * ```
	 */
	value<T extends AnyTag>(tag: T, value: TagType<T>): Layer<never, T> {
		return createLayer<never, T>(
			<TBuilder extends IContainerBuilder>(builder: TBuilder) => {
				return builder.add(tag, () => value) as WithBuilderTags<
					TBuilder,
					T
				>;
			}
		);
	},

	/**
	 * Creates a layer with a mock implementation for testing.
	 *
	 * Similar to `Layer.value()`, but allows partial implementations for ServiceTags,
	 * making it easier to create test mocks without satisfying constructor dependencies.
	 *
	 * **Use this for testing only.** For production code, use `Layer.value()` or `Layer.service()`.
	 *
	 * @param tag - The tag (ServiceTag or ValueTag) to register
	 * @param implementation - The mock implementation (can be partial for ServiceTags)
	 *
	 * @example ServiceTag with partial mock
	 * ```typescript
	 * class UserService {
	 *   constructor(private db: Database) {}
	 *   getUsers() { return this.db.query('SELECT * FROM users'); }
	 * }
	 *
	 * // Mock only the methods you need - no need to satisfy constructor
	 * const testLayer = Layer.mock(UserService, {
	 *   getUsers: () => Promise.resolve([{ id: 1, name: 'Alice' }])
	 * });
	 * ```
	 *
	 * @example ServiceTag with full mock instance
	 * ```typescript
	 * const mockUserService = {
	 *   getUsers: () => Promise.resolve([])
	 * } as UserService;
	 *
	 * const testLayer = Layer.mock(UserService, mockUserService);
	 * ```
	 *
	 * @example ValueTag (works same as Layer.value)
	 * ```typescript
	 * const ConfigTag = Tag.of('config')<{ port: number }>();
	 * const testLayer = Layer.mock(ConfigTag, { port: 3000 });
	 * ```
	 */
	mock<T extends AnyTag>(
		tag: T,
		implementation: T extends ServiceTag
			? Partial<TagType<T>> | TagType<T>
			: TagType<T>
	): Layer<never, T> {
		return createLayer<never, T>(
			<TBuilder extends IContainerBuilder>(builder: TBuilder) => {
				return builder.add(
					tag,
					() => implementation as TagType<T>
				) as WithBuilderTags<TBuilder, T>;
			}
		);
	},

	/**
	 * Creates a custom layer with full control over the factory logic.
	 *
	 * Use this when you need custom instantiation logic that can't be expressed
	 * with `Layer.service()` or `Layer.value()`.
	 *
	 * - `TRequires` is inferred from the `requires` array
	 * - `TProvides` is inferred from what `apply` adds to the builder
	 *
	 * @param options.requires - Array of tags this layer requires (use [] for no requirements)
	 * @param options.apply - Function that adds registrations to a builder
	 *
	 * @example
	 * ```typescript
	 * // Layer with dependencies - TProvides inferred from builder.add()
	 * const cacheLayer = Layer.create({
	 *   requires: [Database],
	 *   apply: (builder) => builder
	 *     .add(Cache, async (ctx) => {
	 *       const db = await ctx.resolve(Database);
	 *       return new Cache(db, { ttl: 3600 });
	 *     })
	 * });
	 * // Type: Layer<typeof Database, typeof Cache>
	 *
	 * // Layer with no dependencies
	 * const dbLayer = Layer.create({
	 *   requires: [],
	 *   apply: (builder) => builder.add(Database, () => new Database())
	 * });
	 * // Type: Layer<never, typeof Database>
	 * ```
	 */
	create<
		const TRequires extends readonly AnyTag[],
		TAllTags extends AnyTag,
	>(options: {
		requires: TRequires;
		apply: (
			builder: IContainerBuilder<TRequires[number]>
		) => IContainerBuilder<TAllTags>;
	}): Layer<TRequires[number], Exclude<TAllTags, TRequires[number]>> {
		type TProvides = Exclude<TAllTags, TRequires[number]>;
		const layer: Layer<TRequires[number], TProvides> = {
			apply: (builder) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return
				return options.apply(builder as any) as any;
			},
			provide(dep) {
				return createProvidedLayer(dep, layer);
			},
			provideMerge(dep) {
				return createComposedLayer(dep, layer);
			},
			merge(other) {
				return createMergedLayer(layer, other);
			},
		};
		return layer;
	},

	/**
	 * Creates an empty layer with no requirements or provisions.
	 *
	 * @example
	 * ```typescript
	 * const baseLayer = Layer.empty()
	 *   .merge(configLayer)
	 *   .merge(serviceLayer);
	 * ```
	 */
	empty(): Layer<never, never> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return
		return createLayer((builder: any) => builder);
	},

	/**
	 * Merges multiple layers at once.
	 *
	 * @param layers - At least 2 layers to merge
	 * @returns A layer combining all requirements and provisions
	 *
	 * @example
	 * ```typescript
	 * const infraLayer = Layer.mergeAll(
	 *   persistenceLayer,
	 *   messagingLayer,
	 *   observabilityLayer
	 * );
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
	 * Merges exactly two layers.
	 * Equivalent to `layer1.merge(layer2)`.
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
