import type { DependencySpec, IContainerBuilder } from './container.js';
import {
	DuplicateOverrideError,
	DuplicateProviderError,
	OverrideTargetNotFoundError,
} from './errors.js';
import type { AnyLayer } from './layer.js';
import type { AnyTag } from './tag.js';

/**
 * Key under which every layer carries its node in the composition graph.
 * @internal
 */
export const LayerNodeKey: unique symbol = Symbol.for('sandly/LayerNode');

/**
 * Where a leaf layer was created. Holds a captured stack trace that is only
 * formatted when an error reports it.
 * @internal
 */
export type DefinitionSite = { stack?: string };

/**
 * A layer that registers providers itself (`Layer.service`, `Layer.value`,
 * `Layer.create`, ...), as opposed to a composition of other layers.
 * @internal
 */
export type LeafNode = {
	readonly kind: 'leaf';
	readonly register: (builder: IContainerBuilder<AnyTag>) => void;
	readonly site: DefinitionSite;
	/** Value bound by `Layer.value` / `Layer.mock`; equal bindings of one tag are one provider. */
	readonly binding?: { readonly value: unknown };
};

/**
 * A node in the layer composition graph. The graph is a DAG: one layer object
 * is typically referenced by many parents.
 * @internal
 */
export type LayerNode =
	| LeafNode
	| {
			readonly kind: 'provide';
			readonly target: AnyLayer;
			readonly dependency: AnyLayer;
	  }
	| { readonly kind: 'merge'; readonly layers: readonly AnyLayer[] }
	| {
			readonly kind: 'override';
			readonly base: AnyLayer;
			readonly replacement: AnyLayer;
	  };

/**
 * One registration produced by a leaf layer.
 * @internal
 */
export type Provider = {
	readonly tag: AnyTag;
	readonly spec: DependencySpec<AnyTag, AnyTag>;
	readonly leaf: LeafNode;
};

type CaptureStackTrace = (
	target: object,
	constructorOpt?: (...args: never[]) => unknown
) => void;

/**
 * Captures the site that called `api`, a public Sandly function. Frames from
 * `api` inward are omitted, so the first frame is the caller's line.
 * @internal
 */
export function captureDefinitionSite(
	api: (...args: never[]) => unknown
): DefinitionSite {
	const site: DefinitionSite = {};
	// V8 and JavaScriptCore only; on other engines layers carry no site.
	const { captureStackTrace } = Error as {
		captureStackTrace?: CaptureStackTrace;
	};
	captureStackTrace?.(site, api);
	return site;
}

function formatSite(site: DefinitionSite): string | undefined {
	const frame = site.stack
		?.split('\n')
		.find((line) => line.trimStart().startsWith('at '));
	return frame?.trim().slice('at '.length);
}

type Mode = 'regular' | 'override';

/**
 * Walks the composition graph once per node and mode, collecting leaves.
 *
 * Leaves exposed by an override's replacement are override leaves; the
 * replacement's own dependencies (what it `provide()`s internally) stay
 * regular, mirroring which provisions the replacement's type exposes.
 */
function collectLeaves(root: AnyLayer): {
	regular: LeafNode[];
	overrides: LeafNode[];
} {
	const visited: Record<Mode, Set<LayerNode>> = {
		regular: new Set(),
		override: new Set(),
	};
	const leaves: Record<Mode, Set<LeafNode>> = {
		regular: new Set(),
		override: new Set(),
	};

	const visit = (layer: AnyLayer, mode: Mode): void => {
		const node = layer[LayerNodeKey];
		if (visited[mode].has(node)) {
			return;
		}
		visited[mode].add(node);

		switch (node.kind) {
			case 'leaf':
				leaves[mode].add(node);
				return;
			case 'provide':
				visit(node.target, mode);
				visit(node.dependency, 'regular');
				return;
			case 'merge':
				for (const child of node.layers) {
					visit(child, mode);
				}
				return;
			case 'override':
				visit(node.base, mode);
				visit(node.replacement, 'override');
				return;
		}
	};

	visit(root, 'regular');
	return {
		regular: [...leaves.regular].filter(
			(leaf) => !leaves.override.has(leaf)
		),
		overrides: [...leaves.override],
	};
}

function registerAll(leaves: readonly LeafNode[]): Map<AnyTag, Provider[]> {
	const byTag = new Map<AnyTag, Provider[]>();
	for (const leaf of leaves) {
		const recorder: IContainerBuilder<AnyTag> = {
			add(tag, spec) {
				const providers = byTag.get(tag) ?? [];
				providers.push({ tag, spec, leaf });
				byTag.set(tag, providers);
				return recorder;
			},
		};
		leaf.register(recorder);
	}
	return byTag;
}

function isSameBinding(a: Provider, b: Provider): boolean {
	return (
		a.leaf.binding !== undefined &&
		b.leaf.binding !== undefined &&
		Object.is(a.leaf.binding.value, b.leaf.binding.value)
	);
}

function distinctProviders(candidates: readonly Provider[]): Provider[] {
	const distinct: Provider[] = [];
	for (const candidate of candidates) {
		if (!distinct.some((provider) => isSameBinding(provider, candidate))) {
			distinct.push(candidate);
		}
	}
	return distinct;
}

/**
 * Flattens a layer into exactly one provider per tag.
 *
 * Each layer object is applied once regardless of how many composition paths
 * reach it, so the result does not depend on composition order.
 *
 * @throws {DuplicateProviderError} If two different layers provide the same tag
 * @throws {DuplicateOverrideError} If two different overrides replace the same tag
 * @throws {OverrideTargetNotFoundError} If an override replaces a tag that no other layer provides
 * @internal
 */
export function resolveProviders(root: AnyLayer): Provider[] {
	const { regular, overrides } = collectLeaves(root);

	const resolved = new Map<AnyTag, Provider>();
	for (const [tag, candidates] of registerAll(regular)) {
		const providers = distinctProviders(candidates);
		if (providers.length > 1) {
			throw new DuplicateProviderError(
				tag,
				providers.map((provider) => formatSite(provider.leaf.site))
			);
		}
		resolved.set(tag, providers[0]!);
	}

	for (const [tag, candidates] of registerAll(overrides)) {
		const providers = distinctProviders(candidates);
		if (providers.length > 1) {
			throw new DuplicateOverrideError(
				tag,
				providers.map((provider) => formatSite(provider.leaf.site))
			);
		}
		const override = providers[0]!;
		if (!resolved.has(tag)) {
			throw new OverrideTargetNotFoundError(
				tag,
				formatSite(override.leaf.site)
			);
		}
		resolved.set(tag, override);
	}

	return [...resolved.values()];
}
