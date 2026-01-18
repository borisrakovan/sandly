import { DependencySpec, IContainer } from './container.js';
import { Layer, layer } from './layer.js';
import { AnyTag } from './tag.js';

/**
 * Extracts a union type from a tuple of tags.
 * Returns `never` for empty arrays.
 * @internal
 */
type TagsToUnion<T extends readonly AnyTag[]> = T[number];

/**
 * Creates a layer that provides a single dependency with inferred requirements.
 *
 * This is a simplified alternative to `layer()` for the common case of defining
 * a single dependency. Unlike `service()` and `autoService()`, this works with
 * any tag type (ServiceTag or ValueTag) and doesn't require extending `Tag.Service()`.
 *
 * Requirements are passed as an optional array of tags, allowing TypeScript to infer
 * both the tag type and the requirements automatically - no explicit type
 * parameters needed.
 *
 * @param tag - The tag (ServiceTag or ValueTag) that identifies this dependency
 * @param spec - Factory function or lifecycle object for creating the dependency
 * @param requirements - Optional array of dependency tags this dependency requires (defaults to [])
 * @returns A layer that requires the specified dependencies and provides the tag
 *
 * @example Simple dependency without requirements
 * ```typescript
 * const Config = Tag.of('Config')<{ apiUrl: string }>();
 *
 * // No requirements - can omit the array
 * const configDep = dependency(Config, () => ({
 *   apiUrl: process.env.API_URL!
 * }));
 * ```
 *
 * @example Dependency with requirements
 * ```typescript
 * const database = dependency(
 *   Database,
 *   async (ctx) => {
 *     const config = await ctx.resolve(Config);
 *     const logger = await ctx.resolve(Logger);
 *     logger.info('Creating database connection');
 *     return createDb(config.DATABASE);
 *   },
 *   [Config, Logger]
 * );
 * ```
 *
 * @example Dependency with lifecycle (create + cleanup)
 * ```typescript
 * const database = dependency(
 *   Database,
 *   {
 *     create: async (ctx) => {
 *       const config = await ctx.resolve(Config);
 *       const logger = await ctx.resolve(Logger);
 *       logger.info('Creating database connection');
 *       return await createDb(config.DATABASE);
 *     },
 *     cleanup: async (db) => {
 *       await disconnectDb(db);
 *     },
 *   },
 *   [Config, Logger]
 * );
 * ```
 *
 * @example Comparison with layer()
 * ```typescript
 * // Using layer() - verbose, requires explicit type parameters
 * const database = layer<typeof Config | typeof Logger, typeof Database>(
 *   (container) =>
 *     container.register(Database, async (ctx) => {
 *       const config = await ctx.resolve(Config);
 *       return createDb(config.DATABASE);
 *     })
 * );
 *
 * // Using dependency() - cleaner, fully inferred types
 * const database = dependency(
 *   Database,
 *   async (ctx) => {
 *     const config = await ctx.resolve(Config);
 *     return createDb(config.DATABASE);
 *   },
 *   [Config, Logger]
 * );
 * ```
 */
export function dependency<
	TTag extends AnyTag,
	TRequirements extends readonly AnyTag[] = [],
>(
	tag: TTag,
	spec: DependencySpec<TTag, TagsToUnion<TRequirements>>,
	requirements?: TRequirements
): Layer<TagsToUnion<TRequirements>, TTag> {
	// The requirements array is only used for type inference, not at runtime
	void requirements;

	return layer<TagsToUnion<TRequirements>, TTag>(
		<TContainer extends AnyTag>(
			container: IContainer<TagsToUnion<TRequirements> | TContainer>
		) => {
			return container.register(tag, spec);
		}
	);
}
