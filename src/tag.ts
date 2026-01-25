/**
 * Type representing a tag identifier (string or symbol).
 */
export type TagId = string | symbol;

/**
 * Symbol used to identify ValueTag objects at runtime.
 * @internal
 */
export const ValueTagIdKey = 'sandly/ValueTagIdKey';

/**
 * Symbol used to carry the phantom type for ValueTag.
 * @internal
 */
export const TagTypeKey = 'sandly/TagTypeKey';

/**
 * A ServiceTag is any class constructor.
 *
 * Any class can be used directly as a dependency tag without special markers.
 *
 * @template T - The type of instances created by this class
 *
 * @example
 * ```typescript
 * class UserService {
 *   constructor(private db: Database) {}
 *   getUsers() { return this.db.query('SELECT * FROM users'); }
 * }
 *
 * const container = Container.builder()
 *   .add(UserService, ...)
 *   .build();
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ServiceTag<T = unknown> = new (...args: any[]) => T;

/**
 * A ValueTag represents a non-class dependency (primitives, objects, functions).
 *
 * ValueTags use phantom types to maintain type safety while being
 * distinguishable at runtime through their unique identifiers.
 *
 * @template Id - The unique identifier for this tag (string or symbol)
 * @template T - The type of the value this tag represents
 *
 * @example
 * ```typescript
 * const ApiKeyTag = Tag.of('ApiKey')<string>();
 * const ConfigTag = Tag.of('Config')<{ dbUrl: string }>();
 *
 * const container = Container.builder()
 *   .add(ApiKeyTag, () => process.env.API_KEY!)
 *   .add(ConfigTag, () => ({ dbUrl: 'postgres://...' }))
 *   .build();
 * ```
 */
export interface ValueTag<Id extends TagId, T> {
	readonly [ValueTagIdKey]: Id;
	readonly [TagTypeKey]: T;
}

/**
 * Union type representing any valid dependency tag in the system.
 *
 * A tag can be either:
 * - A class constructor (ServiceTag) - for class-based dependencies
 * - A ValueTag - for non-class dependencies (primitives, objects, functions)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTag = ServiceTag | ValueTag<TagId, any>;

/**
 * Extracts the instance/value type from any dependency tag.
 *
 * - For ServiceTag (class): extracts the instance type
 * - For ValueTag: extracts the value type
 *
 * @example
 * ```typescript
 * class UserService { ... }
 * const ConfigTag = Tag.of('Config')<{ url: string }>();
 *
 * type A = TagType<typeof UserService>;  // UserService
 * type B = TagType<typeof ConfigTag>;    // { url: string }
 * ```
 */
export type TagType<T extends AnyTag> =
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	T extends new (...args: any[]) => infer Instance
		? Instance
		: // eslint-disable-next-line @typescript-eslint/no-explicit-any
			T extends ValueTag<any, infer Value>
			? Value
			: never;

/**
 * Helper to get an object property safely.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function getKey<T>(obj: unknown, key: string): T | undefined {
	if (obj === null || obj === undefined) return undefined;
	return (obj as Record<string, T>)[key];
}

/**
 * Utility object for creating and working with tags.
 */
export const Tag = {
	/**
	 * Creates a ValueTag factory for non-class dependencies.
	 *
	 * @param id - The unique identifier for this tag (string or symbol)
	 * @returns A factory function that creates a ValueTag for the specified type
	 *
	 * @example
	 * ```typescript
	 * const ApiKeyTag = Tag.of('ApiKey')<string>();
	 * const PortTag = Tag.of('Port')<number>();
	 * const ConfigTag = Tag.of('Config')<{ dbUrl: string; port: number }>();
	 * ```
	 */
	of: <Id extends TagId>(id: Id) => {
		return <T>(): ValueTag<Id, T> =>
			({
				[ValueTagIdKey]: id,
				[TagTypeKey]: undefined as T,
			}) as ValueTag<Id, T>;
	},

	/**
	 * Gets a string identifier for any tag, used for error messages.
	 *
	 * For classes: uses static `Tag` property if present, otherwise `constructor.name`
	 * For ValueTags: uses the tag's id
	 *
	 * @example
	 * ```typescript
	 * class UserService {}
	 * Tag.id(UserService);  // "UserService"
	 *
	 * class ApiClient {
	 *   static readonly Tag = 'MyApiClient';  // Custom name
	 * }
	 * Tag.id(ApiClient);  // "MyApiClient"
	 *
	 * const ConfigTag = Tag.of('app.config')<Config>();
	 * Tag.id(ConfigTag);  // "app.config"
	 * ```
	 */
	id: (tag: AnyTag): string => {
		if (typeof tag === 'function') {
			// It's a class constructor - check for static Tag property
			const customTag = getKey<string>(tag, 'Tag');
			if (customTag !== undefined) {
				return customTag;
			}
			// Fall back to constructor name
			return tag.name || 'AnonymousClass';
		}
		// It's a ValueTag
		return String(tag[ValueTagIdKey]);
	},

	/**
	 * Type guard to check if a value is a ServiceTag (class constructor).
	 *
	 * Returns true for class declarations, class expressions, and regular functions
	 * (which can be used as constructors in JavaScript).
	 *
	 * Returns false for arrow functions since they cannot be used with `new`.
	 */
	isServiceTag: (x: unknown): x is ServiceTag => {
		if (typeof x !== 'function') {
			return false;
		}
		// Arrow functions don't have a prototype property (or it's undefined)
		// Class constructors and regular functions have prototype as an object
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
		return (x as any).prototype !== undefined;
	},

	/**
	 * Type guard to check if a value is a ValueTag.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	isValueTag: (x: unknown): x is ValueTag<TagId, any> => {
		return (
			typeof x === 'object' &&
			x !== null &&
			getKey(x, ValueTagIdKey) !== undefined
		);
	},

	/**
	 * Type guard to check if a value is any kind of tag (ServiceTag or ValueTag).
	 */
	isTag: (x: unknown): x is AnyTag => {
		return Tag.isServiceTag(x) || Tag.isValueTag(x);
	},
};
