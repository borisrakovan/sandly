import { getKey } from './utils/object.js';

/**
 * Type representing a tag identifier (string or symbol).
 * @internal
 */
export type TagId = string | symbol;

/**
 * Symbol used to identify tagged types within the dependency injection system.
 * This symbol is used as a property key to attach metadata to both value tags and service tags.
 *
 * Note: We can't use a symbol here becuase it produced the following TS error:
 *  error TS4020: 'extends' clause of exported class 'NotificationService' has or is using private name 'TagIdKey'.
 *
 * @internal
 */
export const ValueTagIdKey = 'sandly/ValueTagIdKey';

export const ServiceTagIdKey = 'sandly/ServiceTagIdKey';

/**
 * Internal string used to identify the type of a tagged type within the dependency injection system.
 * This string is used as a property key to attach metadata to both value tags and service tags.
 * It is used to carry the type of the tagged type and should not be used directly.
 * @internal
 */
export const TagTypeKey = 'sandly/TagTypeKey';

/**
 * Type representing a value-based dependency tag.
 *
 * Value tags are used to represent non-class dependencies like configuration objects,
 * strings, numbers, or any other values. They use phantom types to maintain type safety
 * while being distinguishable at runtime through their unique identifiers.
 *
 * @template T - The type of the value this tag represents
 * @template Id - The unique identifier for this tag (string or symbol)
 *
 * @example
 * ```typescript
 * // Creates a value tag for string configuration
 * const ApiKeyTag: ValueTag<'apiKey', string> = Tag.of('apiKey')<string>();
 *
 * // Register in container
 * container.register(ApiKeyTag, () => 'my-secret-key');
 * ```
 */
export interface ValueTag<Id extends TagId, T> {
	readonly [ValueTagIdKey]: Id;
	readonly [TagTypeKey]: T;
}

/**
 * Type representing a class-based dependency tag.
 *
 * Tagged classes are created by Tag.Service() and serve as both the dependency identifier
 * and the constructor for the service. They extend regular classes with tag metadata
 * that the DI system uses for identification and type safety.
 *
 * @template Id - The unique identifier for this tag (string or symbol)
 * @template T - The type of instances created by this tagged class
 *
 * @example
 * ```typescript
 * // Creates a tagged class
 * class UserService extends Tag.Service('UserService') {
 *   getUsers() { return []; }
 * }
 *
 * // Register in container
 * container.register(UserService, () => new UserService());
 * ```
 *
 * @internal - Users should use Tag.Service() instead of working with this type directly
 */
export interface ServiceTag<Id extends TagId, T> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	new (...args: any[]): T & { readonly [ServiceTagIdKey]?: Id };
	readonly [ServiceTagIdKey]?: Id;
}

/**
 * Utility type that extracts the service type from any dependency tag.
 *
 * This type is essential for type inference throughout the DI system, allowing
 * the container and layers to automatically determine what type of service
 * a given tag represents without manual type annotations.
 *
 * @template T - Any dependency tag (ValueTag or ServiceTag)
 * @returns The service type that the tag represents
 *
 * @example With value tags
 * ```typescript
 * const StringTag = Tag.of('myString')<string>();
 * const ConfigTag = Tag.of('config')<{ apiKey: string }>();
 *
 * type StringService = TagType<typeof StringTag>; // string
 * type ConfigService = TagType<typeof ConfigTag>; // { apiKey: string }
 * ```
 *
 * @example With service tags
 * ```typescript
 * class UserService extends Tag.Service('UserService') {
 *   getUsers() { return []; }
 * }
 *
 * type UserServiceType = TagType<typeof UserService>; // UserService
 * ```
 *
 * @example Used in container methods
 * ```typescript
 * // The container uses TagType internally for type inference
 * container.register(StringTag, () => 'hello'); // Factory must return string
 * container.register(UserService, () => new UserService()); // Factory must return UserService
 *
 * const str: string = await container.resolve(StringTag); // Automatically typed as string
 * const user: UserService = await container.resolve(UserService); // Automatically typed as UserService
 * ```
 */
export type TagType<TTag extends AnyTag> =
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	TTag extends ValueTag<any, infer T>
		? T
		: // eslint-disable-next-line @typescript-eslint/no-explicit-any
			TTag extends ServiceTag<any, infer T>
			? T
			: never;

/**
 * Union type representing any valid dependency tag in the system.
 *
 * A tag can be either a value tag (for non-class dependencies) or a tagged class
 * (for service classes). This type is used throughout the DI system to constrain
 * what can be used as a dependency identifier.
 *
 * @example Value tag
 * ```typescript
 * const ConfigTag = Tag.of('config')<{ apiUrl: string }>();
 * // ConfigTag satisfies AnyTag
 * ```
 *
 * @example Class tag
 * ```typescript
 * class DatabaseService extends Tag.Service('DatabaseService') {}
 * // DatabaseService satisfies AnyTag
 * ```
 */
export type AnyTag =
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	| ValueTag<TagId, any>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	| ServiceTag<TagId, any>;

/**
 * Utility object containing factory functions for creating dependency tags.
 *
 * The Tag object provides the primary API for creating both value tags and service tags
 * used throughout the dependency injection system. It's the main entry point for
 * defining dependencies in a type-safe way.
 */
export const Tag = {
	/**
	 * Creates a value tag factory for dependencies that are not classes.
	 *
	 * This method returns a factory function that, when called with a type parameter,
	 * creates a value tag for that type. The tag has a string or symbol-based identifier
	 * that must be unique within your application.
	 *
	 * @template Id - The string or symbol identifier for this tag (must be unique)
	 * @param id - The unique string or symbol identifier for this tag
	 * @returns A factory function that creates value tags for the specified type
	 *
	 * @example Basic usage with strings
	 * ```typescript
	 * const ApiKeyTag = Tag.of('apiKey')<string>();
	 * const ConfigTag = Tag.of('config')<{ dbUrl: string; port: number }>();
	 *
	 * container
	 *   .register(ApiKeyTag, () => process.env.API_KEY!)
	 *   .register(ConfigTag, () => ({ dbUrl: 'postgresql://localhost', port: 5432 }));
	 * ```
	 *
	 * @example Usage with symbols
	 * ```typescript
	 * const DB_CONFIG_SYM = Symbol('database-config');
	 * const ConfigTag = Tag.of(DB_CONFIG_SYM)<DatabaseConfig>();
	 *
	 * container.register(ConfigTag, () => ({ host: 'localhost', port: 5432 }));
	 * ```
	 *
	 * @example Primitive values
	 * ```typescript
	 * const PortTag = Tag.of('port')<number>();
	 * const EnabledTag = Tag.of('enabled')<boolean>();
	 *
	 * container
	 *   .register(PortTag, () => 3000)
	 *   .register(EnabledTag, () => true);
	 * ```
	 *
	 * @example Complex objects
	 * ```typescript
	 * interface DatabaseConfig {
	 *   host: string;
	 *   port: number;
	 *   database: string;
	 * }
	 *
	 * const DbConfigTag = Tag.of('database-config')<DatabaseConfig>();
	 * container.register(DbConfigTag, () => ({
	 *   host: 'localhost',
	 *   port: 5432,
	 *   database: 'myapp'
	 * }));
	 * ```
	 */
	of: <Id extends TagId>(id: Id) => {
		return <T>(): ValueTag<Id, T> => ({
			[ValueTagIdKey]: id,
			[TagTypeKey]: undefined as T,
		});
	},

	/**
	 * Creates a base class that can be extended to create service classes with dependency tags.
	 *
	 * This is the primary way to define service classes in the dependency injection system.
	 * Classes that extend the returned base class become both the dependency identifier
	 * and the implementation, providing type safety and clear semantics.
	 *
	 * @template Id - The unique identifier for this service class
	 * @param id - The unique identifier (string or symbol) for this service
	 * @returns A base class that can be extended to create tagged service classes
	 *
	 * @example Basic service class
	 * ```typescript
	 * class UserService extends Tag.Service('UserService') {
	 *   getUsers() {
	 *     return ['alice', 'bob'];
	 *   }
	 * }
	 *
	 * container.register(UserService, () => new UserService());
	 * ```
	 *
	 * @example Service with dependencies
	 * ```typescript
	 * class DatabaseService extends Tag.Service('DatabaseService') {
	 *   query(sql: string) { return []; }
	 * }
	 *
	 * class UserRepository extends Tag.Service('UserRepository') {
	 *   constructor(private db: DatabaseService) {
	 *     super();
	 *   }
	 *
	 *   findUser(id: string) {
	 *     return this.db.query(`SELECT * FROM users WHERE id = ${id}`);
	 *   }
	 * }
	 *
	 * container
	 *   .register(DatabaseService, () => new DatabaseService())
	 *   .register(UserRepository, async (ctx) =>
	 *     new UserRepository(await ctx.resolve(DatabaseService))
	 *   );
	 * ```
	 *
	 * @example With symbol identifiers
	 * ```typescript
	 * const ServiceId = Symbol('InternalService');
	 *
	 * class InternalService extends Tag.Service(ServiceId) {
	 *   doInternalWork() { return 'work'; }
	 * }
	 * ```
	 */
	Service: <Id extends TagId>(id: Id) => {
		class Tagged {
			static readonly [ServiceTagIdKey]?: Id = id;
			readonly [ServiceTagIdKey]?: Id = id;
		}
		return Tagged as ServiceTag<Id, Tagged>;
	},

	/**
	 * Extracts the string representation of a tag's identifier.
	 *
	 * This utility function returns a human-readable string for any tag's identifier,
	 * whether it's a string-based or symbol-based tag. Primarily used internally
	 * for error messages and debugging.
	 *
	 * @param tag - Any valid dependency tag (value tag or service tag)
	 * @returns String representation of the tag's identifier
	 *
	 * @example
	 * ```typescript
	 * const StringTag = Tag.of('myString')<string>();
	 * class ServiceClass extends Tag.Service('MyService') {}
	 *
	 * console.log(Tag.id(StringTag)); // "myString"
	 * console.log(Tag.id(ServiceClass)); // "MyService"
	 * ```
	 *
	 * @internal - Primarily for internal use in error messages and debugging
	 */
	id: (tag: AnyTag): TagId | undefined => {
		return typeof tag === 'function'
			? tag[ServiceTagIdKey]
			: tag[ValueTagIdKey];
	},

	isTag: (tag: unknown): tag is AnyTag => {
		return typeof tag === 'function'
			? getKey(tag, ServiceTagIdKey) !== undefined
			: getKey(tag, ValueTagIdKey) !== undefined;
	},
};

/**
 * String used to store the original ValueTag in Inject<T> types.
 * This prevents property name collisions while allowing type-level extraction.
 */
export const InjectSource = 'sandly/InjectSource';

/**
 * Helper type for injecting ValueTag dependencies in constructor parameters.
 * This allows clean specification of ValueTag dependencies while preserving
 * the original tag information for dependency inference.
 *
 * The phantom property is optional to allow normal runtime values to be assignable.
 *
 * @template T - A ValueTag type
 * @returns The value type with optional phantom tag metadata for dependency inference
 *
 * @example
 * ```typescript
 * const ApiKeyTag = Tag.of('apiKey')<string>();
 *
 * class UserService extends Tag.Service('UserService') {
 *   constructor(
 *     private db: DatabaseService,        // ServiceTag - works automatically
 *     private apiKey: Inject<typeof ApiKeyTag>  // ValueTag - type is string, tag preserved
 *   ) {
 *     super();
 *   }
 * }
 * ```
 */
export type Inject<T extends ValueTag<TagId, unknown>> =
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	T extends ValueTag<any, infer V>
		? V & { readonly [InjectSource]?: T }
		: never;

/**
 * Helper type to extract the original ValueTag from an Inject<T> type.
 * Since InjectSource is optional, we need to check for both presence and absence.
 * @internal
 */
export type ExtractInjectTag<T> = T extends {
	readonly [InjectSource]?: infer U;
}
	? U
	: never;
