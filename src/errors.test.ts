import { describe, expect, it } from 'vitest';
import {
	CircularDependencyError,
	ContainerDestroyedError,
	DependencyCreationError,
	DependencyFinalizationError,
	SandlyError,
	UnknownDependencyError,
} from './errors.js';
import { Tag } from './tag.js';

describe('Error Classes', () => {
	describe('SandlyError', () => {
		it('should create error with message', () => {
			const error = new SandlyError('Something went wrong');

			expect(error.message).toBe('Something went wrong');
			expect(error.name).toBe('SandlyError');
		});

		it('should create error with cause', () => {
			const cause = new Error('Root cause');
			const error = new SandlyError('Wrapped error', { cause });

			expect(error.cause).toBe(cause);
			expect(error.stack).toContain('Caused by:');
		});

		it('should create error with detail', () => {
			const error = new SandlyError('Error with details', {
				detail: { foo: 'bar', count: 42 },
			});

			expect(error.detail).toEqual({ foo: 'bar', count: 42 });
		});

		it('should dump error to structured format', () => {
			const error = new SandlyError('Test error', {
				detail: { key: 'value' },
			});

			const dump = error.dump();

			expect(dump.name).toBe('SandlyError');
			expect(dump.message).toBe('Test error');
			expect(dump.detail).toEqual({ key: 'value' });
			expect(dump.stack).toBeDefined();
		});

		it('should dump nested errors', () => {
			const root = new Error('Root cause');
			const middle = new SandlyError('Middle', { cause: root });
			const top = new SandlyError('Top', { cause: middle });

			const dump = top.dump();

			expect(dump.cause).toBeDefined();
			// @ts-expect-error - accessing nested cause
			expect(dump.cause.message).toBe('Middle');
		});

		it('should serialize to JSON string', () => {
			const error = new SandlyError('Test', { detail: { x: 1 } });

			const json = error.dumps();
			const parsed = JSON.parse(json) as {
				message: string;
				detail: Record<string, unknown>;
			};

			expect(parsed.message).toBe('Test');
			expect(parsed.detail).toEqual({ x: 1 });
		});

		describe('ensure()', () => {
			it('should return SandlyError unchanged', () => {
				const error = new SandlyError('Original');

				expect(SandlyError.ensure(error)).toBe(error);
			});

			it('should wrap non-SandlyError', () => {
				const error = new Error('Plain error');

				const wrapped = SandlyError.ensure(error);

				expect(wrapped).toBeInstanceOf(SandlyError);
				expect(wrapped.cause).toBe(error);
			});

			it('should wrap non-Error values', () => {
				const wrapped = SandlyError.ensure('string error');

				expect(wrapped).toBeInstanceOf(SandlyError);
				expect(wrapped.cause).toBe('string error');
			});
		});
	});

	describe('UnknownDependencyError', () => {
		it('should include tag name for class', () => {
			class UserService {}

			const error = new UnknownDependencyError(UserService);

			expect(error.message).toBe(
				'No factory registered for dependency "UserService"'
			);
		});

		it('should include tag name for ValueTag', () => {
			const _ConfigTag = Tag.of('app.config')<object>();

			const error = new UnknownDependencyError(_ConfigTag);

			expect(error.message).toBe(
				'No factory registered for dependency "app.config"'
			);
		});

		it('should use static Tag property if present', () => {
			class ApiClient {
				static readonly Tag = 'CustomApiClient';
			}

			const error = new UnknownDependencyError(ApiClient);

			expect(error.message).toBe(
				'No factory registered for dependency "CustomApiClient"'
			);
		});
	});

	describe('CircularDependencyError', () => {
		it('should include dependency chain', () => {
			class ServiceA {}
			class ServiceB {}
			class ServiceC {}

			const error = new CircularDependencyError(ServiceA, [
				ServiceA,
				ServiceB,
				ServiceC,
			]);

			expect(error.message).toBe(
				'Circular dependency detected for "ServiceA": ServiceA -> ServiceB -> ServiceC -> ServiceA'
			);
		});

		it('should include chain in detail', () => {
			class ServiceA {}
			class ServiceB {}

			const error = new CircularDependencyError(ServiceA, [
				ServiceA,
				ServiceB,
			]);

			expect(error.detail).toEqual({
				tag: 'ServiceA',
				dependencyChain: ['ServiceA', 'ServiceB'],
			});
		});

		it('should work with ValueTags in chain', () => {
			class ServiceA {}
			const ConfigTag = Tag.of('config')<object>();

			const error = new CircularDependencyError(ServiceA, [
				ServiceA,
				ConfigTag,
			]);

			expect(error.message).toContain('ServiceA -> config -> ServiceA');
		});
	});

	describe('DependencyCreationError', () => {
		it('should wrap factory error', () => {
			class UserService {}
			const cause = new Error('Factory failed');

			const error = new DependencyCreationError(UserService, cause);

			expect(error.message).toBe(
				'Error creating instance of "UserService"'
			);
			expect(error.cause).toBe(cause);
		});

		it('should include tag in detail', () => {
			class UserService {}

			const error = new DependencyCreationError(
				UserService,
				new Error('test')
			);

			expect(error.detail).toEqual({ tag: 'UserService' });
		});

		describe('getRootCause()', () => {
			it('should return direct cause for non-nested errors', () => {
				class ServiceA {}
				const rootError = new Error('Root');

				const error = new DependencyCreationError(ServiceA, rootError);

				expect(error.getRootCause()).toBe(rootError);
			});

			it('should unwrap nested DependencyCreationErrors', () => {
				class ServiceA {}
				class ServiceB {}
				class ServiceC {}

				const rootError = new Error('Database connection failed');
				const errorC = new DependencyCreationError(ServiceC, rootError);
				const errorB = new DependencyCreationError(ServiceB, errorC);
				const errorA = new DependencyCreationError(ServiceA, errorB);

				expect(errorA.getRootCause()).toBe(rootError);
			});

			it('should stop at non-DependencyCreationError', () => {
				class ServiceA {}
				class ServiceB {}

				const customError = new SandlyError('Custom error');
				const errorB = new DependencyCreationError(
					ServiceB,
					customError
				);
				const errorA = new DependencyCreationError(ServiceA, errorB);

				expect(errorA.getRootCause()).toBe(customError);
			});
		});
	});

	describe('DependencyFinalizationError', () => {
		it('should aggregate multiple errors', () => {
			const error1 = new Error('Cleanup 1 failed');
			const error2 = new Error('Cleanup 2 failed');

			const error = new DependencyFinalizationError([error1, error2]);

			expect(error.message).toBe('Error destroying container');
			expect(error.cause).toBe(error1); // First error as cause
		});

		it('should return all root causes', () => {
			const error1 = new Error('Error 1');
			const error2 = new Error('Error 2');
			const error3 = new Error('Error 3');

			const error = new DependencyFinalizationError([
				error1,
				error2,
				error3,
			]);

			const causes = error.getRootCauses();
			expect(causes).toHaveLength(3);
			expect(causes).toContain(error1);
			expect(causes).toContain(error2);
			expect(causes).toContain(error3);
		});

		it('should include errors in detail', () => {
			const error1 = new Error('Error 1');

			const error = new DependencyFinalizationError([error1]);

			expect(error.detail?.errors).toBeDefined();
			expect(Array.isArray(error.detail?.errors)).toBe(true);
		});
	});

	describe('ContainerDestroyedError', () => {
		it('should create with message', () => {
			const error = new ContainerDestroyedError(
				'Container was destroyed'
			);

			expect(error.message).toBe('Container was destroyed');
			expect(error).toBeInstanceOf(SandlyError);
		});
	});
});
