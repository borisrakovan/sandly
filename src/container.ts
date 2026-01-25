import {
	CircularDependencyError,
	ContainerDestroyedError,
	DependencyCreationError,
	DependencyFinalizationError,
	UnknownDependencyError,
} from './errors.js';
import { Layer } from './layer.js';
import { AnyTag, TagType } from './tag.js';
import { Contravariant, PromiseOrValue } from './types.js';

/**
 * Factory function that creates a dependency instance.
 *
 * Receives a resolution context for injecting other dependencies.
 * Can be synchronous or asynchronous.
 *
 * @template T - The type of the service instance being created
 * @template TRequires - Union type of required dependencies
 */
export type Factory<T, TRequires extends AnyTag> = (
	ctx: ResolutionContext<TRequires>
) => PromiseOrValue<T>;

/**
 * Cleanup function called when the container is destroyed.
 *
 * @template T - The type of the service instance being cleaned up
 */
export type Finalizer<T> = (instance: T) => PromiseOrValue<void>;

/**
 * Complete dependency lifecycle with factory and optional cleanup.
 *
 * Can be implemented as a class for complex lifecycle logic.
 *
 * @template T - The instance type
 * @template TRequires - Union type of required dependencies
 */
export interface DependencyLifecycle<T, TRequires extends AnyTag> {
	create: Factory<T, TRequires>;
	cleanup?: Finalizer<T>;
}

/**
 * Valid dependency registration: either a factory function or lifecycle object.
 */
export type DependencySpec<T extends AnyTag, TRequires extends AnyTag> =
	| Factory<TagType<T>, TRequires>
	| DependencyLifecycle<TagType<T>, TRequires>;

/**
 * Context available to factory functions during resolution.
 *
 * Provides `resolve` and `resolveAll` for injecting dependencies.
 */
export type ResolutionContext<TTags extends AnyTag> = Pick<
	IContainer<TTags>,
	'resolve' | 'resolveAll'
>;

/**
 * Internal implementation of ResolutionContext that carries the resolution chain
 * for circular dependency detection.
 * @internal
 */
class ResolutionContextImpl<
	TTags extends AnyTag,
> implements ResolutionContext<TTags> {
	constructor(
		private readonly resolveFn: (tag: AnyTag) => Promise<unknown>
	) {}

	async resolve<T extends TTags>(tag: T): Promise<TagType<T>> {
		return this.resolveFn(tag) as Promise<TagType<T>>;
	}

	async resolveAll<const T extends readonly TTags[]>(
		...tags: T
	): Promise<{ [K in keyof T]: TagType<T[K]> }> {
		const promises = tags.map((tag) => this.resolve(tag));
		const results = await Promise.all(promises);
		return results as { [K in keyof T]: TagType<T[K]> };
	}
}

/**
 * Unique symbol for container type branding.
 */
export const ContainerTypeId: unique symbol = Symbol.for('sandly/Container');

/**
 * Interface for dependency containers.
 *
 * @template TTags - Union type of registered dependency tags
 */
export interface IContainer<TTags extends AnyTag = never> {
	readonly [ContainerTypeId]: {
		readonly _TTags: Contravariant<TTags>;
	};

	resolve: <T extends TTags>(tag: T) => Promise<TagType<T>>;
	resolveAll: <const T extends readonly TTags[]>(
		...tags: T
	) => Promise<{ [K in keyof T]: TagType<T[K]> }>;
	use: <T extends TTags, R>(
		tag: T,
		fn: (service: TagType<T>) => PromiseOrValue<R>
	) => Promise<R>;
	destroy(): Promise<void>;
}

/**
 * Extracts the registered tags from a container type.
 */
export type ContainerTags<C> =
	C extends IContainer<infer TTags> ? TTags : never;

/**
 * Common interface for container builders that support adding dependencies.
 * Used by Layer to work with both ContainerBuilder and ScopedContainerBuilder.
 */
export interface IContainerBuilder<TTags extends AnyTag = never> {
	add<T extends AnyTag>(
		tag: T,
		spec: DependencySpec<T, TTags>
	): IContainerBuilder<TTags | T>;
}

/**
 * Extracts the registered tags from a builder type.
 */
export type BuilderTags<B> =
	B extends IContainerBuilder<infer TTags> ? TTags : never;

/**
 * Builder for constructing immutable containers.
 *
 * Use `Container.builder()` to create a builder, then chain `.add()` calls
 * to register dependencies, and finally call `.build()` to create the container.
 *
 * @template TTags - Union type of registered dependency tags
 *
 * @example
 * ```typescript
 * const container = Container.builder()
 *   .add(Database, () => new Database())
 *   .add(UserService, async (ctx) =>
 *     new UserService(await ctx.resolve(Database))
 *   )
 *   .build();
 * ```
 */
export class ContainerBuilder<TTags extends AnyTag = never> {
	private readonly factories = new Map<AnyTag, Factory<unknown, TTags>>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private readonly finalizers = new Map<AnyTag, Finalizer<any>>();

	/**
	 * Registers a dependency with a factory function or lifecycle object.
	 *
	 * @param tag - The dependency tag (class or ValueTag)
	 * @param spec - Factory function or lifecycle object
	 * @returns The builder with updated type information
	 */
	add<T extends AnyTag>(
		tag: T,
		spec: DependencySpec<T, TTags>
	): ContainerBuilder<TTags | T> {
		if (typeof spec === 'function') {
			this.factories.set(tag, spec as Factory<unknown, TTags>);
			// Remove any existing finalizer when registering with just a factory
			this.finalizers.delete(tag);
		} else {
			// Bind the create method to preserve 'this' context for class instances
			this.factories.set(
				tag,
				spec.create.bind(spec) as Factory<unknown, TTags>
			);
			if (spec.cleanup) {
				// Bind the cleanup method to preserve 'this' context for class instances
				this.finalizers.set(tag, spec.cleanup.bind(spec));
			} else {
				// Remove any existing finalizer when registering with just a create function
				this.finalizers.delete(tag);
			}
		}
		return this as ContainerBuilder<TTags | T>;
	}

	/**
	 * Creates an immutable container from the registered dependencies.
	 */
	build(): Container<TTags> {
		return Container._createFromBuilder(this.factories, this.finalizers);
	}
}

/**
 * Type-safe dependency injection container.
 *
 * Containers are immutable - use `Container.builder()` to create one.
 * Each dependency is created once (singleton) and cached.
 *
 * @template TTags - Union type of registered dependency tags
 *
 * @example
 * ```typescript
 * class Database {
 *   query(sql: string) { return []; }
 * }
 *
 * class UserService {
 *   constructor(private db: Database) {}
 *   getUsers() { return this.db.query('SELECT * FROM users'); }
 * }
 *
 * const container = Container.builder()
 *   .add(Database, () => new Database())
 *   .add(UserService, async (ctx) =>
 *     new UserService(await ctx.resolve(Database))
 *   )
 *   .build();
 *
 * const userService = await container.resolve(UserService);
 * ```
 */
export class Container<
	TTags extends AnyTag = never,
> implements IContainer<TTags> {
	readonly [ContainerTypeId]!: {
		readonly _TTags: Contravariant<TTags>;
	};

	/**
	 * Cache of instantiated dependencies.
	 * @internal
	 */
	protected readonly cache = new Map<AnyTag, Promise<unknown>>();

	/**
	 * Factory functions for creating dependencies.
	 * @internal
	 */
	protected readonly factories: Map<AnyTag, Factory<unknown, TTags>>;

	/**
	 * Cleanup functions for dependencies.
	 * @internal
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected readonly finalizers: Map<AnyTag, Finalizer<any>>;

	/**
	 * Whether this container has been destroyed.
	 * @internal
	 */
	protected isDestroyed = false;

	/**
	 * @internal - Use Container.builder() or Container.empty()
	 */
	protected constructor(
		factories: Map<AnyTag, Factory<unknown, TTags>>,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		finalizers: Map<AnyTag, Finalizer<any>>
	) {
		this.factories = factories;
		this.finalizers = finalizers;
	}

	/**
	 * @internal - Used by ContainerBuilder
	 */
	static _createFromBuilder<T extends AnyTag>(
		factories: Map<AnyTag, Factory<unknown, T>>,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		finalizers: Map<AnyTag, Finalizer<any>>
	): Container<T> {
		return new Container(factories, finalizers);
	}

	/**
	 * Creates a new container builder.
	 *
	 * @example
	 * ```typescript
	 * const container = Container.builder()
	 *   .add(Database, () => new Database())
	 *   .build();
	 * ```
	 */
	static builder(): ContainerBuilder {
		return new ContainerBuilder();
	}

	/**
	 * Creates an empty container with no dependencies.
	 *
	 * Shorthand for `Container.builder().build()`.
	 */
	static empty(): Container {
		return Container.builder().build();
	}

	/**
	 * Creates a scoped container for hierarchical dependency management.
	 *
	 * Scoped containers support parent/child relationships where children
	 * can access parent dependencies but maintain their own cache.
	 *
	 * @param scope - Identifier for the scope (for debugging)
	 *
	 * @example
	 * ```typescript
	 * const appContainer = Container.scoped('app');
	 * // ... add app-level dependencies
	 *
	 * const requestContainer = appContainer.child('request');
	 * // ... add request-specific dependencies
	 * ```
	 */
	static scoped(scope: string | symbol): ScopedContainer {
		return ScopedContainer.empty(scope);
	}

	/**
	 * Creates a container from a layer.
	 *
	 * This is a convenience method equivalent to applying a layer to
	 * `Container.builder()` and building the result.
	 *
	 * @param layer - A layer with no requirements (all dependencies satisfied)
	 *
	 * @example
	 * ```typescript
	 * const dbLayer = Layer.service(Database, []);
	 * const container = Container.from(dbLayer);
	 *
	 * const db = await container.resolve(Database);
	 * ```
	 */
	static from<TProvides extends AnyTag>(
		layer: Layer<never, TProvides>
	): Container<TProvides> {
		const builder = Container.builder();
		const resultBuilder = layer.apply(builder);
		return resultBuilder.build();
	}

	/**
	 * Resolves a dependency, creating it if necessary.
	 *
	 * Dependencies are singletons - the same instance is returned on subsequent calls.
	 *
	 * @param tag - The dependency tag to resolve
	 * @returns Promise resolving to the dependency instance
	 * @throws {ContainerDestroyedError} If the container has been destroyed
	 * @throws {UnknownDependencyError} If any dependency is not registered
	 * @throws {CircularDependencyError} If a circular dependency is detected
	 * @throws {DependencyCreationError} If any factory function throws an error
	 */
	async resolve<T extends TTags>(tag: T): Promise<TagType<T>> {
		return this.resolveInternal(tag, []);
	}

	/**
	 * Internal resolution with dependency chain tracking.
	 * @internal
	 */
	protected resolveInternal<T extends TTags>(
		tag: T,
		chain: AnyTag[]
	): Promise<TagType<T>> {
		if (this.isDestroyed) {
			throw new ContainerDestroyedError(
				'Cannot resolve dependencies from a destroyed container'
			);
		}

		// Check cache first
		const cached = this.cache.get(tag) as Promise<TagType<T>> | undefined;
		if (cached !== undefined) {
			return cached;
		}

		// Check for circular dependency
		if (chain.includes(tag)) {
			throw new CircularDependencyError(tag, chain);
		}

		// Get factory
		const factory = this.factories.get(tag) as
			| Factory<TagType<T>, TTags>
			| undefined;

		if (factory === undefined) {
			throw new UnknownDependencyError(tag);
		}

		// Create resolution context with updated chain
		const newChain = [...chain, tag];
		const context = new ResolutionContextImpl((t: AnyTag) =>
			this.resolveInternal(t as TTags, newChain)
		);

		// Create and cache the promise
		const instancePromise: Promise<TagType<T>> = (async () => {
			try {
				const instance = await factory(context);
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return
				return instance as TagType<T>;
			} catch (error) {
				throw new DependencyCreationError(tag, error);
			}
		})().catch((error: unknown) => {
			// Remove failed promise from cache
			this.cache.delete(tag);
			throw error;
		});

		// Cache the promise immediately to prevent race conditions during concurrent access.
		// Multiple concurrent resolve() calls will share the same promise, ensuring singleton behavior
		// even when the factory is async and takes time to complete.
		this.cache.set(tag, instancePromise);
		return instancePromise;
	}

	/**
	 * Resolves multiple dependencies concurrently.
	 *
	 * @param tags - The dependency tags to resolve
	 * @returns Promise resolving to a tuple of instances
	 * @throws {ContainerDestroyedError} If the container has been destroyed
	 * @throws {UnknownDependencyError} If any dependency is not registered
	 * @throws {CircularDependencyError} If a circular dependency is detected
	 * @throws {DependencyCreationError} If any factory function throws an error
	 */
	async resolveAll<const T extends readonly TTags[]>(
		...tags: T
	): Promise<{ [K in keyof T]: TagType<T[K]> }> {
		if (this.isDestroyed) {
			throw new ContainerDestroyedError(
				'Cannot resolve dependencies from a destroyed container'
			);
		}

		// Use Promise.all to resolve all dependencies concurrently
		const promises = tags.map((tag) => this.resolve(tag));
		const results = await Promise.all(promises);
		return results as { [K in keyof T]: TagType<T[K]> };
	}

	/**
	 * Resolves a service, runs the callback with it, then destroys the container.
	 *
	 * This is a convenience method for the common "create, use, destroy" pattern.
	 * The container is always destroyed after the callback completes, even if it throws.
	 *
	 * @param tag - The dependency tag to resolve
	 * @param fn - Callback that receives the resolved service
	 * @returns Promise resolving to the callback's return value
	 * @throws {ContainerDestroyedError} If the container has been destroyed
	 * @throws {UnknownDependencyError} If the dependency is not registered
	 * @throws {CircularDependencyError} If a circular dependency is detected
	 * @throws {DependencyCreationError} If the factory function throws
	 * @throws {DependencyFinalizationError} If the finalizer function throws
	 *
	 * @example
	 * ```typescript
	 * const result = await container.use(UserService, (service) =>
	 *   service.getUsers()
	 * );
	 * // Container is automatically destroyed after callback completes
	 * ```
	 */
	async use<T extends TTags, R>(
		tag: T,
		fn: (service: TagType<T>) => PromiseOrValue<R>
	): Promise<R> {
		try {
			const service = await this.resolve(tag);
			return await fn(service);
		} finally {
			await this.destroy();
		}
	}

	/**
	 * Destroys the container, calling all finalizers.
	 *
	 * After destruction, the container cannot be used.
	 * Finalizers run concurrently, so there are no ordering guarantees.
	 * Services should be designed to handle cleanup gracefully regardless of the order in which their
	 * dependencies are cleaned up.
	 *
	 * @throws {DependencyFinalizationError} If any finalizers fail
	 */
	async destroy(): Promise<void> {
		if (this.isDestroyed) {
			return; // Already destroyed, nothing to do
		}

		try {
			const promises = Array.from(this.finalizers.entries())
				.filter(([tag]) => this.cache.has(tag))
				.map(async ([tag, finalizer]) => {
					const dep = await this.cache.get(tag);
					return finalizer(dep);
				});

			const results = await Promise.allSettled(promises);

			const failures = results.filter((r) => r.status === 'rejected');
			if (failures.length > 0) {
				throw new DependencyFinalizationError(
					failures.map((r) => r.reason as unknown)
				);
			}
		} finally {
			// Mark as destroyed and clear all state
			this.isDestroyed = true;
			this.cache.clear();
			// Note: We keep factories/finalizers for potential debugging,
			// but the container is no longer usable
		}
	}
}

/**
 * Scope identifier type.
 */
export type Scope = string | symbol;

/**
 * Builder for constructing scoped containers.
 *
 * @template TTags - Union type of registered dependency tags
 */
export class ScopedContainerBuilder<TTags extends AnyTag = never> {
	private readonly factories = new Map<AnyTag, Factory<unknown, TTags>>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private readonly finalizers = new Map<AnyTag, Finalizer<any>>();

	constructor(
		private readonly scope: Scope,
		private readonly parent: IContainer<TTags> | null
	) {}

	/**
	 * Registers a dependency with a factory function or lifecycle object.
	 */
	add<T extends AnyTag>(
		tag: T,
		spec: DependencySpec<T, TTags>
	): ScopedContainerBuilder<TTags | T> {
		if (typeof spec === 'function') {
			this.factories.set(tag, spec as Factory<unknown, TTags>);
			// Remove any existing finalizer when registering with just a factory
			this.finalizers.delete(tag);
		} else {
			// Bind the create method to preserve 'this' context for class instances
			this.factories.set(
				tag,
				spec.create.bind(spec) as Factory<unknown, TTags>
			);
			if (spec.cleanup) {
				// Bind the cleanup method to preserve 'this' context for class instances
				this.finalizers.set(tag, spec.cleanup.bind(spec));
			} else {
				// Remove any existing finalizer when registering with just a factory
				this.finalizers.delete(tag);
			}
		}
		return this as ScopedContainerBuilder<TTags | T>;
	}

	/**
	 * Creates an immutable scoped container from the registered dependencies.
	 */
	build(): ScopedContainer<TTags> {
		const child = ScopedContainer._createScopedFromBuilder(
			this.scope,
			this.parent,
			this.factories,
			this.finalizers
		);
		// Register child with parent for proper destruction order
		if (this.parent instanceof ScopedContainer) {
			this.parent._registerChild(child);
		}
		return child;
	}
}

/**
 * Scoped container for hierarchical dependency management.
 *
 * Supports parent/child relationships where children can access parent
 * dependencies but maintain their own cache. Useful for request-scoped
 * dependencies in web applications.
 *
 * @template TTags - Union type of registered dependency tags
 *
 * @example
 * ```typescript
 * // Application-level container
 * const appContainer = ScopedContainer.builder('app')
 *   .add(Database, () => new Database())
 *   .build();
 *
 * // Request-level container (inherits from app)
 * const requestContainer = appContainer.child('request')
 *   .add(RequestContext, () => new RequestContext())
 *   .build();
 *
 * // Can resolve both app and request dependencies
 * const db = await requestContainer.resolve(Database);
 * const ctx = await requestContainer.resolve(RequestContext);
 * ```
 */
// @ts-expect-error - ScopedContainer overrides the empty method
export class ScopedContainer<
	TTags extends AnyTag = never,
> extends Container<TTags> {
	public readonly scope: Scope;
	private parent: IContainer<TTags> | null;
	private readonly children: WeakRef<ScopedContainer<TTags>>[] = [];

	/**
	 * @internal
	 */
	protected constructor(
		scope: Scope,
		parent: IContainer<TTags> | null,
		factories: Map<AnyTag, Factory<unknown, TTags>>,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		finalizers: Map<AnyTag, Finalizer<any>>
	) {
		super(factories, finalizers);
		this.scope = scope;
		this.parent = parent;
	}

	/**
	 * @internal - Used by ScopedContainerBuilder
	 */
	static _createScopedFromBuilder<T extends AnyTag>(
		scope: Scope,
		parent: IContainer<T> | null,
		factories: Map<AnyTag, Factory<unknown, T>>,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		finalizers: Map<AnyTag, Finalizer<any>>
	): ScopedContainer<T> {
		return new ScopedContainer(scope, parent, factories, finalizers);
	}

	/**
	 * Creates a new scoped container builder.
	 *
	 * @param scope - Identifier for the scope (for debugging)
	 *
	 * @example
	 * ```typescript
	 * const container = ScopedContainer.builder('app')
	 *   .add(Database, () => new Database())
	 *   .build();
	 * ```
	 */
	static override builder(scope: Scope): ScopedContainerBuilder {
		return new ScopedContainerBuilder(scope, null);
	}

	/**
	 * Creates an empty scoped container with no dependencies.
	 */
	static override empty(scope: Scope): ScopedContainer {
		return ScopedContainer.builder(scope).build();
	}

	/**
	 * Creates a scoped container from a layer.
	 *
	 * This is a convenience method equivalent to applying a layer to
	 * `ScopedContainer.builder()` and building the result.
	 *
	 * @param scope - Identifier for the scope (for debugging)
	 * @param layer - A layer with no requirements (all dependencies satisfied)
	 *
	 * @example
	 * ```typescript
	 * const dbLayer = Layer.service(Database, []);
	 * const container = ScopedContainer.from('app', dbLayer);
	 *
	 * const db = await container.resolve(Database);
	 * ```
	 */
	static override from<TProvides extends AnyTag>(
		scope: Scope,
		layer: Layer<never, TProvides>
	): ScopedContainer<TProvides> {
		const builder = ScopedContainer.builder(scope);
		const resultBuilder = layer.apply(builder);
		return resultBuilder.build();
	}

	/**
	 * Resolves a dependency from this scope or parent scopes, creating it if necessary.
	 *
	 * Dependencies are singletons - the same instance is returned on subsequent calls.
	 *
	 * @param tag - The dependency tag to resolve
	 * @returns Promise resolving to the dependency instance
	 * @throws {ContainerDestroyedError} If the container has been destroyed
	 * @throws {UnknownDependencyError} If any dependency is not registered
	 * @throws {CircularDependencyError} If a circular dependency is detected
	 * @throws {DependencyCreationError} If any factory function throws an error
	 */
	override async resolve<T extends TTags>(tag: T): Promise<TagType<T>> {
		return this.resolveInternal(tag, []);
	}

	/**
	 * Internal resolution with parent delegation.
	 * @internal
	 */
	protected override resolveInternal<T extends TTags>(
		tag: T,
		chain: AnyTag[]
	): Promise<TagType<T>> {
		// If this scope has a factory, resolve here
		if (this.factories.has(tag)) {
			return super.resolveInternal(tag, chain);
		}

		// Delegate to parent
		if (this.parent !== null) {
			return this.parent.resolve(tag);
		}

		throw new UnknownDependencyError(tag);
	}

	/**
	 * @internal - Used by ScopedContainerBuilder to register children
	 */
	_registerChild(child: ScopedContainer<TTags>): void {
		this.children.push(new WeakRef(child));
	}

	/**
	 * Creates a child container builder that inherits from this container.
	 *
	 * Use this to create a child scope and add dependencies to it.
	 * The child can resolve dependencies from this container.
	 *
	 * @param scope - Identifier for the child scope
	 * @returns A new ScopedContainerBuilder for the child scope
	 * @throws {ContainerDestroyedError} If the container has been destroyed
	 *
	 * @example
	 * ```typescript
	 * const requestContainer = appContainer.child('request')
	 *   .add(RequestContext, () => new RequestContext())
	 *   .build();
	 *
	 * await requestContainer.resolve(Database); // From parent
	 * await requestContainer.resolve(RequestContext); // From this scope
	 * ```
	 */
	child(scope: Scope): ScopedContainerBuilder<TTags> {
		if (this.isDestroyed) {
			throw new ContainerDestroyedError(
				'Cannot create child containers from a destroyed container'
			);
		}
		return new ScopedContainerBuilder(scope, this);
	}

	/**
	 * Creates a child container with a layer applied.
	 *
	 * This is a convenience method combining child() + layer.apply() + build().
	 * Use this when you have a layer ready to apply.
	 *
	 * @param scope - Identifier for the child scope
	 * @param layer - Layer to apply to the child (can require parent's tags)
	 *
	 * @example
	 * ```typescript
	 * const requestContainer = appContainer.childFrom('request',
	 *   userService
	 *     .provide(Layer.value(TenantContext, tenantCtx))
	 *     .provide(Layer.value(RequestId, requestId))
	 * );
	 *
	 * const users = await requestContainer.resolve(UserService);
	 * ```
	 */
	childFrom<TProvides extends AnyTag>(
		scope: Scope,
		layer: Layer<TTags, TProvides>
	): ScopedContainer<TTags | TProvides> {
		return layer.apply(this.child(scope)).build();
	}

	/**
	 * Destroys this container and all child containers.
	 *
	 * Children are destroyed first to ensure proper cleanup order.
	 *
	 * After destruction, the container cannot be used.
	 * Finalizers run concurrently, so there are no ordering guarantees.
	 * Services should be designed to handle cleanup gracefully regardless of the order in which their
	 * dependencies are cleaned up.
	 *
	 * @throws {DependencyFinalizationError} If any finalizers fail
	 */
	override async destroy(): Promise<void> {
		if (this.isDestroyed) {
			return; // Already destroyed, nothing to do
		}

		const allFailures: unknown[] = [];

		// Destroy children first (they may depend on our dependencies)
		const childDestroyPromises = this.children
			.map((ref) => ref.deref())
			.filter(
				(child): child is ScopedContainer<TTags> => child !== undefined
			)
			.map((child) => child.destroy());

		const childResults = await Promise.allSettled(childDestroyPromises);

		const childFailures = childResults
			.filter((r) => r.status === 'rejected')
			.map((r) => r.reason as unknown);

		allFailures.push(...childFailures);

		try {
			await super.destroy();
		} catch (error) {
			allFailures.push(error);
		} finally {
			this.parent = null;
		}

		if (allFailures.length > 0) {
			throw new DependencyFinalizationError(allFailures);
		}
	}
}
