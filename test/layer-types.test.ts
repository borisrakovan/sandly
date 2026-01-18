import { Container } from '@/container.js';
import { Layer, layer } from '@/layer.js';
import { ScopedContainer } from '@/scoped-container.js';
import { Tag } from '@/tag.js';
import { describe, expectTypeOf, it } from 'vitest';

describe('Layer Type Safety', () => {
	describe('layer register should preserve Container type', () => {
		it('should return Container type', () => {
			class ServiceA extends Tag.Service('ServiceA') {}

			const testLayer = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const container = testLayer.register(Container.empty());

			expectTypeOf(container).toEqualTypeOf<Container<typeof ServiceA>>();
		});

		it('should preserve Container type through provide composition', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
					)
			);

			const composedLayer = layerB.provide(layerA);
			const container = composedLayer.register(
				ScopedContainer.empty('test')
			);

			expectTypeOf(container).toEqualTypeOf<
				ScopedContainer<typeof ServiceB>
			>();
		});

		it('should preserve Container type through merge composition', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<never, typeof ServiceB>((container) =>
				container.register(ServiceB, () => new ServiceB())
			);

			const mergedLayer = layerA.merge(layerB);
			const container = mergedLayer.register(Container.empty());

			expectTypeOf(container).toEqualTypeOf<
				Container<typeof ServiceA | typeof ServiceB>
			>();
		});

		it('should preserve Container type through Layer.mergeAll', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<never, typeof ServiceB>((container) =>
				container.register(ServiceB, () => new ServiceB())
			);

			const layerC = layer<never, typeof ServiceC>((container) =>
				container.register(ServiceC, () => new ServiceC())
			);

			const mergedLayer = Layer.mergeAll(layerA, layerB, layerC);
			const container = mergedLayer.register(Container.empty());

			expectTypeOf(container).toEqualTypeOf<
				Container<typeof ServiceA | typeof ServiceB | typeof ServiceC>
			>();
		});
	});

	describe('basic layer types', () => {
		it('should create layer with correct requirement and provision types', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const testLayer = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
					)
			);

			expectTypeOf(testLayer).toEqualTypeOf<
				Layer<typeof ServiceA, typeof ServiceB>
			>();
		});

		it('should create layer with no requirements', () => {
			class ServiceA extends Tag.Service('ServiceA') {}

			const testLayer = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			expectTypeOf(testLayer).toEqualTypeOf<
				Layer<never, typeof ServiceA>
			>();
		});

		it('should create layer with multiple provisions', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const testLayer = layer<never, typeof ServiceA | typeof ServiceB>(
				(container) =>
					container
						.register(ServiceA, () => new ServiceA())
						.register(ServiceB, () => new ServiceB())
			);

			expectTypeOf(testLayer).toEqualTypeOf<
				Layer<never, typeof ServiceA | typeof ServiceB>
			>();
		});

		it('should create layer with multiple requirements and provisions', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}
			class ServiceD extends Tag.Service('ServiceD') {}

			const testLayer = layer<
				typeof ServiceA | typeof ServiceB,
				typeof ServiceC | typeof ServiceD
			>((container) =>
				container
					.register(
						ServiceC,
						async (ctx) => new ServiceC(await ctx.resolve(ServiceA))
					)
					.register(
						ServiceD,
						async (ctx) => new ServiceD(await ctx.resolve(ServiceB))
					)
			);

			expectTypeOf(testLayer).toEqualTypeOf<
				Layer<
					typeof ServiceA | typeof ServiceB,
					typeof ServiceC | typeof ServiceD
				>
			>();
		});
	});

	describe('layer composition with "provide"', () => {
		it('should compose layers with correct type inference', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
					)
			);

			const composedLayer = layerB.provide(layerA);

			// ServiceA requirement is satisfied by layerA's provision
			// Result should require nothing and provide only ServiceB (target layer's provisions)
			expectTypeOf(composedLayer).toEqualTypeOf<
				Layer<never, typeof ServiceB>
			>();
		});

		it('should preserve external requirements in composition', () => {
			class ExternalService extends Tag.Service('ExternalService') {}
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const layerA = layer<typeof ExternalService, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (ctx) =>
							new ServiceA(await ctx.resolve(ExternalService))
					)
			);

			const layerB = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
					)
			);

			const composedLayer = layerB.provide(layerA);

			// ExternalService is still required (not satisfied by layerA)
			// Only ServiceB is provided (target layer's provisions)
			expectTypeOf(composedLayer).toEqualTypeOf<
				Layer<typeof ExternalService, typeof ServiceB>
			>();
		});

		it('should handle partial requirement satisfaction', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}
			class ServiceD extends Tag.Service('ServiceD') {}

			// Layer provides ServiceA and ServiceB
			const providerLayer = layer<
				never,
				typeof ServiceA | typeof ServiceB
			>((container) =>
				container
					.register(ServiceA, () => new ServiceA())
					.register(ServiceB, () => new ServiceB())
			);

			// Layer requires ServiceA, ServiceB, and ServiceC; provides ServiceD
			const consumerLayer = layer<
				typeof ServiceA | typeof ServiceB | typeof ServiceC,
				typeof ServiceD
			>((container) =>
				container.register(
					ServiceD,
					async (ctx) =>
						new ServiceD(
							await ctx.resolve(ServiceA),
							await ctx.resolve(ServiceB),
							await ctx.resolve(ServiceC)
						)
				)
			);

			const composedLayer = consumerLayer.provide(providerLayer);

			// ServiceA and ServiceB satisfied, ServiceC still required
			// Only ServiceD is provided (target layer's provisions)
			expectTypeOf(composedLayer).toEqualTypeOf<
				Layer<typeof ServiceC, typeof ServiceD>
			>();
		});
	});

	describe('layer merging with "merge"', () => {
		it('should merge independent layers correctly', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<never, typeof ServiceB>((container) =>
				container.register(ServiceB, () => new ServiceB())
			);

			const mergedLayer = layerB.merge(layerA);

			expectTypeOf(mergedLayer).toEqualTypeOf<
				Layer<never, typeof ServiceA | typeof ServiceB>
			>();
		});

		it('should combine requirements from both layers', () => {
			class ExternalA extends Tag.Service('ExternalA') {}
			class ExternalB extends Tag.Service('ExternalB') {}
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const layerA = layer<typeof ExternalA, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (ctx) =>
							new ServiceA(await ctx.resolve(ExternalA))
					)
			);

			const layerB = layer<typeof ExternalB, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) =>
							new ServiceB(await ctx.resolve(ExternalB))
					)
			);

			const mergedLayer = layerB.merge(layerA);

			expectTypeOf(mergedLayer).toEqualTypeOf<
				Layer<
					typeof ExternalA | typeof ExternalB,
					typeof ServiceA | typeof ServiceB
				>
			>();
		});

		it('should handle overlapping requirements', () => {
			class SharedExternal extends Tag.Service('SharedExternal') {}
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const layerA = layer<typeof SharedExternal, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (ctx) =>
							new ServiceA(await ctx.resolve(SharedExternal))
					)
			);

			const layerB = layer<typeof SharedExternal, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) =>
							new ServiceB(await ctx.resolve(SharedExternal))
					)
			);

			const mergedLayer = layerA.merge(layerB);

			// SharedExternal appears in both requirements, but union should deduplicate
			expectTypeOf(mergedLayer).toEqualTypeOf<
				Layer<typeof SharedExternal, typeof ServiceA | typeof ServiceB>
			>();
		});
	});

	describe('value tag support', () => {
		it('should work with value tags', () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();

			const configLayer = layer<
				never,
				typeof StringTag | typeof NumberTag
			>((container) =>
				container
					.register(StringTag, () => 'hello')
					.register(NumberTag, () => 42)
			);

			expectTypeOf(configLayer).toEqualTypeOf<
				Layer<never, typeof StringTag | typeof NumberTag>
			>();
		});

		it('should mix service tags and value tags', () => {
			const ConfigTag = Tag.of('config')<{ apiKey: string }>();
			class ApiService extends Tag.Service('ApiService') {}

			const configLayer = layer<never, typeof ConfigTag>((container) =>
				container.register(ConfigTag, () => ({ apiKey: 'secret' }))
			);

			const serviceLayer = layer<typeof ConfigTag, typeof ApiService>(
				(container) =>
					container.register(
						ApiService,
						async (ctx) =>
							new ApiService(await ctx.resolve(ConfigTag))
					)
			);

			const appLayer = serviceLayer.provide(configLayer);

			expectTypeOf(appLayer).toEqualTypeOf<
				Layer<never, typeof ApiService>
			>();
		});
	});

	describe('Layer utilities type safety', () => {
		it('should type Layer.empty() correctly', () => {
			const emptyLayer = Layer.empty();

			expectTypeOf(emptyLayer).toEqualTypeOf<Layer<never, never>>();
		});

		it('should type Layer.merge() correctly for two layers', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ExternalA extends Tag.Service('ExternalA') {}
			class ExternalB extends Tag.Service('ExternalB') {}

			const layerA = layer<typeof ExternalA, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (ctx) =>
							new ServiceA(await ctx.resolve(ExternalA))
					)
			);

			const layerB = layer<typeof ExternalB, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) =>
							new ServiceB(await ctx.resolve(ExternalB))
					)
			);

			const mergedLayer = Layer.merge(layerA, layerB);

			expectTypeOf(mergedLayer).toEqualTypeOf<
				Layer<
					typeof ExternalA | typeof ExternalB,
					typeof ServiceA | typeof ServiceB
				>
			>();
		});

		it('should type Layer.mergeAll() correctly', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}
			class ExternalA extends Tag.Service('ExternalA') {}
			class ExternalC extends Tag.Service('ExternalC') {}

			const layerA = layer<typeof ExternalA, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (ctx) =>
							new ServiceA(await ctx.resolve(ExternalA))
					)
			);

			const layerB = layer<never, typeof ServiceB>((container) =>
				container.register(ServiceB, () => new ServiceB())
			);

			const layerC = layer<typeof ExternalC, typeof ServiceC>(
				(container) =>
					container.register(
						ServiceC,
						async (ctx) =>
							new ServiceC(await ctx.resolve(ExternalC))
					)
			);

			const mergedLayer = Layer.mergeAll(layerA, layerB, layerC);

			expectTypeOf(mergedLayer).toEqualTypeOf<
				Layer<
					typeof ExternalA | typeof ExternalC,
					typeof ServiceA | typeof ServiceB | typeof ServiceC
				>
			>();
		});
	});

	describe('layer register method type constraints', () => {
		it('should constrain layer register to require satisfied dependencies', () => {
			class ExternalService extends Tag.Service('ExternalService') {}
			class ProvidedService extends Tag.Service('ProvidedService') {}

			const testLayer = layer<
				typeof ExternalService,
				typeof ProvidedService
			>((container) =>
				container.register(ProvidedService, async (ctx) => {
					// Container should have ExternalService available
					expectTypeOf(ctx.resolve(ExternalService)).toEqualTypeOf<
						Promise<ExternalService>
					>();

					return new ProvidedService(
						await ctx.resolve(ExternalService)
					);
				})
			);

			// Test that the layer can only be applied to containers that provide ExternalService
			const baseContainer = Container.empty().register(
				ExternalService,
				() => new ExternalService()
			);
			const finalContainer = testLayer.register(baseContainer);

			expectTypeOf(finalContainer.resolve(ProvidedService)).toEqualTypeOf<
				Promise<ProvidedService>
			>();
		});
	});

	describe('complex layer composition scenarios', () => {
		it('should handle deep layer composition chains', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}
			class ServiceD extends Tag.Service('ServiceD') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
					)
			);

			const layerC = layer<typeof ServiceB, typeof ServiceC>(
				(container) =>
					container.register(
						ServiceC,
						async (ctx) => new ServiceC(await ctx.resolve(ServiceB))
					)
			);

			const layerD = layer<typeof ServiceC, typeof ServiceD>(
				(container) =>
					container.register(
						ServiceD,
						async (ctx) => new ServiceD(await ctx.resolve(ServiceC))
					)
			);

			const finalLayer = layerD
				.provide(layerC)
				.provide(layerB)
				.provide(layerA);

			expectTypeOf(finalLayer).toEqualTypeOf<
				Layer<never, typeof ServiceD>
			>();
		});

		it('should handle complex mixed composition and merging', () => {
			class BaseService extends Tag.Service('BaseService') {}
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}
			class CompositeService extends Tag.Service('CompositeService') {}

			const baseLayer = layer<never, typeof BaseService>((container) =>
				container.register(BaseService, () => new BaseService())
			);

			const branchA = layer<typeof BaseService, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (ctx) =>
							new ServiceA(await ctx.resolve(BaseService))
					)
			);

			const branchB = layer<typeof BaseService, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) =>
							new ServiceB(await ctx.resolve(BaseService))
					)
			);

			const independentC = layer<never, typeof ServiceC>((container) =>
				container.register(ServiceC, () => new ServiceC())
			);

			const compositeLayer = layer<
				typeof ServiceA | typeof ServiceB | typeof ServiceC,
				typeof CompositeService
			>((container) =>
				container.register(
					CompositeService,
					async (ctx) =>
						new CompositeService(
							await ctx.resolve(ServiceA),
							await ctx.resolve(ServiceB),
							await ctx.resolve(ServiceC)
						)
				)
			);

			// Base provides to both branches, merge branches with independent, then compose
			const finalLayer = compositeLayer
				.provide(branchA.merge(branchB))
				.provide(baseLayer.merge(independentC));

			expectTypeOf(finalLayer).toEqualTypeOf<
				Layer<never, typeof CompositeService>
			>();
		});
	});

	describe('error prevention at type level', () => {
		it('should prevent composition of incompatible layers at compile time', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class UnrelatedService extends Tag.Service('UnrelatedService') {}

			const providerLayer = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const requiresB = layer<typeof ServiceB, typeof UnrelatedService>(
				(container) =>
					container.register(
						UnrelatedService,
						async (ctx) =>
							new UnrelatedService(await ctx.resolve(ServiceB))
					)
			);

			// This composition should work at type level but leave ServiceB unsatisfied
			const composed = requiresB.provide(providerLayer);

			// The result should still require ServiceB since providerLayer doesn't provide it
			// Only UnrelatedService is provided (target layer's provisions)
			expectTypeOf(composed).toEqualTypeOf<
				Layer<typeof ServiceB, typeof UnrelatedService>
			>();
		});
	});

	describe('layer composition with "provideMerge"', () => {
		it("should compose layers and expose both layers' provisions", () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
					)
			);

			const composedLayer = layerB.provideMerge(layerA);

			// ServiceA requirement is satisfied by layerA's provision
			// Result should require nothing and provide both ServiceA and ServiceB
			expectTypeOf(composedLayer).toEqualTypeOf<
				Layer<never, typeof ServiceA | typeof ServiceB>
			>();
		});

		it('should preserve external requirements and expose both provisions', () => {
			class ExternalService extends Tag.Service('ExternalService') {}
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const layerA = layer<typeof ExternalService, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (ctx) =>
							new ServiceA(await ctx.resolve(ExternalService))
					)
			);

			const layerB = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
					)
			);

			const composedLayer = layerB.provideMerge(layerA);

			// ExternalService is still required (not satisfied by layerA)
			// Both ServiceA and ServiceB are provided
			expectTypeOf(composedLayer).toEqualTypeOf<
				Layer<typeof ExternalService, typeof ServiceA | typeof ServiceB>
			>();
		});

		it('should handle partial requirement satisfaction with merged provisions', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}
			class ServiceD extends Tag.Service('ServiceD') {}

			// Layer provides ServiceA and ServiceB
			const providerLayer = layer<
				never,
				typeof ServiceA | typeof ServiceB
			>((container) =>
				container
					.register(ServiceA, () => new ServiceA())
					.register(ServiceB, () => new ServiceB())
			);

			// Layer requires ServiceA, ServiceB, and ServiceC; provides ServiceD
			const consumerLayer = layer<
				typeof ServiceA | typeof ServiceB | typeof ServiceC,
				typeof ServiceD
			>((container) =>
				container.register(
					ServiceD,
					async (ctx) =>
						new ServiceD(
							await ctx.resolve(ServiceA),
							await ctx.resolve(ServiceB),
							await ctx.resolve(ServiceC)
						)
				)
			);

			const composedLayer = consumerLayer.provideMerge(providerLayer);

			// ServiceA and ServiceB satisfied, ServiceC still required
			// All provisions from both layers are exposed
			expectTypeOf(composedLayer).toEqualTypeOf<
				Layer<
					typeof ServiceC,
					typeof ServiceA | typeof ServiceB | typeof ServiceD
				>
			>();
		});

		it('should differ from .provide() in type signature', () => {
			class ConfigService extends Tag.Service('ConfigService') {}
			class DatabaseService extends Tag.Service('DatabaseService') {}

			const configLayer = layer<never, typeof ConfigService>(
				(container) =>
					container.register(ConfigService, () => new ConfigService())
			);

			const databaseLayer = layer<
				typeof ConfigService,
				typeof DatabaseService
			>((container) =>
				container.register(
					DatabaseService,
					async (ctx) =>
						new DatabaseService(await ctx.resolve(ConfigService))
				)
			);

			// .provide() only exposes target layer's provisions
			const withProvide = databaseLayer.provide(configLayer);
			expectTypeOf(withProvide).toEqualTypeOf<
				Layer<never, typeof DatabaseService>
			>();

			// .provideMerge() exposes both layers' provisions
			const withProvideMerge = databaseLayer.provideMerge(configLayer);
			expectTypeOf(withProvideMerge).toEqualTypeOf<
				Layer<never, typeof ConfigService | typeof DatabaseService>
			>();
		});

		it('should work with value tags', () => {
			const ConfigTag = Tag.of('config')<{ apiKey: string }>();
			class ApiService extends Tag.Service('ApiService') {}

			const configLayer = layer<never, typeof ConfigTag>((container) =>
				container.register(ConfigTag, () => ({ apiKey: 'secret' }))
			);

			const serviceLayer = layer<typeof ConfigTag, typeof ApiService>(
				(container) =>
					container.register(
						ApiService,
						async (ctx) =>
							new ApiService(await ctx.resolve(ConfigTag))
					)
			);

			const appLayer = serviceLayer.provideMerge(configLayer);

			expectTypeOf(appLayer).toEqualTypeOf<
				Layer<never, typeof ConfigTag | typeof ApiService>
			>();
		});

		it('should handle deep composition chains with merged provisions', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}
			class ServiceD extends Tag.Service('ServiceD') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
					)
			);

			const layerC = layer<typeof ServiceB, typeof ServiceC>(
				(container) =>
					container.register(
						ServiceC,
						async (ctx) => new ServiceC(await ctx.resolve(ServiceB))
					)
			);

			const layerD = layer<typeof ServiceC, typeof ServiceD>(
				(container) =>
					container.register(
						ServiceD,
						async (ctx) => new ServiceD(await ctx.resolve(ServiceC))
					)
			);

			const finalLayer = layerD
				.provideMerge(layerC)
				.provideMerge(layerB)
				.provideMerge(layerA);

			expectTypeOf(finalLayer).toEqualTypeOf<
				Layer<
					never,
					| typeof ServiceA
					| typeof ServiceB
					| typeof ServiceC
					| typeof ServiceD
				>
			>();
		});

		it('should handle mixed .provide() and .provideMerge() composition', () => {
			class ConfigService extends Tag.Service('ConfigService') {}
			class DatabaseService extends Tag.Service('DatabaseService') {}
			class UserService extends Tag.Service('UserService') {}

			const configLayer = layer<never, typeof ConfigService>(
				(container) =>
					container.register(ConfigService, () => new ConfigService())
			);

			const databaseLayer = layer<
				typeof ConfigService,
				typeof DatabaseService
			>((container) =>
				container.register(
					DatabaseService,
					async (ctx) =>
						new DatabaseService(await ctx.resolve(ConfigService))
				)
			);

			const userLayer = layer<typeof DatabaseService, typeof UserService>(
				(container) =>
					container.register(
						UserService,
						async (ctx) =>
							new UserService(await ctx.resolve(DatabaseService))
					)
			);

			// Use provideMerge to keep config available, then provide to hide intermediate services
			const appLayer = userLayer
				.provide(databaseLayer)
				.provide(configLayer);

			expectTypeOf(appLayer).toEqualTypeOf<
				Layer<never, typeof UserService>
			>();
		});
	});

	describe('layer variance', () => {
		it('should support contravariance for TRequires and covariance for TProvides', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}

			// Create layers with specific types
			const layerAB = layer<
				typeof ServiceA,
				typeof ServiceB | typeof ServiceC
			>((container) =>
				container
					.register(
						ServiceB,
						async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
					)
					.register(ServiceC, () => new ServiceC())
			);

			const layerNeverB = layer<never, typeof ServiceB>((container) =>
				container.register(ServiceB, () => new ServiceB())
			);

			// COVARIANCE TESTS: Layers requiring fewer dependencies can substitute ones requiring more
			// Layer<never, X> can be used where Layer<ServiceA, X> is expected (less demanding is more compatible)

			const covariantRequires: Layer<typeof ServiceA, typeof ServiceB> =
				layerNeverB;
			expectTypeOf(covariantRequires).toEqualTypeOf<
				Layer<typeof ServiceA, typeof ServiceB>
			>();

			// CONTRAVARIANCE TESTS: Layers providing more services can substitute ones providing fewer
			// Layer<X, ServiceB | ServiceC> can be used where Layer<X, ServiceB> is expected (more generous is more compatible)

			const contravariantProvides: Layer<
				typeof ServiceA,
				typeof ServiceB
			> = layerAB;
			expectTypeOf(contravariantProvides).toEqualTypeOf<
				Layer<typeof ServiceA, typeof ServiceB>
			>();

			// INVALID ASSIGNMENTS: These should fail

			// @ts-expect-error - Cannot assign layer requiring more to one requiring less (covariance violation)
			const _invalidCovariant: Layer<never, typeof ServiceB> = layerAB;

			// @ts-expect-error - Cannot assign layer providing fewer to one providing more (contravariance violation)
			const _invalidContravariant: Layer<
				typeof ServiceA,
				typeof ServiceB | typeof ServiceC
			> = layerNeverB;
		});
	});
});
