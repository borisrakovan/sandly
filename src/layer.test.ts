import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Container, ScopedContainer } from './container.js';
import {
	DependencyCreationError,
	DuplicateOverrideError,
	DuplicateProviderError,
	OverrideTargetNotFoundError,
	SingletonInChildScopeError,
	UnusedDependencyResolvedError,
} from './errors.js';
import { Layer } from './layer.js';
import type {
	ChildLayer,
	MissingDependencies,
	Root,
	RootLayer,
	SatisfiedAtRoot,
	SatisfiedByParent,
	SingletonInChildScope,
} from './requirements.js';
import { type AnyTag, Tag } from './tag.js';

describe('Layer', () => {
	describe('Layer.service()', () => {
		it('should create a layer for a class with no dependencies', async () => {
			class Database {
				query() {
					return 'data';
				}
			}

			const layer = Layer.service(Database, []);
			const container = Container.from(layer);

			const db = await container.resolve(Database);
			expect(db.query()).toBe('data');
		});

		it('should create a layer for a class with service dependencies', async () => {
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

			const dbLayer = Layer.service(Database, []);
			const userLayer = Layer.service(UserService, [Database]);
			const appLayer = userLayer.provide(dbLayer);

			const container = Container.from(appLayer);
			const userService = await container.resolve(UserService);

			expect(userService.getUser()).toBe('db-result');
		});

		it('should create a layer for a class with ValueTag dependencies', async () => {
			const ApiKeyTag = Tag.of('apiKey')<string>();

			class ApiClient {
				constructor(private apiKey: string) {}
				getKey() {
					return this.apiKey;
				}
			}

			const apiKeyLayer = Layer.value(ApiKeyTag, 'secret-key');
			const clientLayer = Layer.service(ApiClient, [ApiKeyTag]);
			const appLayer = clientLayer.provide(apiKeyLayer);

			const container = Container.from(appLayer);
			const client = await container.resolve(ApiClient);

			expect(client.getKey()).toBe('secret-key');
		});

		it('should create a layer for a class with mixed dependencies', async () => {
			class Database {
				query() {
					return 'data';
				}
			}

			const ApiKeyTag = Tag.of('apiKey')<string>();

			class ApiService {
				constructor(
					private db: Database,
					private apiKey: string
				) {}
				getData() {
					return `${this.db.query()} with key ${this.apiKey}`;
				}
			}

			const dbLayer = Layer.service(Database, []);
			const apiKeyLayer = Layer.value(ApiKeyTag, 'my-key');
			const apiLayer = Layer.service(ApiService, [Database, ApiKeyTag]);

			const appLayer = apiLayer.provide(dbLayer).provide(apiKeyLayer);
			const container = Container.from(appLayer);

			const api = await container.resolve(ApiService);
			expect(api.getData()).toBe('data with key my-key');
		});

		it('should support raw values as dependencies', async () => {
			class Config {
				constructor(
					private port: number,
					private host: string
				) {}
				getUrl() {
					return `http://${this.host}:${this.port}`;
				}
			}

			// Pass raw values directly - no tags needed
			const configLayer = Layer.service(Config, [3000, 'localhost']);
			const container = Container.from(configLayer);

			const config = await container.resolve(Config);
			expect(config.getUrl()).toBe('http://localhost:3000');
		});

		it('should pass arrow functions through as raw values (not resolve them)', async () => {
			class EventHandler {
				constructor(private callback: () => string) {}
				handle() {
					return this.callback();
				}
			}

			// Arrow functions are NOT ServiceTags, so they're passed through as raw values
			const myCallback = () => 'callback result';

			const layer = Layer.service(EventHandler, [myCallback]);
			const container = Container.from(layer);

			const handler = await container.resolve(EventHandler);
			expect(handler.handle()).toBe('callback result');
		});

		it('should support cleanup function', async () => {
			const cleanup = vi.fn();

			class Database {
				close() {
					cleanup();
				}
			}

			const layer = Layer.service(Database, [], {
				cleanup: (db): void => {
					db.close();
				},
			});

			const container = Container.from(layer);
			await container.resolve(Database);
			await container.destroy();

			expect(cleanup).toHaveBeenCalled();
		});

		it('should work with classes extending other classes', async () => {
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

			const layer = Layer.service(ExtendedService, []);
			const container = Container.from(layer);

			const service = await container.resolve(ExtendedService);
			expect(service.base()).toBe('base');
			expect(service.extended()).toBe('extended');
		});
	});

	describe('Layer.value()', () => {
		it('should create a layer for a constant value', async () => {
			const ConfigTag = Tag.of('config')<{ port: number }>();

			const layer = Layer.value(ConfigTag, { port: 3000 });
			const container = Container.from(layer);

			const config = await container.resolve(ConfigTag);
			expect(config.port).toBe(3000);
		});

		it('should work with primitive values', async () => {
			const StringTag = Tag.of('str')<string>();
			const NumberTag = Tag.of('num')<number>();

			const layer = Layer.value(StringTag, 'hello').merge(
				Layer.value(NumberTag, 42)
			);

			const container = Container.from(layer);

			expect(await container.resolve(StringTag)).toBe('hello');
			expect(await container.resolve(NumberTag)).toBe(42);
		});

		it('should work with ServiceTags (pre-instantiated instances)', async () => {
			class UserService {
				getUsers() {
					return [{ id: 1, name: 'Alice' }];
				}
			}

			// Create a pre-instantiated instance (useful for testing/mocking)
			const mockUserService = new UserService();

			const layer = Layer.value(UserService, mockUserService);
			const container = Container.from(layer);

			const service = await container.resolve(UserService);
			expect(service).toBe(mockUserService);
			expect(service.getUsers()).toEqual([{ id: 1, name: 'Alice' }]);
		});

		it('should work with ServiceTags in layer composition', async () => {
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

			// Pre-instantiated mock instances
			const mockDb = new Database();
			const mockUserService = new UserService(mockDb);

			const testLayer = Layer.value(UserService, mockUserService).provide(
				Layer.value(Database, mockDb)
			);

			const container = Container.from(testLayer);

			const service = await container.resolve(UserService);
			expect(service).toBe(mockUserService);
			expect(service.getUsers()).toBe('data');
		});
	});

	describe('Layer.values()', () => {
		const PortTag = Tag.of('port')<number>();
		const RegionTag = Tag.of('region')<'eu' | 'us'>();
		class Logger {
			level = 'info';
		}

		it('should bind each tag to its value', async () => {
			const logger = new Logger();
			const layer = Layer.values(
				[PortTag, 3000],
				[RegionTag, 'eu'],
				[Logger, logger]
			);

			const container = Container.from(layer);

			expectTypeOf(layer).toEqualTypeOf<
				Layer<never, typeof PortTag | typeof RegionTag | typeof Logger>
			>();
			expect(
				await container.resolveAll(PortTag, RegionTag, Logger)
			).toEqual([3000, 'eu', logger]);
		});

		it("should check each value against its tag's type", () => {
			// @ts-expect-error - string is not assignable to number
			Layer.values([PortTag, '3000'], [RegionTag, 'eu']);
			// @ts-expect-error - 'asia' is not assignable to 'eu' | 'us'
			Layer.values([RegionTag, 'asia']);
		});

		it('should treat a pair binding the same value as a Layer.value() as one provider', async () => {
			const layer = Layer.values([PortTag, 3000]).merge(
				Layer.value(PortTag, 3000)
			);

			expect(await Container.from(layer).resolve(PortTag)).toBe(3000);
		});

		it('should reject one tag bound to different values', () => {
			const layer = Layer.values([PortTag, 3000], [PortTag, 4000]);

			expect(() => Container.from(layer)).toThrow(DuplicateProviderError);
		});
	});

	describe('Layer.mock()', () => {
		it('should create a layer with partial mock for ServiceTag', async () => {
			class UserService {
				constructor(private _db: Database) {}
				getUsers(): Promise<{ id: number; name: string }[]> {
					return Promise.resolve([]);
				}
				getUserById(
					_id: number
				): Promise<{ id: number; name: string } | null> {
					return Promise.resolve(null);
				}
			}

			class Database {
				query() {
					return 'data';
				}
			}

			// Partial mock - only implement methods you need, no constructor needed
			const testLayer = Layer.mock(UserService, {
				getUsers: () => Promise.resolve([{ id: 1, name: 'Alice' }]),
			});

			const container = Container.from(testLayer);
			const service = await container.resolve(UserService);

			const users = await service.getUsers();
			expect(users).toEqual([{ id: 1, name: 'Alice' }]);
		});

		it('should work with full mock instance for ServiceTag', async () => {
			class UserService {
				getUsers(): Promise<{ id: number; name: string }[]> {
					return Promise.resolve([]);
				}
			}

			const fullMock: UserService = {
				getUsers: () => Promise.resolve([{ id: 1, name: 'Bob' }]),
			};

			const testLayer = Layer.mock(UserService, fullMock);
			const container = Container.from(testLayer);

			const service = await container.resolve(UserService);
			expect(service).toBe(fullMock);
			const users = await service.getUsers();
			expect(users).toEqual([{ id: 1, name: 'Bob' }]);
		});

		it('should work with ValueTag (same as Layer.value)', async () => {
			const ConfigTag = Tag.of('config')<{ port: number }>();

			const layer = Layer.mock(ConfigTag, { port: 3000 });
			const container = Container.from(layer);

			const config = await container.resolve(ConfigTag);
			expect(config.port).toBe(3000);
		});

		it('should maintain type safety for provided methods in partial mocks', () => {
			class UserService {
				getUsers(): Promise<{ id: number; name: string }[]> {
					return Promise.resolve([]);
				}
				getUserById(
					_id: number
				): Promise<{ id: number; name: string } | null> {
					return Promise.resolve(null);
				}
			}

			// Valid - correct return type
			Layer.mock(UserService, {
				getUsers: () => Promise.resolve([{ id: 1, name: 'Alice' }]),
			});

			// TypeScript will catch type mismatches in actual usage
			// (Partial<T> allows flexibility for testing, but runtime behavior is type-safe)
			expect(true).toBe(true);
		});

		it('should work in layer composition with partial mocks', async () => {
			class Database {
				query(): string {
					return 'data';
				}
			}

			class UserService {
				constructor(private _db: Database) {}
				getUsers(): Promise<{ id: number; name: string }[]> {
					return Promise.resolve([]);
				}
			}

			// Partial mock for UserService, full mock for Database
			const testLayer = Layer.mock(UserService, {
				getUsers: () => Promise.resolve([{ id: 1, name: 'Test' }]),
			}).provide(Layer.mock(Database, { query: () => 'mocked' }));

			const container = Container.from(testLayer);

			const service = await container.resolve(UserService);
			const users = await service.getUsers();
			expect(users).toEqual([{ id: 1, name: 'Test' }]);
		});
	});

	describe('Layer.create()', () => {
		it('should create a custom layer with no dependencies', async () => {
			class Database {
				query() {
					return 'data';
				}
			}

			// TProvides inferred from builder.add() return type
			const layer = Layer.create({
				requires: [],
				apply: (builder) => builder.add(Database, () => new Database()),
			});

			const container = Container.from(layer);
			const db = await container.resolve(Database);

			expect(db.query()).toBe('data');
		});

		it('should create a custom layer with dependencies', async () => {
			class Database {
				query() {
					return 'data';
				}
			}

			class Cache {
				constructor(
					private db: Database,
					private ttl: number
				) {}
				get() {
					return `cached: ${this.db.query()} (ttl: ${this.ttl})`;
				}
			}

			const dbLayer = Layer.service(Database, []);

			// TProvides (Cache) inferred from builder.add() return type
			const cacheLayer = Layer.create({
				requires: [Database],
				apply: (builder) =>
					builder.add(Cache, async (ctx) => {
						const db = await ctx.resolve(Database);
						return new Cache(db, 3600);
					}),
			});

			const appLayer = cacheLayer.provide(dbLayer);
			const container = Container.from(appLayer);

			const cache = await container.resolve(Cache);
			expect(cache.get()).toBe('cached: data (ttl: 3600)');
		});

		it('should support multiple provides (inferred from chained adds)', async () => {
			// Classes must have DIFFERENT structures to be distinguishable by TypeScript
			class ServiceA {
				a(): string {
					return 'A';
				}
			}
			class ServiceB {
				b(): string {
					return 'B';
				}
			}
			class ServiceC {
				c(): string {
					return 'C';
				}
			}

			// Both ServiceA and ServiceB inferred from chained builder.add() calls
			const layer = Layer.create({
				requires: [ServiceC],
				apply: (builder) =>
					builder
						.add(ServiceA, () => new ServiceA())
						.add(ServiceB, () => new ServiceB()),
			});

			const container = Container.from(
				layer.provide(Layer.service(ServiceC, []))
			);
			const a = await container.resolve(ServiceA);
			const b = await container.resolve(ServiceB);

			expect(a.a()).toBe('A');
			expect(b.b()).toBe('B');
		});
	});

	describe('Layer.empty()', () => {
		it('should create an empty layer', () => {
			const layer = Layer.empty();
			const container = Container.from(layer);

			expect(container).toBeDefined();
		});

		it('should be mergeable with other layers', async () => {
			class Database {}

			const layer = Layer.empty().merge(Layer.service(Database, []));
			const container = Container.from(layer);

			const db = await container.resolve(Database);
			expect(db).toBeInstanceOf(Database);
		});
	});

	describe('provide()', () => {
		it('should satisfy requirements', async () => {
			class Config {
				url = 'localhost';
			}

			class Database {
				constructor(private config: Config) {}
				getUrl() {
					return this.config.url;
				}
			}

			const configLayer = Layer.service(Config, []);
			const dbLayer = Layer.service(Database, [Config]);

			// dbLayer requires Config, configLayer provides it
			const appLayer = dbLayer.provide(configLayer);

			const container = Container.from(appLayer);
			const db = await container.resolve(Database);

			expect(db.getUrl()).toBe('localhost');
		});

		it('should only expose target provisions (not dependency)', async () => {
			class Config {}
			class Database {
				constructor(private _config: Config) {}
			}

			const configLayer = Layer.service(Config, []);
			const dbLayer = Layer.service(Database, [Config]);

			const appLayer = dbLayer.provide(configLayer);
			const container = Container.from(appLayer);

			// Database should be resolvable (Config is registered internally)
			expect(await container.resolve(Database)).toBeInstanceOf(Database);

			// Config is NOT exposed at the type level - the following would be a compile error:
			// container.resolve(Config) // TypeScript error: Config not in Container's TTags
		});

		it('should chain multiple provides', async () => {
			class Config {
				port = 3000;
			}
			class Database {
				constructor(private config: Config) {}
				getPort() {
					return this.config.port;
				}
			}
			class UserService {
				constructor(private db: Database) {}
				getPort() {
					return this.db.getPort();
				}
			}

			const configLayer = Layer.service(Config, []);
			const dbLayer = Layer.service(Database, [Config]);
			const userLayer = Layer.service(UserService, [Database]);

			const appLayer = userLayer.provide(dbLayer).provide(configLayer);

			const container = Container.from(appLayer);
			const userService = await container.resolve(UserService);

			expect(userService.getPort()).toBe(3000);
		});
	});

	describe('merge()', () => {
		it('should combine independent layers', async () => {
			class Database {}
			class Cache {}
			class Logger {}

			const dbLayer = Layer.service(Database, []);
			const cacheLayer = Layer.service(Cache, []);
			const loggerLayer = Layer.service(Logger, []);

			const infraLayer = dbLayer.merge(cacheLayer).merge(loggerLayer);

			const container = Container.from(infraLayer);

			expect(await container.resolve(Database)).toBeInstanceOf(Database);
			expect(await container.resolve(Cache)).toBeInstanceOf(Cache);
			expect(await container.resolve(Logger)).toBeInstanceOf(Logger);
		});

		it('should combine requirements from both layers', async () => {
			class Config {}
			class Database {
				constructor(private _config: Config) {}
			}
			class Cache {
				constructor(private _config: Config) {}
			}

			const dbLayer = Layer.service(Database, [Config]);
			const cacheLayer = Layer.service(Cache, [Config]);

			// Both require Config
			const persistenceLayer = dbLayer.merge(cacheLayer);

			// Must provide Config to satisfy requirements
			const configLayer = Layer.service(Config, []);
			const appLayer = persistenceLayer.provide(configLayer);

			const container = Container.from(appLayer);

			expect(await container.resolve(Database)).toBeInstanceOf(Database);
			expect(await container.resolve(Cache)).toBeInstanceOf(Cache);
		});

		it('should subtract internally satisfied requirements (smart-merge)', async () => {
			class Config {
				port = 3000;
			}
			class Database {
				constructor(private config: Config) {}
				getPort() {
					return this.config.port;
				}
			}

			const configLayer = Layer.service(Config, []);
			const dbLayer = Layer.service(Database, [Config]);

			// dbLayer requires Config; configLayer provides it.
			// merge wires them automatically and exposes both provisions.
			const infraLayer = dbLayer.merge(configLayer);

			const container = Container.from(infraLayer);

			const config = await container.resolve(Config);
			const db = await container.resolve(Database);

			expect(config.port).toBe(3000);
			expect(db.getPort()).toBe(3000);
		});

		it('should wire dependencies regardless of merge order', async () => {
			class Config {
				port = 3000;
			}
			class Database {
				constructor(private config: Config) {}
				getPort() {
					return this.config.port;
				}
			}

			const configLayer = Layer.service(Config, []);
			const dbLayer = Layer.service(Database, [Config]);

			// Same as above but with arguments reversed - smart-merge is order-agnostic
			const infraLayer = configLayer.merge(dbLayer);

			const container = Container.from(infraLayer);
			const db = await container.resolve(Database);

			expect(db.getPort()).toBe(3000);
		});
	});

	describe('Layer.merge()', () => {
		it('should merge two layers (static method)', async () => {
			class ServiceA {}
			class ServiceB {}

			const layerA = Layer.service(ServiceA, []);
			const layerB = Layer.service(ServiceB, []);

			const merged = Layer.merge(layerA, layerB);
			const container = Container.from(merged);

			expect(await container.resolve(ServiceA)).toBeInstanceOf(ServiceA);
			expect(await container.resolve(ServiceB)).toBeInstanceOf(ServiceB);
		});
	});

	describe('Layer.mergeAll()', () => {
		it('should merge multiple layers', async () => {
			class ServiceA {}
			class ServiceB {}
			class ServiceC {}

			const layerA = Layer.service(ServiceA, []);
			const layerB = Layer.service(ServiceB, []);
			const layerC = Layer.service(ServiceC, []);

			const merged = Layer.mergeAll(layerA, layerB, layerC);
			const container = Container.from(merged);

			expect(await container.resolve(ServiceA)).toBeInstanceOf(ServiceA);
			expect(await container.resolve(ServiceB)).toBeInstanceOf(ServiceB);
			expect(await container.resolve(ServiceC)).toBeInstanceOf(ServiceC);
		});
	});

	describe('build semantics', () => {
		class Logger {}
		class ServiceA {
			constructor(public logger: Logger) {}
		}
		class ServiceB {
			constructor(public logger: Logger) {}
		}

		it('should apply a layer reached through several paths once', async () => {
			let registrations = 0;
			const loggerLayer = Layer.create({
				requires: [],
				apply: (builder) => {
					registrations++;
					return builder.add(Logger, () => new Logger());
				},
			});
			const aLayer = Layer.service(ServiceA, [Logger]).provide(
				loggerLayer
			);
			const bLayer = Layer.service(ServiceB, [Logger]).provide(
				loggerLayer
			);

			const container = Container.from(
				aLayer.merge(bLayer).merge(loggerLayer)
			);
			const [a, b] = await container.resolveAll(ServiceA, ServiceB);

			expect(registrations).toBe(1);
			expect(a.logger).toBe(b.logger);
		});

		it('should throw DuplicateProviderError when two different layers provide one tag', () => {
			const layer = Layer.service(Logger, []).merge(
				Layer.service(Logger, [])
			);

			expect(() => Container.from(layer)).toThrow(DuplicateProviderError);
		});

		it('should name both definition sites in the error', () => {
			const layer = Layer.service(Logger, []).merge(
				Layer.service(Logger, [])
			);

			expect(() => Container.from(layer)).toThrow(
				/Logger" has more than one provider\n {2}- .*layer\.test\.ts:\d+:\d+.*\n {2}- .*layer\.test\.ts:\d+:\d+/
			);
		});

		it('should detect a conflict hidden inside provide()', () => {
			const aLayer = Layer.service(ServiceA, [Logger]).provide(
				Layer.service(Logger, [])
			);
			const bLayer = Layer.service(ServiceB, [Logger]).provide(
				Layer.service(Logger, [])
			);

			expect(() => Container.from(aLayer.merge(bLayer))).toThrow(
				DuplicateProviderError
			);
		});

		it('should treat bindings of one tag to the same value as one provider', async () => {
			const PortTag = Tag.of('port')<number>();
			const layer = Layer.value(PortTag, 3000).merge(
				Layer.value(PortTag, 3000)
			);

			const container = Container.from(layer);

			expect(await container.resolve(PortTag)).toBe(3000);
		});

		it('should reject bindings of one tag to different values', () => {
			const PortTag = Tag.of('port')<number>();
			const layer = Layer.value(PortTag, 3000).merge(
				Layer.value(PortTag, 4000)
			);

			expect(() => Container.from(layer)).toThrow(DuplicateProviderError);
		});

		it('should reject a layer providing a tag the builder already has', () => {
			const builder = Container.builder().add(Logger, () => new Logger());

			expect(() => Layer.service(Logger, []).apply(builder)).toThrow(
				DuplicateProviderError
			);
		});

		it('should let a child scope shadow a parent provider', async () => {
			const NameTag = Tag.of('name')<string>();
			const parent = ScopedContainer.from(
				'app',
				Layer.value(NameTag, 'parent')
			);

			const child = parent.childFrom(
				'request',
				Layer.value(NameTag, 'child')
			);

			expect(await child.resolve(NameTag)).toBe('child');
			expect(await parent.resolve(NameTag)).toBe('parent');
		});
	});

	describe('override()', () => {
		class ExchangeRates {
			rate(): number {
				return 1;
			}
		}
		class Pricing {
			constructor(public rates: ExchangeRates) {}
		}
		class Checkout {
			constructor(public pricing: Pricing) {}
		}

		const pricingLayer = Layer.service(Pricing, [ExchangeRates]).provide(
			Layer.service(ExchangeRates, [])
		);
		const checkoutLayer = Layer.service(Checkout, [Pricing]).provide(
			pricingLayer
		);
		const fakeRates = (value: number) =>
			Layer.mock(ExchangeRates, { rate: () => value });

		it('should replace a provider nested anywhere in the composition', async () => {
			const container = Container.from(
				checkoutLayer.override(fakeRates(42))
			);

			const checkout = await container.resolve(Checkout);

			expect(checkout.pricing.rates.rate()).toBe(42);
		});

		it('should win regardless of position in the chain', async () => {
			const layer = Layer.service(Checkout, [Pricing])
				.override(fakeRates(42))
				.provide(pricingLayer);

			const checkout = await Container.from(layer).resolve(Checkout);

			expect(checkout.pricing.rates.rate()).toBe(42);
		});

		it("should keep the replacement's own dependencies as ordinary providers", async () => {
			const RateTag = Tag.of('rate')<number>();
			const configurableRates = Layer.create({
				requires: [RateTag],
				apply: (builder) =>
					builder.add(ExchangeRates, async (ctx) => {
						const rate = await ctx.resolve(RateTag);
						return { rate: () => rate };
					}),
			}).provide(Layer.value(RateTag, 7));

			const checkout = await Container.from(
				checkoutLayer.override(configurableRates)
			).resolve(Checkout);

			expect(checkout.pricing.rates.rate()).toBe(7);
		});

		it('should accept the same override layer reached through several paths', async () => {
			const fake = fakeRates(42);
			const layer = checkoutLayer
				.override(fake)
				.merge(pricingLayer.override(fake));

			const pricing = await Container.from(layer).resolve(Pricing);

			expect(pricing.rates.rate()).toBe(42);
		});

		it('should throw OverrideTargetNotFoundError when nothing else provides the tag', () => {
			const layer = Layer.service(Checkout, [Pricing])
				.provide(Layer.mock(Pricing, {}))
				.override(fakeRates(42));

			expect(() => Container.from(layer)).toThrow(
				OverrideTargetNotFoundError
			);
		});

		it('should throw DuplicateOverrideError for two overrides of one tag', () => {
			const layer = checkoutLayer
				.override(fakeRates(1))
				.override(fakeRates(2));

			expect(() => Container.from(layer)).toThrow(DuplicateOverrideError);
		});

		it('should only replace providers within the child scope being built', async () => {
			const parent = ScopedContainer.from('app', pricingLayer);
			const parentPricing = await parent.resolve(Pricing);

			const child = parent.childFrom(
				'request',
				pricingLayer.override(fakeRates(42))
			);

			expect((await child.resolve(Pricing)).rates.rate()).toBe(42);
			expect(await parent.resolve(Pricing)).toBe(parentPricing);
			expect(parentPricing.rates.rate()).toBe(1);
		});

		it('should not override a provider that only the parent scope has', () => {
			const parent = ScopedContainer.from(
				'app',
				Layer.service(ExchangeRates, [])
			);

			expect(() =>
				parent.childFrom(
					'request',
					Layer.service(Pricing, [ExchangeRates]).override(
						fakeRates(42)
					)
				)
			).toThrow(OverrideTargetNotFoundError);
		});

		it("should keep the replaced provider's requirements in the type", () => {
			const SourceTag = Tag.of('source')<string>();
			class SourcedRates extends ExchangeRates {
				constructor(public source: string) {
					super();
				}
			}
			const layer = Layer.service(Pricing, [SourcedRates])
				.provide(Layer.service(SourcedRates, [SourceTag]))
				.override(Layer.mock(SourcedRates, { rate: () => 2 }));

			expectTypeOf(layer).toEqualTypeOf<
				Layer<typeof SourceTag, typeof Pricing>
			>();
		});
	});

	describe('Layer.unused()', () => {
		const SourceTag = Tag.of('source')<string>();
		const RegionTag = Tag.of('region')<string>();

		it('should provide the given tags at the type level', () => {
			expectTypeOf(Layer.unused(SourceTag, RegionTag)).toEqualTypeOf<
				Layer<never, typeof SourceTag | typeof RegionTag>
			>();
		});

		it('should satisfy requirements left by an override', async () => {
			class Rates {
				constructor(public source: string) {}
				rate(): number {
					return 1;
				}
			}
			class Pricing {
				constructor(public rates: Rates) {}
			}
			const layer = Layer.service(Pricing, [Rates])
				.provide(Layer.service(Rates, [SourceTag]))
				.override(Layer.mock(Rates, { rate: () => 2 }))
				.provide(Layer.unused(SourceTag));

			const pricing = await Container.from(layer).resolve(Pricing);

			expect(pricing.rates.rate()).toBe(2);
		});

		it('should fail resolution of a placeholder', async () => {
			const container = Container.from(Layer.unused(SourceTag));

			const error = await container
				.resolve(SourceTag)
				.catch((err: unknown) => err);

			expect(error).toBeInstanceOf(DependencyCreationError);
			expect(
				(error as DependencyCreationError).getRootCause()
			).toBeInstanceOf(UnusedDependencyResolvedError);
		});

		it('should conflict with a real provider of the same tag', () => {
			const layer = Layer.unused(SourceTag).merge(
				Layer.value(SourceTag, 'feed')
			);

			expect(() => Container.from(layer)).toThrow(DuplicateProviderError);
		});
	});

	describe('Layer.singleton()', () => {
		class Config {
			url = 'postgres://localhost';
		}
		class Database {
			constructor(public config: Config) {}
		}
		class UserService {
			constructor(public db: Database) {}
		}

		const configLayer = Layer.value(Config, new Config());
		const database = Layer.singleton(Database, [Config]);
		const userService = Layer.service(UserService, [Database]);

		it('should carry a Root requirement through composition', () => {
			expectTypeOf(database).toEqualTypeOf<
				Layer<typeof Config | Root<typeof Database>, typeof Database>
			>();
			expectTypeOf(userService.provide(database)).toEqualTypeOf<
				Layer<typeof Config | Root<typeof Database>, typeof UserService>
			>();
		});

		it('should build into a root container', async () => {
			const container = Container.from(
				userService.provide(database).provide(configLayer)
			);
			const scoped = ScopedContainer.from(
				'app',
				database.provide(configLayer)
			);

			expect((await container.resolve(UserService)).db).toBeInstanceOf(
				Database
			);
			expect(await scoped.resolve(Database)).toBeInstanceOf(Database);
		});

		it("should let a child scope resolve the root's instance", async () => {
			const app = ScopedContainer.from(
				'app',
				database.provide(configLayer)
			);

			const request = app.childFrom('request', userService);

			expect((await request.resolve(UserService)).db).toBe(
				await app.resolve(Database)
			);
		});

		it('should reject a child scope layer containing a singleton', () => {
			const app = ScopedContainer.from('app', configLayer);

			expect(() =>
				// @ts-expect-error - SingletonInChildScope<typeof Database>
				app.childFrom('request', userService.provide(database))
			).toThrow(SingletonInChildScopeError);
		});

		it('should name the singleton and its definition site in the error', () => {
			const app = ScopedContainer.from('app', configLayer);

			expect(() =>
				// @ts-expect-error - SingletonInChildScope<typeof Database>
				app.childFrom('request', database)
			).toThrow(
				/Singleton "Database" cannot be built in a child scope\n {2}- .*layer\.test\.ts:\d+:\d+/
			);
		});

		it('should reject a singleton applied to a child builder directly', () => {
			const app = ScopedContainer.from('app', configLayer);

			expect(() => database.apply(app.child('request'))).toThrow(
				SingletonInChildScopeError
			);
		});

		it('should reject a singleton in a child scope even when an override replaces it', () => {
			const app = ScopedContainer.from('app', configLayer);
			const layer = userService
				.provide(database)
				.override(Layer.mock(Database, {}));

			// @ts-expect-error - SingletonInChildScope<typeof Database>
			expect(() => app.childFrom('request', layer)).toThrow(
				SingletonInChildScopeError
			);
		});

		it('should wrap an existing layer', async () => {
			const databaseFactory = Layer.create({
				requires: [Config],
				apply: (builder) =>
					builder.add(
						Database,
						async (ctx) => new Database(await ctx.resolve(Config))
					),
			});
			const wrapped = Layer.singleton(databaseFactory);

			expectTypeOf(wrapped).toEqualTypeOf<
				Layer<typeof Config | Root<typeof Database>, typeof Database>
			>();
			const app = ScopedContainer.from(
				'app',
				wrapped.provide(configLayer)
			);
			expect(await app.resolve(Database)).toBeInstanceOf(Database);
			expect(() =>
				// @ts-expect-error - SingletonInChildScope<typeof Database>
				app.childFrom('request', wrapped)
			).toThrow(SingletonInChildScopeError);
		});

		it('should leave the wrapped layer usable on its own', async () => {
			const databaseLayer = Layer.service(Database, [Config]);
			const layer = Layer.singleton(databaseLayer)
				.merge(userService.provide(databaseLayer))
				.provide(configLayer);
			const app = ScopedContainer.from('app', layer);

			const request = app.childFrom(
				'request',
				databaseLayer.provide(configLayer)
			);

			expect((await app.resolve(UserService)).db).toBe(
				await app.resolve(Database)
			);
			expect(await request.resolve(Database)).not.toBe(
				await app.resolve(Database)
			);
		});

		it('should run the cleanup of a class singleton', async () => {
			const cleanup = vi.fn();
			const container = Container.from(
				Layer.singleton(Database, [Config], { cleanup }).provide(
					configLayer
				)
			);
			const db = await container.resolve(Database);

			await container.destroy();

			expect(cleanup).toHaveBeenCalledWith(db);
		});
	});

	describe('requirement checks', () => {
		class Config {
			url = 'postgres://localhost';
		}
		class Logger {
			level = 'info';
		}
		class Database {
			constructor(public config: Config) {}
		}
		class AuditLog {
			constructor(public logger: Logger) {}
		}

		it('should name the missing dependencies of a root layer', () => {
			expectTypeOf<
				SatisfiedAtRoot<typeof Config | Root<typeof Database>>
			>().toEqualTypeOf<MissingDependencies<typeof Config>>();
			expectTypeOf<
				SatisfiedAtRoot<Root<typeof Database>>
			>().toEqualTypeOf<unknown>();
		});

		it('should name the missing dependencies and singletons of a child layer', () => {
			expectTypeOf<
				SatisfiedByParent<
					typeof Config | typeof Logger | Root<typeof Database>,
					typeof Logger
				>
			>().toEqualTypeOf<
				MissingDependencies<typeof Config> &
					SingletonInChildScope<typeof Database>
			>();
			expectTypeOf<
				SatisfiedByParent<typeof Logger, typeof Logger>
			>().toEqualTypeOf<unknown>();
		});

		it('should accept untyped layers', () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expectTypeOf<SatisfiedAtRoot<any>>().toEqualTypeOf<unknown>();
			expectTypeOf<
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				SatisfiedByParent<any, typeof Logger>
			>().toEqualTypeOf<unknown>();
		});

		it('should let a generic wrapper forward the child check', async () => {
			function scoped<
				TParentTags extends AnyTag,
				TRequires extends AnyTag,
				TProvides extends AnyTag,
			>(
				parent: ScopedContainer<TParentTags>,
				layer: ChildLayer<TRequires, TProvides, TParentTags>
			) {
				return parent.childFrom('scoped', layer);
			}
			const app = ScopedContainer.from(
				'app',
				Layer.value(Config, new Config())
			);

			const child = scoped(app, Layer.service(Database, [Config]));

			expect(await child.resolve(Database)).toBeInstanceOf(Database);
			// @ts-expect-error - MissingDependencies<typeof Logger>
			scoped(app, Layer.service(AuditLog, [Logger]));
			expect(() =>
				scoped(
					app,
					// @ts-expect-error - SingletonInChildScope<typeof Database>
					Layer.singleton(Database, [Config])
				)
			).toThrow(SingletonInChildScopeError);
		});

		it('should let a generic wrapper forward the root check', async () => {
			function root<TRequires extends AnyTag, TProvides extends AnyTag>(
				layer: RootLayer<TRequires, TProvides>
			) {
				return Container.from(layer);
			}

			const app = root(
				Layer.singleton(Database, [Config]).provide(
					Layer.value(Config, new Config())
				)
			);

			expect(await app.resolve(Database)).toBeInstanceOf(Database);
			// @ts-expect-error - MissingDependencies<typeof Config>
			root(Layer.service(Database, [Config]));
		});
	});

	describe('Container.from()', () => {
		it('should create container from layer', async () => {
			class Database {}

			const layer = Layer.service(Database, []);
			const container = Container.from(layer);

			expect(await container.resolve(Database)).toBeInstanceOf(Database);
		});

		it('should work with composed layers', async () => {
			class Config {
				url = 'localhost';
			}
			class Database {
				constructor(private config: Config) {}
				getUrl() {
					return this.config.url;
				}
			}
			class UserService {
				constructor(private db: Database) {}
				getDbUrl() {
					return this.db.getUrl();
				}
			}

			const appLayer = Layer.service(UserService, [Database])
				.provide(Layer.service(Database, [Config]))
				.provide(Layer.service(Config, []));

			const container = Container.from(appLayer);
			const userService = await container.resolve(UserService);

			expect(userService.getDbUrl()).toBe('localhost');
		});
	});

	describe('Container.from()', () => {
		it('should create container from fully resolved layer', async () => {
			class Config {
				url = 'localhost';
			}
			class Database {
				constructor(private config: Config) {}
			}

			// Layer with no requirements (fully resolved)
			const configLayer = Layer.service(Config, []);
			const dbLayer = Layer.service(Database, [Config]);
			const appLayer = dbLayer.provide(configLayer);

			const container = Container.from(appLayer);

			expect(await container.resolve(Database)).toBeInstanceOf(Database);
		});

		it('should reject layer with unsatisfied requirements at compile time', () => {
			class Config {
				url = 'localhost';
			}
			class Database {
				constructor(private _config: Config) {}
			}

			// Layer with requirements (NOT fully resolved)
			const layerWithRequirements = Layer.service(Database, [Config]);

			// @ts-expect-error - Layer<typeof Config, typeof Database> is not assignable to Applicable<never, ...>
			Container.from(layerWithRequirements);

			expect(true).toBe(true);
		});

		it('should reject layer with requirements for ScopedContainer.from() at compile time', () => {
			class Config {
				url = 'localhost';
			}
			class Database {
				constructor(private _config: Config) {}
			}

			const layerWithRequirements = Layer.service(Database, [Config]);

			// @ts-expect-error - Layer with requirements should not be accepted
			ScopedContainer.from('app', layerWithRequirements);

			expect(true).toBe(true);
		});
	});

	describe('realistic application example', () => {
		it('should support typical 3-tier architecture', async () => {
			// Config layer
			const ConfigTag = Tag.of('Config')<{
				dbUrl: string;
				apiKey: string;
			}>();
			const configLayer = Layer.value(ConfigTag, {
				dbUrl: 'postgres://localhost',
				apiKey: 'secret',
			});

			// Infrastructure layer
			class Database {
				constructor(private config: { dbUrl: string }) {}
				query() {
					return `Query to ${this.config.dbUrl}`;
				}
			}

			class Cache {
				private data = new Map<string, string>();
				get(key: string) {
					return this.data.get(key);
				}
				set(key: string, value: string) {
					this.data.set(key, value);
				}
			}

			const dbLayer = Layer.create({
				requires: [ConfigTag],
				apply: (builder) =>
					builder.add(Database, async (ctx) => {
						const config = await ctx.resolve(ConfigTag);
						return new Database({ dbUrl: config.dbUrl });
					}),
			});

			const cacheLayer = Layer.service(Cache, []);

			const infraLayer = Layer.mergeAll(dbLayer, cacheLayer);

			// Service layer
			class UserService {
				constructor(
					private db: Database,
					private cache: Cache
				) {}
				getUser(id: string) {
					const cached = this.cache.get(id);
					if (cached !== undefined) return cached;
					const result = this.db.query();
					this.cache.set(id, result);
					return result;
				}
			}

			const userServiceLayer = Layer.service(UserService, [
				Database,
				Cache,
			]);

			// Compose application
			const appLayer = userServiceLayer
				.provide(infraLayer)
				.provide(configLayer);

			const container = Container.from(appLayer);
			const userService = await container.resolve(UserService);

			expect(userService.getUser('1')).toBe(
				'Query to postgres://localhost'
			);
		});
	});

	describe('type safety (compile-time)', () => {
		it('should accept correct service dependencies', () => {
			class Database {}
			class UserService {
				constructor(private db: Database) {}
			}

			// Valid: class tag matching constructor param
			Layer.service(UserService, [Database]);

			expect(true).toBe(true);
		});

		it('should accept ValueTag matching constructor param type', () => {
			const ApiKeyTag = Tag.of('apiKey')<string>();

			class ApiClient {
				constructor(private apiKey: string) {}
			}

			// Valid: ValueTag<string> for string param
			Layer.service(ApiClient, [ApiKeyTag]);

			expect(true).toBe(true);
		});

		it('should accept raw values matching constructor param type', () => {
			class Config {
				constructor(
					private port: number,
					private host: string
				) {}
			}

			// Valid: raw values matching param types
			Layer.service(Config, [3000, 'localhost']);

			expect(true).toBe(true);
		});

		it('should accept mixed tags and raw values', () => {
			class Database {}
			const PortTag = Tag.of('port')<number>();

			class Server {
				constructor(
					private db: Database,
					private port: number,
					private name: string
				) {}
			}

			// Valid: mix of class tag, value tag, and raw value
			Layer.service(Server, [Database, PortTag, 'my-server']);

			expect(true).toBe(true);
		});

		it('should accept a ValueTag whose value type is a string union (no naked-conditional distribution)', async () => {
			// Regression test: previously `T extends object ? ... : ValueTag<any, T>`
			// distributed over `T = 'SANDBOX' | 'PRODUCTION'`, producing
			// `ValueTag<any, 'SANDBOX'> | ValueTag<any, 'PRODUCTION'>`. Since
			// ValueTag is invariant in its value parameter, the union-typed tag
			// would not be assignable to either branch. Wrapping in a tuple
			// (`[T] extends [object]`) prevents distribution.
			type Environment = 'SANDBOX' | 'PRODUCTION';
			const EnvironmentTag = Tag.of('Environment')<Environment>();

			class EnvAwareService {
				constructor(private env: Environment) {}
				current(): Environment {
					return this.env;
				}
			}

			// This should compile without error.
			const layer = Layer.service(EnvAwareService, [
				EnvironmentTag,
			]).provide(Layer.value(EnvironmentTag, 'SANDBOX'));

			const container = Container.from(layer);
			const service = await container.resolve(EnvAwareService);
			expect(service.current()).toBe('SANDBOX');
		});

		it('should accept a ValueTag whose value type is a primitive union', () => {
			const FlagTag = Tag.of('flag')<string | number>();

			class FlagConsumer {
				constructor(private _flag: string | number) {}
			}

			// Should compile without error.
			Layer.service(FlagConsumer, [FlagTag]);
			expect(true).toBe(true);
		});

		it('should accept a ServiceTag for a nullable class parameter', async () => {
			// Regression test: when a constructor parameter is typed as a
			// nullable class (e.g. `Cache | null`), `[T] extends [object]`
			// evaluates to `false` because `null`/`undefined` aren't `object`.
			// `ValidDepFor` now strips nullability via `NonNullable<T>` before
			// the object check, so the `ServiceTag` branch still applies.
			class Cache {
				get(key: string): string {
					return `cached:${key}`;
				}
			}

			class CachedService {
				constructor(
					private name: string,
					private cache: Cache | null = null
				) {}
				lookup(): string {
					return (
						this.cache?.get(this.name) ?? `no-cache:${this.name}`
					);
				}
			}

			// Passing the class as a ServiceTag must compile, even though the
			// declared parameter type is `Cache | null`.
			const layer = Layer.service(CachedService, [
				'hello',
				Cache,
			]).provide(Layer.service(Cache, []));

			const container = Container.from(layer);
			const service = await container.resolve(CachedService);
			expect(service.lookup()).toBe('cached:hello');
		});

		it('should reject wrong type in deps array', () => {
			// Classes must have properties/methods - empty classes are structurally
			// equivalent to {} and accept primitives in TypeScript
			class Database {
				query(): string {
					return 'result';
				}
			}
			class UserService {
				constructor(private db: Database) {}
			}

			// @ts-expect-error - number is not valid for Database param
			Layer.service(UserService, [123]);

			expect(true).toBe(true);
		});

		it('should reject wrong number of dependencies', () => {
			class Database {}
			class UserService {
				constructor(private db: Database) {}
			}

			// @ts-expect-error - missing required dependency
			Layer.service(UserService, []);

			// @ts-expect-error - too many dependencies
			Layer.service(UserService, [Database, Database]);

			expect(true).toBe(true);
		});

		it('should reject ValueTag with wrong type', () => {
			const NumberTag = Tag.of('num')<number>();

			class ApiClient {
				constructor(private apiKey: string) {}
			}

			// @ts-expect-error - ValueTag<number> doesn't match string param
			Layer.service(ApiClient, [NumberTag]);

			expect(true).toBe(true);
		});

		it('should reject ServiceTag with wrong instance type', () => {
			// Classes must have different structures for TypeScript to distinguish them
			// (empty classes are structurally equivalent)
			class Database {
				query(): string {
					return 'result';
				}
			}
			class Logger {
				log(_msg: string): void {
					// Different structure than Database
				}
			}

			class UserService {
				constructor(private db: Database) {}
			}

			// @ts-expect-error - Logger instance is not assignable to Database
			Layer.service(UserService, [Logger]);

			expect(true).toBe(true);
		});

		it('should validate ValueTag types in Layer.value', () => {
			const StringTag = Tag.of('str')<string>();

			// Valid
			Layer.value(StringTag, 'hello');

			// @ts-expect-error - number is not assignable to string
			Layer.value(StringTag, 123);

			expect(true).toBe(true);
		});

		it('should validate ServiceTag types in Layer.value', () => {
			class UserService {
				getUsers() {
					return [];
				}
			}

			class Database {
				query() {
					return 'data';
				}
			}

			// Valid - correct instance type
			Layer.value(UserService, new UserService());

			// @ts-expect-error - Database instance is not assignable to UserService
			Layer.value(UserService, new Database());

			expect(true).toBe(true);
		});

		it('should track requirements through composition', async () => {
			class A {}
			class B {
				constructor(private _a: A) {}
			}
			class C {
				constructor(private _b: B) {}
			}

			const aLayer = Layer.service(A, []);
			const bLayer = Layer.service(B, [A]);
			const cLayer = Layer.service(C, [B]);

			// Partial composition - still has requirements
			const bcLayer = cLayer.provide(bLayer);
			// bcLayer requires A

			// Full composition - no requirements
			const appLayer = bcLayer.provide(aLayer);
			// appLayer requires nothing

			const container = Container.from(appLayer);
			expect(await container.resolve(C)).toBeInstanceOf(C);
		});
	});

	describe('type inference (expectTypeOf)', () => {
		it('should infer correct Layer type from Layer.service', () => {
			class Database {
				query(): string {
					return '';
				}
			}
			class UserService {
				constructor(private _db: Database) {}
			}

			const dbLayer = Layer.service(Database, []);
			const userLayer = Layer.service(UserService, [Database]);

			expectTypeOf(dbLayer).toEqualTypeOf<
				Layer<never, typeof Database>
			>();
			expectTypeOf(userLayer).toEqualTypeOf<
				Layer<typeof Database, typeof UserService>
			>();
		});

		it('should infer correct Layer type from Layer.value', () => {
			const ConfigTag = Tag.of('config')<{ url: string }>();

			const configLayer = Layer.value(ConfigTag, { url: 'localhost' });

			expectTypeOf(configLayer).toEqualTypeOf<
				Layer<never, typeof ConfigTag>
			>();
		});

		it('should infer correct Layer type from Layer.create', () => {
			class Database {
				query(): string {
					return '';
				}
			}
			class Cache {
				get(): string {
					return '';
				}
			}

			// TProvides (Cache) inferred from builder.add() return type
			const layer = Layer.create({
				requires: [Database],
				apply: (builder) => builder.add(Cache, () => new Cache()),
			});

			expectTypeOf(layer).toEqualTypeOf<
				Layer<typeof Database, typeof Cache>
			>();
		});

		it('should infer Layer<never, never> when apply adds nothing', () => {
			// If apply just returns the builder without adding anything,
			// TProvides should be inferred as never
			const layer = Layer.create({
				requires: [],
				apply: (builder) => builder,
			});

			expectTypeOf(layer).toEqualTypeOf<Layer<never, never>>();
		});

		it('should correctly infer complex Layer.create with multiple requires and provides', () => {
			// ServiceTags with distinct structures
			class Database {
				query(): string {
					return 'data';
				}
			}
			class Cache {
				get(): string {
					return 'cached';
				}
			}
			class UserService {
				serve(): string {
					return 'serving';
				}
			}

			// ValueTags
			const ConfigTag = Tag.of('config')<{ url: string }>();
			const ApiKeyTag = Tag.of('apiKey')<string>();

			// Layer with multiple requires (ServiceTag + ValueTag) and multiple provides (ServiceTag + ValueTag)
			const complexLayer = Layer.create({
				requires: [Database, ConfigTag],
				apply: (builder) =>
					builder
						.add(Cache, () => new Cache())
						.add(UserService, () => new UserService())
						.add(ApiKeyTag, () => 'secret-key'),
			});

			// TRequires = typeof Database | typeof ConfigTag
			// TProvides = typeof Cache | typeof UserService | typeof ApiKeyTag
			// (Database and ConfigTag are excluded from provisions)
			expectTypeOf(complexLayer).toEqualTypeOf<
				Layer<
					typeof Database | typeof ConfigTag,
					typeof Cache | typeof UserService | typeof ApiKeyTag
				>
			>();
		});

		it('should infer correct Container type from Container.from', () => {
			class Database {
				query(): string {
					return '';
				}
			}

			const layer = Layer.service(Database, []);
			const container = Container.from(layer);

			expectTypeOf(container).toEqualTypeOf<Container<typeof Database>>();
		});

		it('should infer correct type through provide composition', () => {
			class A {
				a(): string {
					return 'a';
				}
			}
			class B {
				constructor(private _a: A) {}
				b(): string {
					return 'b';
				}
			}

			const aLayer = Layer.service(A, []);
			const bLayer = Layer.service(B, [A]);
			const composed = bLayer.provide(aLayer);

			// After provide: requirements satisfied, only provisions remain
			expectTypeOf(composed).toEqualTypeOf<Layer<never, typeof B>>();
		});

		it('should infer correct type through merge composition', () => {
			class A {
				a(): string {
					return 'a';
				}
			}
			class B {
				b(): string {
					return 'b';
				}
			}

			const aLayer = Layer.service(A, []);
			const bLayer = Layer.service(B, []);
			const merged = aLayer.merge(bLayer);

			// After merge: both provisions combined
			expectTypeOf(merged).toEqualTypeOf<
				Layer<never, typeof A | typeof B>
			>();
		});

		it('should subtract internally satisfied requirements at the type level (smart-merge)', () => {
			class A {
				a(): string {
					return 'a';
				}
			}
			class B {
				constructor(private _a: A) {}
				b(): string {
					return 'b';
				}
			}

			const aLayer = Layer.service(A, []);
			const bLayer = Layer.service(B, [A]);

			// bLayer requires A; aLayer provides A.
			// merge subtracts A from requirements; provides both.
			const merged = bLayer.merge(aLayer);
			expectTypeOf(merged).toEqualTypeOf<
				Layer<never, typeof A | typeof B>
			>();

			// Order-independent at the type level
			const mergedReverse = aLayer.merge(bLayer);
			expectTypeOf(mergedReverse).toEqualTypeOf<
				Layer<never, typeof A | typeof B>
			>();
		});

		it('should keep unsatisfied requirements after merge', () => {
			class A {
				a(): string {
					return 'a';
				}
			}
			class B {
				b(): string {
					return 'b';
				}
			}
			class C {
				constructor(
					private _a: A,
					private _b: B
				) {}
				c(): string {
					return 'c';
				}
			}

			const aLayer = Layer.service(A, []);
			const cLayer = Layer.service(C, [A, B]);

			// cLayer requires A | B; aLayer provides A.
			// After merge: B remains as a requirement, A and C are provided.
			const merged = aLayer.merge(cLayer);
			expectTypeOf(merged).toEqualTypeOf<
				Layer<typeof B, typeof A | typeof C>
			>();
		});

		it('should subtract internally satisfied requirements via Layer.mergeAll', () => {
			class Config {
				port = 0;
			}
			class Database {
				constructor(private _config: Config) {}
			}
			class Cache {
				constructor(private _config: Config) {}
			}

			const configLayer = Layer.service(Config, []);
			const dbLayer = Layer.service(Database, [Config]);
			const cacheLayer = Layer.service(Cache, [Config]);

			const merged = Layer.mergeAll(configLayer, dbLayer, cacheLayer);
			expectTypeOf(merged).toEqualTypeOf<
				Layer<never, typeof Config | typeof Database | typeof Cache>
			>();
		});

		it('should subtract requirements both ways in provide', () => {
			class A {
				a(): string {
					return 'a';
				}
			}
			class B {
				constructor(private _a: A) {}
				b(): string {
					return 'b';
				}
			}

			const aLayer = Layer.service(A, []);
			const bLayer = Layer.service(B, [A]);

			// provide narrows provisions to target only.
			const composed = bLayer.provide(aLayer);
			expectTypeOf(composed).toEqualTypeOf<Layer<never, typeof B>>();
		});

		it('should infer correct ScopedContainer type', () => {
			class Database {
				query(): string {
					return '';
				}
			}

			const layer = Layer.service(Database, []);
			const container = ScopedContainer.from('app', layer);

			expectTypeOf(container).toEqualTypeOf<
				ScopedContainer<typeof Database>
			>();
		});
	});

	describe('ScopedContainer integration', () => {
		it('should create scoped container from layer via ScopedContainer.from()', async () => {
			class Database {
				query() {
					return 'data';
				}
			}

			const dbLayer = Layer.service(Database, []);

			// This should work like Container.from() but return a ScopedContainer
			const container = ScopedContainer.from('app', dbLayer);

			expect(container).toBeInstanceOf(ScopedContainer);
			expect(container.scope).toBe('app');
			const db = await container.resolve(Database);
			expect(db.query()).toBe('data');
		});

		it('should apply layer to scoped container child builder', async () => {
			class AppConfig {
				url = 'localhost';
			}
			class RequestContext {
				constructor(public id: string) {}
			}
			class RequestHandler {
				constructor(
					private config: AppConfig,
					private ctx: RequestContext
				) {}
				handle() {
					return `${this.config.url}:${this.ctx.id}`;
				}
			}

			// App-level layer
			const appLayer = Layer.service(AppConfig, []);
			const appContainer = ScopedContainer.from('app', appLayer);

			// Request-level layer with RequestHandler (RequestContext will be added manually)
			const requestHandlerLayer = Layer.service(RequestHandler, [
				AppConfig,
				RequestContext,
			]);

			// Apply layer to child scope builder
			const childBuilder = appContainer.child('request');
			const builderWithHandler = requestHandlerLayer.apply(childBuilder);
			const requestContainer = builderWithHandler
				.add(RequestContext, () => new RequestContext('req-1'))
				.build();

			const handler = await requestContainer.resolve(RequestHandler);
			expect(handler.handle()).toBe('localhost:req-1');
		});

		it('should support composed layers with scoped containers', async () => {
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

			const dbLayer = Layer.service(Database, []);
			const userLayer = Layer.service(UserService, [Database]);
			const appLayer = userLayer.provide(dbLayer);

			const container = ScopedContainer.from('app', appLayer);

			expect(container).toBeInstanceOf(ScopedContainer);
			const userService = await container.resolve(UserService);
			expect(userService.getUser()).toBe('db-result');
		});
	});
});
