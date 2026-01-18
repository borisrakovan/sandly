import { constant } from '@/constant.js';
import { Container } from '@/container.js';
import { dependency } from '@/dependency.js';
import { Layer } from '@/layer.js';
import { Tag } from '@/tag.js';
import { describe, expect, it } from 'vitest';

describe('dependency', () => {
	describe('Basic usage with ValueTag', () => {
		it('should create a dependency layer for a simple value', async () => {
			const Config = Tag.of('Config')<{ apiUrl: string }>();

			// No requirements - omit the array
			const configDep = dependency(Config, () => ({
				apiUrl: 'https://api.example.com',
			}));

			const container = configDep.register(Container.empty());
			const config = await container.resolve(Config);

			expect(config.apiUrl).toBe('https://api.example.com');
		});

		it('should create a dependency layer for primitive values', async () => {
			const Port = Tag.of('Port')<number>();
			const Debug = Tag.of('Debug')<boolean>();

			const portDep = dependency(Port, () => 3000);
			const debugDep = dependency(Debug, () => true);

			const appLayer = Layer.mergeAll(portDep, debugDep);
			const container = appLayer.register(Container.empty());

			const port = await container.resolve(Port);
			const debug = await container.resolve(Debug);

			expect(port).toBe(3000);
			expect(debug).toBe(true);
		});
	});

	describe('Basic usage with ServiceTag', () => {
		it('should create a dependency layer for a service class', async () => {
			class LoggerService extends Tag.Service('LoggerService') {
				log(message: string) {
					return `Logged: ${message}`;
				}
			}

			const loggerDep = dependency(
				LoggerService,
				() => new LoggerService()
			);

			const container = loggerDep.register(Container.empty());
			const logger = await container.resolve(LoggerService);

			expect(logger.log('test')).toBe('Logged: test');
		});
	});

	describe('Dependencies with requirements', () => {
		it('should create a dependency that requires other dependencies', async () => {
			const Config = Tag.of('Config')<{ dbUrl: string }>();

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private url: string) {
					super();
				}
				connect() {
					return `Connected to ${this.url}`;
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
			const container = appLayer.register(Container.empty());

			const db = await container.resolve(DatabaseService);
			expect(db.connect()).toBe(
				'Connected to postgresql://localhost:5432'
			);
		});

		it('should support multiple requirements', async () => {
			const Config = Tag.of('Config')<{ dbUrl: string }>();

			class Logger extends Tag.Service('Logger') {
				log(message: string) {
					return `[LOG] ${message}`;
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(
					private url: string,
					private logger: Logger
				) {
					super();
				}
				connect() {
					this.logger.log('Connecting...');
					return `Connected to ${this.url}`;
				}
			}

			const configDep = dependency(Config, () => ({
				dbUrl: 'postgresql://localhost:5432',
			}));

			const loggerDep = dependency(Logger, () => new Logger());

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

			const appLayer = dbDep.provide(
				Layer.mergeAll(configDep, loggerDep)
			);
			const container = appLayer.register(Container.empty());

			const db = await container.resolve(DatabaseService);
			expect(db.connect()).toBe(
				'Connected to postgresql://localhost:5432'
			);
		});
	});

	describe('Lifecycle with cleanup', () => {
		it('should support cleanup function', async () => {
			const cleanupCalls: string[] = [];

			class DatabaseConnection extends Tag.Service('DatabaseConnection') {
				constructor(private url: string) {
					super();
				}
				connect() {
					return `Connected to ${this.url}`;
				}
				disconnect() {
					cleanupCalls.push(`Disconnected from ${this.url}`);
				}
			}

			const dbDep = dependency(DatabaseConnection, {
				create: () =>
					new DatabaseConnection('postgresql://localhost:5432'),
				cleanup: (conn) => {
					conn.disconnect();
				},
			});

			const container = dbDep.register(Container.empty());

			const db = await container.resolve(DatabaseConnection);
			expect(db.connect()).toBe(
				'Connected to postgresql://localhost:5432'
			);

			await container.destroy();
			expect(cleanupCalls).toEqual([
				'Disconnected from postgresql://localhost:5432',
			]);
		});

		it('should support async cleanup', async () => {
			const cleanupCalls: string[] = [];

			class AsyncResource extends Tag.Service('AsyncResource') {
				async cleanup() {
					await new Promise((resolve) => setTimeout(resolve, 1));
					cleanupCalls.push('AsyncResource cleaned up');
				}
			}

			const resourceDep = dependency(AsyncResource, {
				create: () => new AsyncResource(),
				cleanup: async (resource) => {
					await resource.cleanup();
				},
			});

			const container = resourceDep.register(Container.empty());
			await container.resolve(AsyncResource);
			await container.destroy();

			expect(cleanupCalls).toEqual(['AsyncResource cleaned up']);
		});

		it('should support lifecycle with requirements', async () => {
			const cleanupCalls: string[] = [];

			class Logger extends Tag.Service('Logger') {
				log(message: string) {
					cleanupCalls.push(`Logger: ${message}`);
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private logger: Logger) {
					super();
				}
				query(sql: string) {
					this.logger.log(`Executing: ${sql}`);
					return [`Result for: ${sql}`];
				}
				close() {
					this.logger.log('Database connection closed');
				}
			}

			const loggerDep = dependency(Logger, () => new Logger());

			const dbDep = dependency(
				DatabaseService,
				{
					create: async (ctx) => {
						const logger = await ctx.resolve(Logger);
						return new DatabaseService(logger);
					},
					cleanup: (db) => {
						db.close();
					},
				},
				[Logger]
			);

			const appLayer = dbDep.provide(loggerDep);
			const container = appLayer.register(Container.empty());

			const db = await container.resolve(DatabaseService);
			db.query('SELECT * FROM users');

			await container.destroy();

			expect(cleanupCalls).toEqual([
				'Logger: Executing: SELECT * FROM users',
				'Logger: Database connection closed',
			]);
		});
	});

	describe('Async factory functions', () => {
		it('should support async factory functions', async () => {
			const Config = Tag.of('Config')<{ delay: number }>();

			class SlowService extends Tag.Service('SlowService') {
				constructor(private startTime: number) {
					super();
				}
				getStartTime() {
					return this.startTime;
				}
			}

			const configDep = dependency(Config, () => ({ delay: 10 }));

			const slowDep = dependency(
				SlowService,
				async (ctx) => {
					const config = await ctx.resolve(Config);
					await new Promise((resolve) =>
						setTimeout(resolve, config.delay)
					);
					return new SlowService(Date.now());
				},
				[Config]
			);

			const appLayer = slowDep.provide(configDep);
			const container = appLayer.register(Container.empty());

			const service = await container.resolve(SlowService);
			expect(typeof service.getStartTime()).toBe('number');
		});
	});

	describe('Layer composition', () => {
		it('should compose with other dependency layers', async () => {
			const ApiKey = Tag.of('ApiKey')<string>();
			const Timeout = Tag.of('Timeout')<number>();

			class ApiClient extends Tag.Service('ApiClient') {
				constructor(
					private apiKey: string,
					private timeout: number
				) {
					super();
				}
				getConfig() {
					return { apiKey: this.apiKey, timeout: this.timeout };
				}
			}

			const apiKeyDep = dependency(ApiKey, () => 'secret-key');
			const timeoutDep = dependency(Timeout, () => 5000);

			const clientDep = dependency(
				ApiClient,
				async (ctx) => {
					const [apiKey, timeout] = await ctx.resolveAll(
						ApiKey,
						Timeout
					);
					return new ApiClient(apiKey, timeout);
				},
				[ApiKey, Timeout]
			);

			const appLayer = clientDep.provide(
				Layer.mergeAll(apiKeyDep, timeoutDep)
			);
			const container = appLayer.register(Container.empty());

			const client = await container.resolve(ApiClient);
			expect(client.getConfig()).toEqual({
				apiKey: 'secret-key',
				timeout: 5000,
			});
		});

		it('should compose with constant() layers', async () => {
			const ApiKey = Tag.of('ApiKey')<string>();

			class ApiClient extends Tag.Service('ApiClient') {
				constructor(private apiKey: string) {
					super();
				}
				getApiKey() {
					return this.apiKey;
				}
			}

			const apiKeyLayer = constant(ApiKey, 'my-secret-key');

			const clientDep = dependency(
				ApiClient,
				async (ctx) => {
					const apiKey = await ctx.resolve(ApiKey);
					return new ApiClient(apiKey);
				},
				[ApiKey]
			);

			const appLayer = clientDep.provide(apiKeyLayer);
			const container = appLayer.register(Container.empty());

			const client = await container.resolve(ApiClient);
			expect(client.getApiKey()).toBe('my-secret-key');
		});

		it('should support provideMerge for exposing both provisions', async () => {
			const Config = Tag.of('Config')<{ dbUrl: string }>();

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private url: string) {
					super();
				}
				getUrl() {
					return this.url;
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

			// Using provideMerge to expose both Config and DatabaseService
			const infraLayer = dbDep.provideMerge(configDep);
			const container = infraLayer.register(Container.empty());

			// Both should be accessible
			const config = await container.resolve(Config);
			const db = await container.resolve(DatabaseService);

			expect(config.dbUrl).toBe('postgresql://localhost:5432');
			expect(db.getUrl()).toBe('postgresql://localhost:5432');
		});
	});

	describe('Real-world usage patterns', () => {
		it('should work like the production database example', async () => {
			const cleanupCalls: string[] = [];

			// Simulating the production pattern
			const Config = Tag.of('Config')<{ DATABASE: string }>();

			class Logger extends Tag.Service('Logger') {
				info(message: string) {
					return `[INFO] ${message}`;
				}
			}

			// Simulating a Database class (not extending Tag.Service)
			// In the real world, this might be imported from another library
			class Database extends Tag.Service('Database') {
				constructor(private connectionString: string) {
					super();
				}
				query(sql: string) {
					return `Query: ${sql} on ${this.connectionString}`;
				}
			}

			// Helper functions simulating real database operations
			const createDb = async (connectionString: string) => {
				return Promise.resolve(new Database(connectionString));
			};

			const disconnectDb = async (_db: Database) => {
				cleanupCalls.push('Database disconnected');
				return Promise.resolve();
			};

			// Define layers using dependency()
			const configDep = dependency(Config, () => ({
				DATABASE: 'postgresql://localhost:5432/myapp',
			}));

			const loggerDep = dependency(Logger, () => new Logger());

			// This is the cleaner syntax compared to layer()
			const databaseDep = dependency(
				Database,
				{
					create: async (ctx) => {
						const logger = await ctx.resolve(Logger);
						const config = await ctx.resolve(Config);
						logger.info('Creating database connection');

						const db = await createDb(config.DATABASE);
						logger.info('Database connection created');

						return db;
					},
					cleanup: async (db) => {
						await disconnectDb(db);
					},
				},
				[Config, Logger]
			);

			// Compose the application
			const appLayer = databaseDep.provide(
				Layer.mergeAll(configDep, loggerDep)
			);
			const container = appLayer.register(Container.empty());

			const db = await container.resolve(Database);
			expect(db.query('SELECT 1')).toBe(
				'Query: SELECT 1 on postgresql://localhost:5432/myapp'
			);

			await container.destroy();
			expect(cleanupCalls).toEqual(['Database disconnected']);
		});

		it('should work like the production HTTP client example', async () => {
			// Simulating the ReapComplianceClient pattern
			const Logger = Tag.of('Logger')<{ info: (msg: string) => void }>();
			const HttpServiceFactory = Tag.of('HttpServiceFactory')<{
				create: (config: unknown) => { get: (url: string) => string };
			}>();

			type ReapComplianceClientConfig = {
				endpoint: string;
				apiKey: string;
				timeout: number;
			};

			const ReapComplianceClientConfig = Tag.of(
				'ReapComplianceClientConfig'
			)<ReapComplianceClientConfig>();

			class ReapComplianceClient extends Tag.Service(
				'ReapComplianceClient'
			) {
				constructor(
					private httpService: { get: (url: string) => string },
					private logger: { info: (msg: string) => void }
				) {
					super();
				}

				getEntities() {
					this.logger.info('Fetching entities');
					return this.httpService.get('/entities');
				}
			}

			// Define dependencies
			const loggerDep = dependency(Logger, () => ({
				info: (msg: string) => {
					console.log(msg);
				},
			}));

			const httpFactoryDep = dependency(HttpServiceFactory, () => ({
				create: (config: unknown) => ({
					get: (url: string) =>
						`GET ${url} with config: ${JSON.stringify(config)}`,
				}),
			}));

			const configDep = dependency(ReapComplianceClientConfig, () => ({
				endpoint: 'https://api.reap.com',
				apiKey: 'secret',
				timeout: 5000,
			}));

			// The main client dependency - cleaner than using layer() directly
			const clientDep = dependency(
				ReapComplianceClient,
				async (ctx) => {
					const [logger, httpServiceFactory, config] =
						await ctx.resolveAll(
							Logger,
							HttpServiceFactory,
							ReapComplianceClientConfig
						);

					const httpService = httpServiceFactory.create({
						baseURL: config.endpoint,
						headers: { 'x-reap-api-key': config.apiKey },
						timeout: config.timeout,
					});

					return new ReapComplianceClient(httpService, logger);
				},
				[Logger, HttpServiceFactory, ReapComplianceClientConfig]
			);

			// Compose
			const appLayer = clientDep.provide(
				Layer.mergeAll(loggerDep, httpFactoryDep, configDep)
			);
			const container = appLayer.register(Container.empty());

			const client = await container.resolve(ReapComplianceClient);
			const result = client.getEntities();

			expect(result).toContain('GET /entities');
			expect(result).toContain('https://api.reap.com');
		});
	});

	describe('Edge cases', () => {
		it('should handle dependency with no requirements (omitted)', async () => {
			const SimpleValue = Tag.of('SimpleValue')<string>();

			// Omit requirements array entirely
			const simpleDep = dependency(SimpleValue, () => 'simple value');

			const container = simpleDep.register(Container.empty());
			const value = await container.resolve(SimpleValue);

			expect(value).toBe('simple value');
		});

		it('should handle dependency with explicit empty requirements', async () => {
			const SimpleValue = Tag.of('SimpleValue')<string>();

			// Explicit empty array
			const simpleDep = dependency(SimpleValue, () => 'simple value', []);

			const container = simpleDep.register(Container.empty());
			const value = await container.resolve(SimpleValue);

			expect(value).toBe('simple value');
		});

		it('should handle dependency with sync factory', async () => {
			const SyncValue = Tag.of('SyncValue')<number>();

			const syncDep = dependency(SyncValue, () => 42);

			const container = syncDep.register(Container.empty());
			const value = await container.resolve(SyncValue);

			expect(value).toBe(42);
		});

		it('should handle dependency with sync lifecycle', async () => {
			const cleanupCalls: string[] = [];
			const SyncResource = Tag.of('SyncResource')<{ id: number }>();

			const syncDep = dependency(SyncResource, {
				create: () => ({ id: 123 }),
				cleanup: (resource) => {
					cleanupCalls.push(`Cleaned up resource ${resource.id}`);
				},
			});

			const container = syncDep.register(Container.empty());
			const resource = await container.resolve(SyncResource);

			expect(resource.id).toBe(123);

			await container.destroy();
			expect(cleanupCalls).toEqual(['Cleaned up resource 123']);
		});
	});
});
