<h1 align="center">Sandly</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/sandly"><img src="https://img.shields.io/npm/v/sandly?color=3178c6&label=npm" alt="npm version"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.0%2B-blue?logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://codecov.io/gh/borisrakovan/sandly"><img src="https://codecov.io/gh/borisrakovan/sandly/branch/main/graph/badge.svg" alt="coverage"></a>
  <br />
  <a href="https://github.com/borisrakovan/sandly/actions/workflows/ci.yml"><img src="https://github.com/borisrakovan/sandly/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/borisrakovan/sandly/blob/main/LICENSE"><img src="https://img.shields.io/github/license/borisrakovan/sandly" alt="license"></a>
  <a href="https://github.com/borisrakovan/sandly"><img src="https://img.shields.io/github/stars/borisrakovan/sandly?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  <strong>Type-safe dependency injection for TypeScript.</strong><br />
  No decorators, no runtime reflection — just compile-time safety.
</p>

## Why Sandly?

Most TypeScript DI libraries rely on experimental decorators and runtime reflection, losing type safety in the process. Sandly takes a different approach: the container tracks every registered dependency at the type level, making it impossible to resolve unregistered dependencies at compile time.

```typescript
import { Container, Layer } from 'sandly';

class Database {
	query(sql: string) {
		return [];
	}
}

class UserService {
	constructor(private db: Database) {}
	getUsers() {
		return this.db.query('SELECT * FROM users');
	}
}

// Define layers
const dbLayer = Layer.service(Database, []);
const userLayer = Layer.service(UserService, [Database]);

// Compose and create container
const container = Container.from(userLayer.provide(dbLayer));

// TypeScript knows UserService is available
const users = await container.resolve(UserService);

// TypeScript error - OrderService not registered
const orders = await container.resolve(OrderService);
```

**Key features:**

- **Compile-time safety**: TypeScript catches missing dependencies before runtime
- **No decorators**: Works with standard TypeScript, no experimental features
- **Async support**: Factories and cleanup functions can be async
- **Composable layers**: Organize dependencies into reusable modules
- **Scoped containers**: Hierarchical dependency management for web servers
- **Zero dependencies**: Tiny library with no runtime overhead

## Installation

```bash
npm install sandly
# or
pnpm add sandly
# or
yarn add sandly
```

Requires TypeScript 5.0+.

## Quick Start

```typescript
import { Container, Layer, Tag } from 'sandly';

// Any class can be a dependency - no special base class needed
class Database {
	async query(sql: string) {
		return [{ id: 1, name: 'Alice' }];
	}
	async close() {
		console.log('Database closed');
	}
}

class UserRepository {
	constructor(private db: Database) {}
	findAll() {
		return this.db.query('SELECT * FROM users');
	}
}

// Create layers
const dbLayer = Layer.service(Database, [], {
	cleanup: (db) => db.close(),
});

const userRepoLayer = Layer.service(UserRepository, [Database]);

// Compose layers and create container
const appLayer = userRepoLayer.provide(dbLayer);
const container = Container.from(appLayer);

// Use services
const repo = await container.resolve(UserRepository);
const users = await repo.findAll();

// Clean up
await container.destroy();
```

## Core Concepts

### Tags

Tags identify dependencies. There are two types:

**Classes as tags**: Any class constructor can be used directly as a tag:

```typescript
class UserService {
	getUsers() {
		return [];
	}
}

// UserService is both the class and its tag
const layer = Layer.service(UserService, []);
```

**ValueTags for non-class values**: Use `Tag.of()` for primitives, objects, or functions:

```typescript
const PortTag = Tag.of('Port')<number>();
const ConfigTag = Tag.of('Config')<{ apiUrl: string }>();

const portLayer = Layer.value(PortTag, 3000);
const configLayer = Layer.value(ConfigTag, {
	apiUrl: 'https://api.example.com',
});
```

### Container

Containers manage dependency instantiation and lifecycle:

```typescript
// Create from layers (recommended)
const container = Container.from(appLayer);

// Or build manually
const container = Container.builder()
	.add(Database, () => new Database())
	.add(
		UserService,
		async (ctx) => new UserService(await ctx.resolve(Database))
	)
	.build();

// Resolve dependencies
const db = await container.resolve(Database);
const [db, users] = await container.resolveAll(Database, UserService);

// Use and discard pattern - resolves, runs callback, then destroys
const result = await container.use(UserService, (service) =>
	service.getUsers()
);

// Manual clean up
await container.destroy();
```

Each dependency is created once (singleton) and cached.

### Layers

Layers are composable units of dependency registrations:

```typescript
// Layer.service for classes with dependencies
const userLayer = Layer.service(UserService, [Database, Logger]);

// Layer.value for constants
const configLayer = Layer.value(ConfigTag, { port: 3000 });

// Layer.create for custom factory logic
const cacheLayer = Layer.create({
	requires: [ConfigTag],
	apply: (builder) =>
		builder.add(Cache, async (ctx) => {
			const config = await ctx.resolve(ConfigTag);
			return new Cache({ ttl: config.cacheTtl });
		}),
});
```

Compose layers with `provide()`, `provideMerge()`, and `merge()`:

```typescript
// provide: satisfy dependencies, expose only this layer's provisions
const appLayer = userLayer.provide(dbLayer);

// merge: combine independent layers
const infraLayer = Layer.merge(dbLayer, loggerLayer);
// or
const infraLayer = Layer.mergeAll(dbLayer, loggerLayer, cacheLayer);

// provideMerge: satisfy dependencies and expose both layers
const fullLayer = userLayer.provideMerge(dbLayer);
```

### Scoped Containers

Scoped containers enable hierarchical dependency management:

```typescript
// Application scope - use builder to add dependencies
const appContainer = ScopedContainer.builder('app')
	.add(Database, () => new Database())
	.build();

// Request scope - use child() to create a child builder
const requestContainer = appContainer
	.child('request')
	.add(RequestContext, () => new RequestContext())
	.build();

// Child can resolve both its own and parent dependencies
const db = await requestContainer.resolve(Database); // From parent
const ctx = await requestContainer.resolve(RequestContext); // From child

// Destroy child without affecting parent
await requestContainer.destroy();
```

Or use layers with `childFrom`:

```typescript
const appContainer = ScopedContainer.from('app', dbLayer);
const requestContainer = appContainer.childFrom(
	'request',
	Layer.value(RequestContext, new RequestContext())
);
```

### Use and Discard Pattern

The `use()` method resolves a service, runs a callback, and automatically destroys the container:

```typescript
// Perfect for short-lived operations like Lambda handlers or worker jobs
const result = await appContainer
	.childFrom('request', requestLayer)
	.use(UserService, (service) => service.processEvent(event));
// Container is automatically destroyed after callback completes
```

This is especially useful for serverless functions or message handlers where the container lifecycle matches a single operation.

## Working with Layers

### Creating Layers

**Layer.service**: Class dependencies with automatic injection

```typescript
class ApiClient {
	constructor(
		private config: Config,
		private logger: Logger
	) {}
}

// Dependencies must match constructor parameters in order
const apiLayer = Layer.service(ApiClient, [Config, Logger]);

// With cleanup function
const dbLayer = Layer.service(Database, [], {
	cleanup: (db) => db.close(),
});
```

**Layer.value**: Constant values or pre-instantiated instances

```typescript
// ValueTag (constants)
const ApiKeyTag = Tag.of('apiKey')<string>();
const configLayer = Layer.value(ApiKeyTag, process.env.API_KEY!);

// ServiceTag (pre-instantiated instances)
class UserService {
	getUsers() {
		return [];
	}
}
const userService = new UserService();
const testLayer = Layer.value(UserService, userService);
```

**Layer.mock**: Partial mocks for testing (ServiceTags only)

```typescript
class UserService {
	constructor(private db: Database) {}
	getUsers() {
		return this.db.query('SELECT * FROM users');
	}
	getUserById(id: number) {
		return this.db.query(`...`);
	}
}

// Mock only the methods you need - no constructor dependencies required
const testLayer = Layer.mock(UserService, {
	getUsers: () => Promise.resolve([{ id: 1, name: 'Alice' }]),
});

// TypeScript still validates the mock's method signatures
```

**Layer.create**: Custom factory logic

```typescript
const dbLayer = Layer.create({
	requires: [ConfigTag],
	apply: (builder) =>
		builder.add(Database, async (ctx) => {
			const config = await ctx.resolve(ConfigTag);
			const db = new Database(config.dbUrl);
			await db.connect();
			return db;
		}),
});
```

### Composing Layers

```typescript
// Build your application layer by layer
const configLayer = Layer.value(ConfigTag, loadConfig());
const dbLayer = Layer.service(Database, [ConfigTag]);
const repoLayer = Layer.service(UserRepository, [Database]);
const serviceLayer = Layer.service(UserService, [UserRepository, Logger]);

// Compose into complete application
const appLayer = serviceLayer
	.provide(repoLayer)
	.provide(dbLayer)
	.provide(configLayer)
	.provide(Layer.service(Logger, []));

// Create container - all dependencies satisfied
const container = Container.from(appLayer);
```

### Layer Type Safety

Layers track their requirements and provisions at the type level:

```typescript
const dbLayer = Layer.service(Database, []);
// Type: Layer<never, typeof Database>

const userLayer = Layer.service(UserService, [Database]);
// Type: Layer<typeof Database, typeof UserService>

const appLayer = userLayer.provide(dbLayer);
// Type: Layer<never, typeof UserService>

// Container.from only accepts layers with no requirements
const container = Container.from(appLayer); // OK

const incomplete = Layer.service(UserService, [Database]);
const container = Container.from(incomplete); // Type error!
```

## Scoped Containers

### Request Scoping for Web Servers

```typescript
import { ScopedContainer, Layer } from 'sandly';

// App-level dependencies (shared across requests)
const appContainer = ScopedContainer.from(
	'app',
	Layer.mergeAll(dbLayer, loggerLayer)
);

// Express middleware
app.use(async (req, res, next) => {
	// Create request scope with request-specific dependencies
	const requestScope = appContainer.childFrom(
		'request',
		Layer.value(RequestContext, {
			requestId: crypto.randomUUID(),
			userId: req.user?.id,
		})
	);

	res.locals.container = requestScope;

	res.on('finish', () => requestScope.destroy());
	next();
});

// Route handler
app.get('/users', async (req, res) => {
	const userService = await res.locals.container.resolve(UserService);
	res.json(await userService.getUsers());
});
```

### Destruction Order

When destroying a scoped container:

1. Child scopes are destroyed first
2. Then the current scope's finalizers run
3. Parent scope is unaffected

```typescript
const parent = ScopedContainer.builder('parent')
	.add(Database, {
		create: () => new Database(),
		cleanup: (db) => db.close(),
	})
	.build();

const child = parent
	.child('child')
	.add(Cache, { create: () => new Cache(), cleanup: (c) => c.clear() })
	.build();

await parent.destroy(); // Destroys child first (Cache.clear), then parent (Database.close)
```

## Error Handling

Sandly provides specific error types for common issues:

```typescript
import {
	UnknownDependencyError,
	CircularDependencyError,
	DependencyCreationError,
	DependencyFinalizationError,
} from 'sandly';

try {
	const service = await container.resolve(UserService);
} catch (error) {
	if (error instanceof CircularDependencyError) {
		console.log(error.message);
		// "Circular dependency detected for UserService: UserService -> Database -> UserService"
	}

	if (error instanceof DependencyCreationError) {
		// Get the original error that caused the failure
		const rootCause = error.getRootCause();
		console.log(rootCause.message);
	}
}
```

## API Reference

### Container

| Method                          | Description                                   |
| ------------------------------- | --------------------------------------------- |
| `Container.from(layer)`         | Create container from a fully resolved layer  |
| `Container.builder()`           | Create a container builder                    |
| `Container.empty()`             | Create an empty container                     |
| `Container.scoped(scope)`       | Create an empty scoped container              |
| `container.resolve(tag)`        | Get a dependency instance                     |
| `container.resolveAll(...tags)` | Get multiple dependencies                     |
| `container.use(tag, fn)`        | Resolve, run callback, then destroy container |
| `container.destroy()`           | Run finalizers and clean up                   |

### ContainerBuilder

| Method                   | Description           |
| ------------------------ | --------------------- |
| `builder.add(tag, spec)` | Register a dependency |
| `builder.build()`        | Create the container  |

### Layer

| Method                                 | Description                                     |
| -------------------------------------- | ----------------------------------------------- |
| `Layer.service(class, deps, options?)` | Create layer for a class                        |
| `Layer.value(tag, value)`              | Create layer for a constant value               |
| `Layer.mock(tag, implementation)`      | Create layer with mock (partial for ServiceTag) |
| `Layer.create({ requires, apply })`    | Create custom layer                             |
| `Layer.empty()`                        | Create empty layer                              |
| `Layer.merge(a, b)`                    | Merge two layers                                |
| `Layer.mergeAll(...layers)`            | Merge multiple layers                           |
| `layer.provide(dep)`                   | Satisfy dependencies                            |
| `layer.provideMerge(dep)`              | Satisfy and merge provisions                    |
| `layer.merge(other)`                   | Merge with another layer                        |

### ScopedContainer

| Method                               | Description                                 |
| ------------------------------------ | ------------------------------------------- |
| `ScopedContainer.builder(scope)`     | Create a new scoped container builder       |
| `ScopedContainer.empty(scope)`       | Create empty scoped container               |
| `ScopedContainer.from(scope, layer)` | Create from layer                           |
| `container.child(scope)`             | Create child scope builder                  |
| `container.childFrom(scope, layer)`  | Create child scope from layer (convenience) |

### Tag

| Method             | Description                 |
| ------------------ | --------------------------- |
| `Tag.of(id)<T>()`  | Create a ValueTag           |
| `Tag.id(tag)`      | Get tag's string identifier |
| `Tag.isTag(value)` | Check if value is a tag     |

## Testing

Sandly makes testing easy with `Layer.mock()`, which allows you to create partial mocks without satisfying constructor dependencies. Import your production layers and override dependencies with mocks:

```typescript
// Production code (e.g., src/services/user-service.ts)
import { Layer } from 'sandly';
import { ResourcesRepository } from '../repositories/resources-repository';

export class UserService {
	constructor(private repo: ResourcesRepository) {}
	async getUsers() {
		return this.repo.listByCrawlId('crawl-123');
	}
}

// Layer definition in the same file
export const userServiceLayer = Layer.service(UserService, [
	ResourcesRepository,
]);

// Test file (e.g., src/services/user-service.test.ts)
import { Container, Layer } from 'sandly';
import { userServiceLayer } from './user-service';
import { ResourcesRepository } from '../repositories/resources-repository';

// Override production dependencies with mocks
const testLayer = userServiceLayer.provide(
	Layer.mock(ResourcesRepository, {
		listByCrawlId: async () => [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
		],
	})
);

const container = Container.from(testLayer);
const userService = await container.resolve(UserService);

// Use the service - mock is automatically injected
const users = await userService.getUsers();
expect(users).toHaveLength(2);
```

**Benefits:**

- ✅ No need to satisfy constructor dependencies for mocks
- ✅ TypeScript validates mock method signatures
- ✅ Works seamlessly with `Layer.service()` composition
- ✅ Clear intent: `mock()` for tests, `value()` for production

## Comparison with Alternatives

| Feature                    | Sandly | NestJS | InversifyJS | TSyringe |
| -------------------------- | ------ | ------ | ----------- | -------- |
| Compile-time type safety   | ✅     | ❌     | ⚠️ Partial  | ❌       |
| No experimental decorators | ✅     | ❌     | ❌          | ❌       |
| Async factories            | ✅     | ✅     | ❌          | ❌       |
| Framework-agnostic         | ✅     | ❌     | ✅          | ✅       |
| Layer composition          | ✅     | ❌     | ❌          | ❌       |
| Zero dependencies          | ✅     | ❌     | ❌          | ❌       |

**Choose Sandly when you want:**

- Type safety without sacrificing simplicity
- DI without experimental decorators
- Composable, reusable dependency modules
- Easy testing with mock injection
- Minimal bundle size and zero dependencies

## License

MIT
