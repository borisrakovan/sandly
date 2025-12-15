import { Container, IContainer, ResolutionContext } from '@/container.js';
import { Layer } from '@/layer.js';
import { autoService, service } from '@/service.js';
import { Tag } from '@/tag.js';
import { describe, expectTypeOf, it } from 'vitest';

describe('Service Type Safety', () => {
	describe('basic service types', () => {
		it('should create service with correct layer type for simple service', () => {
			class LoggerService extends Tag.Service('LoggerService') {
				log(message: string) {
					return `Logged: ${message}`;
				}
			}

			const loggerService = service(
				LoggerService,
				() => new LoggerService()
			);

			expectTypeOf(loggerService).branded.toEqualTypeOf<
				Layer<never, typeof LoggerService>
			>();

			// Service should extend Layer with correct types
			expectTypeOf(loggerService).toExtend<
				Layer<never, typeof LoggerService>
			>();
		});

		it('should create service with correct dependency requirements', () => {
			class DatabaseService extends Tag.Service('DatabaseService') {
				query() {
					return [];
				}
			}

			class UserService extends Tag.Service('UserService') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			const userService = service(UserService, async (ctx) => {
				// Container should have DatabaseService available
				expectTypeOf(ctx).toExtend<
					ResolutionContext<typeof DatabaseService>
				>();

				const db = await ctx.resolve(DatabaseService);
				expectTypeOf(db).branded.toEqualTypeOf<DatabaseService>();

				return new UserService(db);
			});

			// Service should require DatabaseService and provide UserService
			expectTypeOf(userService).branded.toEqualTypeOf<
				Layer<typeof DatabaseService, typeof UserService>
			>();
			expectTypeOf(userService).toExtend<
				Layer<typeof DatabaseService, typeof UserService>
			>();
		});

		it('should handle complex multi-dependency services', () => {
			class DatabaseService extends Tag.Service('DatabaseService') {}
			class CacheService extends Tag.Service('CacheService') {}
			class LoggerService extends Tag.Service('LoggerService') {}

			class UserService extends Tag.Service('UserService') {
				constructor(
					private _db: DatabaseService,
					private _cache: CacheService,
					private _logger: LoggerService
				) {
					super();
				}
			}

			const userService = service(UserService, async (ctx) => {
				// Container should have all required dependencies available
				expectTypeOf(ctx).toExtend<
					ResolutionContext<
						| typeof DatabaseService
						| typeof CacheService
						| typeof LoggerService
					>
				>();

				const [db, cache, logger] = await Promise.all([
					ctx.resolve(DatabaseService),
					ctx.resolve(CacheService),
					ctx.resolve(LoggerService),
				]);

				expectTypeOf(db).branded.toEqualTypeOf<DatabaseService>();
				expectTypeOf(cache).branded.toEqualTypeOf<CacheService>();
				expectTypeOf(logger).branded.toEqualTypeOf<LoggerService>();

				return new UserService(db, cache, logger);
			});

			expectTypeOf(userService).toExtend<
				Layer<
					| typeof DatabaseService
					| typeof CacheService
					| typeof LoggerService,
					typeof UserService
				>
			>();
		});
	});

	describe('service composition', () => {
		it('should compose services with .provide() correctly', () => {
			class DatabaseService extends Tag.Service('DatabaseService') {}

			class UserService extends Tag.Service('UserService') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			const dbService = service(
				DatabaseService,
				() => new DatabaseService()
			);
			const userService = service(UserService, async (ctx) => {
				const db = await ctx.resolve(DatabaseService);
				return new UserService(db);
			});

			const composedService = userService.provide(dbService);

			// DatabaseService requirement should be satisfied by dbService
			// Only UserService is provided (target layer's provisions)
			expectTypeOf(composedService).branded.toEqualTypeOf<
				Layer<never, typeof UserService>
			>();
		});

		it('should merge services with .merge() correctly', () => {
			class LoggerService extends Tag.Service('LoggerService') {}
			class CacheService extends Tag.Service('CacheService') {}

			const loggerService = service(
				LoggerService,
				() => new LoggerService()
			);
			const cacheService = service(
				CacheService,
				() => new CacheService()
			);

			const mergedService = loggerService.merge(cacheService);

			expectTypeOf(mergedService).branded.toEqualTypeOf<
				Layer<never, typeof LoggerService | typeof CacheService>
			>();
		});

		it('should handle partial dependency satisfaction in composition', () => {
			class ExternalService extends Tag.Service('ExternalService') {}
			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private _external: ExternalService) {
					super();
				}
			}
			class UserService extends Tag.Service('UserService') {
				constructor(
					private _db: DatabaseService,
					private _external: ExternalService
				) {
					super();
				}
			}

			const dbService = service(DatabaseService, async (ctx) => {
				const external = await ctx.resolve(ExternalService);
				return new DatabaseService(external);
			});

			const userService = service(UserService, async (ctx) => {
				const [db, external] = await Promise.all([
					ctx.resolve(DatabaseService),
					ctx.resolve(ExternalService),
				]);
				return new UserService(db, external);
			});

			const composedService = userService.provide(dbService);

			// ExternalService is still required (needed by both services)
			// DatabaseService requirement is satisfied by dbService
			// Only UserService is provided (target layer's provisions)
			expectTypeOf(composedService).branded.toEqualTypeOf<
				Layer<typeof ExternalService, typeof UserService>
			>();
		});
	});

	describe('complex service scenarios', () => {
		it('should handle deep service dependency chains', () => {
			class ConfigService extends Tag.Service('ConfigService') {}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private _config: ConfigService) {
					super();
				}
			}

			class UserRepository extends Tag.Service('UserRepository') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			class UserService extends Tag.Service('UserService') {
				constructor(private _repo: UserRepository) {
					super();
				}
			}

			const configService = service(
				ConfigService,
				() => new ConfigService()
			);

			const dbService = service(DatabaseService, async (ctx) => {
				const config = await ctx.resolve(ConfigService);
				return new DatabaseService(config);
			});

			const repoService = service(UserRepository, async (ctx) => {
				const db = await ctx.resolve(DatabaseService);
				return new UserRepository(db);
			});

			const userService = service(UserService, async (ctx) => {
				const repo = await ctx.resolve(UserRepository);
				return new UserService(repo);
			});

			const fullService = userService
				.provide(repoService)
				.provide(dbService)
				.provide(configService);

			// All dependencies should be satisfied, only final service provided
			expectTypeOf(fullService).branded.toEqualTypeOf<
				Layer<never, typeof UserService>
			>();
		});

		it('should handle diamond dependency patterns', () => {
			class ConfigService extends Tag.Service('ConfigService') {}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private _config: ConfigService) {
					super();
				}
			}

			class CacheService extends Tag.Service('CacheService') {
				constructor(private _config: ConfigService) {
					super();
				}
			}

			class UserService extends Tag.Service('UserService') {
				constructor(
					private _db: DatabaseService,
					private _cache: CacheService
				) {
					super();
				}
			}

			const configService = service(
				ConfigService,
				() => new ConfigService()
			);

			const dbService = service(DatabaseService, async (ctx) => {
				const config = await ctx.resolve(ConfigService);
				return new DatabaseService(config);
			});

			const cacheService = service(CacheService, async (ctx) => {
				const config = await ctx.resolve(ConfigService);
				return new CacheService(config);
			});

			const userService = service(UserService, async (ctx) => {
				const [db, cache] = await Promise.all([
					ctx.resolve(DatabaseService),
					ctx.resolve(CacheService),
				]);
				return new UserService(db, cache);
			});

			// Build the diamond: Config -> (Database & Cache) -> User
			const infraLayer = dbService
				.merge(cacheService)
				.provide(configService);
			const appLayer = userService.provide(infraLayer);

			expectTypeOf(appLayer).branded.toEqualTypeOf<
				Layer<never, typeof UserService>
			>();
		});
	});

	describe('service interface completeness', () => {
		it('should maintain all Layer methods', () => {
			class TestService extends Tag.Service('TestService') {}

			const testService = service(TestService, () => new TestService());

			// Should have all Layer methods
			expectTypeOf(testService.register).branded.toEqualTypeOf<
				Layer<never, typeof TestService>['register']
			>();

			expectTypeOf(testService.provide).branded.toEqualTypeOf<
				Layer<never, typeof TestService>['provide']
			>();

			expectTypeOf(testService.merge).branded.toEqualTypeOf<
				Layer<never, typeof TestService>['merge']
			>();

			expectTypeOf(testService.provideMerge).branded.toEqualTypeOf<
				Layer<never, typeof TestService>['provideMerge']
			>();
		});
	});

	describe('integration with container', () => {
		it('should integrate seamlessly with container registration', () => {
			class DatabaseService extends Tag.Service('DatabaseService') {}

			class UserService extends Tag.Service('UserService') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			const dbService = service(
				DatabaseService,
				() => new DatabaseService()
			);
			const userService = service(UserService, async (ctx) => {
				const db = await ctx.resolve(DatabaseService);
				return new UserService(db);
			});

			const appService = userService.provide(dbService);

			// Should be able to apply to a container
			const container = Container.empty();
			const finalContainer = appService.register(container);

			expectTypeOf(finalContainer).branded.toEqualTypeOf<
				IContainer<typeof UserService>
			>();

			// Should be able to resolve services from the container
			expectTypeOf(
				finalContainer.resolve(UserService)
			).branded.toEqualTypeOf<Promise<UserService>>();
		});
	});

	describe('error prevention at type level', () => {
		it('should prevent incorrect service composition at compile time', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {
				constructor(private _b: ServiceB) {
					super();
				}
			}

			const serviceA = service(ServiceA, () => new ServiceA());
			const serviceC = service(ServiceC, async (ctx) => {
				const b = await ctx.resolve(ServiceB);
				return new ServiceC(b);
			});

			// This composition should be allowed at type level but leave ServiceB unsatisfied
			const composed = serviceC.provide(serviceA);

			// ServiceB should still be required
			// Only ServiceC is provided (target layer's provisions)
			expectTypeOf(composed).branded.toEqualTypeOf<
				Layer<typeof ServiceB, typeof ServiceC>
			>();
		});
	});

	describe('service composition with "provideMerge"', () => {
		it("should compose services and expose both layers' provisions", () => {
			class DatabaseService extends Tag.Service('DatabaseService') {}
			class UserService extends Tag.Service('UserService') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			const dbService = service(
				DatabaseService,
				() => new DatabaseService()
			);
			const userService = service(UserService, async (ctx) => {
				const db = await ctx.resolve(DatabaseService);
				return new UserService(db);
			});

			const composedService = userService.provideMerge(dbService);

			// DatabaseService requirement should be satisfied by dbService
			// Both DatabaseService and UserService should be provided
			expectTypeOf(composedService).branded.toEqualTypeOf<
				Layer<never, typeof DatabaseService | typeof UserService>
			>();
		});

		it('should preserve external requirements and expose both provisions', () => {
			class ExternalService extends Tag.Service('ExternalService') {}
			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private _external: ExternalService) {
					super();
				}
			}
			class UserService extends Tag.Service('UserService') {
				constructor(
					private _db: DatabaseService,
					private _external: ExternalService
				) {
					super();
				}
			}

			const dbService = service(DatabaseService, async (ctx) => {
				const external = await ctx.resolve(ExternalService);
				return new DatabaseService(external);
			});

			const userService = service(UserService, async (ctx) => {
				const [db, external] = await Promise.all([
					ctx.resolve(DatabaseService),
					ctx.resolve(ExternalService),
				]);
				return new UserService(db, external);
			});

			const composedService = userService.provideMerge(dbService);

			// ExternalService is still required (needed by both services)
			// Both DatabaseService and UserService should be provided
			expectTypeOf(composedService).branded.toEqualTypeOf<
				Layer<
					typeof ExternalService,
					typeof DatabaseService | typeof UserService
				>
			>();
		});

		it('should differ from .provide() in type signature', () => {
			class ConfigService extends Tag.Service('ConfigService') {}
			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private _config: ConfigService) {
					super();
				}
			}

			const configService = service(
				ConfigService,
				() => new ConfigService()
			);
			const dbService = service(DatabaseService, async (ctx) => {
				const config = await ctx.resolve(ConfigService);
				return new DatabaseService(config);
			});

			// .provide() only exposes target layer's provisions
			const withProvide = dbService.provide(configService);
			expectTypeOf(withProvide).branded.toEqualTypeOf<
				Layer<never, typeof DatabaseService>
			>();

			// .provideMerge() exposes both layers' provisions
			const withProvideMerge = dbService.provideMerge(configService);
			expectTypeOf(withProvideMerge).branded.toEqualTypeOf<
				Layer<never, typeof ConfigService | typeof DatabaseService>
			>();
		});

		it('should handle deep service dependency chains with merged provisions', () => {
			class ConfigService extends Tag.Service('ConfigService') {}
			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private _config: ConfigService) {
					super();
				}
			}
			class UserRepository extends Tag.Service('UserRepository') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}
			class UserService extends Tag.Service('UserService') {
				constructor(private _repo: UserRepository) {
					super();
				}
			}

			const configService = service(
				ConfigService,
				() => new ConfigService()
			);
			const dbService = service(DatabaseService, async (ctx) => {
				const config = await ctx.resolve(ConfigService);
				return new DatabaseService(config);
			});
			const repoService = service(UserRepository, async (ctx) => {
				const db = await ctx.resolve(DatabaseService);
				return new UserRepository(db);
			});
			const userService = service(UserService, async (ctx) => {
				const repo = await ctx.resolve(UserRepository);
				return new UserService(repo);
			});

			const fullService = userService.provideMerge(
				repoService.provideMerge(dbService).provideMerge(configService)
			);
			// All dependencies should be satisfied, all services provided
			expectTypeOf(fullService).branded.toEqualTypeOf<
				Layer<
					never,
					| typeof ConfigService
					| typeof DatabaseService
					| typeof UserRepository
					| typeof UserService
				>
			>();
		});

		it('should handle mixed .provide() and .provideMerge() composition', () => {
			class ConfigService extends Tag.Service('ConfigService') {}
			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private _config: ConfigService) {
					super();
				}
			}
			class UserService extends Tag.Service('UserService') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			const configService = service(
				ConfigService,
				() => new ConfigService()
			);
			const dbService = service(DatabaseService, async (ctx) => {
				const config = await ctx.resolve(ConfigService);
				return new DatabaseService(config);
			});
			const userService = service(UserService, async (ctx) => {
				const db = await ctx.resolve(DatabaseService);
				return new UserService(db);
			});

			// Use provideMerge to keep config available, then provide to hide intermediate services
			const appService = userService.provide(
				dbService.provide(configService)
			);

			expectTypeOf(appService).branded.toEqualTypeOf<
				Layer<never, typeof UserService>
			>();
		});

		it('should integrate with container correctly for merged provisions', () => {
			class DatabaseService extends Tag.Service('DatabaseService') {}
			class UserService extends Tag.Service('UserService') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			const dbService = service(
				DatabaseService,
				() => new DatabaseService()
			);
			const userService = service(UserService, async (ctx) => {
				const db = await ctx.resolve(DatabaseService);
				return new UserService(db);
			});

			const appService = userService.provideMerge(dbService);

			// Should be able to apply to a container
			const container = Container.empty();
			const finalContainer = appService.register(container);

			// Both services should be available in the final container
			expectTypeOf(finalContainer).branded.toEqualTypeOf<
				IContainer<typeof DatabaseService | typeof UserService>
			>();

			// Should be able to resolve both services from the container
			expectTypeOf(
				finalContainer.resolve(DatabaseService)
			).branded.toEqualTypeOf<Promise<DatabaseService>>();
			expectTypeOf(
				finalContainer.resolve(UserService)
			).branded.toEqualTypeOf<Promise<UserService>>();
		});
	});

	describe('service with DependencySpec support', () => {
		it('should accept simple factory functions', () => {
			class DatabaseService extends Tag.Service('DatabaseService') {}

			const dbService = service(
				DatabaseService,
				() => new DatabaseService()
			);

			expectTypeOf(dbService).branded.toEqualTypeOf<
				Layer<never, typeof DatabaseService>
			>();
		});

		it('should accept DependencyLifecycle objects with factory and finalizer', () => {
			class DatabaseConnection extends Tag.Service('DatabaseConnection') {
				disconnect() {
					return;
				}
			}

			const dbService = service(DatabaseConnection, {
				create: () => new DatabaseConnection(),
				cleanup: (conn) => {
					conn.disconnect();
				},
			});

			expectTypeOf(dbService).branded.toEqualTypeOf<
				Layer<never, typeof DatabaseConnection>
			>();
		});

		it('should support async factories and finalizers', () => {
			class AsyncResource extends Tag.Service('AsyncResource') {
				cleanup() {
					return Promise.resolve();
				}
			}

			const resourceService = service(AsyncResource, {
				create: () => Promise.resolve(new AsyncResource()),
				cleanup: async (resource) => {
					await resource.cleanup();
				},
			});

			expectTypeOf(resourceService).branded.toEqualTypeOf<
				Layer<never, typeof AsyncResource>
			>();
		});

		it('should work with services that have dependencies', () => {
			class Logger extends Tag.Service('Logger') {}
			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private logger: Logger) {
					super();
				}
				close() {
					return;
				}
				getLogger() {
					return this.logger;
				}
			}

			const dbService = service(DatabaseService, {
				create: async (ctx) => {
					const logger = await ctx.resolve(Logger);
					expectTypeOf(logger).branded.toEqualTypeOf<Logger>();
					return new DatabaseService(logger);
				},
				cleanup: (db) => {
					db.close();
					db.getLogger(); // Use the logger to avoid unused warning
				},
			});

			expectTypeOf(dbService).branded.toEqualTypeOf<
				Layer<typeof Logger, typeof DatabaseService>
			>();
		});

		it('should maintain type safety in factory and finalizer parameters', () => {
			class CustomService extends Tag.Service('CustomService') {
				private value = 'test';
				getValue() {
					return this.value;
				}
				cleanup() {
					return;
				}
			}

			const customService = service(CustomService, {
				create: () => {
					const instance = new CustomService();
					expectTypeOf(
						instance
					).branded.toEqualTypeOf<CustomService>();
					expectTypeOf(instance.getValue).branded.toEqualTypeOf<
						() => string
					>();
					return instance;
				},
				cleanup: (instance) => {
					expectTypeOf(
						instance
					).branded.toEqualTypeOf<CustomService>();
					expectTypeOf(instance.getValue).branded.toEqualTypeOf<
						() => string
					>();
					expectTypeOf(instance.cleanup).branded.toEqualTypeOf<
						() => void
					>();
					instance.cleanup();
				},
			});

			expectTypeOf(customService).branded.toEqualTypeOf<
				Layer<never, typeof CustomService>
			>();
		});
	});

	describe('AutoService Type Safety', () => {
		it('should enforce correct parameter types and order', () => {
			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private url: string) {
					super();
				}
			}

			class UserService extends Tag.Service('UserService') {
				constructor(
					private db: DatabaseService,
					private timeout: number,
					private apiKey: string
				) {
					super();
				}
			}

			// ✅ Correct types and order
			const correctService = autoService(UserService, [
				DatabaseService,
				5000,
				'api-key-123',
			]);
			expectTypeOf(correctService).toExtend<
				Layer<typeof DatabaseService, typeof UserService>
			>();

			// These should cause TypeScript errors:
			autoService(UserService, [
				DatabaseService,
				// @ts-expect-error - number expected
				'wrong-type',
				'api-key',
			]);
			// @ts-expect-error - missing parameter
			autoService(UserService, [DatabaseService, 5000]);
			// @ts-expect-error - wrong order
			autoService(UserService, [5000, DatabaseService, 'api-key']);
		});

		it('should require all constructor parameters', () => {
			class ComplexService extends Tag.Service('ComplexService') {
				constructor(
					private prefix: string,
					private db: DatabaseService,
					private retries: number
				) {
					super();
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {}

			// ✅ All parameters provided
			const completeService = autoService(ComplexService, [
				'prefix',
				DatabaseService,
				3,
			]);
			expectTypeOf(completeService).branded.toEqualTypeOf<
				Layer<typeof DatabaseService, typeof ComplexService>
			>();

			// These should fail:
			// @ts-expect-error - missing retries
			autoService(ComplexService, ['prefix', DatabaseService]);
			// @ts-expect-error - missing db and retries
			autoService(ComplexService, ['prefix']);
		});

		it('should correctly infer dependencies from mixed parameters', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			class MixedService extends Tag.Service('MixedService') {
				constructor(
					private config: string,
					private serviceA: ServiceA,
					private timeout: number,
					private serviceB: ServiceB
				) {
					super();
				}
			}

			const mixedService = autoService(MixedService, [
				'config-value',
				ServiceA,
				1000,
				ServiceB,
			]);

			// Should require both ServiceA and ServiceB
			expectTypeOf(mixedService).toExtend<
				Layer<typeof ServiceA | typeof ServiceB, typeof MixedService>
			>();
		});

		it('should handle services with no dependencies', () => {
			class SimpleService extends Tag.Service('SimpleService') {
				constructor(
					private value: string,
					private count: number
				) {
					super();
				}
			}

			const simpleService = autoService(SimpleService, ['test', 42]);
			expectTypeOf(simpleService).branded.toEqualTypeOf<
				Layer<never, typeof SimpleService>
			>();

			// Should reject extra parameters:
			// @ts-expect-error - extra parameter
			autoService(SimpleService, ['test', 42, 'extra']);
		});

		it('should prevent wrong service types in dependency positions', () => {
			class DatabaseService extends Tag.Service('DatabaseService') {}
			class CacheService extends Tag.Service('CacheService') {}
			class UserService extends Tag.Service('UserService') {
				constructor(private db: DatabaseService) {
					super();
				}
			}

			// ✅ Correct service type
			const correctService = autoService(UserService, [DatabaseService]);
			expectTypeOf(correctService).toExtend<
				Layer<typeof DatabaseService, typeof UserService>
			>();

			// These should fail at compile time:
			// @ts-expect-error - Wrong service type
			autoService(UserService, [CacheService]);
			// @ts-expect-error - String instead of service tag
			autoService(UserService, ['DatabaseService']);
		});

		it('should compose correctly with other layers', () => {
			class ConfigService extends Tag.Service('ConfigService') {}
			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private config: ConfigService) {
					super();
				}
			}
			class UserService extends Tag.Service('UserService') {
				constructor(
					private db: DatabaseService,
					private timeout: number
				) {
					super();
				}
			}

			const configService = autoService(ConfigService, []);
			const dbService = autoService(DatabaseService, [ConfigService]);
			const userService = autoService(UserService, [
				DatabaseService,
				5000,
			]);

			const composedService = userService
				.provide(dbService)
				.provide(configService);

			// All dependencies should be satisfied
			expectTypeOf(composedService).branded.toEqualTypeOf<
				Layer<never, typeof UserService>
			>();
		});

		it('should handle services with static properties correctly', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {
				static readonly foo = 123; // Static property causes the bug

				constructor(private a: ServiceA) {
					super();
				}
			}
			class ServiceC extends Tag.Service('ServiceC') {
				constructor(private b: ServiceB) {
					super();
				}
			}

			const serviceA = autoService(ServiceA, []);
			const serviceB = autoService(ServiceB, [ServiceA]);
			const serviceC = autoService(ServiceC, [ServiceB]);

			// Composition chain:
			// 1. serviceC requires ServiceB
			// 2. provide(serviceB) satisfies ServiceB requirement
			//    - serviceB requires ServiceA
			//    - IF BUG EXISTS: serviceB also requires ServiceB (itself)
			// 3. provide(serviceA) satisfies ServiceA requirement
			//
			// If bug exists: final layer still requires ServiceB
			// If fix works: final layer requires nothing
			const composed = serviceC.provide(serviceB).provide(serviceA);

			expectTypeOf(composed).branded.toEqualTypeOf<
				Layer<never, typeof ServiceC>
			>();

			// Should be able to register to empty container
			const container = Container.empty();
			const finalContainer = composed.register(container);

			expectTypeOf(finalContainer).branded.toEqualTypeOf<
				IContainer<typeof ServiceC>
			>();
		});

		it('should handle services with private attributes correctly', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {
				private readonly client: string; // Private attribute causes the bug

				constructor(
					_config: object = {},
					private a: ServiceA
				) {
					super();
					this.client = 'test';
				}
			}
			class ServiceC extends Tag.Service('ServiceC') {
				constructor(private b: ServiceB) {
					super();
				}
			}

			const serviceA = autoService(ServiceA, []);
			const serviceB = autoService(ServiceB, [{}, ServiceA]);
			const serviceC = autoService(ServiceC, [ServiceB]);

			// Same composition logic as above
			const composed = serviceC.provide(serviceB).provide(serviceA);

			expectTypeOf(composed).branded.toEqualTypeOf<
				Layer<never, typeof ServiceC>
			>();

			// Should be able to register to empty container
			const container = Container.empty();
			const finalContainer = composed.register(container);

			expectTypeOf(finalContainer).branded.toEqualTypeOf<
				IContainer<typeof ServiceC>
			>();
		});
	});
});
