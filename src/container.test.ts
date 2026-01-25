import { describe, expect, it, vi } from 'vitest';
import {
	Container,
	ScopedContainer,
	ScopedContainerBuilder,
	type DependencyLifecycle,
	type ResolutionContext,
} from './container.js';
import {
	CircularDependencyError,
	ContainerDestroyedError,
	DependencyCreationError,
	DependencyFinalizationError,
	UnknownDependencyError,
} from './errors.js';
import { Layer } from './layer.js';
import { Tag } from './tag.js';

describe('Container', () => {
	describe('builder pattern', () => {
		it('should create an empty container via builder', () => {
			const container = Container.builder().build();

			expect(container).toBeInstanceOf(Container);
		});

		it('should create an empty container via empty()', () => {
			const container = Container.empty();

			expect(container).toBeInstanceOf(Container);
		});

		it('should register dependencies via builder', async () => {
			class TestService {
				getValue() {
					return 'test';
				}
			}

			const container = Container.builder()
				.add(TestService, () => new TestService())
				.build();

			const instance = await container.resolve(TestService);
			expect(instance).toBeInstanceOf(TestService);
		});

		it('should chain multiple registrations', async () => {
			class ServiceA {}
			class ServiceB {}
			class ServiceC {}

			const container = Container.builder()
				.add(ServiceA, () => new ServiceA())
				.add(ServiceB, () => new ServiceB())
				.add(ServiceC, () => new ServiceC())
				.build();

			const [a, b, c] = await container.resolveAll(
				ServiceA,
				ServiceB,
				ServiceC
			);
			expect(a).toBeInstanceOf(ServiceA);
			expect(b).toBeInstanceOf(ServiceB);
			expect(c).toBeInstanceOf(ServiceC);
		});

		it('should allow overriding registrations in builder', async () => {
			class TestService {
				constructor(public value: string) {}
			}

			const container = Container.builder()
				.add(TestService, () => new TestService('first'))
				.add(TestService, () => new TestService('second'))
				.build();

			const instance = await container.resolve(TestService);
			expect(instance.value).toBe('second');
		});

		it('should register with lifecycle object', async () => {
			class TestService {
				cleanup = vi.fn() as () => void;
			}

			const container = Container.builder()
				.add(TestService, {
					create: () => new TestService(),
					cleanup: (instance) => {
						instance.cleanup();
					},
				})
				.build();

			const instance = await container.resolve(TestService);
			expect(instance).toBeInstanceOf(TestService);
		});

		it('should register with DependencyLifecycle class', async () => {
			class Logger {
				log(msg: string) {
					return msg;
				}
			}

			class TestService {
				constructor(
					private logger: Logger,
					public value: string
				) {}
				cleanup = vi.fn();
			}

			class TestServiceLifecycle implements DependencyLifecycle<
				TestService,
				typeof Logger
			> {
				constructor(private value: string) {}

				async create(ctx: ResolutionContext<typeof Logger>) {
					const logger = await ctx.resolve(Logger);
					return new TestService(logger, this.value);
				}

				cleanup(instance: TestService) {
					instance.cleanup();
				}
			}

			const container = Container.builder()
				.add(Logger, () => new Logger())
				.add(TestService, new TestServiceLifecycle('test-value'))
				.build();

			const instance = await container.resolve(TestService);
			expect(instance.value).toBe('test-value');

			await container.destroy();
			expect(instance.cleanup).toHaveBeenCalled();
		});
	});

	describe('resolve()', () => {
		it('should create and return instance for sync factory', async () => {
			class TestService {
				getValue() {
					return 'test';
				}
			}

			const container = Container.builder()
				.add(TestService, () => new TestService())
				.build();

			const instance = await container.resolve(TestService);

			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('test');
		});

		it('should create and return instance for async factory', async () => {
			class TestService {
				constructor(public value: string) {}
			}

			const container = Container.builder()
				.add(TestService, async () => {
					await Promise.resolve();
					return new TestService('async');
				})
				.build();

			const instance = await container.resolve(TestService);

			expect(instance).toBeInstanceOf(TestService);
			expect(instance.value).toBe('async');
		});

		it('should return cached instance (singleton)', async () => {
			class TestService {}

			const factory = vi.fn(() => new TestService());
			const container = Container.builder()
				.add(TestService, factory)
				.build();

			const instance1 = await container.resolve(TestService);
			const instance2 = await container.resolve(TestService);

			expect(instance1).toBe(instance2);
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should throw UnknownDependencyError for unregistered dependency', async () => {
			class TestService {}

			const container = Container.empty();

			// @ts-expect-error - TestService is not registered
			await expect(container.resolve(TestService)).rejects.toThrow(
				UnknownDependencyError
			);
		});

		it('should wrap factory errors in DependencyCreationError', async () => {
			class TestService {}

			const container = Container.builder()
				.add(TestService, () => {
					throw new Error('Factory error');
				})
				.build();

			await expect(container.resolve(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should handle async factory errors', async () => {
			class TestService {}

			const container = Container.builder()
				.add(TestService, async () => {
					await Promise.resolve();
					throw new Error('Async factory error');
				})
				.build();

			await expect(container.resolve(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should remove failed promise from cache and allow retry', async () => {
			class TestService {}

			let shouldFail = true;
			const container = Container.builder()
				.add(TestService, () => {
					if (shouldFail) {
						throw new Error('Factory error');
					}
					return new TestService();
				})
				.build();

			await expect(container.resolve(TestService)).rejects.toThrow();

			shouldFail = false;
			const instance = await container.resolve(TestService);
			expect(instance).toBeInstanceOf(TestService);
		});

		it('should handle concurrent calls properly', async () => {
			class TestService {}

			const factory = vi.fn(() => new TestService());
			const container = Container.builder()
				.add(TestService, factory)
				.build();

			const [i1, i2, i3] = await Promise.all([
				container.resolve(TestService),
				container.resolve(TestService),
				container.resolve(TestService),
			]);

			expect(i1).toBe(i2);
			expect(i2).toBe(i3);
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should throw error when resolving from destroyed container', async () => {
			class TestService {}

			const container = Container.builder()
				.add(TestService, () => new TestService())
				.build();

			await container.destroy();

			await expect(container.resolve(TestService)).rejects.toThrow(
				ContainerDestroyedError
			);
		});
	});

	describe('resolveAll()', () => {
		it('should resolve multiple dependencies concurrently', async () => {
			class ServiceA {
				getValue() {
					return 'A';
				}
			}
			class ServiceB {
				getValue() {
					return 'B';
				}
			}

			const container = Container.builder()
				.add(ServiceA, () => new ServiceA())
				.add(ServiceB, () => new ServiceB())
				.build();

			const [a, b] = await container.resolveAll(ServiceA, ServiceB);

			expect(a).toBeInstanceOf(ServiceA);
			expect(b).toBeInstanceOf(ServiceB);
			expect(a.getValue()).toBe('A');
			expect(b.getValue()).toBe('B');
		});

		it('should resolve empty array', async () => {
			const container = Container.empty();

			const results = await container.resolveAll();

			expect(results).toEqual([]);
		});

		it('should maintain order', async () => {
			class ServiceA {
				getValue() {
					return 'A';
				}
			}
			class ServiceB {
				getValue() {
					return 'B';
				}
			}
			class ServiceC {
				getValue() {
					return 'C';
				}
			}

			const container = Container.builder()
				.add(ServiceA, () => new ServiceA())
				.add(ServiceB, () => new ServiceB())
				.add(ServiceC, () => new ServiceC())
				.build();

			const [c, a, b] = await container.resolveAll(
				ServiceC,
				ServiceA,
				ServiceB
			);

			expect(c.getValue()).toBe('C');
			expect(a.getValue()).toBe('A');
			expect(b.getValue()).toBe('B');
		});

		it('should throw error from destroyed container', async () => {
			const container = Container.empty();
			await container.destroy();

			await expect(container.resolveAll()).rejects.toThrow(
				ContainerDestroyedError
			);
		});
	});

	describe('dependency injection', () => {
		it('should inject dependencies through factory function', async () => {
			class Database {
				query() {
					return 'db-result';
				}
			}

			class UserService {
				constructor(private db: Database) {}
				getUser() {
					return this.db.query();
				}
			}

			const container = Container.builder()
				.add(Database, () => new Database())
				.add(
					UserService,
					async (ctx) => new UserService(await ctx.resolve(Database))
				)
				.build();

			const userService = await container.resolve(UserService);

			expect(userService.getUser()).toBe('db-result');
		});

		it('should handle complex dependency graphs', async () => {
			class Config {
				getDbUrl() {
					return 'db://localhost';
				}
			}

			class Database {
				constructor(private config: Config) {}
				connect() {
					return `Connected to ${this.config.getDbUrl()}`;
				}
			}

			class Cache {}

			class UserService {
				constructor(
					private db: Database,
					private _cache: Cache
				) {}
				getUser() {
					return `${this.db.connect()} with cache`;
				}
			}

			const container = Container.builder()
				.add(Config, () => new Config())
				.add(
					Database,
					async (ctx) => new Database(await ctx.resolve(Config))
				)
				.add(Cache, () => new Cache())
				.add(UserService, async (ctx) => {
					const [db, cache] = await ctx.resolveAll(Database, Cache);
					return new UserService(db, cache);
				})
				.build();

			const userService = await container.resolve(UserService);

			expect(userService.getUser()).toBe(
				'Connected to db://localhost with cache'
			);
		});

		it('should detect circular dependencies', async () => {
			class ServiceA {
				constructor(private _b: ServiceB) {}
			}

			class ServiceB {
				constructor(private _a: ServiceA) {}
			}

			const container = Container.builder()
				.add(
					ServiceA,
					// @ts-expect-error - circular dependency
					async (ctx) => new ServiceA(await ctx.resolve(ServiceB))
				)
				.add(
					ServiceB,
					async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
				)
				.build();

			try {
				await container.resolve(ServiceA);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				const rootCause = (
					error as DependencyCreationError
				).getRootCause();
				expect(rootCause).toBeInstanceOf(CircularDependencyError);
			}
		});
	});

	describe('destroy()', () => {
		it('should call finalizers for instantiated dependencies', async () => {
			class TestService {
				cleanup = vi.fn() as () => void;
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const container = Container.builder()
				.add(TestService, {
					create: () => new TestService(),
					cleanup: finalizer,
				})
				.build();

			const instance = await container.resolve(TestService);
			await container.destroy();

			expect(finalizer).toHaveBeenCalledWith(instance);
			expect(instance.cleanup).toHaveBeenCalled();
		});

		it('should not call finalizers for non-instantiated dependencies', async () => {
			class TestService {}

			const finalizer = vi.fn();

			const container = Container.builder()
				.add(TestService, {
					create: () => new TestService(),
					cleanup: finalizer,
				})
				.build();

			await container.destroy();

			expect(finalizer).not.toHaveBeenCalled();
		});

		it('should handle async finalizers', async () => {
			class TestService {
				asyncCleanup = vi
					.fn()
					.mockResolvedValue(undefined) as () => Promise<void>;
			}

			const container = Container.builder()
				.add(TestService, {
					create: () => new TestService(),
					cleanup: (instance) => instance.asyncCleanup(),
				})
				.build();

			const instance = await container.resolve(TestService);
			await container.destroy();

			expect(instance.asyncCleanup).toHaveBeenCalled();
		});

		it('should collect finalizer errors', async () => {
			class ServiceA {}
			class ServiceB {}

			const container = Container.builder()
				.add(ServiceA, {
					create: () => new ServiceA(),
					cleanup: () => {
						throw new Error('Finalizer A error');
					},
				})
				.add(ServiceB, {
					create: () => new ServiceB(),
					cleanup: () => {
						throw new Error('Finalizer B error');
					},
				})
				.build();

			await container.resolve(ServiceA);
			await container.resolve(ServiceB);

			await expect(container.destroy()).rejects.toThrow(
				DependencyFinalizationError
			);
		});

		it('should be idempotent', async () => {
			class TestService {}

			const container = Container.builder()
				.add(TestService, () => new TestService())
				.build();

			await container.destroy();
			await expect(container.destroy()).resolves.toBeUndefined();
		});

		it('should make container unusable after destroy', async () => {
			class TestService {}

			const container = Container.builder()
				.add(TestService, () => new TestService())
				.build();

			await container.destroy();

			await expect(container.resolve(TestService)).rejects.toThrow(
				ContainerDestroyedError
			);
		});
	});

	describe('use()', () => {
		it('should resolve service and run callback', async () => {
			class UserService {
				getUsers() {
					return ['alice', 'bob'];
				}
			}

			const container = Container.builder()
				.add(UserService, () => new UserService())
				.build();

			const result = await container.use(UserService, (service) =>
				service.getUsers()
			);

			expect(result).toEqual(['alice', 'bob']);
		});

		it('should destroy container after callback completes', async () => {
			class TestService {}

			const container = Container.builder()
				.add(TestService, () => new TestService())
				.build();

			await container.use(TestService, () => 'done');

			// Container should be destroyed
			await expect(container.resolve(TestService)).rejects.toThrow(
				ContainerDestroyedError
			);
		});

		it('should destroy container even when callback throws', async () => {
			class TestService {}

			const container = Container.builder()
				.add(TestService, () => new TestService())
				.build();

			await expect(
				container.use(TestService, () => {
					throw new Error('Callback error');
				})
			).rejects.toThrow('Callback error');

			// Container should still be destroyed
			await expect(container.resolve(TestService)).rejects.toThrow(
				ContainerDestroyedError
			);
		});

		it('should call finalizers when use completes', async () => {
			const cleanup = vi.fn();

			class TestService {}

			const container = Container.builder()
				.add(TestService, {
					create: () => new TestService(),
					cleanup,
				})
				.build();

			await container.use(TestService, () => 'done');

			expect(cleanup).toHaveBeenCalledTimes(1);
		});

		it('should work with async callbacks', async () => {
			class TestService {
				fetchData() {
					return Promise.resolve('async data');
				}
			}

			const container = Container.builder()
				.add(TestService, () => new TestService())
				.build();

			const result = await container.use(TestService, async (service) => {
				return service.fetchData();
			});

			expect(result).toBe('async data');
		});

		it('should propagate resolution errors', async () => {
			class MissingService {}

			const container = Container.empty();

			await expect(
				// @ts-expect-error - MissingService is not registered
				container.use(MissingService, () => 'never reached')
			).rejects.toThrow(UnknownDependencyError);
		});
	});

	describe('ValueTag support', () => {
		it('should work with ValueTag dependencies', async () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();

			const container = Container.builder()
				.add(StringTag, () => 'hello')
				.add(NumberTag, () => 42)
				.build();

			const stringValue = await container.resolve(StringTag);
			const numberValue = await container.resolve(NumberTag);

			expect(stringValue).toBe('hello');
			expect(numberValue).toBe(42);
		});

		it('should work with object ValueTags', async () => {
			const ConfigTag = Tag.of('Config')<{ apiKey: string }>();

			const container = Container.builder()
				.add(ConfigTag, () => ({ apiKey: 'secret' }))
				.build();

			const config = await container.resolve(ConfigTag);

			expect(config.apiKey).toBe('secret');
		});

		it('should mix ServiceTag and ValueTag dependencies', async () => {
			class UserService {
				constructor(private apiKey: string) {}
				getApiKey() {
					return this.apiKey;
				}
			}

			const ApiKeyTag = Tag.of('apiKey')<string>();

			const container = Container.builder()
				.add(ApiKeyTag, () => 'secret-key')
				.add(
					UserService,
					async (ctx) => new UserService(await ctx.resolve(ApiKeyTag))
				)
				.build();

			const userService = await container.resolve(UserService);

			expect(userService.getApiKey()).toBe('secret-key');
		});
	});

	describe('error handling', () => {
		it('should preserve error context in DependencyCreationError', async () => {
			class TestService {}

			const originalError = new Error('Original error');
			const container = Container.builder()
				.add(TestService, () => {
					throw originalError;
				})
				.build();

			try {
				await container.resolve(TestService);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				expect((error as DependencyCreationError).cause).toBe(
					originalError
				);
			}
		});

		it('should get root cause from nested errors', async () => {
			class ServiceC {}

			class ServiceB {
				constructor(private _c: ServiceC) {}
			}
			class ServiceA {
				constructor(private _b: ServiceB) {}
			}

			const rootError = new Error('Root cause error');
			const container = Container.builder()
				.add(ServiceC, () => {
					throw rootError;
				})
				.add(
					ServiceB,
					async (ctx) => new ServiceB(await ctx.resolve(ServiceC))
				)
				.add(
					ServiceA,
					async (ctx) => new ServiceA(await ctx.resolve(ServiceB))
				)
				.build();

			try {
				await container.resolve(ServiceA);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				const rootCause = (
					error as DependencyCreationError
				).getRootCause();
				expect(rootCause).toBe(rootError);
			}
		});
	});

	describe('Container.scoped()', () => {
		it('should create a scoped container', () => {
			const scoped = Container.scoped('test');

			expect(scoped).toBeDefined();
			expect(scoped.scope).toBe('test');
		});
	});

	describe('classes extending other classes', () => {
		it('should work with classes that extend other classes', async () => {
			class BaseService {
				base() {
					return 'base';
				}
			}

			class ExtendedService extends BaseService {
				extended() {
					return 'extended';
				}
			}

			const container = Container.builder()
				.add(ExtendedService, () => new ExtendedService())
				.build();

			const instance = await container.resolve(ExtendedService);

			expect(instance.base()).toBe('base');
			expect(instance.extended()).toBe('extended');
		});

		it('should work with third-party classes', async () => {
			// Simulate a third-party class
			class ThirdPartyClient {
				fetch(url: string) {
					return `Fetched: ${url}`;
				}
			}

			const container = Container.builder()
				.add(ThirdPartyClient, () => new ThirdPartyClient())
				.build();

			const client = await container.resolve(ThirdPartyClient);

			expect(client.fetch('http://example.com')).toBe(
				'Fetched: http://example.com'
			);
		});
	});
});

describe('ScopedContainer', () => {
	describe('creation', () => {
		it('should create via ScopedContainer.create()', () => {
			const container = ScopedContainer.empty('app');

			expect(container).toBeInstanceOf(ScopedContainer);
			expect(container.scope).toBe('app');
		});

		it('should create via ScopedContainer.builder()', () => {
			const container = ScopedContainer.builder('app')
				.add(class Database {}, () => ({}))
				.build();

			expect(container).toBeInstanceOf(ScopedContainer);
			expect(container.scope).toBe('app');
		});

		it('should create via Container.scoped()', () => {
			const container = Container.scoped('app');

			expect(container).toBeInstanceOf(ScopedContainer);
			expect(container.scope).toBe('app');
		});

		it('should support symbol scopes', () => {
			const scopeSymbol = Symbol('my-scope');
			const container = ScopedContainer.empty(scopeSymbol);

			expect(container.scope).toBe(scopeSymbol);
		});
	});

	describe('registration', () => {
		it('should register dependencies via builder', async () => {
			class Database {
				query() {
					return 'data';
				}
			}

			const container = ScopedContainer.builder('app')
				.add(Database, () => new Database())
				.build();

			const db = await container.resolve(Database);
			expect(db.query()).toBe('data');
		});

		it('should chain registrations', async () => {
			class ServiceA {}
			class ServiceB {}

			const container = ScopedContainer.builder('app')
				.add(ServiceA, () => new ServiceA())
				.add(ServiceB, () => new ServiceB())
				.build();

			const [a, b] = await container.resolveAll(ServiceA, ServiceB);
			expect(a).toBeInstanceOf(ServiceA);
			expect(b).toBeInstanceOf(ServiceB);
		});
	});

	describe('child scopes', () => {
		it('should create child container builder', () => {
			const parent = ScopedContainer.empty('app');
			const childBuilder = parent.child('request');

			expect(childBuilder).toBeInstanceOf(ScopedContainerBuilder);

			const child = childBuilder.build();
			expect(child.scope).toBe('request');
			expect(child).toBeInstanceOf(ScopedContainer);
		});

		it('should inherit parent dependencies', async () => {
			class Database {
				query() {
					return 'data';
				}
			}

			const parent = ScopedContainer.builder('app')
				.add(Database, () => new Database())
				.build();

			const child = parent.child('request').build();

			const db = await child.resolve(Database);
			expect(db.query()).toBe('data');
		});

		it('should share parent instances', async () => {
			class Database {}

			const factory = vi.fn(() => new Database());
			const parent = ScopedContainer.builder('app')
				.add(Database, factory)
				.build();

			const child1 = parent.child('request-1').build();
			const child2 = parent.child('request-2').build();

			const db1 = await child1.resolve(Database);
			const db2 = await child2.resolve(Database);
			const dbParent = await parent.resolve(Database);

			expect(db1).toBe(db2);
			expect(db1).toBe(dbParent);
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should isolate child-scoped dependencies', async () => {
			class RequestContext {
				constructor(public id: string) {}
			}

			const parent = ScopedContainer.empty('app');

			const child1 = parent
				.child('request-1')
				.add(RequestContext, () => new RequestContext('req-1'))
				.build();

			const child2 = parent
				.child('request-2')
				.add(RequestContext, () => new RequestContext('req-2'))
				.build();

			const ctx1 = await child1.resolve(RequestContext);
			const ctx2 = await child2.resolve(RequestContext);

			expect(ctx1.id).toBe('req-1');
			expect(ctx2.id).toBe('req-2');
			expect(ctx1).not.toBe(ctx2);
		});

		it('should access both parent and child dependencies', async () => {
			class Database {
				query() {
					return 'data';
				}
			}
			class RequestContext {
				constructor(public id: string) {}
			}

			const parent = ScopedContainer.builder('app')
				.add(Database, () => new Database())
				.build();

			const child = parent
				.child('request')
				.add(RequestContext, () => new RequestContext('req-1'))
				.build();

			const db = await child.resolve(Database);
			const ctx = await child.resolve(RequestContext);

			expect(db.query()).toBe('data');
			expect(ctx.id).toBe('req-1');
		});

		it('should throw for unregistered dependency in child', async () => {
			class UnregisteredService {}

			const parent = ScopedContainer.empty('app');
			const child = parent.child('request').build();

			// @ts-expect-error - not registered
			await expect(child.resolve(UnregisteredService)).rejects.toThrow(
				UnknownDependencyError
			);
		});
	});

	describe('childFrom()', () => {
		it('should create child with layer applied', async () => {
			class Database {
				query() {
					return 'result';
				}
			}
			const RequestIdTag = Tag.of('requestId')<string>();

			const parent = ScopedContainer.builder('app')
				.add(Database, () => new Database())
				.build();

			const requestLayer = Layer.value(RequestIdTag, 'req-123');

			const child = parent.childFrom('request', requestLayer);

			// Can resolve parent deps
			const db = await child.resolve(Database);
			expect(db.query()).toBe('result');

			// Can resolve child-specific deps
			const reqId = await child.resolve(RequestIdTag);
			expect(reqId).toBe('req-123');
		});

		it('should be equivalent to child + apply + build', async () => {
			class Database {}
			const ConfigTag = Tag.of('config')<{ url: string }>();

			const parent = ScopedContainer.builder('app')
				.add(Database, () => new Database())
				.build();

			const configLayer = Layer.value(ConfigTag, { url: 'localhost' });

			// Using childFrom
			const child1 = parent.childFrom('request-1', configLayer);

			// Using child + apply + build
			const child2 = configLayer.apply(parent.child('request-2')).build();

			// Both should work the same
			const config1 = await child1.resolve(ConfigTag);
			const config2 = await child2.resolve(ConfigTag);

			expect(config1.url).toBe('localhost');
			expect(config2.url).toBe('localhost');
		});

		it('should work with layers that require parent dependencies', async () => {
			class Database {
				query() {
					return 'users';
				}
			}
			class UserService {
				constructor(private db: Database) {}
				getUsers() {
					return this.db.query();
				}
			}

			const parent = ScopedContainer.builder('app')
				.add(Database, () => new Database())
				.build();

			const userServiceLayer = Layer.service(UserService, [Database]);

			const child = parent.childFrom('request', userServiceLayer);

			const userService = await child.resolve(UserService);
			expect(userService.getUsers()).toBe('users');
		});
	});

	describe('destroy()', () => {
		it('should destroy child scopes first', async () => {
			const destroyOrder: string[] = [];

			class ParentService {}
			class ChildService {}

			const parent = ScopedContainer.builder('app')
				.add(ParentService, {
					create: () => new ParentService(),
					cleanup: () => {
						destroyOrder.push('parent');
					},
				})
				.build();

			const child = parent
				.child('request')
				.add(ChildService, {
					create: () => new ChildService(),
					cleanup: () => {
						destroyOrder.push('child');
					},
				})
				.build();

			await parent.resolve(ParentService);
			await child.resolve(ChildService);

			await parent.destroy();

			expect(destroyOrder).toEqual(['child', 'parent']);
		});

		it('should not affect other children when one is destroyed', async () => {
			class Database {}

			const parent = ScopedContainer.builder('app')
				.add(Database, () => new Database())
				.build();

			const child1 = parent.child('request-1').build();
			const child2 = parent.child('request-2').build();

			await child1.resolve(Database);
			await child2.resolve(Database);

			await child1.destroy();

			// Child2 should still work
			const db = await child2.resolve(Database);
			expect(db).toBeInstanceOf(Database);
		});

		it('should collect errors from child and parent finalizers', async () => {
			class ParentService {}
			class ChildService {}

			const parent = ScopedContainer.builder('app')
				.add(ParentService, {
					create: () => new ParentService(),
					cleanup: () => {
						throw new Error('Parent cleanup error');
					},
				})
				.build();

			const child = parent
				.child('request')
				.add(ChildService, {
					create: () => new ChildService(),
					cleanup: () => {
						throw new Error('Child cleanup error');
					},
				})
				.build();

			await parent.resolve(ParentService);
			await child.resolve(ChildService);

			await expect(parent.destroy()).rejects.toThrow(
				DependencyFinalizationError
			);
		});

		it('should prevent creating children after destroy', async () => {
			const parent = ScopedContainer.empty('app');
			await parent.destroy();

			expect(() => parent.child('request')).toThrow(
				ContainerDestroyedError
			);
		});

		it('should be idempotent', async () => {
			const parent = ScopedContainer.empty('app');

			await parent.destroy();
			await expect(parent.destroy()).resolves.toBeUndefined();
		});
	});

	describe('use()', () => {
		it('should resolve service and run callback', async () => {
			class UserService {
				getUsers() {
					return ['alice', 'bob'];
				}
			}

			const container = ScopedContainer.builder('app')
				.add(UserService, () => new UserService())
				.build();

			const result = await container.use(UserService, (service) =>
				service.getUsers()
			);

			expect(result).toEqual(['alice', 'bob']);
		});

		it('should destroy container after callback completes', async () => {
			class TestService {}

			const container = ScopedContainer.builder('app')
				.add(TestService, () => new TestService())
				.build();

			await container.use(TestService, () => 'done');

			// Container should be destroyed
			await expect(container.resolve(TestService)).rejects.toThrow(
				ContainerDestroyedError
			);
		});

		it('should work with child containers', async () => {
			class Database {
				query() {
					return 'data';
				}
			}
			class UserService {
				constructor(private db: Database) {}
				getUsers() {
					return this.db.query();
				}
			}

			const parent = ScopedContainer.builder('app')
				.add(Database, () => new Database())
				.build();

			const result = await parent
				.child('request')
				.add(UserService, async (ctx) => {
					const db = await ctx.resolve(Database);
					return new UserService(db);
				})
				.build()
				.use(UserService, (service) => service.getUsers());

			expect(result).toBe('data');
		});

		it('should destroy children when parent uses', async () => {
			const destroyOrder: string[] = [];

			class ParentService {}
			class ChildService {}

			const parent = ScopedContainer.builder('app')
				.add(ParentService, {
					create: () => new ParentService(),
					cleanup: () => {
						destroyOrder.push('parent');
					},
				})
				.build();

			const _child = parent
				.child('request')
				.add(ChildService, {
					create: () => new ChildService(),
					cleanup: () => {
						destroyOrder.push('child');
					},
				})
				.build();

			await parent.resolve(ParentService);
			await _child.resolve(ChildService);

			// use() on parent should destroy both parent and child
			await parent.use(ParentService, () => 'done');

			expect(destroyOrder).toEqual(['child', 'parent']);
		});

		it('should work with childFrom convenience method', async () => {
			class Database {
				query() {
					return 'data';
				}
			}

			const databaseLayer = Layer.service(Database, []);

			const container = ScopedContainer.from('app', databaseLayer);

			const result = await container.use(Database, (db) => db.query());

			expect(result).toBe('data');
		});
	});

	describe('ValueTag support', () => {
		it('should work with ValueTags in parent scope', async () => {
			const ConfigTag = Tag.of('Config')<{ url: string }>();

			const parent = ScopedContainer.builder('app')
				.add(ConfigTag, () => ({ url: 'http://localhost' }))
				.build();

			// child() now returns a builder - need to build() to get container
			const child = parent.child('request').build();

			const config = await child.resolve(ConfigTag);
			expect(config.url).toBe('http://localhost');
		});

		it('should work with ValueTags in child scope', async () => {
			const RequestIdTag = Tag.of('RequestId')<string>();

			const parent = ScopedContainer.empty('app');

			const child = parent
				.child('request')
				.add(RequestIdTag, () => 'req-123')
				.build();

			const requestId = await child.resolve(RequestIdTag);
			expect(requestId).toBe('req-123');
		});
	});

	describe('dependency injection across scopes', () => {
		it('should inject parent dependencies into child services', async () => {
			class Database {
				query() {
					return 'data';
				}
			}

			class RequestHandler {
				constructor(private db: Database) {}
				handle() {
					return this.db.query();
				}
			}

			const parent = ScopedContainer.builder('app')
				.add(Database, () => new Database())
				.build();

			const child = parent
				.child('request')
				.add(
					RequestHandler,
					async (ctx) =>
						new RequestHandler(await ctx.resolve(Database))
				)
				.build();

			const handler = await child.resolve(RequestHandler);
			expect(handler.handle()).toBe('data');
		});

		it('should inject child dependencies into child services', async () => {
			class RequestContext {
				constructor(public id: string) {}
			}

			class RequestLogger {
				constructor(private ctx: RequestContext) {}
				log(msg: string) {
					return `[${this.ctx.id}] ${msg}`;
				}
			}

			const parent = ScopedContainer.empty('app');

			const child = parent
				.child('request')
				.add(RequestContext, () => new RequestContext('req-1'))
				.add(
					RequestLogger,
					async (ctx) =>
						new RequestLogger(await ctx.resolve(RequestContext))
				)
				.build();

			const logger = await child.resolve(RequestLogger);
			expect(logger.log('hello')).toBe('[req-1] hello');
		});
	});

	describe('realistic web server scenario', () => {
		it('should support request-scoped dependencies', async () => {
			// App-level services
			class Database {
				query(sql: string) {
					return `Result: ${sql}`;
				}
			}
			class Logger {
				log(msg: string) {
					return msg;
				}
			}

			// Request-level services
			class RequestContext {
				constructor(
					public requestId: string,
					public userId: string
				) {}
			}

			class UserService {
				constructor(
					private db: Database,
					private ctx: RequestContext
				) {}
				getCurrentUser() {
					return this.db.query(
						`SELECT * FROM users WHERE id = ${this.ctx.userId}`
					);
				}
			}

			// Set up app container
			const appContainer = ScopedContainer.builder('app')
				.add(Database, () => new Database())
				.add(Logger, () => new Logger())
				.build();

			// Simulate two concurrent requests
			async function handleRequest(requestId: string, userId: string) {
				const requestContainer = appContainer
					.child('request')
					.add(
						RequestContext,
						() => new RequestContext(requestId, userId)
					)
					.add(UserService, async (ctx) => {
						const [db, reqCtx] = await ctx.resolveAll(
							Database,
							RequestContext
						);
						return new UserService(db, reqCtx);
					})
					.build();

				try {
					const userService =
						await requestContainer.resolve(UserService);
					return userService.getCurrentUser();
				} finally {
					await requestContainer.destroy();
				}
			}

			const [result1, result2] = await Promise.all([
				handleRequest('req-1', 'user-1'),
				handleRequest('req-2', 'user-2'),
			]);

			expect(result1).toBe(
				'Result: SELECT * FROM users WHERE id = user-1'
			);
			expect(result2).toBe(
				'Result: SELECT * FROM users WHERE id = user-2'
			);

			// App container should still work
			const db = await appContainer.resolve(Database);
			expect(db.query('SELECT 1')).toBe('Result: SELECT 1');

			await appContainer.destroy();
		});
	});
});
