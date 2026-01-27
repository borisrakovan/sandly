import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Container, ScopedContainer } from './container.js';
import { Layer } from './layer.js';
import { Tag } from './tag.js';

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

	describe('provideMerge()', () => {
		it('should expose both layers provisions', async () => {
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

			// provideMerge exposes both Config and Database
			const infraLayer = dbLayer.provideMerge(configLayer);

			const container = Container.from(infraLayer);

			// Both should be resolvable
			const config = await container.resolve(Config);
			const db = await container.resolve(Database);

			expect(config.port).toBe(3000);
			expect(db.getPort()).toBe(3000);
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
