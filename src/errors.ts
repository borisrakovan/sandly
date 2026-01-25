import { AnyTag, Tag } from './tag.js';

/**
 * Structured error information for debugging and logging.
 */
export type ErrorDump = {
	name: string;
	message: string;
	stack?: string;
	detail: Record<string, unknown>;
	cause?: unknown;
};

/**
 * Options for creating Sandly errors.
 */
export type SandlyErrorOptions = {
	cause?: unknown;
	detail?: Record<string, unknown>;
};

/**
 * Base error class for all Sandly library errors.
 *
 * Extends the native Error class to provide consistent error handling
 * and structured error information across the library.
 *
 * @example
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
		// Use cause stack if available
		if (cause instanceof Error && cause.stack !== undefined) {
			this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack}`;
		}
	}

	/**
	 * Wraps any error as a SandlyError.
	 */
	static ensure(error: unknown): SandlyError {
		return error instanceof SandlyError
			? error
			: new SandlyError('An unknown error occurred', { cause: error });
	}

	/**
	 * Returns a structured representation of the error for logging.
	 */
	dump(): ErrorDump {
		return {
			name: this.name,
			message: this.message,
			stack: this.stack,
			detail: this.detail ?? {},
			cause: this.dumpCause(this.cause),
		};
	}

	/**
	 * Returns a JSON string representation of the error.
	 */
	dumps(): string {
		return JSON.stringify(this.dump());
	}

	/**
	 * Recursively extract cause chain from any Error.
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

			if ('cause' in cause && cause.cause !== undefined) {
				result.cause = this.dumpCause(cause.cause);
			}

			return result;
		}

		return cause;
	}
}

/**
 * Error thrown when attempting to use a container that has been destroyed.
 */
export class ContainerDestroyedError extends SandlyError {}

/**
 * Error thrown when attempting to retrieve a dependency that hasn't been registered.
 *
 * @example
 * ```typescript
 * const container = Container.builder().build(); // Empty container
 *
 * try {
 *   await container.resolve(UnregisteredService);
 * } catch (error) {
 *   if (error instanceof UnknownDependencyError) {
 *     console.error('Missing dependency:', error.message);
 *   }
 * }
 * ```
 */
export class UnknownDependencyError extends SandlyError {
	constructor(tag: AnyTag) {
		super(`No factory registered for dependency "${Tag.id(tag)}"`);
	}
}

/**
 * Error thrown when a circular dependency is detected during resolution.
 *
 * @example
 * ```typescript
 * // ServiceA depends on ServiceB, ServiceB depends on ServiceA
 * try {
 *   await container.resolve(ServiceA);
 * } catch (error) {
 *   if (error instanceof CircularDependencyError) {
 *     console.error('Circular dependency:', error.message);
 *     // "Circular dependency detected for ServiceA: ServiceA -> ServiceB -> ServiceA"
 *   }
 * }
 * ```
 */
export class CircularDependencyError extends SandlyError {
	constructor(tag: AnyTag, dependencyChain: AnyTag[]) {
		const chain = dependencyChain.map((t) => Tag.id(t)).join(' -> ');
		super(
			`Circular dependency detected for "${Tag.id(tag)}": ${chain} -> ${Tag.id(tag)}`,
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
 * Error thrown when a dependency factory throws during instantiation.
 *
 * For nested dependencies (A depends on B depends on C), use `getRootCause()`
 * to unwrap all layers and get the original error.
 *
 * @example
 * ```typescript
 * try {
 *   await container.resolve(UserService);
 * } catch (error) {
 *   if (error instanceof DependencyCreationError) {
 *     console.error('Failed to create:', error.message);
 *     const rootCause = error.getRootCause();
 *     console.error('Root cause:', rootCause);
 *   }
 * }
 * ```
 */
export class DependencyCreationError extends SandlyError {
	constructor(tag: AnyTag, error: unknown) {
		super(`Error creating instance of "${Tag.id(tag)}"`, {
			cause: error,
			detail: {
				tag: Tag.id(tag),
			},
		});
	}

	/**
	 * Traverses the error chain to find the root cause error.
	 *
	 * When dependencies are nested, each level wraps the error.
	 * This method unwraps all layers to get the original error.
	 */
	getRootCause(): unknown {
		let current: unknown = this.cause;

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
 * Even if some finalizers fail, cleanup continues for all others.
 * This error aggregates all failures.
 *
 * @example
 * ```typescript
 * try {
 *   await container.destroy();
 * } catch (error) {
 *   if (error instanceof DependencyFinalizationError) {
 *     console.error('Cleanup failures:', error.getRootCauses());
 *   }
 * }
 * ```
 */
export class DependencyFinalizationError extends SandlyError {
	constructor(private readonly errors: unknown[]) {
		const sandlyErrors = errors.map((error) => SandlyError.ensure(error));
		super('Error destroying container', {
			cause: errors[0],
			detail: {
				errors: sandlyErrors.map((error) => error.dump()),
			},
		});
	}

	/**
	 * Returns all root cause errors from the finalization failures.
	 */
	getRootCauses(): unknown[] {
		return this.errors;
	}
}
