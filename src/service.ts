import {
	DependencySpec,
	Finalizer,
	IContainer,
	ResolutionContext,
} from './container.js';
import { Layer, layer } from './layer.js';
import {
	AnyTag,
	ExtractInjectTag,
	ServiceTag,
	ServiceTagIdKey,
	Tag,
	TagId,
	TagType,
} from './tag.js';

/**
 * Extracts constructor parameter types from a ServiceTag.
 * Only parameters that extend AnyTag are considered as dependencies.
 * @internal
 */
export type ConstructorParams<T extends ServiceTag<TagId, unknown>> =
	T extends new (...args: infer A) => unknown ? A : never;

/**
 * Helper to normalize a tag type.
 * For ServiceTags, this strips away extra static properties of the class constructor,
 * reducing it to the canonical ServiceTag<Id, Instance> form.
 * @internal
 */
export type CanonicalTag<T extends AnyTag> =
	T extends ServiceTag<infer Id, infer Instance>
		? ServiceTag<Id, Instance>
		: T;

/**
 * Extracts only dependency tags from a constructor parameter list.
 * Filters out non‑DI parameters.
 *
 * Example:
 *   [DatabaseService, Inject<typeof ConfigTag>, number]
 *     → typeof DatabaseService | typeof ConfigTag
 * @internal
 */
export type ExtractConstructorDeps<T extends readonly unknown[]> =
	T extends readonly []
		? never
		: {
				[K in keyof T]: T[K] extends {
					readonly [ServiceTagIdKey]?: infer Id;
				}
					? // Service tag
						Id extends TagId
						? // Use canonical tag form (stripped of statics) to ensure
							// requirements match provisions in Layer composition.
							T[K] extends new (
								...args: unknown[]
							) => infer Instance
							? ServiceTag<Id, Instance>
							: ServiceTag<Id, T[K]>
						: never
					: // Value tag
						ExtractInjectTag<T[K]> extends never
						? never
						: ExtractInjectTag<T[K]>;
			}[number];

/**
 * Produces an ordered tuple of constructor parameters
 * where dependency parameters are replaced with their tag types,
 * while non‑DI parameters are preserved as‑is.
 * @internal
 */
export type InferConstructorDepsTuple<T extends readonly unknown[]> =
	T extends readonly []
		? never
		: {
				[K in keyof T]: T[K] extends {
					readonly [ServiceTagIdKey]?: infer Id;
				}
					? // Service tag
						Id extends TagId
						? // Use canonical tag form
							T[K] extends new (
								...args: unknown[]
							) => infer Instance
							? ServiceTag<Id, Instance>
							: ServiceTag<Id, T[K]>
						: never
					: // Value tag
						ExtractInjectTag<T[K]> extends never
						? T[K] // non-tag value
						: ExtractInjectTag<T[K]>;
			};

/**
 * Union of all dependency tags a ServiceTag constructor requires.
 * Filters out non‑DI parameters.
 */
export type ServiceDependencies<T extends ServiceTag<TagId, unknown>> =
	ExtractConstructorDeps<ConstructorParams<T>> extends AnyTag
		? ExtractConstructorDeps<ConstructorParams<T>>
		: never;

/**
 * Ordered tuple of dependency tags (and other constructor params)
 * inferred from a ServiceTag’s constructor.
 */
export type ServiceDepsTuple<T extends ServiceTag<TagId, unknown>> =
	InferConstructorDepsTuple<ConstructorParams<T>>;

/**
 * Creates a service layer from any tag type (ServiceTag or ValueTag) with optional parameters.
 *
 * For ServiceTag services:
 * - Dependencies are automatically inferred from constructor parameters
 * - The factory function must handle dependency injection by resolving dependencies from the container
 *
 * For ValueTag services:
 * - No constructor dependencies are needed since they don't have constructors
 *
 * @template T - The tag representing the service (ServiceTag or ValueTag)
 * @param tag - The tag (ServiceTag or ValueTag)
 * @param factory - Factory function for service instantiation with container
 * @returns The service layer
 *
 * @example Simple service without dependencies
 * ```typescript
 * class LoggerService extends Tag.Service('LoggerService') {
 *   log(message: string) { console.log(message); }
 * }
 *
 * const loggerService = service(LoggerService, () => new LoggerService());
 * ```
 *
 * @example Service with dependencies
 * ```typescript
 * class DatabaseService extends Tag.Service('DatabaseService') {
 *   query() { return []; }
 * }
 *
 * class UserService extends Tag.Service('UserService') {
 *   constructor(private db: DatabaseService) {
 *     super();
 *   }
 *
 *   getUsers() { return this.db.query(); }
 * }
 *
 * const userService = service(UserService, async (ctx) =>
 *   new UserService(await ctx.resolve(DatabaseService))
 * );
 * ```
 */
export function service<T extends ServiceTag<TagId, unknown>>(
	tag: T,
	spec: DependencySpec<T, ServiceDependencies<T>>
): Layer<ServiceDependencies<T>, CanonicalTag<T>> {
	return layer<ServiceDependencies<T>, CanonicalTag<T>>(
		<TContainer extends AnyTag>(
			container: IContainer<TContainer | ServiceDependencies<T>>
		) => {
			return container.register(tag, spec) as IContainer<
				TContainer | ServiceDependencies<T> | CanonicalTag<T>
			>;
		}
	);
}

/**
 * Specification for autoService.
 * Can be either a tuple of constructor parameters or an object with dependencies and finalizer.
 */
export type AutoServiceSpec<T extends ServiceTag<TagId, unknown>> =
	| ServiceDepsTuple<T>
	| {
			dependencies: ServiceDepsTuple<T>;
			cleanup?: Finalizer<TagType<T>>;
	  };

/**
 * Creates a service layer with automatic dependency injection by inferring constructor parameters.
 *
 * This is a convenience function that automatically resolves constructor dependencies and passes
 * both DI-managed dependencies and static values to the service constructor in the correct order.
 * It eliminates the need to manually write factory functions for services with constructor dependencies.
 *
 * @template T - The ServiceTag representing the service class
 * @param tag - The service tag (must be a ServiceTag, not a ValueTag)
 * @param deps - Tuple of constructor parameters in order - mix of dependency tags and static values
 * @param finalizer - Optional cleanup function called when the container is destroyed
 * @returns A service layer that automatically handles dependency injection
 *
 * @example Simple service with dependencies
 * ```typescript
 * class DatabaseService extends Tag.Service('DatabaseService') {
 *   constructor(private url: string) {
 *     super();
 *   }
 *   connect() { return `Connected to ${this.url}`; }
 * }
 *
 * class UserService extends Tag.Service('UserService') {
 *   constructor(private db: DatabaseService, private timeout: number) {
 *     super();
 *   }
 *   getUsers() { return this.db.query('SELECT * FROM users'); }
 * }
 *
 * // Automatically inject DatabaseService and pass static timeout value
 * const userService = autoService(UserService, [DatabaseService, 5000]);
 * ```
 *
 * @example Mixed dependencies and static values
 * ```typescript
 * class NotificationService extends Tag.Service('NotificationService') {
 *   constructor(
 *     private logger: LoggerService,
 *     private apiKey: string,
 *     private retries: number,
 *     private cache: CacheService
 *   ) {
 *     super();
 *   }
 * }
 *
 * // Mix of DI tags and static values in constructor order
 * const notificationService = autoService(NotificationService, [
 *   LoggerService,    // Will be resolved from container
 *   'secret-api-key', // Static string value
 *   3,                // Static number value
 *   CacheService      // Will be resolved from container
 * ]);
 * ```
 *
 * @example Compared to manual service creation
 * ```typescript
 * // Manual approach (more verbose)
 * const userServiceManual = service(UserService, async (ctx) => {
 *   const db = await ctx.resolve(DatabaseService);
 *   return new UserService(db, 5000);
 * });
 *
 * // Auto approach (concise)
 * const userServiceAuto = autoService(UserService, [DatabaseService, 5000]);
 * ```
 *
 * @example With finalizer for cleanup
 * ```typescript
 * class DatabaseService extends Tag.Service('DatabaseService') {
 *   constructor(private connectionString: string) {
 *     super();
 *   }
 *
 *   private connection: Connection | null = null;
 *
 *   async connect() {
 *     this.connection = await createConnection(this.connectionString);
 *   }
 *
 *   async disconnect() {
 *     if (this.connection) {
 *       await this.connection.close();
 *       this.connection = null;
 *     }
 *   }
 * }
 *
 * // Service with automatic cleanup
 * const dbService = autoService(
 *   DatabaseService,
 * 	 {
 * 		dependencies: ['postgresql://localhost:5432/mydb'],
 * 		cleanup: (service) => service.disconnect() // Finalizer for cleanup
 * 	 }
 * );
 * ```
 */
export function autoService<T extends ServiceTag<TagId, unknown>>(
	tag: T,
	spec: AutoServiceSpec<T>
): Layer<ServiceDependencies<T>, CanonicalTag<T>> {
	if (Array.isArray(spec)) {
		spec = { dependencies: spec };
	}

	const create = async (ctx: ResolutionContext<ServiceDependencies<T>>) => {
		// Split out the DI-managed tags from the static params
		const diDeps: AnyTag[] = [];
		for (const dep of spec.dependencies) {
			if (Tag.isTag(dep)) diDeps.push(dep);
		}

		// Resolve only those tags
		const resolved = await ctx.resolveAll(
			...(diDeps as ServiceDependencies<T>[])
		);

		// Reassemble constructor args in correct order
		const args: unknown[] = [];
		let resolvedIndex = 0;

		for (const dep of spec.dependencies) {
			if (Tag.isTag(dep)) {
				args.push(resolved[resolvedIndex++]);
			} else {
				args.push(dep); // pass non-tag values directly
			}
		}

		// Instantiate service with both resolved and static deps
		return new tag(...args) as TagType<T>;
	};

	return service(tag, { create, cleanup: spec.cleanup });
}
