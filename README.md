# Sandly

Dependency injection for TypeScript that actually uses the type system. No runtime reflection, no experimental decorators, just compile-time type safety that prevents entire classes of bugs before your code ever runs.

The name **Sandly** comes from **S**ervices **and** **L**a**y**ers - the two core abstractions for organizing dependencies in large applications.

## Why Sandly?

Most TypeScript DI libraries rely on experimental decorators and runtime reflection, losing type safety in the process. Sandly takes a different approach: the container tracks every registered dependency at the type level, making it impossible to resolve unregistered dependencies or create circular dependency chains without TypeScript catching it at compile time.

```typescript
import { Container, Tag } from 'sandly';

class UserService extends Tag.Service('UserService') {
	getUsers() {
		return ['alice', 'bob'];
	}
}

const container = Container.empty().register(
	UserService,
	() => new UserService()
);

// ✅ TypeScript knows UserService is registered
const users = await container.resolve(UserService);

// ❌ TypeScript error - OrderService not registered
const orders = await container.resolve(OrderService);
// Error: Argument of type 'typeof OrderService' is not assignable to parameter of type 'typeof UserService'
```

## Installation

```bash
npm install sandly
# or
pnpm add sandly
# or
yarn add sandly
```

Recommended version of TypeScript is 5.0+.

## Quick Start

Here's a complete example showing dependency injection with automatic cleanup:

```typescript
import { Container, Tag } from 'sandly';

// Define services using Tag.Service
class Database extends Tag.Service('Database') {
	async query(sql: string) {
		console.log(`Executing: ${sql}`);
		return [{ id: 1, name: 'Alice' }];
	}

	async close() {
		console.log('Database connection closed');
	}
}

class UserRepository extends Tag.Service('UserRepository') {
	constructor(private db: Database) {
		super();
	}

	async findAll() {
		return this.db.query('SELECT * FROM users');
	}
}

// Register services with their factories
const container = Container.empty()
	.register(Database, {
		create: () => new Database(),
		cleanup: (db) => db.close(), // Cleanup when container is destroyed
	})
	.register(
		UserRepository,
		async (ctx) => new UserRepository(await ctx.resolve(Database))
	);

// Use the services
const userRepo = await container.resolve(UserRepository);
const users = await userRepo.findAll();
console.log(users); // [{ id: 1, name: 'Alice' }]

// Clean up all resources
await container.destroy(); // Calls db.close()
```

**Key concepts:**

- **Tags** identify dependencies. Use `Tag.Service()` for classes or `Tag.of()` for values.
- **Container** manages service instantiation and caching. Each service is created once (singleton).
- **Factories** create service instances and can resolve other dependencies via the resolution context.
- **Finalizers** (optional) clean up resources when the container is destroyed.

For larger applications, use **Layers** to organize dependencies into composable modules:

```typescript
import { layer, autoService, Container } from 'sandly';

// Layer that provides Database
const databaseLayer = layer<never, typeof Database>((container) =>
	container.register(Database, {
		create: () => new Database(),
		cleanup: (db) => db.close(),
	})
);

// Layer that provides UserRepository (depends on Database)
const userRepositoryLayer = autoService(UserRepository, [Database]);

// Compose layers - userRepositoryLayer.provide(databaseLayer) creates
// a complete layer with all dependencies satisfied
const appLayer = userRepositoryLayer.provide(databaseLayer);

// Apply to container
const container = appLayer.register(Container.empty());
const userRepo = await container.resolve(UserRepository);
```

Continue reading to learn about all features including value tags, layer composition, and scope management.

## Main Features

### Type Safety

The container tracks registered dependencies in its generic type parameters, making it impossible to resolve unregistered dependencies.

```typescript
import { Container, Tag } from 'sandly';

class CacheService extends Tag.Service('CacheService') {
	get(key: string) {
		return null;
	}
}

class EmailService extends Tag.Service('EmailService') {
	send(to: string) {}
}

// Container knows exactly what's registered
const container = Container.empty().register(
	CacheService,
	() => new CacheService()
);
// Type: Container<typeof CacheService>

// ✅ Works - CacheService is registered
const cache = await container.resolve(CacheService);

// ❌ TypeScript error - EmailService not registered
const email = await container.resolve(EmailService);
// Error: Argument of type 'typeof EmailService' is not assignable
// to parameter of type 'typeof CacheService'
```

Type information is preserved through method chaining:

```typescript
const container = Container.empty()
	.register(CacheService, () => new CacheService())
	.register(EmailService, () => new EmailService());
// Type: Container<typeof CacheService | typeof EmailService>

// Now both work
const cache = await container.resolve(CacheService);
const email = await container.resolve(EmailService);
```

Dependencies are tracked in factory functions too:

```typescript
class UserService extends Tag.Service('UserService') {
	constructor(
		private cache: CacheService,
		private email: EmailService
	) {
		super();
	}
}

// Factory resolution context only allows registered dependencies
// and must return a value of the same type as the dependency
const container = Container.empty()
	.register(CacheService, () => new CacheService())
	.register(EmailService, () => new EmailService())
	.register(UserService, async (ctx) => {
		// ctx.resolve() only accepts CacheService or EmailService
		return new UserService(
			await ctx.resolve(CacheService),
			await ctx.resolve(EmailService)
		);
	});
```

### Modular Architecture with Layers

For large applications, organizing dependencies into layers helps manage complexity and makes dependencies composable.

```typescript
import { layer, service, constant, Tag, Container } from 'sandly';

// Configuration layer - provides primitive values
const Config = Tag.of('Config')<{ databaseUrl: string }>();

const configLayer = constant(Config, { databaseUrl: process.env.DATABASE_URL! });

// Database layer - depends on config
class Database extends Tag.Service('Database') {
	constructor(private url: string) {
		super();
	}

	async query(sql: string) {
		console.log(`Querying ${this.url}: ${sql}`);
		return [];
	}
}

const databaseLayer = layer<typeof Config, typeof Database>((container) =>
	container.register(Database, async (ctx) => {
		const config = await ctx.resolve(Config);
		return new Database(config.databaseUrl);
	})
);

// Service layer - depends on database
class UserService extends Tag.Service('UserService') {
	constructor(private db: Database) {
		super();
	}

	async getUsers() {
		return this.db.query('SELECT * FROM users');
	}
}

const userServiceLayer = service(
	UserService,
	async (ctx) => new UserService(await ctx.resolve(Database))
);

// Or alternatively, using shorter syntax:
// const userServiceLayer = autoService(UserService, [Database]);

// Compose into complete application layer
// Dependencies flow: Config -> Database -> UserService
const appLayer = userServiceLayer.provide(databaseLayer).provide(configLayer);

// Apply to container - all dependencies satisfied
const container = appLayer.register(Container.empty());
const userService = await container.resolve(UserService);
```

Don't worry if you don't understand everything yet - keep reading and you'll learn more about layers and how to use them in practice.

### Flexible Dependency Values

Any value can be a dependency, not just class instances:

```typescript
import { Tag, constant, Container } from 'sandly';

// Primitive values
const PortTag = Tag.of('Port')<number>();
const DebugModeTag = Tag.of('DebugMode')<boolean>();

// Configuration objects
interface Config {
	apiUrl: string;
	timeout: number;
	retries: number;
}
const ConfigTag = Tag.of('Config')<Config>();

// Even functions
type Logger = (msg: string) => void;
const LoggerTag = Tag.of('Logger')<Logger>();

const container = Container.empty()
	.register(PortTag, () => 3000)
	.register(DebugModeTag, () => process.env.NODE_ENV === 'development')
	.register(ConfigTag, () => ({
		apiUrl: 'https://api.example.com',
		timeout: 5000,
		retries: 3,
	}))
	.register(LoggerTag, () => (msg: string) => console.log(msg));

const port = await container.resolve(PortTag); // number
const config = await container.resolve(ConfigTag); // Config
```

### Async Lifecycle Management

Both service creation and cleanup can be asynchronous:

```typescript
import { Container, Tag } from 'sandly';

class DatabaseConnection extends Tag.Service('DatabaseConnection') {
	private connection: any = null;

	async connect() {
		console.log('Connecting to database...');
		await new Promise((resolve) => setTimeout(resolve, 100));
		this.connection = {
			/* connection object */
		};
		console.log('Connected!');
	}

	async disconnect() {
		console.log('Disconnecting from database...');
		await new Promise((resolve) => setTimeout(resolve, 50));
		this.connection = null;
		console.log('Disconnected!');
	}

	query(sql: string) {
		if (!this.connection) throw new Error('Not connected');
		return [];
	}
}

const container = Container.empty().register(DatabaseConnection, {
	create: async () => {
		const db = new DatabaseConnection();
		await db.connect(); // Async initialization
		return db;
	},
	cleanup: async (db) => {
		await db.disconnect(); // Async cleanup
	},
});

// Use the service
const db = await container.resolve(DatabaseConnection);
await db.query('SELECT * FROM users');

// Clean shutdown
await container.destroy();
// Output:
// Disconnecting from database...
// Disconnected!
```

### Powerful Scope Management

Scoped containers enable hierarchical dependency management - perfect for web servers where some services live for the application lifetime while others are request-specific:

```typescript
import { ScopedContainer, Tag } from 'sandly';

// Application-level (singleton)
class Database extends Tag.Service('Database') {
	query(sql: string) {
		return [];
	}
}

// Request-level
class RequestContext extends Tag.Service('RequestContext') {
	constructor(public requestId: string) {
		super();
	}
}

// Set up application container with shared services
const rootContainer = ScopedContainer.empty('app').register(
	Database,
	() => new Database()
);

// For each HTTP request, create a child scope
async function handleRequest(requestId: string) {
	const requestContainer = rootContainer.child('request');

	requestContainer.register(
		RequestContext,
		() => new RequestContext(requestId)
	);

	const ctx = await requestContainer.resolve(RequestContext);
	const db = await requestContainer.resolve(Database); // From parent scope

	// Clean up request scope only
	await requestContainer.destroy();
}

// Each request gets isolated scope, but shares Database
await handleRequest('req-1');
await handleRequest('req-2');
```

### Performance & Developer Experience

**Zero runtime overhead for resolution**: Dependency resolution uses a simple `Map` lookup. Services are instantiated once and cached.

**No third-party dependencies**: The library has zero runtime dependencies, keeping your bundle size small.

**No experimental decorators**: Works with standard TypeScript - no special compiler flags or deprecated decorator metadata.

**IntelliSense works perfectly**: Because dependencies are tracked at the type level, your IDE knows exactly what's available:

```typescript
const container = Container.empty()
	.register(Database, () => new Database())
	.register(Cache, () => new Cache());

// IDE autocomplete shows: Database | Cache
await container.resolve(/* IDE suggests Database and Cache */);
```

**Lazy instantiation**: Services are only created when first resolved:

```typescript
const container = Container.empty()
	.register(ExpensiveService, () => {
		console.log('Creating expensive service...');
		return new ExpensiveService();
	})
	.register(CheapService, () => {
		console.log('Creating cheap service...');
		return new CheapService();
	});

// Nothing instantiated yet
await container.resolve(CheapService);
// Output: "Creating cheap service..."
// ExpensiveService never created unless resolved
```

### Easy Testing

Create test containers with real or mocked services:

```typescript
import { Container, Tag } from 'sandly';

class EmailService extends Tag.Service('EmailService') {
	async send(to: string, body: string) {
		/* real implementation */
	}
}

class UserService extends Tag.Service('UserService') {
	constructor(private email: EmailService) {
		super();
	}

	async registerUser(email: string) {
		await this.email.send(email, 'Welcome!');
	}
}

// In the main application, create a live container with real EmailService
const liveContainer = Container.empty()
	.register(EmailService, () => new EmailService())
	.register(
		UserService,
		async (ctx) => new UserService(await ctx.resolve(EmailService))
	);

// In the test, override EmailService with mock
const mockEmail = { send: vi.fn() };

const testContainer = liveContainer.register(EmailService, () => mockEmail);

const userService = await testContainer.resolve(UserService);
await userService.registerUser('test@example.com');

expect(mockEmail.send).toHaveBeenCalledWith('test@example.com', 'Welcome!');
```

## Core Concepts

Before diving into detailed usage, let's understand the four main building blocks of Sandly.

### Tags

Tags are unique tokens that represent dependencies and serve as a way to reference them in the container. They come in two flavors:

**ServiceTag** - For class-based dependencies. Created by extending `Tag.Service()`:

```typescript
class UserRepository extends Tag.Service('UserRepository') {
	findUser(id: string) {
		return { id, name: 'Alice' };
	}
}
```

The class itself serves as both the tag and the implementation. The string identifier can be anything you want,
but the best practice is to use a descriptive name that is unique across your application.

**ValueTag** - For non-class dependencies (primitives, objects, functions). Created with `Tag.of()`:

```typescript
const ApiKeyTag = Tag.of('ApiKey')<string>();
const ConfigTag = Tag.of('Config')<{ port: number }>();
```

ValueTags separate the identifier from the value type. The string identifier should be unique in order to avoid collisions in TypeScript type error reporting. The main use-case for ValueTags is for injecting configuration values. Be careful with generic names like `'ApiKey'` or `'Config'` - prefer specific identifiers like `'ThirdPartyApiKey'` or `'HttpClientConfig'`.

### Container

The container manages the lifecycle of your dependencies. It handles:

- **Registration**: Associating tags with factory functions
- **Resolution**: Creating and caching service instances
- **Dependency injection**: Making dependencies available to factories
- **Lifecycle management**: Calling finalizers when destroyed

```typescript
const container = Container.empty()
	.register(Database, () => new Database())
	.register(
		UserRepository,
		async (ctx) => new UserRepository(await ctx.resolve(Database))
	);

const repo = await container.resolve(UserRepository);
await container.destroy(); // Clean up
```

Each service is instantiated once (singleton pattern). The container tracks what's registered at the type level, preventing resolution of unregistered dependencies at compile time.

### Layers

Layers are composable units of dependency registrations. Think of them as blueprints that can be combined and reused:

```typescript
// A layer is a function that registers dependencies
const databaseLayer = layer<never, typeof Database>((container) =>
	container.register(Database, () => new Database())
);

// Layers can depend on other layers
const repositoryLayer = layer<typeof Database, typeof UserRepository>(
	(container) =>
		container.register(
			UserRepository,
			async (ctx) => new UserRepository(await ctx.resolve(Database))
		)
);

// Compose layers to build complete dependency graphs
const appLayer = repositoryLayer.provide(databaseLayer);
```

Layers have two type parameters: requirements (what they need) and provisions (what they provide). This allows TypeScript to verify that all dependencies are satisfied when composing layers.

Layers make it easy to structure code in large applications by grouping related dependencies into composable modules. Instead of registering services one-by-one across your codebase, you can define layers that encapsulate entire subsystems (authentication, database access, API clients) and compose them declaratively. This improves code organization, enables module reusability, and makes it easier to swap implementations (production vs. test layers).
Keep reading to learn more about how to use layers in practice.

### Scopes

Scoped containers enable hierarchical dependency management. They're useful when you have:

- **Application-level services** that live for the entire app lifetime (database connections, configuration)
- **Request-level services** that should be created and destroyed per request (request context, user session)
- **Other scopes** like transactions, background jobs, or Lambda invocations

```typescript
// Root scope with shared services
const rootContainer = ScopedContainer.empty('app').register(
	Database,
	() => new Database()
);

// Child scope for each request
const requestContainer = rootContainer
	.child('request')
	.register(RequestContext, () => new RequestContext());

// Child can access parent services
const db = await requestContainer.resolve(Database); // From parent

// Destroying child doesn't affect parent
await requestContainer.destroy();
```

Child scopes inherit access to parent dependencies but maintain their own cache. This means a request-scoped service gets its own instance, while application-scoped services are shared across all requests.

## Working with Containers

This section covers direct container usage. For larger applications, you'll typically use layers instead (covered in the next section), but understanding containers is essential.

### Creating a Container

Start with an empty container:

```typescript
import { Container } from 'sandly';

const container = Container.empty();
// Type: Container<never> - no services registered yet
```

### Registering Dependencies

#### Service Tags (Classes)

Register a class by providing a factory function:

```typescript
import { Tag } from 'sandly';

class Logger extends Tag.Service('Logger') {
	log(msg: string) {
		console.log(`[${new Date().toISOString()}] ${msg}`);
	}
}

const container = Container.empty().register(Logger, () => new Logger());
// Type: Container<typeof Logger>
```

The factory receives a resolution context for injecting dependencies:

```typescript
class Database extends Tag.Service('Database') {
	query(sql: string) {
		return [];
	}
}

class UserRepository extends Tag.Service('UserRepository') {
	constructor(
		private db: Database,
		private logger: Logger
	) {
		super();
	}

	async findAll() {
		this.logger.log('Finding all users');
		return this.db.query('SELECT * FROM users');
	}
}

const container = Container.empty()
	.register(Database, () => new Database())
	.register(Logger, () => new Logger())
	.register(UserRepository, async (ctx) => {
		// ctx provides resolve() and resolveAll()
		const [db, logger] = await ctx.resolveAll(Database, Logger);
		return new UserRepository(db, logger);
	});
```

#### Value Tags (Non-Classes)

Register values using `Tag.of()`:

```typescript
const PortTag = Tag.of('server.port')<number>();
const DatabaseUrlTag = Tag.of('database.url')<string>();

interface AppConfig {
	apiKey: string;
	timeout: number;
}
const ConfigTag = Tag.of('app.config')<AppConfig>();

const container = Container.empty()
	.register(PortTag, () => 3000)
	.register(DatabaseUrlTag, () => process.env.DATABASE_URL!)
	.register(ConfigTag, () => ({
		apiKey: process.env.API_KEY!,
		timeout: 5000,
	}));
```

### Resolving Dependencies

Use `resolve()` to get a service instance:

```typescript
const logger = await container.resolve(Logger);
logger.log('Hello!');

// TypeScript error - UserRepository not registered
const repo = await container.resolve(UserRepository);
// Error: Argument of type 'typeof UserRepository' is not assignable...
```

Resolve multiple dependencies at once:

```typescript
const [db, logger] = await container.resolveAll(Database, Logger);
// Returns tuple with correct types: [Database, Logger]
```

Services are singletons - always the same instance:

```typescript
const logger1 = await container.resolve(Logger);
const logger2 = await container.resolve(Logger);

console.log(logger1 === logger2); // true
```

### Lifecycle Management

#### Finalizers for Cleanup

Register finalizers to clean up resources when the container is destroyed. They receive the created instance and should perform any necessary cleanup (closing connections, releasing resources, etc.):

```typescript
class DatabaseConnection extends Tag.Service('DatabaseConnection') {
	private connected = false;

	async connect() {
		this.connected = true;
		console.log('Connected');
	}

	async disconnect() {
		this.connected = false;
		console.log('Disconnected');
	}

	query(sql: string) {
		if (!this.connected) throw new Error('Not connected');
		return [];
	}
}

const container = Container.empty().register(DatabaseConnection, {
	// Factory
	create: async () => {
		const db = new DatabaseConnection();
		await db.connect();
		return db;
	},
	// Finalizer
	cleanup: async (db) => {
		await db.disconnect();
	},
});

// Use the service
const db = await container.resolve(DatabaseConnection);
await db.query('SELECT 1');

// Clean up
await container.destroy();
// Output: "Disconnected"
```

You can also implement `DependencyLifecycle` as a class for better organization and reuse:

```typescript
import {
	Container,
	Tag,
	type DependencyLifecycle,
	type ResolutionContext,
} from 'sandly';

class Logger extends Tag.Service('Logger') {
	log(message: string) {
		console.log(message);
	}
}

class DatabaseConnection extends Tag.Service('DatabaseConnection') {
	constructor(
		private logger: Logger,
		private url: string
	) {
		super();
	}
	async connect() {
		this.logger.log('Connected');
	}
	async disconnect() {
		this.logger.log('Disconnected');
	}
}

class DatabaseLifecycle
	implements DependencyLifecycle<DatabaseConnection, typeof Logger>
{
	constructor(private url: string) {}

	async create(
		ctx: ResolutionContext<typeof Logger>
	): Promise<DatabaseConnection> {
		const logger = await ctx.resolve(Logger);
		const db = new DatabaseConnection(logger, this.url);
		await db.connect();
		return db;
	}

	async cleanup(db: DatabaseConnection): Promise<void> {
		await db.disconnect();
	}
}

const container = Container.empty()
	.register(Logger, () => new Logger())
	.register(
		DatabaseConnection,
		new DatabaseLifecycle('postgresql://localhost:5432')
	);
```

The `cleanup` method is optional, so you can implement classes with only a `create` method:

```typescript
import { Container, Tag, type DependencyLifecycle } from 'sandly';

class SimpleService extends Tag.Service('SimpleService') {}

class SimpleServiceFactory
	implements DependencyLifecycle<SimpleService, never>
{
	create(): SimpleService {
		return new SimpleService();
	}
	// cleanup is optional
}

const container = Container.empty().register(
	SimpleService,
	new SimpleServiceFactory()
);
```

All finalizers run concurrently when you call `destroy()`:

```typescript
const container = Container.empty()
	.register(Database, {
		create: () => new Database(),
		cleanup: (db) => db.close(),
	})
	.register(Cache, {
		create: () => new Cache(),
		cleanup: (cache) => cache.clear(),
	});

// Both finalizers run in parallel
await container.destroy();
```

#### Overriding Registrations

You can override a registration before it's instantiated:

```typescript
const container = Container.empty()
	.register(Logger, () => new ConsoleLogger())
	.register(Logger, () => new FileLogger()); // Overrides previous

const logger = await container.resolve(Logger);
// Gets FileLogger instance
```

But you cannot override after instantiation:

```typescript
const container = Container.empty().register(Logger, () => new Logger());

const logger = await container.resolve(Logger); // Instantiated

container.register(Logger, () => new Logger()); // Throws!
// DependencyAlreadyInstantiatedError: Cannot register dependency Logger -
// it has already been instantiated
```

### Container Methods

#### has() - Check if Registered

```typescript
const container = Container.empty().register(Logger, () => new Logger());

console.log(container.has(Logger)); // true
console.log(container.has(Database)); // false
```

#### exists() - Check if Instantiated

```typescript
const container = Container.empty().register(Logger, () => new Logger());

console.log(container.exists(Logger)); // false - not instantiated yet

await container.resolve(Logger);

console.log(container.exists(Logger)); // true - now instantiated
```

### Error Handling

#### Unknown Dependency

```typescript
const container = Container.empty();

try {
	await container.resolve(Logger);
} catch (error) {
	console.log(error instanceof UnknownDependencyError); // true
	console.log(error.message); // "No factory registered for dependency Logger"
}
```

However, thanks to the type system, the code above will produce a type error if you try to resolve a dependency that hasn't been registered, before you even run your code.

#### Circular Dependencies

Circular dependencies are detected at runtime:

```typescript
class ServiceA extends Tag.Service('ServiceA') {}
class ServiceB extends Tag.Service('ServiceB') {}

const container = Container.empty()
	.register(ServiceA, async (ctx) => {
		await ctx.resolve(ServiceB);
		return new ServiceA();
	})
	.register(ServiceB, async (ctx) => {
		await ctx.resolve(ServiceA); // Circular!
		return new ServiceB();
	});

try {
	await container.resolve(ServiceA);
} catch (error) {
	console.log(error instanceof CircularDependencyError); // true
	console.log(error.message);
	// "Circular dependency detected for ServiceA: ServiceA -> ServiceB -> ServiceA"
}
```

Similarly to unknown dependencies, the type system will catch this error before you even run your code.

#### Creation Errors

If a factory throws, the error is wrapped in `DependencyCreationError`:

```typescript
const container = Container.empty().register(Database, () => {
	throw new Error('Connection failed');
});

try {
	await container.resolve(Database);
} catch (error) {
	console.log(error instanceof DependencyCreationError); // true
	console.log(error.cause); // Original Error: Connection failed
}
```

**Nested Creation Errors**

When dependencies are nested (A depends on B, B depends on C), and C's factory throws, you get nested `DependencyCreationError`s. Use `getRootCause()` to unwrap all the layers and get the original error:

```typescript
class ServiceC extends Tag.Service('ServiceC') {
	constructor() {
		super();
		throw new Error('Database connection failed');
	}
}

class ServiceB extends Tag.Service('ServiceB') {
	constructor(private c: ServiceC) {
		super();
	}
}

class ServiceA extends Tag.Service('ServiceA') {
	constructor(private b: ServiceB) {
		super();
	}
}

const container = Container.empty()
	.register(ServiceC, () => new ServiceC())
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
} catch (error) {
	if (error instanceof DependencyCreationError) {
		console.log(error.message);
		// "Error creating instance of ServiceA"

		// Get the original error that caused the failure
		const rootCause = error.getRootCause();
		console.log(rootCause);
		// Error: Database connection failed
	}
}
```

#### Finalization Errors

If any finalizer fails, cleanup continues for others and a `DependencyFinalizationError` is thrown with details of all failures:

```typescript
class Database extends Tag.Service('Database') {
	async close() {
		throw new Error('Database close failed');
	}
}

class Cache extends Tag.Service('Cache') {
	async clear() {
		throw new Error('Cache clear failed');
	}
}

const container = Container.empty()
	.register(Database, {
		create: () => new Database(),
		cleanup: async (db) => db.close(),
	})
	.register(Cache, {
		create: () => new Cache(),
		cleanup: async (cache) => cache.clear(),
	});

await container.resolve(Database);
await container.resolve(Cache);

try {
	await container.destroy();
} catch (error) {
	if (error instanceof DependencyFinalizationError) {
		// Get all original errors that caused the finalization failure
		const rootCauses = error.getRootCauses();
		console.error('Finalization failures:', rootCauses);
		// [
		//   Error: Database close failed,
		//   Error: Cache clear failed
		// ]
	}
}
```

### Type Safety in Action

The container's type parameter tracks all registered dependencies:

```typescript
const c1 = Container.empty();
// Type: Container<never>

const c2 = c1.register(Database, () => new Database());
// Type: Container<typeof Database>

const c3 = c2.register(Logger, () => new Logger());
// Type: Container<typeof Database | typeof Logger>

// TypeScript knows what's available
await c3.resolve(Database); // ✅ OK
await c3.resolve(Logger); // ✅ OK
await c3.resolve(Cache); // ❌ Type error
```

Factory functions have typed resolution contexts:

```typescript
const container = Container.empty()
	.register(Database, () => new Database())
	.register(Logger, () => new Logger())
	.register(UserService, async (ctx) => {
		// ctx can only resolve Database or Logger
		await ctx.resolve(Database); // ✅ OK
		await ctx.resolve(Logger); // ✅ OK
		await ctx.resolve(Cache); // ❌ Type error

		return new UserService();
	});
```

### Best Practices

**Use method chaining** - Each `register()` returns the container with updated types:

```typescript
// ✅ Good - types flow through chain
const container = Container.empty()
	.register(Database, () => new Database())
	.register(Logger, () => new Logger())
	.register(
		UserService,
		async (ctx) =>
			new UserService(
				await ctx.resolve(Database),
				await ctx.resolve(Logger)
			)
	);

// ❌ Bad - lose type information
const container = Container.empty();
container.register(Database, () => new Database());
container.register(Logger, () => new Logger());
// TypeScript doesn't track these registrations
```

**Prefer layers for multiple dependencies** - Once you have larger numbers of services and more complex dependency graphs, layers become cleaner. See the next section for more details.

**Handle cleanup errors** - Finalizers can fail:

```typescript
try {
	await container.destroy();
} catch (error) {
	if (error instanceof DependencyFinalizationError) {
		console.error('Cleanup failed:', error.detail.errors);
		// Continue with shutdown anyway
	}
}
```

**Avoid resolving during registration if possible** - Once you resolve a dependency, the container will cache it and you won't be able to override the registration. This might become problematic in case you're composing layers and multiple layers reference the same layer in their provisions (see more on layers below). It's better to keep registration and resolution separate:

```typescript
// ❌ Bad - resolving during setup creates timing issues
const container = Container.empty().register(Logger, () => new Logger());

const logger = await container.resolve(Logger); // During setup!

container.register(Database, () => new Database());

// ✅ Good - register everything first, then resolve
const container = Container.empty()
	.register(Logger, () => new Logger())
	.register(Database, () => new Database());

// Now use services
const logger = await container.resolve(Logger);
```

However, it's perfectly fine to resolve and even use dependencies inside another dependency factory function.

```typescript
// ✅ Also good - resolve dependency inside factory function during the registration
const container = Container.empty()
	.register(Logger, () => new Logger())
	.register(Database, (ctx) => {
		const db = new Database();
		const logger = await ctx.resolve(Logger);
		logger.log('Database created successfully');
		return db;
	});
```

## Working with Layers

Layers are the recommended approach for organizing dependencies in larger applications. While direct container registration works well for small projects, layers provide better code organization, reusability, and developer experience as your application grows.

### Why Use Layers?

Layers solve three key problems with manual container registration: repetitive boilerplate, lack of reusability across entry points, and leakage of implementation details.

#### Problem 1: Repetitive Factory Boilerplate

With direct container registration, you must write factory functions repeatedly:

```typescript
// user-repository.ts
export class UserRepository extends Tag.Service('UserRepository') {
	constructor(
		private db: Database,
		private logger: Logger
	) {
		super();
	}
	// ... implementation
}

// app.ts - Far away from the implementation!
const container = Container.empty()
	.register(Database, () => new Database())
	.register(Logger, () => new Logger())
	.register(UserRepository, async (ctx) => {
		// Manually specify what the constructor needs
		const [db, logger] = await ctx.resolveAll(Database, Logger);
		return new UserRepository(db, logger);
	});
```

Every service requires manually writing a factory that resolves its dependencies and calls the constructor. This is **repetitive and error-prone** - if you add a dependency to the constructor, you must remember to update the factory too.

**Solution:** Layers provide shorthand helpers (`service`, `autoService`) that eliminate boilerplate and keep the layer definition next to the implementation:

```typescript
// user-repository.ts
export class UserRepository extends Tag.Service('UserRepository') {
	constructor(
		private db: Database,
		private logger: Logger
	) {
		super();
	}
	// ... implementation
}

// Layer defined right next to the class
export const userRepositoryLayer = autoService(UserRepository, [
	Database,
	Logger,
]);

// app.ts - Just compose the layers
const appLayer = userRepositoryLayer.provide(
	Layer.mergeAll(databaseLayer, loggerLayer)
);
const container = appLayer.register(Container.empty());
```

#### Problem 2: No Reusability Across Entry Points

Applications with multiple entry points (multiple Lambda functions, CLI commands, background workers) need to wire up dependencies separately for each entry point. Without layers, you must duplicate the registration logic:

```typescript
// functions/create-user.ts - Lambda that creates users
export async function handler(event: APIGatewayEvent) {
	// Duplicate ALL the registration logic
	const container = Container.empty()
		.register(Config, () => loadConfig())
		.register(
			Database,
			async (ctx) => new Database(await ctx.resolve(Config))
		)
		.register(Logger, () => new Logger())
		.register(
			UserRepository,
			async (ctx) =>
				new UserRepository(
					await ctx.resolve(Database),
					await ctx.resolve(Logger)
				)
		)
		.register(
			UserService,
			async (ctx) =>
				new UserService(
					await ctx.resolve(UserRepository),
					await ctx.resolve(Logger)
				)
		);

	const userService = await container.resolve(UserService);
	// ... handle request
}

// functions/get-orders.ts - Lambda that fetches orders
export async function handler(event: APIGatewayEvent) {
	// Duplicate the SAME registration logic AGAIN
	const container = Container.empty()
		.register(Config, () => loadConfig())
		.register(
			Database,
			async (ctx) => new Database(await ctx.resolve(Config))
		)
		.register(Logger, () => new Logger())
		.register(
			OrderRepository,
			async (ctx) =>
				new OrderRepository(
					await ctx.resolve(Database),
					await ctx.resolve(Logger)
				)
		)
		.register(
			OrderService,
			async (ctx) =>
				new OrderService(
					await ctx.resolve(OrderRepository),
					await ctx.resolve(Logger)
				)
		);
	// Uses OrderService but had to register Database, Logger, etc again

	const orderService = await container.resolve(OrderService);
	// ... handle request
}
```

This has major problems:

- **Massive duplication**: Registration logic is copy-pasted across entry points
- **Maintenance nightmare**: When you change `UserRepository`'s dependencies, you must update every Lambda that uses it
- **Can't compose selectively**: Each entry point must register ALL dependencies, even those it doesn't need
- **Configuration inconsistency**: Each entry point might configure services differently by accident

**Solution:** Define layers once, compose them differently for each entry point:

```typescript
// Shared infrastructure - defined once
// database.ts
export const databaseLayer = autoService(Database, [ConfigTag]);

// logger.ts
export const loggerLayer = autoService(Logger, []);

// config.ts
export const configLayer = constant(ConfigTag, loadConfig());

// Infrastructure layer combining all base services
export const infraLayer = Layer.mergeAll(
	databaseLayer,
	loggerLayer,
	configLayer
);

// Domain layers - defined once
// user-repository.ts
export const userRepositoryLayer = autoService(UserRepository, [
	Database,
	Logger,
]);

// user-service.ts
export const userServiceLayer = autoService(UserService, [
	UserRepository,
	Logger,
]);

// order-repository.ts
export const orderRepositoryLayer = autoService(OrderRepository, [
	Database,
	Logger,
]);

// order-service.ts
export const orderServiceLayer = autoService(OrderService, [
	OrderRepository,
	Logger,
]);

// Now compose differently for each Lambda
// functions/create-user.ts
export async function handler(event: APIGatewayEvent) {
	// Only UserService and its dependencies - no Order code!
	const appLayer = userServiceLayer
		.provide(userRepositoryLayer)
		.provide(infraLayer);

	const container = appLayer.register(Container.empty());
	const userService = await container.resolve(UserService);
	// ... handle request
}

// functions/get-orders.ts
export async function handler(event: APIGatewayEvent) {
	// Only OrderService and its dependencies - no User code!
	const appLayer = orderServiceLayer
		.provide(orderRepositoryLayer)
		.provide(infraLayer);

	const container = appLayer.register(Container.empty());
	const orderService = await container.resolve(OrderService);
	// ... handle request
}

// functions/admin-dashboard.ts - Needs both!
export async function handler(event: APIGatewayEvent) {
	// Compose BOTH user and order services
	const appLayer = Layer.mergeAll(
		userServiceLayer.provide(userRepositoryLayer),
		orderServiceLayer.provide(orderRepositoryLayer)
	).provide(infraLayer);

	const container = appLayer.register(Container.empty());
	const userService = await container.resolve(UserService);
	const orderService = await container.resolve(OrderService);
	// ... handle request
}
```

Benefits:

- **Zero duplication**: Each layer is defined once, reused everywhere
- **Easy maintenance**: Change `UserRepository`'s constructor once, all entry points automatically use the new version
- **Compose exactly what you need**: Each Lambda only includes the services it actually uses
- **Consistent configuration**: Infrastructure like Database is configured once in `infraLayer`

#### Problem 3: Requirement Leakage

Without layers, internal implementation details leak into your API. Consider a `UserService` that depends on `UserValidator` and `UserNotifier` internally:

```typescript
// Without layers - internal dependencies leak
export class UserService {
	constructor(
		private validator: UserValidator,
		private notifier: UserNotifier,
		private db: Database
	) {}
}

// Consumers must know about internal dependencies
const container = Container.empty()
	.register(UserValidator, () => new UserValidator())
	.register(UserNotifier, () => new UserNotifier())
	.register(Database, () => new Database())
	.register(
		UserService,
		async (ctx) =>
			new UserService(
				await ctx.resolve(UserValidator),
				await ctx.resolve(UserNotifier),
				await ctx.resolve(Database)
			)
	);
```

Consumers need to know about `UserValidator` and `UserNotifier`, even though they're internal implementation details. If you refactor UserService's internals, consumers must update their code.

#### Solution: Encapsulated Requirements

Layers can hide internal dependencies:

```typescript
// user-service.ts
export class UserService extends Tag.Service('UserService') {
	constructor(
		private validator: UserValidator,
		private notifier: UserNotifier,
		private db: Database
	) {
		super();
	}
}

// Internal dependencies provided inline
export const userServiceLayer = autoService(UserService, [
	UserValidator,
	UserNotifier,
	Database,
]).provide(Layer.mergeAll(userValidatorLayer, userNotifierLayer));

// Type: Layer<typeof Database, typeof UserService>
// Only requires Database externally!

// app.ts - Consumers don't see internal dependencies
const appLayer = userServiceLayer.provide(databaseLayer);
// Just provide Database, internal details are hidden
```

The layer hides `UserValidator` and `UserNotifier` as implementation details. Consumers only need to provide `Database`. You can refactor internals freely without affecting consumers.

### Benefits Summary

Layers provide:

- **Cleaner syntax**: `autoService()` and `service()` eliminate repetitive factory boilerplate
- **Reusability**: Define layers once, compose them differently across multiple entry points (Lambda functions, CLI commands, workers)
- **Selective composition**: Each entry point only includes the dependencies it actually needs
- **Better organization**: Dependency construction logic lives next to the implementation (code that changes together stays together)
- **Encapsulation**: Hide internal dependencies from consumers
- **Type safety**: Requirements and provisions tracked at the type level

### Creating Layers

#### layer() - Manual Layer Creation

The `layer()` function creates a layer by providing a registration function:

```typescript
import { layer, Container } from 'sandly';

class Database extends Tag.Service('Database') {
	query(sql: string) {
		return [];
	}
}

// Must annotate layer type parameters manually
const databaseLayer = layer<never, typeof Database>((container) =>
	container.register(Database, () => new Database())
);

// Apply to container
const container = databaseLayer.register(Container.empty());
const db = await container.resolve(Database);
```

**Type parameters:**

- First: Requirements (what the layer needs) - `never` means no requirements
- Second: Provisions (what the layer provides) - `typeof Database`

With dependencies:

```typescript
class Logger extends Tag.Service('Logger') {
	log(msg: string) {
		console.log(msg);
	}
}

class UserRepository extends Tag.Service('UserRepository') {
	constructor(
		private db: Database,
		private logger: Logger
	) {
		super();
	}

	async findAll() {
		this.logger.log('Finding all users');
		return this.db.query('SELECT * FROM users');
	}
}

// Requires Database and Logger, provides UserRepository
const userRepositoryLayer = layer<
	typeof Database | typeof Logger,
	typeof UserRepository
>((container) =>
	container.register(UserRepository, async (ctx) => {
		const [db, logger] = await ctx.resolveAll(Database, Logger);
		return new UserRepository(db, logger);
	})
);
```

#### service() - Service Layer Helper

The `service()` function is a convenience wrapper for creating service layers:

```typescript
import { service } from 'sandly';

// Simpler than layer() - infers types from the factory
const userRepositoryLayer = service(UserRepository, async (ctx) => {
	const [db, logger] = await ctx.resolveAll(Database, Logger);
	return new UserRepository(db, logger);
});

// With finalizer
const databaseLayer = service(Database, {
	create: async () => {
		const db = new Database();
		await db.connect();
		return db;
	},
	cleanup: (db) => db.disconnect(),
});
```

The dependencies are automatically inferred from the factory's resolution context.

#### autoService() - Automatic Constructor Injection

The `autoService()` function automatically injects dependencies based on constructor parameters:

```typescript
import { autoService } from 'sandly';

class UserRepository extends Tag.Service('UserRepository') {
	constructor(
		private db: Database,
		private logger: Logger
	) {
		super();
	}

	async findAll() {
		this.logger.log('Finding all users');
		return this.db.query('SELECT * FROM users');
	}
}

// Automatically resolves Database and Logger from constructor
const userRepositoryLayer = autoService(UserRepository, [Database, Logger]);
```

Mix ServiceTag dependencies, ValueTag dependencies, and static values:

```typescript
const ApiKeyTag = Tag.of('ApiKey')<string>();
const TimeoutTag = Tag.of('Timeout')<number>();

class ApiClient extends Tag.Service('ApiClient') {
	constructor(
		private logger: Logger, // ServiceTag - works automatically
		private apiKey: Inject<typeof ApiKeyTag>, // ValueTag - needs Inject<>
		private timeout: Inject<typeof TimeoutTag>, // ValueTag - needs Inject<>
		private baseUrl: string // Static value
	) {
		super();
	}
}

// Order matters - must match constructor parameter order
const apiClientLayer = autoService(ApiClient, [
	Logger, // ServiceTag - resolved from container
	ApiKeyTag, // ValueTag - resolved from container
	TimeoutTag, // ValueTag - resolved from container
	'https://api.example.com', // Static value - passed directly
]);
```

**Important**: ValueTag dependencies in constructors must be annotated with `Inject<typeof YourTag>`. This preserves type information for `service()` and `autoService()` to infer the dependency. Without `Inject<>`, TypeScript sees it as a regular value and `service()` and `autoService()` won't know to resolve it from the container.

With cleanup:

```typescript
const databaseLayer = autoService(Database, {
	dependencies: ['postgresql://localhost:5432/mydb'],
	cleanup: (db) => db.disconnect(),
});
```

#### dependency() - Generic Dependency Layer

The `dependency()` function creates a layer for any tag type (ServiceTag or ValueTag) with fully inferred types. Unlike `service()` and `autoService()`, it doesn't require extending `Tag.Service()`:

```typescript
import { dependency, Tag } from 'sandly';

// Simple dependency without requirements
const Config = Tag.of('Config')<{ apiUrl: string }>();

const configDep = dependency(Config, () => ({
	apiUrl: process.env.API_URL!,
}));

// Dependency with requirements - pass them as the last argument
const Database = Tag.of('Database')<DatabaseConnection>();

const databaseDep = dependency(
	Database,
	async (ctx) => {
		const config = await ctx.resolve(Config);
		return createConnection(config.apiUrl);
	},
	[Config] // Requirements array - enables type inference
);
```

With lifecycle (create + cleanup):

```typescript
const databaseDep = dependency(
	Database,
	{
		create: async (ctx) => {
			const config = await ctx.resolve(Config);
			return await createConnection(config.apiUrl);
		},
		cleanup: async (db) => {
			await db.disconnect();
		},
	},
	[Config]
);
```

The `dependency()` function is useful when:

- Working with ValueTags that need dependencies
- Using third-party classes that can't extend `Tag.Service()`
- Wanting cleaner syntax than `layer()` without explicit type parameters

#### constant() - Constant Value Layer Helper

The `constant()` function creates a layer that provides a constant value:

```typescript
import { constant, Tag } from 'sandly';

const ApiKeyTag = Tag.of('ApiKey')<string>();
const PortTag = Tag.of('Port')<number>();

const apiKeyLayer = constant(ApiKeyTag, 'my-secret-key');
const portLayer = constant(PortTag, 3000);

// Combine constant layers
const configLayer = Layer.mergeAll(
	apiKeyLayer,
	portLayer,
	constant(Tag.of('Debug')<boolean>(), true)
);
```

### Using Inject<> for ValueTag Dependencies

When using ValueTags as constructor parameters with `autoService()`, you must annotate them with `Inject<>`:

```typescript
import { Tag, Inject, autoService } from 'sandly';

const ApiKeyTag = Tag.of('ApiKey')<string>();
const TimeoutTag = Tag.of('Timeout')<number>();

class ApiClient extends Tag.Service('ApiClient') {
	constructor(
		private logger: Logger, // ServiceTag - works automatically
		private apiKey: Inject<typeof ApiKeyTag>, // ValueTag - needs Inject<>
		private timeout: Inject<typeof TimeoutTag> // ValueTag - needs Inject<>
	) {
		super();
	}

	async get(endpoint: string) {
		// this.apiKey is typed as string (the actual value type)
		// this.timeout is typed as number
		return fetch(endpoint, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
			signal: AbortSignal.timeout(this.timeout),
		});
	}
}

// autoService infers dependencies from constructor
const apiClientLayer = autoService(ApiClient, [
	Logger, // ServiceTag
	ApiKeyTag, // ValueTag - resolved from container
	TimeoutTag, // ValueTag - resolved from container
]);
```

`Inject<>` is a type-level marker that:

- Keeps the actual value type (string, number, etc.)
- Allows dependency inference for `autoService()`
- Has no runtime overhead

### Composing Layers

Layers can be combined in three ways: **provide**, **provideMerge**, and **merge**.

#### .provide() - Sequential Composition

Provides dependencies to a layer, hiding the dependency layer's provisions in the result:

```typescript
const configLayer = layer<never, typeof ConfigTag>((container) =>
	container.register(ConfigTag, () => loadConfig())
);

const databaseLayer = layer<typeof ConfigTag, typeof Database>((container) =>
	container.register(Database, async (ctx) => {
		const config = await ctx.resolve(ConfigTag);
		return new Database(config);
	})
);

// Database layer needs ConfigTag, which configLayer provides
const infraLayer = databaseLayer.provide(configLayer);
// Type: Layer<never, typeof Database>
// Note: ConfigTag is hidden - it's an internal detail
```

The type signature:

```typescript
Layer<TRequires, TProvides>.provide(
  dependency: Layer<TDepReq, TDepProv>
) => Layer<TDepReq | Exclude<TRequires, TDepProv>, TProvides>
```

Reading left-to-right (natural flow):

```typescript
const appLayer = serviceLayer // needs: Database, Logger
	.provide(infraLayer) // needs: Config, provides: Database, Logger
	.provide(configLayer); // needs: nothing, provides: Config
// Result: Layer<never, typeof UserService>
```

#### .provideMerge() - Composition with Merged Provisions

Like `.provide()` but includes both layers' provisions in the result:

```typescript
const infraLayer = databaseLayer.provideMerge(configLayer);
// Type: Layer<never, typeof ConfigTag | typeof Database>
// Both ConfigTag and Database are available
```

Use when you want to expose multiple layers' services:

```typescript
const AppConfigTag = Tag.of('AppConfig')<AppConfig>();

const configLayer = constant(AppConfigTag, loadConfig());
const databaseLayer = layer<typeof AppConfigTag, typeof Database>((container) =>
	container.register(
		Database,
		async (ctx) => new Database(await ctx.resolve(AppConfigTag))
	)
);

// Expose both config and database
const infraLayer = databaseLayer.provideMerge(configLayer);
// Type: Layer<never, typeof AppConfigTag | typeof Database>

// Services can use both
const container = infraLayer.register(Container.empty());
const config = await container.resolve(AppConfigTag); // Available!
const db = await container.resolve(Database); // Available!
```

#### .merge() - Parallel Combination

Merges two independent layers (no dependency relationship):

```typescript
const databaseLayer = layer<never, typeof Database>((container) =>
	container.register(Database, () => new Database())
);

const loggerLayer = layer<never, typeof Logger>((container) =>
	container.register(Logger, () => new Logger())
);

// Combine independent layers
const infraLayer = databaseLayer.merge(loggerLayer);
// Type: Layer<never, typeof Database | typeof Logger>
```

For multiple layers, use `Layer.mergeAll()`:

```typescript
const infraLayer = Layer.mergeAll(
	databaseLayer,
	loggerLayer,
	cacheLayer,
	metricsLayer
);
```

### Static Layer Methods

#### Layer.empty()

Creates an empty layer (no requirements, no provisions):

```typescript
import { Layer } from 'sandly';

const emptyLayer = Layer.empty();
// Type: Layer<never, never>
```

#### Layer.merge()

Merges exactly two layers:

```typescript
const combined = Layer.merge(databaseLayer, loggerLayer);
// Equivalent to: databaseLayer.merge(loggerLayer)
```

#### Layer.mergeAll()

Merges multiple layers at once:

```typescript
const infraLayer = Layer.mergeAll(
	constant(ApiKeyTag, 'key'),
	constant(PortTag, 3000),
	databaseLayer,
	loggerLayer
);
// Type: Layer<Requirements, Provisions> with all merged
```

Requires at least 2 layers.

### Applying Layers to Containers

Use the `.register()` method to apply a layer to a container:

```typescript
const appLayer = userServiceLayer.provide(databaseLayer).provide(configLayer);

// Apply to container
const container = appLayer.register(Container.empty());

// Now resolve services
const userService = await container.resolve(UserService);
```

Layers can be applied to containers that already have services:

```typescript
const baseContainer = Container.empty().register(Logger, () => new Logger());

// Apply layer to container with existing services
const container = databaseLayer.register(baseContainer);
// Container now has both Logger and Database
```

#### Type Safety: Requirements Must Be Satisfied

TypeScript ensures that a layer can only be registered on a container that satisfies all of the layer's requirements. This prevents runtime errors from missing dependencies.

```typescript
// Layer that requires Database
const userServiceLayer = autoService(UserService, [Database, Logger]);

// ✅ Works - Container.empty() can be used because layer has no requirements
// (userServiceLayer was composed with all dependencies via .provide())
const completeLayer = userServiceLayer
	.provide(userRepositoryLayer)
	.provide(infraLayer);
// Type: Layer<never, typeof UserService> - no requirements!

const container = completeLayer.register(Container.empty());
// ✅ TypeScript allows this because completeLayer has no requirements

// ❌ Type error - Layer still has requirements
const incompleteLayer = userServiceLayer.provide(userRepositoryLayer);
// Type: Layer<typeof Logger, typeof UserService> - still needs Logger!

const container2 = incompleteLayer.register(Container.empty());
// ❌ Error: Argument of type 'Container<never>' is not assignable to parameter of type 'IContainer<ServiceTag<"Logger", Logger>>'.
```

When applying a layer to an existing container, the container must already have all the layer's requirements:

```typescript
// Layer requires Database
const userRepositoryLayer = autoService(UserRepository, [Database, Logger]);

// ✅ Works - baseContainer has Logger, and we provide Database via layer
const baseContainer = Container.empty().register(Logger, () => new Logger());
const container = userRepositoryLayer
	.provide(databaseLayer)
	.register(baseContainer);

// ❌ Type error - baseContainer doesn't have Database
const baseContainer2 = Container.empty().register(Logger, () => new Logger());
const container2 = userRepositoryLayer.register(baseContainer2);
// ❌ Error: Argument of type 'Conainer<ttypeof Logger>' is not assignable to parameter of type 'IContainer<ServiceTag<"Database", Database> | ServiceTag<"Logger", Logger>>'.
```

This compile-time checking ensures that all dependencies are satisfied before your code runs, preventing `UnknownDependencyError` at runtime.

### Best Practices

**Always annotate layer<> type parameters manually:**

```typescript
// ✅ Good - explicit types
const myLayer = layer<typeof Requirement, typeof Provision>((container) =>
	container.register(Provision, async (ctx) => {
		const req = await ctx.resolve(Requirement);
		return new Provision(req);
	})
);

// ❌ Bad - inference is difficult/impossible
const myLayer = layer((container) =>
	container.register(Provision, async (ctx) => {
		const req = await ctx.resolve(Requirement);
		return new Provision(req);
	})
);
```

**Follow the types when composing layers:**

Start with the target layer, inspect its type to see requirements, then chain `.provide()` calls:

```typescript
// Start with what you need
const userServiceLayer = service(UserService, ...);
// Type: Layer<typeof Database | typeof Logger, typeof UserService>
//             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ requirements

// Provide those requirements
const appLayer = userServiceLayer
  .provide(Layer.mergeAll(databaseLayer, loggerLayer));
```

**Define layers in the same file as the service class:**

```typescript
// user-repository.ts
export class UserRepository extends Tag.Service('UserRepository') {
	constructor(private db: Database) {
		super();
	}

	async findAll() {
		return this.db.query('SELECT * FROM users');
	}
}

// Layer definition stays with the class
export const userRepositoryLayer = autoService(UserRepository, [Database]);
```

This keeps related code together while keeping the service class decoupled from DI details.

**Resolve dependencies locally:**

When a module has internal dependencies, provide them within the module's layer to avoid leaking implementation details:

```typescript
// user-module/user-validator.ts
export class UserValidator extends Tag.Service('UserValidator') {
	validate(user: User) {
		// Validation logic
	}
}

export const userValidatorLayer = autoService(UserValidator, []);
```

```typescript
// user-module/user-notifier.ts
export class UserNotifier extends Tag.Service('UserNotifier') {
	notify(user: User) {
		// Notification logic
	}
}

export const userNotifierLayer = autoService(UserNotifier, []);
```

```typescript
// user-module/user-service.ts
import { UserValidator, userValidatorLayer } from './user-validator.js';
import { UserNotifier, userNotifierLayer } from './user-notifier.js';

// Public service - external consumers only see this
export class UserService extends Tag.Service('UserService') {
	constructor(
		private validator: UserValidator, // Internal dependency
		private notifier: UserNotifier, // Internal dependency
		private db: Database // External dependency
	) {
		super();
	}

	async createUser(user: User) {
		this.validator.validate(user);
		await this.db.save(user);
		this.notifier.notify(user);
	}
}

// Public layer - provides internal dependencies inline
export const userServiceLayer = autoService(UserService, [
	UserValidator,
	UserNotifier,
	Database,
]).provide(Layer.mergeAll(userValidatorLayer, userNotifierLayer));
// Type: Layer<typeof Database, typeof UserService>

// Consumers of this module only need to provide Database
// UserValidator and UserNotifier are internal details
```

```typescript
// app.ts
import { userServiceLayer } from './user-module/user-service.js';

// Only need to provide Database - internal dependencies already resolved
const appLayer = userServiceLayer.provide(databaseLayer);
```

This pattern:

- **Encapsulates internal dependencies**: Consumers don't need to know about `UserValidator` or `UserNotifier`
- **Reduces coupling**: Changes to internal dependencies don't affect consumers
- **Simplifies usage**: Consumers only provide what the module actually needs externally

**Use provideMerge when you need access to intermediate services:**

```typescript
// Need both config and database in final container
const infraLayer = databaseLayer.provideMerge(configLayer);
// Type: Layer<never, typeof ConfigTag | typeof Database>

// vs. provide hides config
const infraLayer = databaseLayer.provide(configLayer);
// Type: Layer<never, typeof Database> - ConfigTag not accessible
```

**Prefer autoService for simple cases:**

```typescript
// ✅ Simple and clear
const userServiceLayer = autoService(UserService, [Database, Logger]);

// ❌ Verbose for simple case
const userServiceLayer = service(UserService, async (ctx) => {
	const [db, logger] = await ctx.resolveAll(Database, Logger);
	return new UserService(db, logger);
});
```

But use `service()` when you need custom logic:

```typescript
// ✅ Good - custom initialization logic
const databaseLayer = service(Database, {
	create: async () => {
		const db = new Database();
		await db.connect();
		await db.runMigrations();
		return db;
	},
	cleanup: (db) => db.disconnect(),
});
```

## Scope Management

Scoped containers enable hierarchical dependency management where some services live for different durations. This is essential for applications that handle multiple contexts (HTTP requests, database transactions, background jobs, etc.).

### When to Use Scopes

Use scoped containers when you have dependencies with different lifecycles:

**Web servers**: Application-level services (database pool, config) vs. request-level services (request context, user session)

**Serverless functions**: Function-level services (logger, metrics) vs. invocation-level services (event context, request ID)

**Background jobs**: Worker-level services (job queue, database) vs. job-level services (job context, transaction)

### Creating Scoped Containers

Use `ScopedContainer.empty()` to create a root scope:

```typescript
import { ScopedContainer, Tag } from 'sandly';

class Database extends Tag.Service('Database') {
	query(sql: string) {
		return [];
	}
}

// Create root scope with application-level services
const appContainer = ScopedContainer.empty('app').register(
	Database,
	() => new Database()
);
```

The scope identifier (`'app'`) is used for debugging and has no runtime behavior.

### Child Scopes

Create child scopes using `.child()`:

```typescript
class RequestContext extends Tag.Service('RequestContext') {
  constructor(public requestId: string, public userId: string) {
    super();
  }
}

function handleRequest(requestId: string, userId: string) {
  // Create child scope for each request
  const requestScope = appContainer.child('request')
    // Register request-specific services
    .register(RequestContext, () =>
      new RequestContext(requestId, userId)
    )
  );

  // Child can access parent services
  const db = await requestScope.resolve(Database);      // From parent
  const ctx = await requestScope.resolve(RequestContext); // From child

  // Clean up request scope when done
  await requestScope.destroy();
}
```

### Scope Resolution Rules

When resolving a dependency, scoped containers follow these rules:

1. **Check current scope cache**: If already instantiated in this scope, return it
2. **Check current scope factory**: If registered in this scope, create and cache it here
3. **Delegate to parent**: If not in current scope, try parent scope
4. **Throw error**: If not found in any scope, throw `UnknownDependencyError`

```typescript
const appScope = ScopedContainer.empty('app').register(
	Database,
	() => new Database()
);

const requestScope = appScope
	.child('request')
	.register(RequestContext, () => new RequestContext());

// Resolving Database from requestScope:
// 1. Not in requestScope cache
// 2. Not in requestScope factory
// 3. Delegate to appScope -> found and cached in appScope
await requestScope.resolve(Database); // Returns Database from appScope

// Resolving RequestContext from requestScope:
// 1. Not in requestScope cache
// 2. Found in requestScope factory -> create and cache in requestScope
await requestScope.resolve(RequestContext); // Returns RequestContext from requestScope
```

### Complete Web Server Example

Here's a realistic Express.js application with scoped containers:

```typescript
import express from 'express';
import { ScopedContainer, Tag, autoService } from 'sandly';

// ============ Application-Level Services ============
class Database extends Tag.Service('Database') {
	async query(sql: string) {
		// Real database query
		return [];
	}
}

class Logger extends Tag.Service('Logger') {
	log(message: string) {
		console.log(`[${new Date().toISOString()}] ${message}`);
	}
}

// ============ Request-Level Services ============
class RequestContext extends Tag.Service('RequestContext') {
	constructor(
		public requestId: string,
		public userId: string | null,
		public startTime: number
	) {
		super();
	}

	getDuration() {
		return Date.now() - this.startTime;
	}
}

class UserSession extends Tag.Service('UserSession') {
	constructor(
		private ctx: RequestContext,
		private db: Database,
		private logger: Logger
	) {
		super();
	}

	async getCurrentUser() {
		if (!this.ctx.userId) {
			return null;
		}

		this.logger.log(`Fetching user ${this.ctx.userId}`);
		const users = await this.db.query(
			`SELECT * FROM users WHERE id = '${this.ctx.userId}'`
		);
		return users[0] || null;
	}
}

// ============ Setup Application Container ============
const appContainer = ScopedContainer.empty('app')
	.register(Database, () => new Database())
	.register(Logger, () => new Logger());

// ============ Express Middleware ============
const app = express();

// Store request scope in res.locals
app.use((req, res, next) => {
	const requestId = crypto.randomUUID();
	const userId = req.headers['user-id'] as string | undefined;

	// Create child scope for this request
	const requestScope = appContainer.child(`request-${requestId}`);

	// Register request-specific services
	requestScope
		.register(
			RequestContext,
			() => new RequestContext(requestId, userId || null, Date.now())
		)
		.register(
			UserSession,
			async (ctx) =>
				new UserSession(
					await ctx.resolve(RequestContext),
					await ctx.resolve(Database),
					await ctx.resolve(Logger)
				)
		);

	// Store scope for use in route handlers
	res.locals.scope = requestScope;

	// Clean up scope when response finishes
	res.on('finish', async () => {
		await requestScope.destroy();
	});

	next();
});

// ============ Route Handlers ============
app.get('/api/user', async (req, res) => {
	const scope: ScopedContainer<typeof UserSession> = res.locals.scope;

	const session = await scope.resolve(UserSession);
	const user = await session.getCurrentUser();

	if (!user) {
		res.status(401).json({ error: 'Unauthorized' });
		return;
	}

	res.json({ user });
});

app.get('/api/stats', async (req, res) => {
	const scope: ScopedContainer<typeof RequestContext | typeof Database> =
		res.locals.scope;

	const ctx = await scope.resolve(RequestContext);
	const db = await scope.resolve(Database);

	const stats = await db.query('SELECT COUNT(*) FROM users');

	res.json({
		stats,
		requestId: ctx.requestId,
		duration: ctx.getDuration(),
	});
});

// ============ Start Server ============
const PORT = 3000;
app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});

// ============ Graceful Shutdown ============
process.on('SIGTERM', async () => {
	console.log('Shutting down...');
	await appContainer.destroy();
	process.exit(0);
});
```

### Serverless Function Example

Scoped containers work perfectly for serverless functions where each invocation should have isolated state:

```typescript
import { ScopedContainer, Tag } from 'sandly';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// ============ Function-Level Services (shared across invocations) ============
class Logger extends Tag.Service('Logger') {
	log(level: string, message: string) {
		console.log(JSON.stringify({ level, message, timestamp: Date.now() }));
	}
}

class DynamoDB extends Tag.Service('DynamoDB') {
	async get(table: string, key: string) {
		// AWS SDK call
		return {};
	}
}

// ============ Invocation-Level Services (per Lambda invocation) ============
const EventContextTag = Tag.of('EventContext')<APIGatewayProxyEvent>();
const InvocationIdTag = Tag.of('InvocationId')<string>();

class RequestProcessor extends Tag.Service('RequestProcessor') {
	constructor(
		private event: Inject<typeof EventContextTag>,
		private invocationId: Inject<typeof InvocationIdTag>,
		private db: DynamoDB,
		private logger: Logger
	) {
		super();
	}

	async process() {
		this.logger.log('info', `Processing ${this.invocationId}`);

		const userId = this.event.pathParameters?.userId;
		if (!userId) {
			return { statusCode: 400, body: 'Missing userId' };
		}

		const user = await this.db.get('users', userId);
		return { statusCode: 200, body: JSON.stringify(user) };
	}
}

// ============ Initialize Function-Level Container (cold start) ============
const functionContainer = ScopedContainer.empty('function')
	.register(Logger, () => new Logger())
	.register(DynamoDB, () => new DynamoDB());

// ============ Lambda Handler ============
export async function handler(
	event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
	const invocationId = crypto.randomUUID();

	// Create invocation scope
	const invocationScope = functionContainer.child(
		`invocation-${invocationId}`
	);

	try {
		// Register invocation-specific context
		invocationScope
			.register(EventContextTag, () => event)
			.register(InvocationIdTag, () => invocationId)
			.register(
				RequestProcessor,
				async (ctx) =>
					new RequestProcessor(
						await ctx.resolve(EventContextTag),
						await ctx.resolve(InvocationIdTag),
						await ctx.resolve(DynamoDB),
						await ctx.resolve(Logger)
					)
			);

		// Process request
		const processor = await invocationScope.resolve(RequestProcessor);
		const result = await processor.process();

		return result;
	} finally {
		// Clean up invocation scope
		await invocationScope.destroy();
	}
}
```

### Scope Destruction Order

When a scope is destroyed, finalizers run in this order:

1. **Child scopes first**: All child scopes are destroyed before the parent
2. **Concurrent finalizers**: Within a scope, finalizers run concurrently
3. **Parent scope last**: Parent finalizers run after all children are cleaned up

```typescript
const appScope = ScopedContainer.empty('app').register(Database, {
	create: () => new Database(),
	cleanup: (db) => {
		console.log('Closing database');
		return db.close();
	},
});

const request1 = appScope.child('request-1').register(RequestContext, {
	create: () => new RequestContext('req-1'),
	cleanup: (ctx) => {
		console.log('Cleaning up request-1');
	},
});

const request2 = appScope.child('request-2').register(RequestContext, {
	create: () => new RequestContext('req-2'),
	cleanup: (ctx) => {
		console.log('Cleaning up request-2');
	},
});

// Destroy parent scope
await appScope.destroy();
// Output:
// Cleaning up request-1
// Cleaning up request-2
// Closing database
```

### Scope Lifecycle Best Practices

**Always destroy child scopes**: Failing to destroy child scopes causes memory leaks:

```typescript
// ❌ Bad - memory leak
app.use((req, res, next) => {
	const requestScope = appContainer.child('request');
	res.locals.scope = requestScope;
	next();
	// Scope never destroyed!
});

// ✅ Good - proper cleanup
app.use((req, res, next) => {
	const requestScope = appContainer.child('request');
	res.locals.scope = requestScope;

	res.on('finish', async () => {
		await requestScope.destroy();
	});

	next();
});
```

**Use try-finally for cleanup**: Ensure scopes are destroyed even if errors occur:

```typescript
// ✅ Good - cleanup guaranteed
async function processRequest() {
	const requestScope = appContainer.child('request');

	try {
		// Process request
		const result = await requestScope.resolve(RequestProcessor);
		return await result.process();
	} finally {
		// Always cleanup, even on error
		await requestScope.destroy();
	}
}
```

**Don't share scopes across async boundaries**: Each context should have its own scope:

```typescript
// ❌ Bad - scope shared across requests
const sharedScope = appContainer.child('shared');

app.get('/api/user', async (req, res) => {
	const service = await sharedScope.resolve(UserService);
	// Multiple requests share the same scope - potential data leaks!
});

// ✅ Good - scope per request
app.get('/api/user', async (req, res) => {
	const requestScope = appContainer.child('request');
	const service = await requestScope.resolve(UserService);
	// Each request gets isolated scope
	await requestScope.destroy();
});
```

**Register request-scoped services in parent scope when possible**: If services don't need request-specific data, register them once:

```typescript
// ❌ Suboptimal - registering service definition per request
app.use((req, res, next) => {
	const requestScope = appContainer.child('request');

	// UserService factory defined repeatedly
	requestScope.register(
		UserService,
		async (ctx) => new UserService(await ctx.resolve(Database))
	);

	next();
});

// ✅ Better - register service definition once, instantiate per request
const appContainer = ScopedContainer.empty('app')
	.register(Database, () => new Database())
	.register(
		UserService,
		async (ctx) => new UserService(await ctx.resolve(Database))
	);

app.use((req, res, next) => {
	const requestScope = appContainer.child('request');
	// UserService factory already registered in parent
	// First resolve in requestScope will create instance
	next();
});
```

**Use weak references for child tracking**: ScopedContainer uses WeakRef internally for child scope tracking, so destroyed child scopes can be garbage collected even if parent scope is still alive.

### Combining Scopes with Layers

You can apply layers to scoped containers just like regular containers:

```typescript
import { ScopedContainer, Layer, autoService } from 'sandly';

// Define layers
const databaseLayer = autoService(Database, []);
const loggerLayer = autoService(Logger, []);
const infraLayer = Layer.mergeAll(databaseLayer, loggerLayer);

// Apply layers to scoped container
const appContainer = infraLayer.register(ScopedContainer.empty('app'));

// Create child scopes as needed
const requestScope = appContainer.child('request');
```

This combines the benefits of:

- **Layers**: Composable, reusable dependency definitions
- **Scopes**: Hierarchical lifetime management

## Comparison with Alternatives

### vs NestJS

**NestJS**:

- **No Type Safety**: Relies on string tokens and runtime reflection. TypeScript can't validate your dependency graph at compile time. This results in common runtime errors like "Unknown dependency" or "Dependency not found" when NestJS app is run.
- **Decorator-Based**: Uses experimental decorators which are being deprecated in favor of the new TypeScript standard.
- **Framework Lock-In**: Tightly coupled to the NestJS framework. You can't use the DI system independently.
- **Heavy**: Pulls in many dependencies and runtime overhead.

**Sandly**:

- **Full Type Safety**: Compile-time validation of your entire dependency graph.
- **No Decorators**: Uses standard TypeScript without experimental features.
- **Framework-Agnostic**: Works with any TypeScript project (Express, Fastify, plain Node.js, serverless, etc.).
- **Lightweight**: Zero runtime dependencies, minimal overhead.

### vs InversifyJS

**InversifyJS**:

- **Complex API**: Requires learning container binding DSL, identifiers, and numerous decorators.
- **Decorator-heavy**: Relies heavily on experimental decorators.
- **No async factory support**: Doesn't support async dependency creation out of the box.
- **Weak type inference**: Type safety requires manual type annotations everywhere.

**Sandly**:

- **Simple API**: Clean, minimal API surface. Tags, containers, and layers.
- **No decorators**: Standard TypeScript classes and functions.
- **Async first**: Native support for async factories and finalizers.
- **Strong type inference**: Types are automatically inferred from your code.

```typescript
// InversifyJS - Complex and decorator-heavy
const TYPES = {
	Database: Symbol.for('Database'),
	UserService: Symbol.for('UserService'),
};

@injectable()
class UserService {
	constructor(@inject(TYPES.Database) private db: Database) {}
}

container.bind<Database>(TYPES.Database).to(Database).inSingletonScope();
container.bind<UserService>(TYPES.UserService).to(UserService);

// Sandly - Simple and type-safe
class UserService extends Tag.Service('UserService') {
	constructor(private db: Database) {
		super();
	}
}

const container = Container.empty()
	.register(Database, () => new Database())
	.register(
		UserService,
		async (ctx) => new UserService(await ctx.resolve(Database))
	);
```

### vs TSyringe

**TSyringe**:

- **Decorator-based**: Uses experimental `reflect-metadata` and decorators.
- **No type-safe container**: The container doesn't track what's registered. Easy to request unregistered dependencies and only find out at runtime.
- **No async support**: Factories must be synchronous.
- **Global container**: Relies on a global container which makes testing harder.

**Sandly**:

- **No decorators**: Standard TypeScript, no experimental features.
- **Type-Safe container**: Container tracks all registered services. TypeScript prevents requesting unregistered dependencies.
- **Full async support**: Factories and finalizers can be async.
- **Explicit containers**: Create and manage containers explicitly for better testability and scope management.

```typescript
// TSyringe - Global container, no compile-time safety
@injectable()
class UserService {
	constructor(@inject('Database') private db: Database) {}
}

container.register('Database', { useClass: Database });
container.register('UserService', { useClass: UserService });

// Will compile but fail at runtime if 'Database' wasn't registered
const service = container.resolve('UserService');

// Sandly - Type-safe, explicit
const container = Container.empty()
	.register(Database, () => new Database())
	.register(
		UserService,
		async (ctx) => new UserService(await ctx.resolve(Database))
	);

// Won't compile if Database isn't registered
const service = await container.resolve(UserService); // Type-safe
```

### vs Effect-TS

**Effect-TS**:

- **Steep learning curve**: Requires learning functional programming concepts, Effect type, generators, and extensive API.
- **All-or-nothing**: Designed as a complete effect system. Hard to adopt incrementally.
- **Functional programming**: Uses FP paradigms which may not fit all teams or codebases.
- **Large bundle**: Comprehensive framework with significant bundle size.

**Sandly**:

- **Easy to learn**: Simple, familiar API. If you know TypeScript classes, you're ready to use Sandly.
- **Incremental adoption**: Add DI to existing codebases without major refactoring.
- **Pragmatic**: Works with standard OOP and functional styles.
- **Minimal size**: Tiny library focused on DI only.

**Similarities with Effect**:

- Both provide full type safety for dependency management
- Both use the concept of layers for composable dependency graphs
- Both support complete async lifecycle management and scope management

**When to choose Effect**: If you want a complete effect system with error handling, concurrency, streams, and are comfortable with FP paradigms.

**When to choose Sandly**: If you want just dependency injection with great type safety, without the learning curve or the need to adopt an entire effect system.

### Feature Comparison Table

| Feature                    | Sandly  | NestJS     | InversifyJS           | TSyringe | Effect-TS |
| -------------------------- | ------- | ---------- | --------------------- | -------- | --------- |
| Compile-time type safety   | ✅ Full | ❌ None    | ⚠️ Partial            | ❌ None  | ✅ Full   |
| No experimental decorators | ✅      | ❌         | ❌                    | ❌       | ✅        |
| Async lifecycle methods    | ✅      | ✅         | ❌                    | ❌       | ✅        |
| Framework-agnostic         | ✅      | ❌         | ✅                    | ✅       | ✅        |
| Learning curve             | Low     | Medium     | Medium                | Low      | Very High |
| Bundle size                | Small   | Large      | Medium                | Small    | Large     |
| Custom scopes              | ✅      | ⚠️ Limited | ⚠️ Request scope only | ❌       | ✅        |
| Layer composition          | ✅      | ❌         | ❌                    | ❌       | ✅        |
| Zero dependencies          | ✅      | ❌         | ❌                    | ❌       | ❌        |

### Why Choose Sandly?

Choose Sandly if you want:

- **Type safety** without sacrificing developer experience
- **Dependency injection** without the need for experimental features that won't be supported in the future
- **Clean architecture** with layers and composable modules
- **Async support** for real-world scenarios (database connections, API clients, etc.)
- **Testing-friendly** design with easy mocking and isolation
- **Incremental adoption** in existing codebases
- **Zero runtime dependencies** and minimal overhead

Sandly takes inspiration from Effect-TS's excellent type safety and layer composition, while keeping the API simple and accessible for teams that don't need a full effect system.
