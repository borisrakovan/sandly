import { AnyTag, Tag } from './tag.js';

export type ErrorDump = {
	name: string;
	message: string;
	stack?: string;
	detail: Record<string, unknown>;
	cause?: unknown;
};

export type SandlyErrorOptions = {
	cause?: unknown;
	detail?: Record<string, unknown>;
};

/**
 * Base error class for all library errors.
 *
 * This extends the native Error class to provide consistent error handling
 * and structured error information across the library.
 *
 * @example Catching library errors
 * ```typescript
 * try {
 *   await container.resolve(SomeService);
 * } catch (error) {
 *   if (error instanceof SandlyError) {
 *     console.error('DI Error:', error.message);
 *     console.error('Details:', error.detail);
 *   }
 * }
 * ```
 */
export class SandlyError extends Error {
	detail: Record<string, unknown> | undefined;

	constructor(message: string, { cause, detail }: SandlyErrorOptions = {}) {
		super(message, { cause });
		this.name = this.constructor.name;
		this.detail = detail;
		// Use cause stack if available, otherwise fall back to the current error's stack
		if (cause instanceof Error && cause.stack !== undefined) {
			this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack}`;
		}
	}

	static ensure(error: unknown): SandlyError {
		return error instanceof SandlyError
			? error
			: new SandlyError('An unknown error occurred', { cause: error });
	}

	dump(): ErrorDump {
		return {
			name: this.name,
			message: this.message,
			stack: this.stack,
			detail: this.detail ?? {},
			cause: this.dumpCause(this.cause),
		};
	}

	dumps(): string {
		return JSON.stringify(this.dump());
	}

	/**
	 * Recursively extract cause chain from any Error.
	 * Handles both AppError (with dump()) and plain Errors (with cause property).
	 */
	private dumpCause(cause: unknown): unknown {
		if (cause instanceof SandlyError) {
			return cause.dump();
		}

		if (cause instanceof Error) {
			const result: Record<string, unknown> = {
				name: cause.name,
				message: cause.message,
			};

			// Recursively extract nested cause if present
			if ('cause' in cause && cause.cause !== undefined) {
				result.cause = this.dumpCause(cause.cause);
			}

			return result;
		}

		return cause;
	}
}

/**
 * Error thrown when attempting to register a dependency that has already been instantiated.
 *
 * This error occurs when calling `container.register()` for a tag that has already been instantiated.
 * Registration must happen before any instantiation occurs, as cached instances would still be used
 * by existing dependencies.
 */
export class DependencyAlreadyInstantiatedError extends SandlyError {}

/**
 * Error thrown when attempting to use a container that has been destroyed.
 *
 * This error occurs when calling `container.resolve()`, `container.register()`, or `container.destroy()`
 * on a container that has already been destroyed. It indicates a programming error where the container
 * is being used after it has been destroyed.
 */
export class ContainerDestroyedError extends SandlyError {}

/**
 * Error thrown when attempting to retrieve a dependency that hasn't been registered.
 *
 * This error occurs when calling `container.resolve(Tag)` for a tag that was never
 * registered via `container.register()`. It indicates a programming error where
 * the dependency setup is incomplete.
 *
 * @example
 * ```typescript
 * const container = Container.empty(); // Empty container
 *
 * try {
 *   await c.resolve(UnregisteredService); // This will throw
 * } catch (error) {
 *   if (error instanceof UnknownDependencyError) {
 *     console.error('Missing dependency:', error.message);
 *   }
 * }
 * ```
 */
export class UnknownDependencyError extends SandlyError {
	/**
	 * @internal
	 * Creates an UnknownDependencyError for the given tag.
	 *
	 * @param tag - The dependency tag that wasn't found
	 */
	constructor(tag: AnyTag) {
		super(`No factory registered for dependency ${String(Tag.id(tag))}`);
	}
}

/**
 * Error thrown when a circular dependency is detected during dependency resolution.
 *
 * This occurs when service A depends on service B, which depends on service A (directly
 * or through a chain of dependencies). The error includes the full dependency chain
 * to help identify the circular reference.
 *
 * @example Circular dependency scenario
 * ```typescript
 * class ServiceA extends Tag.Service('ServiceA') {}
 * class ServiceB extends Tag.Service('ServiceB') {}
 *
 * const container = Container.empty()
 *   .register(ServiceA, async (ctx) =>
 *     new ServiceA(await ctx.resolve(ServiceB)) // Depends on B
 *   )
 *   .register(ServiceB, async (ctx) =>
 *     new ServiceB(await ctx.resolve(ServiceA)) // Depends on A - CIRCULAR!
 *   );
 *
 * try {
 *   await c.resolve(ServiceA);
 * } catch (error) {
 *   if (error instanceof CircularDependencyError) {
 *     console.error('Circular dependency:', error.message);
 *     // Output: "Circular dependency detected for ServiceA: ServiceA -> ServiceB -> ServiceA"
 *   }
 * }
 * ```
 */
export class CircularDependencyError extends SandlyError {
	/**
	 * @internal
	 * Creates a CircularDependencyError with the dependency chain information.
	 *
	 * @param tag - The tag where the circular dependency was detected
	 * @param dependencyChain - The chain of dependencies that led to the circular reference
	 */
	constructor(tag: AnyTag, dependencyChain: AnyTag[]) {
		const chain = dependencyChain.map((t) => Tag.id(t)).join(' -> ');
		super(
			`Circular dependency detected for ${String(Tag.id(tag))}: ${chain} -> ${String(Tag.id(tag))}`,
			{
				detail: {
					tag: Tag.id(tag),
					dependencyChain: dependencyChain.map((t) => Tag.id(t)),
				},
			}
		);
	}
}

/**
 * Error thrown when a dependency factory function throws an error during instantiation.
 *
 * This wraps the original error with additional context about which dependency
 * failed to be created. The original error is preserved as the `cause` property.
 *
 * When dependencies are nested (A depends on B depends on C), and C's factory throws,
 * you get nested DependencyCreationErrors. Use `getRootCause()` to get the original error.
 *
 * @example Factory throwing error
 * ```typescript
 * class DatabaseService extends Tag.Service('DatabaseService') {}
 *
 * const container = Container.empty().register(DatabaseService, () => {
 *   throw new Error('Database connection failed');
 * });
 *
 * try {
 *   await c.resolve(DatabaseService);
 * } catch (error) {
 *   if (error instanceof DependencyCreationError) {
 *     console.error('Failed to create:', error.message);
 *     console.error('Original error:', error.cause);
 *   }
 * }
 * ```
 *
 * @example Getting root cause from nested errors
 * ```typescript
 * // ServiceA -> ServiceB -> ServiceC (ServiceC throws)
 * try {
 *   await container.resolve(ServiceA);
 * } catch (error) {
 *   if (error instanceof DependencyCreationError) {
 *     console.error('Top-level error:', error.message); // "Error creating instance of ServiceA"
 *     const rootCause = error.getRootCause();
 *     console.error('Root cause:', rootCause); // Original error from ServiceC
 *   }
 * }
 * ```
 */
export class DependencyCreationError extends SandlyError {
	/**
	 * @internal
	 * Creates a DependencyCreationError wrapping the original factory error.
	 *
	 * @param tag - The tag of the dependency that failed to be created
	 * @param error - The original error thrown by the factory function
	 */
	constructor(tag: AnyTag, error: unknown) {
		super(`Error creating instance of ${String(Tag.id(tag))}`, {
			cause: error,
			detail: {
				tag: Tag.id(tag),
			},
		});
	}

	/**
	 * Traverses the error chain to find the root cause error.
	 *
	 * When dependencies are nested, each level wraps the error in a DependencyCreationError.
	 * This method unwraps all the layers to get to the original error that started the failure.
	 *
	 * @returns The root cause error (not a DependencyCreationError unless that's the only error)
	 *
	 * @example
	 * ```typescript
	 * try {
	 *   await container.resolve(UserService);
	 * } catch (error) {
	 *   if (error instanceof DependencyCreationError) {
	 *     const rootCause = error.getRootCause();
	 *     console.error('Root cause:', rootCause);
	 *   }
	 * }
	 * ```
	 */
	getRootCause(): unknown {
		let current: unknown = this.cause;

		// Traverse the chain while we have DependencyCreationErrors
		while (
			current instanceof DependencyCreationError &&
			current.cause !== undefined
		) {
			current = current.cause;
		}

		return current;
	}
}

/**
 * Error thrown when one or more finalizers fail during container destruction.
 *
 * This error aggregates multiple finalizer failures that occurred during
 * `container.destroy()`. Even if some finalizers fail, the container cleanup
 * process continues and this error contains details of all failures.
 *
 * @example Handling finalization errors
 * ```typescript
 * try {
 *   await container.destroy();
 * } catch (error) {
 *   if (error instanceof DependencyFinalizationError) {
 *     console.error('Some finalizers failed');
 *     console.error('Error details:', error.detail.errors);
 *   }
 * }
 * ```
 */
export class DependencyFinalizationError extends SandlyError {
	/**
	 * @internal
	 * Creates a DependencyFinalizationError aggregating multiple finalizer failures.
	 *
	 * @param errors - Array of errors thrown by individual finalizers
	 */
	constructor(private readonly errors: unknown[]) {
		const lambdaErrors = errors.map((error) => SandlyError.ensure(error));
		super('Error destroying dependency container', {
			cause: errors[0],
			detail: {
				errors: lambdaErrors.map((error) => error.dump()),
			},
		});
	}

	/**
	 * Returns the root causes of the errors that occurred during finalization.
	 *
	 * @returns An array of the errors that occurred during finalization.
	 * You can expect at least one error in the array.
	 */
	getRootCauses(): unknown[] {
		return this.errors;
	}
}
