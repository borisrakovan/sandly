import { Container, IContainer } from '@/container.js';
import { dependency } from '@/dependency.js';
import { Layer } from '@/layer.js';
import { Tag } from '@/tag.js';
import { describe, expectTypeOf, it } from 'vitest';

describe('dependency type inference', () => {
	describe('Layer type inference', () => {
		it('should infer Layer<never, TTag> for dependency without requirements', () => {
			const Config = Tag.of('Config')<{ apiUrl: string }>();

			// Omit requirements - should infer Layer<never, typeof Config>
			const configDep = dependency(Config, () => ({
				apiUrl: 'https://api.example.com',
			}));

			expectTypeOf(configDep).toExtend<Layer<never, typeof Config>>();
		});

		it('should infer Layer<never, TTag> for explicit empty requirements', () => {
			const Config = Tag.of('Config')<{ apiUrl: string }>();

			// Explicit empty array
			const configDep = dependency(
				Config,
				() => ({
					apiUrl: 'https://api.example.com',
				}),
				[]
			);

			expectTypeOf(configDep).toExtend<Layer<never, typeof Config>>();
		});

		it('should infer Layer<TRequires, TTag> for dependency with requirements', () => {
			const Config = Tag.of('Config')<{ dbUrl: string }>();

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private url: string) {
					super();
				}
			}

			// Requirements are inferred from the array
			const dbDep = dependency(
				DatabaseService,
				async (ctx) => {
					const config = await ctx.resolve(Config);
					return new DatabaseService(config.dbUrl);
				},
				[Config]
			);

			// Should be Layer<typeof Config, typeof DatabaseService>
			expectTypeOf(dbDep).toEqualTypeOf<
				Layer<typeof Config, typeof DatabaseService>
			>();
		});

		it('should infer union of requirements from array', () => {
			const Config = Tag.of('Config')<{ dbUrl: string }>();

			class Logger extends Tag.Service('Logger') {
				log(message: string) {
					return message;
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(
					private url: string,
					private logger: Logger
				) {
					super();
				}
			}

			const dbDep = dependency(
				DatabaseService,
				async (ctx) => {
					const [config, logger] = await ctx.resolveAll(
						Config,
						Logger
					);
					return new DatabaseService(config.dbUrl, logger);
				},
				[Config, Logger]
			);

			// Should be Layer<typeof Config | typeof Logger, typeof DatabaseService>
			expectTypeOf(dbDep).toExtend<
				Layer<typeof Config | typeof Logger, typeof DatabaseService>
			>();
		});
	});

	describe('Context type safety', () => {
		it('should only allow resolving declared requirements', () => {
			const Config = Tag.of('Config')<{ dbUrl: string }>();
			const OtherTag = Tag.of('OtherTag')<string>();

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private url: string) {
					super();
				}
			}

			// This should compile - Config is in requirements
			dependency(
				DatabaseService,
				async (ctx) => {
					const config = await ctx.resolve(Config);
					return new DatabaseService(config.dbUrl);
				},
				[Config]
			);

			// This should NOT compile - OtherTag is not in requirements
			dependency(
				DatabaseService,
				async (ctx) => {
					// @ts-expect-error - OtherTag is not in the requirements
					await ctx.resolve(OtherTag);
					const config = await ctx.resolve(Config);
					return new DatabaseService(config.dbUrl);
				},
				[Config]
			);
		});

		it('should have empty context when no requirements', () => {
			const Config = Tag.of('Config')<{ apiUrl: string }>();
			const OtherTag = Tag.of('OtherTag')<string>();

			// Without requirements, ctx should not allow resolving anything
			dependency(Config, async (ctx) => {
				// @ts-expect-error - no requirements declared
				await ctx.resolve(OtherTag);
				return { apiUrl: 'test' };
			});
		});

		it('should type resolveAll correctly', () => {
			const Config = Tag.of('Config')<{ dbUrl: string }>();

			class Logger extends Tag.Service('Logger') {
				log(message: string) {
					return message;
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(
					private url: string,
					private logger: Logger
				) {
					super();
				}
			}

			dependency(
				DatabaseService,
				async (ctx) => {
					const [config, logger] = await ctx.resolveAll(
						Config,
						Logger
					);

					// Type assertions
					expectTypeOf(config).toExtend<{ dbUrl: string }>();
					expectTypeOf(logger).toExtend<Logger>();

					return new DatabaseService(config.dbUrl, logger);
				},
				[Config, Logger]
			);
		});
	});

	describe('Lifecycle type safety', () => {
		it('should type cleanup function correctly', () => {
			class DatabaseConnection extends Tag.Service('DatabaseConnection') {
				disconnect() {
					return 'disconnected';
				}
			}

			dependency(DatabaseConnection, {
				create: () => new DatabaseConnection(),
				cleanup: (conn) => {
					// conn should be typed as DatabaseConnection
					expectTypeOf(conn).toExtend<DatabaseConnection>();
					conn.disconnect();
				},
			});
		});

		it('should type async cleanup correctly', () => {
			class AsyncResource extends Tag.Service('AsyncResource') {
				async cleanup() {
					return Promise.resolve('cleaned');
				}
			}

			dependency(AsyncResource, {
				create: () => new AsyncResource(),
				cleanup: async (resource) => {
					expectTypeOf(resource).toExtend<AsyncResource>();
					await resource.cleanup();
				},
			});
		});

		it('should type cleanup with requirements correctly', () => {
			class Logger extends Tag.Service('Logger') {
				log(message: string) {
					return message;
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private logger: Logger) {
					super();
				}
				close() {
					this.logger.log('Closing');
				}
			}

			dependency(
				DatabaseService,
				{
					create: async (ctx) => {
						const logger = await ctx.resolve(Logger);
						return new DatabaseService(logger);
					},
					cleanup: (db) => {
						// db should be typed as DatabaseService
						expectTypeOf(db).toExtend<DatabaseService>();
						db.close();
					},
				},
				[Logger]
			);
		});
	});

	describe('Layer composition type safety', () => {
		it('should compose correctly with provide', () => {
			const Config = Tag.of('Config')<{ dbUrl: string }>();

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private url: string) {
					super();
				}
			}

			const configDep = dependency(Config, () => ({
				dbUrl: 'postgresql://localhost:5432',
			}));

			const dbDep = dependency(
				DatabaseService,
				async (ctx) => {
					const config = await ctx.resolve(Config);
					return new DatabaseService(config.dbUrl);
				},
				[Config]
			);

			const appLayer = dbDep.provide(configDep);

			// After providing, requirements should be satisfied
			expectTypeOf(appLayer).toExtend<
				Layer<never, typeof DatabaseService>
			>();

			// Should be able to register on empty container
			const container = appLayer.register(Container.empty());
			expectTypeOf(container).toExtend<
				IContainer<typeof DatabaseService>
			>();
		});

		it('should compose correctly with provideMerge', () => {
			const Config = Tag.of('Config')<{ dbUrl: string }>();

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private url: string) {
					super();
				}
			}

			const configDep = dependency(Config, () => ({
				dbUrl: 'postgresql://localhost:5432',
			}));

			const dbDep = dependency(
				DatabaseService,
				async (ctx) => {
					const config = await ctx.resolve(Config);
					return new DatabaseService(config.dbUrl);
				},
				[Config]
			);

			const infraLayer = dbDep.provideMerge(configDep);

			// After provideMerge, both provisions should be available
			expectTypeOf(infraLayer).toExtend<
				Layer<never, typeof Config | typeof DatabaseService>
			>();
		});

		it('should compose correctly with merge', () => {
			const ApiKey = Tag.of('ApiKey')<string>();
			const Timeout = Tag.of('Timeout')<number>();

			const apiKeyDep = dependency(ApiKey, () => 'secret');
			const timeoutDep = dependency(Timeout, () => 5000);

			const configLayer = apiKeyDep.merge(timeoutDep);

			expectTypeOf(configLayer).toExtend<
				Layer<never, typeof ApiKey | typeof Timeout>
			>();
		});

		it('should work with Layer.mergeAll', () => {
			const A = Tag.of('A')<string>();
			const B = Tag.of('B')<number>();
			const C = Tag.of('C')<boolean>();

			const aDep = dependency(A, () => 'a');
			const bDep = dependency(B, () => 1);
			const cDep = dependency(C, () => true);

			const merged = Layer.mergeAll(aDep, bDep, cDep);

			expectTypeOf(merged).toExtend<
				Layer<never, typeof A | typeof B | typeof C>
			>();
		});
	});

	describe('Container resolution type safety', () => {
		it('should only allow resolving provided dependencies', async () => {
			const Config = Tag.of('Config')<{ apiUrl: string }>();
			const OtherTag = Tag.of('OtherTag')<string>();

			const configDep = dependency(Config, () => ({
				apiUrl: 'https://api.example.com',
			}));

			const container = configDep.register(Container.empty());

			// This should compile - just checking the type, not running
			expectTypeOf(container.resolve(Config)).resolves.toExtend<{
				apiUrl: string;
			}>();

			// This should NOT compile
			// @ts-expect-error - OtherTag is not registered
			await container.resolve(OtherTag).catch(() => ({}));
		});
	});
});
