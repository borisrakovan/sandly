import {
	Container,
	type DependencyLifecycle,
	type ResolutionContext,
} from '@/container.js';
import {
	CircularDependencyError,
	ContainerDestroyedError,
	DependencyAlreadyInstantiatedError,
	DependencyCreationError,
	DependencyFinalizationError,
	UnknownDependencyError,
} from '@/errors.js';
import { Tag } from '@/tag.js';
import { describe, expect, it, vi } from 'vitest';

describe('DependencyContainer', () => {
	describe('constructor and factory', () => {
		it('should create an empty container', () => {
			const container = Container.empty();
			expect(container).toBeInstanceOf(Container);
		});

		it('should create a container with proper typing', () => {
			const container = Container.empty();
			// Type check - should be DependencyContainer<never>
			expect(container).toBeDefined();
		});
	});

	describe('register', () => {
		it('should register a simple class constructor', () => {
			class TestService extends Tag.Service('TestService') {
				getValue() {
					return 'test';
				}
			}

			const container = Container.empty();
			const registered = container.register(
				TestService,
				() => new TestService()
			);

			expect(registered).toBeInstanceOf(Container);
			// Should return the same container instance with updated type
			expect(registered).toBe(container);
		});

		it('should register with sync factory', () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const container = Container.empty().register(
				TestService,
				() => new TestService('sync')
			);

			expect(container).toBeDefined();
		});

		it('should register with async factory', () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const container = Container.empty().register(
				TestService,
				() => new TestService('async')
			);

			expect(container).toBeDefined();
		});

		it('should register with finalizer', () => {
			class TestService extends Tag.Service('TestService') {
				cleanup = vi.fn() as () => void;
			}

			const container = Container.empty().register(TestService, {
				create: () => new TestService(),
				cleanup: (instance) => {
					instance.cleanup();
				},
			});

			expect(container).toBeDefined();
		});

		it('should register with class implementing DependencyLifecycle with create and cleanup', async () => {
			class TestService extends Tag.Service('TestService') {
				cleanup = vi.fn() as () => void;
			}

			class TestServiceLifecycle implements DependencyLifecycle<
				TestService,
				never
			> {
				create(): TestService {
					return new TestService();
				}

				cleanup(instance: TestService): void {
					instance.cleanup();
				}
			}

			const container = Container.empty().register(
				TestService,
				new TestServiceLifecycle()
			);

			const instance = await container.resolve(TestService);
			expect(instance).toBeInstanceOf(TestService);

			await container.destroy();
			expect(instance.cleanup).toHaveBeenCalled();
		});

		it('should register with class implementing DependencyLifecycle with only create', async () => {
			class TestService extends Tag.Service('TestService') {
				getValue() {
					return 'test';
				}
			}

			class SimpleServiceLifecycle implements DependencyLifecycle<
				TestService,
				never
			> {
				create(): TestService {
					return new TestService();
				}
				// cleanup is optional, so it can be omitted
			}

			const container = Container.empty().register(
				TestService,
				new SimpleServiceLifecycle()
			);

			const instance = await container.resolve(TestService);
			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('test');
		});

		it('should register with class implementing DependencyLifecycle with dependencies', async () => {
			class Logger extends Tag.Service('Logger') {
				log(message: string) {
					return message;
				}
			}

			class TestService extends Tag.Service('TestService') {
				constructor(
					private logger: Logger,
					public value: string
				) {
					super();
				}

				getLog() {
					return this.logger.log('test');
				}
			}

			class TestServiceLifecycle implements DependencyLifecycle<
				TestService,
				typeof Logger
			> {
				constructor(private value: string) {}

				async create(
					ctx: ResolutionContext<typeof Logger>
				): Promise<TestService> {
					const logger = await ctx.resolve(Logger);
					return new TestService(logger, this.value);
				}
			}

			const container = Container.empty()
				.register(Logger, () => new Logger())
				.register(TestService, new TestServiceLifecycle('test-value'));

			const instance = await container.resolve(TestService);
			expect(instance).toBeInstanceOf(TestService);
			expect(instance.value).toBe('test-value');
			expect(instance.getLog()).toBe('test');
		});

		it('should allow overriding registration before instantiation', () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const container = Container.empty()
				.register(TestService, () => new TestService('original'))
				.register(TestService, () => new TestService('overridden'));

			expect(container).toBeDefined();
		});

		it('should preserve container chain for multiple registrations', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const container = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			expect(container).toBeDefined();
		});

		it('should throw error when trying to register after instantiation', async () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const container = Container.empty().register(
				TestService,
				() => new TestService('original')
			);

			// Instantiate the service
			await container.resolve(TestService);

			// Now try to register again - should throw
			expect(() =>
				container.register(
					TestService,
					() => new TestService('overridden')
				)
			).toThrow(DependencyAlreadyInstantiatedError);
		});

		it('should throw error when registering on destroyed container', async () => {
			class TestService extends Tag.Service('TestService') {}

			const container = Container.empty().register(
				TestService,
				() => new TestService()
			);

			await container.destroy();

			expect(() =>
				container.register(TestService, () => new TestService())
			).toThrow(ContainerDestroyedError);
		});
	});

	describe('has', () => {
		it('should return false for unregistered dependency', () => {
			class TestService extends Tag.Service('TestService') {}

			const container = Container.empty();

			expect(container.has(TestService)).toBe(false);
		});

		it('should return true for registered dependency', () => {
			class TestService extends Tag.Service('TestService') {}

			const container = Container.empty().register(
				TestService,
				() => new TestService()
			);

			expect(container.has(TestService)).toBe(true);
		});

		it('should return true for instantiated dependency', async () => {
			class TestService extends Tag.Service('TestService') {}

			const container = Container.empty().register(
				TestService,
				() => new TestService()
			);

			await container.resolve(TestService);

			expect(container.has(TestService)).toBe(true);
		});
	});

	describe('resolve', () => {
		it('should create and return instance for sync factory', async () => {
			class TestService extends Tag.Service('TestService') {
				getValue() {
					return 'test';
				}
			}

			const container = Container.empty().register(
				TestService,
				() => new TestService()
			);

			const instance = await container.resolve(TestService);

			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('test');
		});

		it('should create and return instance for async factory', async () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const container = Container.empty().register(
				TestService,
				async () => {
					await Promise.resolve();
					return new TestService('async');
				}
			);

			const instance = await container.resolve(TestService);

			expect(instance).toBeInstanceOf(TestService);
			expect(instance.value).toBe('async');
		});

		it('should return cached instance on subsequent calls', async () => {
			class TestService extends Tag.Service('TestService') {}

			const factory = vi.fn(() => new TestService());
			const container = Container.empty().register(TestService, factory);

			const instance1 = await container.resolve(TestService);
			const instance2 = await container.resolve(TestService);

			expect(instance1).toBe(instance2);
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should throw UnknownDependencyError for unregistered dependency', async () => {
			class TestService extends Tag.Service('TestService') {}

			const container = Container.empty();

			// @ts-expect-error - TestService is not registered
			await expect(container.resolve(TestService)).rejects.toThrow(
				UnknownDependencyError
			);
		});

		it('should wrap factory errors in DependencyCreationError', async () => {
			class TestService extends Tag.Service('TestService') {}

			const container = Container.empty().register(TestService, () => {
				throw new Error('Factory error');
			});

			await expect(container.resolve(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should handle async factory errors', async () => {
			class TestService extends Tag.Service('TestService') {}

			const container = Container.empty().register(
				TestService,
				async () => {
					await Promise.resolve();
					throw new Error('Async factory error');
				}
			);

			await expect(container.resolve(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should remove failed promise from cache and allow retry', async () => {
			class TestService extends Tag.Service('TestService') {}

			let shouldFail = true;
			const container = Container.empty().register(TestService, () => {
				if (shouldFail) {
					throw new Error('Factory error');
				}
				return new TestService();
			});

			// First call should fail
			await expect(container.resolve(TestService)).rejects.toThrow(
				DependencyCreationError
			);

			// Service should still be registered even after failure
			expect(container.has(TestService)).toBe(true);

			// Second call should succeed
			shouldFail = false;
			const instance = await container.resolve(TestService);
			expect(instance).toBeInstanceOf(TestService);
		});

		it('should handle concurrent calls properly', async () => {
			class TestService extends Tag.Service('TestService') {}

			const factory = vi.fn(() => new TestService());
			const container = Container.empty().register(TestService, factory);

			// Make concurrent calls
			const [instance1, instance2, instance3] = await Promise.all([
				container.resolve(TestService),
				container.resolve(TestService),
				container.resolve(TestService),
			]);

			expect(instance1).toBe(instance2);
			expect(instance2).toBe(instance3);
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should throw error when getting from destroyed container', async () => {
			class TestService extends Tag.Service('TestService') {}

			const container = Container.empty().register(
				TestService,
				() => new TestService()
			);

			await container.destroy();

			await expect(container.resolve(TestService)).rejects.toThrow(
				ContainerDestroyedError
			);
		});
	});

	describe('resolveAll', () => {
		it('should resolve multiple dependencies concurrently', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				getValue() {
					return 'A';
				}
			}
			class ServiceB extends Tag.Service('ServiceB') {
				getValue() {
					return 'B';
				}
			}

			const container = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			const [serviceA, serviceB] = await container.resolveAll(
				ServiceA,
				ServiceB
			);

			expect(serviceA).toBeInstanceOf(ServiceA);
			expect(serviceB).toBeInstanceOf(ServiceB);
			expect(serviceA.getValue()).toBe('A');
			expect(serviceB.getValue()).toBe('B');
		});

		it('should resolve empty array', async () => {
			const container = Container.empty();

			const results = await container.resolveAll();

			expect(results).toEqual([]);
		});

		it('should resolve single dependency in array', async () => {
			class TestService extends Tag.Service('TestService') {
				getValue() {
					return 'test';
				}
			}

			const container = Container.empty().register(
				TestService,
				() => new TestService()
			);

			const [service] = await container.resolveAll(TestService);

			expect(service).toBeInstanceOf(TestService);
			expect(service.getValue()).toBe('test');
		});

		it('should return cached instances for multiple calls', async () => {
			class TestService extends Tag.Service('TestService') {}

			const factory = vi.fn(() => new TestService());
			const container = Container.empty().register(TestService, factory);

			// First call
			const [instance1] = await container.resolveAll(TestService);
			// Second call
			const [instance2] = await container.resolveAll(TestService);
			// Call with resolve for comparison
			const instance3 = await container.resolve(TestService);

			expect(instance1).toBe(instance2);
			expect(instance1).toBe(instance3);
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should work with ValueTag dependencies', async () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();
			class ServiceA extends Tag.Service('ServiceA') {}

			const container = Container.empty()
				.register(StringTag, () => 'hello')
				.register(NumberTag, () => 42)
				.register(ServiceA, () => new ServiceA());

			const [stringValue, numberValue, serviceA] =
				await container.resolveAll(StringTag, NumberTag, ServiceA);

			expect(stringValue).toBe('hello');
			expect(numberValue).toBe(42);
			expect(serviceA).toBeInstanceOf(ServiceA);
		});

		it('should maintain order of resolved dependencies', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				getValue() {
					return 'A';
				}
			}
			class ServiceB extends Tag.Service('ServiceB') {
				getValue() {
					return 'B';
				}
			}
			class ServiceC extends Tag.Service('ServiceC') {
				getValue() {
					return 'C';
				}
			}

			const container = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB())
				.register(ServiceC, () => new ServiceC());

			// Test different orders
			const [a1, b1, c1] = await container.resolveAll(
				ServiceA,
				ServiceB,
				ServiceC
			);
			expect(a1.getValue()).toBe('A');
			expect(b1.getValue()).toBe('B');
			expect(c1.getValue()).toBe('C');

			const [c2, a2, b2] = await container.resolveAll(
				ServiceC,
				ServiceA,
				ServiceB
			);
			expect(c2.getValue()).toBe('C');
			expect(a2.getValue()).toBe('A');
			expect(b2.getValue()).toBe('B');
		});

		it('should handle async factories properly', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				constructor(public value: string) {
					super();
				}
			}
			class ServiceB extends Tag.Service('ServiceB') {
				constructor(public value: number) {
					super();
				}
			}

			const container = Container.empty()
				.register(ServiceA, async () => {
					await Promise.resolve();
					return new ServiceA('async-A');
				})
				.register(ServiceB, async () => {
					await Promise.resolve();
					return new ServiceB(123);
				});

			const [serviceA, serviceB] = await container.resolveAll(
				ServiceA,
				ServiceB
			);

			expect(serviceA.value).toBe('async-A');
			expect(serviceB.value).toBe(123);
		});

		it('should throw UnknownDependencyError for unregistered dependency', async () => {
			class RegisteredService extends Tag.Service('RegisteredService') {}
			class UnregisteredService extends Tag.Service(
				'UnregisteredService'
			) {}

			const container = Container.empty().register(
				RegisteredService,
				() => new RegisteredService()
			);

			await expect(
				// @ts-expect-error - UnregisteredService is not registered
				container.resolveAll(RegisteredService, UnregisteredService)
			).rejects.toThrow(UnknownDependencyError);
		});

		it('should throw DependencyCreationError if any factory fails', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const container = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => {
					throw new Error('Factory B failed');
				});

			await expect(
				container.resolveAll(ServiceA, ServiceB)
			).rejects.toThrow(DependencyCreationError);
		});

		it('should throw error when resolving from destroyed container', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const container = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			await container.destroy();

			await expect(
				container.resolveAll(ServiceA, ServiceB)
			).rejects.toThrow(ContainerDestroyedError);
		});

		it('should handle concurrent resolveAll calls properly', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const factoryA = vi.fn(() => new ServiceA());
			const factoryB = vi.fn(() => new ServiceB());

			const container = Container.empty()
				.register(ServiceA, factoryA)
				.register(ServiceB, factoryB);

			// Make concurrent resolveAll calls
			const [result1, result2, result3] = await Promise.all([
				container.resolveAll(ServiceA, ServiceB),
				container.resolveAll(ServiceA, ServiceB),
				container.resolveAll(ServiceB, ServiceA),
			]);

			// All results should have the same instances
			expect(result1[0]).toBe(result2[0]);
			expect(result1[1]).toBe(result2[1]);
			expect(result1[0]).toBe(result3[1]);
			expect(result1[1]).toBe(result3[0]);

			// Factories should only be called once each
			expect(factoryA).toHaveBeenCalledTimes(1);
			expect(factoryB).toHaveBeenCalledTimes(1);
		});

		it('should handle mix of cached and non-cached dependencies', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}

			const factoryA = vi.fn(() => new ServiceA());
			const factoryB = vi.fn(() => new ServiceB());
			const factoryC = vi.fn(() => new ServiceC());

			const container = Container.empty()
				.register(ServiceA, factoryA)
				.register(ServiceB, factoryB)
				.register(ServiceC, factoryC);

			// Resolve ServiceA first to cache it
			const cachedA = await container.resolve(ServiceA);

			// Now resolve all three - A should be from cache, B and C should be new
			const [serviceA, serviceB, serviceC] = await container.resolveAll(
				ServiceA,
				ServiceB,
				ServiceC
			);

			expect(serviceA).toBe(cachedA);
			expect(serviceB).toBeInstanceOf(ServiceB);
			expect(serviceC).toBeInstanceOf(ServiceC);

			// ServiceA factory called once (from first resolve), others called once each
			expect(factoryA).toHaveBeenCalledTimes(1);
			expect(factoryB).toHaveBeenCalledTimes(1);
			expect(factoryC).toHaveBeenCalledTimes(1);
		});
	});

	describe('dependency injection', () => {
		it('should inject dependencies through factory function', async () => {
			class DatabaseService extends Tag.Service('DatabaseService') {
				query() {
					return 'db-result';
				}
			}

			class UserService extends Tag.Service('UserService') {
				constructor(private db: DatabaseService) {
					super();
				}

				getUser() {
					return this.db.query();
				}
			}

			const container = Container.empty()
				.register(DatabaseService, () => new DatabaseService())
				.register(
					UserService,
					async (ctx) =>
						new UserService(await ctx.resolve(DatabaseService))
				);

			const userService = await container.resolve(UserService);

			expect(userService.getUser()).toBe('db-result');
		});

		it('should handle complex dependency graphs', async () => {
			class ConfigService extends Tag.Service('ConfigService') {
				getDbUrl() {
					return 'db://localhost';
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private config: ConfigService) {
					super();
				}

				connect() {
					return `Connected to ${this.config.getDbUrl()}`;
				}
			}

			class CacheService extends Tag.Service('CacheService') {}

			class UserService extends Tag.Service('UserService') {
				constructor(
					private db: DatabaseService,
					private _cache: CacheService
				) {
					super();
				}

				getUser() {
					return `${this.db.connect()} with cache`;
				}
			}

			const container = Container.empty()
				.register(ConfigService, () => new ConfigService())
				.register(
					DatabaseService,
					async (ctx) =>
						new DatabaseService(await ctx.resolve(ConfigService))
				)
				.register(CacheService, () => new CacheService())
				.register(
					UserService,
					async (ctx) =>
						new UserService(
							await ctx.resolve(DatabaseService),
							await ctx.resolve(CacheService)
						)
				);

			const userService = await container.resolve(UserService);

			expect(userService.getUser()).toBe(
				'Connected to db://localhost with cache'
			);
		});

		it('should detect and throw CircularDependencyError', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				constructor(private _serviceB: ServiceB) {
					super();
				}
			}

			class ServiceB extends Tag.Service('ServiceB') {
				constructor(private _serviceA: ServiceA) {
					super();
				}
			}

			const container = Container.empty()
				.register(
					ServiceA,
					async (ctx) =>
						// @ts-expect-error - ServiceB is not registered
						new ServiceA(await ctx.resolve(ServiceB))
				)
				.register(
					ServiceB,
					async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
				);

			// Should throw DependencyCreationError with nested error chain leading to CircularDependencyError
			try {
				await container.resolve(ServiceA);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				// The error chain is: DependencyCreationError(ServiceA) -> DependencyCreationError(ServiceB) -> CircularDependencyError
				const serviceAError = error as DependencyCreationError;
				expect(serviceAError.cause).toBeInstanceOf(
					DependencyCreationError
				);
				const serviceBError =
					serviceAError.cause as DependencyCreationError;
				expect(serviceBError.cause).toBeInstanceOf(
					CircularDependencyError
				);
			}

			try {
				await container.resolve(ServiceB);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				// The error chain is: DependencyCreationError(ServiceB) -> DependencyCreationError(ServiceA) -> CircularDependencyError
				const serviceBError = error as DependencyCreationError;
				expect(serviceBError.cause).toBeInstanceOf(
					DependencyCreationError
				);
				const serviceAError =
					serviceBError.cause as DependencyCreationError;
				expect(serviceAError.cause).toBeInstanceOf(
					CircularDependencyError
				);
			}
		});
	});

	describe('destroy', () => {
		it('should call finalizers for instantiated dependencies', async () => {
			class TestService extends Tag.Service('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const container = Container.empty().register(TestService, {
				create: () => new TestService(),
				cleanup: finalizer,
			});

			// Instantiate the service
			const instance = await container.resolve(TestService);

			await container.destroy();

			expect(finalizer).toHaveBeenCalledWith(instance);
			expect(instance.cleanup).toHaveBeenCalled();
		});

		it('should not call finalizers for non-instantiated dependencies', async () => {
			class TestService extends Tag.Service('TestService') {}

			const finalizer = vi.fn();

			const container = Container.empty().register(TestService, {
				create: () => new TestService(),
				cleanup: finalizer,
			});

			// Do not instantiate the service
			await container.destroy();

			expect(finalizer).not.toHaveBeenCalled();
		});

		it('should call finalizers concurrently', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}

			const finalizationOrder: string[] = [];

			const container = Container.empty()
				.register(ServiceA, {
					create: () => new ServiceA(),
					cleanup: () => {
						finalizationOrder.push('A');
					},
				})
				.register(ServiceB, {
					create: () => new ServiceB(),
					cleanup: () => {
						finalizationOrder.push('B');
					},
				})
				.register(ServiceC, {
					create: () => new ServiceC(),
					cleanup: () => {
						finalizationOrder.push('C');
					},
				});

			// Instantiate all services
			await container.resolve(ServiceA);
			await container.resolve(ServiceB);
			await container.resolve(ServiceC);

			await container.destroy();

			// Finalizers run concurrently, so we just verify all were called
			expect(finalizationOrder).toHaveLength(3);
			expect(finalizationOrder).toContain('A');
			expect(finalizationOrder).toContain('B');
			expect(finalizationOrder).toContain('C');
		});

		it('should handle async finalizers', async () => {
			class TestService extends Tag.Service('TestService') {
				asyncCleanup = vi
					.fn()
					.mockResolvedValue(undefined) as () => Promise<void>;
			}

			const finalizer = vi
				.fn()
				.mockImplementation((instance: TestService) => {
					return instance.asyncCleanup();
				});

			const container = Container.empty().register(TestService, {
				create: () => new TestService(),
				cleanup: finalizer,
			});

			const instance = await container.resolve(TestService);

			await container.destroy();

			expect(instance.asyncCleanup).toHaveBeenCalled();
		});

		it('should collect finalizer errors and throw DependencyContainerFinalizationError', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const container = Container.empty()
				.register(ServiceA, {
					create: () => new ServiceA(),
					cleanup: () => {
						throw new Error('Finalizer A error');
					},
				})
				.register(ServiceB, {
					create: () => new ServiceB(),
					cleanup: () => {
						throw new Error('Finalizer B error');
					},
				});

			// Instantiate services
			await container.resolve(ServiceA);
			await container.resolve(ServiceB);

			await expect(container.destroy()).rejects.toThrow(
				DependencyFinalizationError
			);
		});

		it('should return all root causes via getRootCauses() with single error', async () => {
			class TestService extends Tag.Service('TestService') {}

			const originalError = new Error('Single finalizer error');
			const container = Container.empty().register(TestService, {
				create: () => new TestService(),
				cleanup: () => {
					throw originalError;
				},
			});

			await container.resolve(TestService);

			try {
				await container.destroy();
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyFinalizationError);
				const finalizationError = error as DependencyFinalizationError;

				const rootCauses = finalizationError.getRootCauses();
				expect(rootCauses).toHaveLength(1);
				expect(rootCauses[0]).toBe(originalError);
				expect(rootCauses[0]).toBeInstanceOf(Error);
				expect((rootCauses[0] as Error).message).toBe(
					'Single finalizer error'
				);
			}
		});

		it('should return all root causes via getRootCauses() with multiple errors', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}

			const errorA = new Error('Finalizer A error');
			const errorB = new Error('Finalizer B error');
			const errorC = new Error('Finalizer C error');

			const container = Container.empty()
				.register(ServiceA, {
					create: () => new ServiceA(),
					cleanup: () => {
						throw errorA;
					},
				})
				.register(ServiceB, {
					create: () => new ServiceB(),
					cleanup: () => {
						throw errorB;
					},
				})
				.register(ServiceC, {
					create: () => new ServiceC(),
					cleanup: () => {
						throw errorC;
					},
				});

			// Instantiate all services
			await container.resolve(ServiceA);
			await container.resolve(ServiceB);
			await container.resolve(ServiceC);

			try {
				await container.destroy();
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyFinalizationError);
				const finalizationError = error as DependencyFinalizationError;

				const rootCauses = finalizationError.getRootCauses();
				expect(rootCauses).toHaveLength(3);
				expect(rootCauses).toContain(errorA);
				expect(rootCauses).toContain(errorB);
				expect(rootCauses).toContain(errorC);

				// Verify all are Error instances
				rootCauses.forEach((cause) => {
					expect(cause).toBeInstanceOf(Error);
				});

				// Verify messages
				const messages = rootCauses.map(
					(cause) => (cause as Error).message
				);
				expect(messages).toContain('Finalizer A error');
				expect(messages).toContain('Finalizer B error');
				expect(messages).toContain('Finalizer C error');
			}
		});

		it('should clear instance cache even if finalization fails', async () => {
			class TestService extends Tag.Service('TestService') {}

			const container = Container.empty().register(TestService, {
				create: () => new TestService(),
				cleanup: () => {
					throw new Error('Finalizer error');
				},
			});

			await container.resolve(TestService);

			// Should throw due to finalizer error
			await expect(container.destroy()).rejects.toThrow();

			// Service should still be registered even after destroy fails
			expect(container.has(TestService)).toBe(true);
		});

		it('should make container unusable after destroy', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const container = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			await container.resolve(ServiceA);
			await container.resolve(ServiceB);

			expect(container.has(ServiceA)).toBe(true);
			expect(container.has(ServiceB)).toBe(true);

			await container.destroy();

			// Services should still be registered even after destroy
			expect(container.has(ServiceA)).toBe(true);
			expect(container.has(ServiceB)).toBe(true);

			// Container should now be unusable
			await expect(container.resolve(ServiceA)).rejects.toThrow(
				'Cannot resolve dependencies from a destroyed container'
			);

			expect(() =>
				container.register(ServiceA, () => new ServiceA())
			).toThrow('Cannot register dependencies on a destroyed container');

			// Subsequent destroy calls should be safe (idempotent)
			await expect(container.destroy()).resolves.toBeUndefined();
		});

		it('should throw error when trying to use destroyed container multiple times', async () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public id: number) {
					super();
				}
			}

			let instanceCount = 0;
			const container = Container.empty().register(TestService, () => {
				return new TestService(++instanceCount);
			});

			// First cycle
			const instance1 = await container.resolve(TestService);
			expect(instance1.id).toBe(1);
			await container.destroy();

			// Container should now be unusable
			await expect(container.resolve(TestService)).rejects.toThrow(
				'Cannot resolve dependencies from a destroyed container'
			);

			// Multiple destroy calls should be safe
			await expect(container.destroy()).resolves.toBeUndefined();
			await expect(container.destroy()).resolves.toBeUndefined();
		});

		it('should verify finalizers are called but container becomes unusable', async () => {
			class TestService extends Tag.Service('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const container = Container.empty().register(TestService, {
				create: () => new TestService(),
				cleanup: finalizer,
			});

			// First cycle
			const instance1 = await container.resolve(TestService);
			await container.destroy();
			expect(finalizer).toHaveBeenCalledTimes(1);
			expect(instance1.cleanup).toHaveBeenCalledTimes(1);

			// Container should now be unusable
			await expect(container.resolve(TestService)).rejects.toThrow(
				'Cannot resolve dependencies from a destroyed container'
			);
		});
	});

	describe('ValueTag support', () => {
		it('should work with ValueTag dependencies', async () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();

			const container = Container.empty()
				.register(StringTag, () => 'hello')
				.register(NumberTag, () => 42);

			const stringValue = await container.resolve(StringTag);
			const numberValue = await container.resolve(NumberTag);

			expect(stringValue).toBe('hello');
			expect(numberValue).toBe(42);
		});

		it('should work with ValueTags', async () => {
			const ConfigTag = Tag.of('Config')<{ apiKey: string }>();

			const container = Container.empty().register(ConfigTag, () => ({
				apiKey: 'secret',
			}));

			const config = await container.resolve(ConfigTag);

			expect(config.apiKey).toBe('secret');
		});

		it('should mix ServiceTag and ValueTag dependencies', async () => {
			class UserService extends Tag.Service('UserService') {
				constructor(private apiKey: string) {
					super();
				}

				getApiKey() {
					return this.apiKey;
				}
			}

			const ApiKeyTag = Tag.of('apiKey')<string>();

			const container = Container.empty()
				.register(ApiKeyTag, () => 'secret-key')
				.register(
					UserService,
					async (ctx) => new UserService(await ctx.resolve(ApiKeyTag))
				);

			const userService = await container.resolve(UserService);

			expect(userService.getApiKey()).toBe('secret-key');
		});
	});

	describe('error handling', () => {
		it('should preserve error context in DependencyCreationError', async () => {
			class TestService extends Tag.Service('TestService') {}

			const originalError = new Error('Original error');
			const container = Container.empty().register(TestService, () => {
				throw originalError;
			});

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

		it('should handle nested dependency creation errors', async () => {
			class DatabaseService extends Tag.Service('DatabaseService') {}
			class UserService extends Tag.Service('UserService') {}

			const container = Container.empty()
				.register(DatabaseService, () => {
					throw new Error('Database connection failed');
				})
				.register(
					UserService,
					async (ctx) =>
						new UserService(await ctx.resolve(DatabaseService))
				);

			try {
				await container.resolve(UserService);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				// Should be the UserService creation error, with nested DatabaseService error
			}
		});

		it('should get root cause from nested DependencyCreationErrors', async () => {
			class ServiceC extends Tag.Service('ServiceC') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceA extends Tag.Service('ServiceA') {}

			const rootError = new Error('Root cause error');
			const container = Container.empty()
				.register(ServiceC, () => {
					throw rootError;
				})
				.register(
					ServiceB,
					async (ctx) => new ServiceB(await ctx.resolve(ServiceC))
				)
				.register(
					ServiceA,
					async (ctx) => new ServiceA(await ctx.resolve(ServiceB))
				);

			try {
				await container.resolve(ServiceA);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				const creationError = error as DependencyCreationError;

				// getRootCause should unwrap all nested DependencyCreationErrors
				const rootCause = creationError.getRootCause();
				expect(rootCause).toBe(rootError);
				expect(rootCause).toBeInstanceOf(Error);
				expect((rootCause as Error).message).toBe('Root cause error');

				// Should not be a DependencyCreationError
				expect(rootCause).not.toBeInstanceOf(DependencyCreationError);
			}
		});

		it('should return the error itself if it is not nested', async () => {
			class TestService extends Tag.Service('TestService') {}

			const originalError = new Error('Simple error');
			const container = Container.empty().register(TestService, () => {
				throw originalError;
			});

			try {
				await container.resolve(TestService);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				const creationError = error as DependencyCreationError;

				const rootCause = creationError.getRootCause();
				expect(rootCause).toBe(originalError);
			}
		});
	});

	describe('type safety edge cases', () => {
		it('should maintain type safety with complex inheritance', async () => {
			class BaseService extends Tag.Service('BaseService') {
				baseMethod() {
					return 'base';
				}
			}

			class ExtendedService extends BaseService {
				extendedMethod() {
					return 'extended';
				}
			}

			const container = Container.empty().register(
				BaseService,
				() => new ExtendedService()
			);

			const instance = await container.resolve(BaseService);

			// Should be able to call base method
			expect(instance.baseMethod()).toBe('base');
			// Should also be able to call extended method due to implementation
			expect((instance as ExtendedService).extendedMethod()).toBe(
				'extended'
			);
		});
	});
});
