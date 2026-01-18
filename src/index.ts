export { Container } from './container.js';
export type {
	DependencyLifecycle,
	DependencySpec,
	Factory,
	Finalizer,
	IContainer,
	ResolutionContext,
} from './container.js';
export { dependency } from './dependency.js';
export {
	CircularDependencyError,
	ContainerDestroyedError,
	DependencyAlreadyInstantiatedError,
	DependencyCreationError,
	DependencyFinalizationError,
	SandlyError,
	UnknownDependencyError,
} from './errors.js';
export { Layer, layer } from './layer.js';
export type { AnyLayer } from './layer.js';
export { ScopedContainer } from './scoped-container.js';
export type { Scope } from './scoped-container.js';
export { autoService, service } from './service.js';
export type { ServiceDependencies, ServiceDepsTuple } from './service.js';
export {
	InjectSource,
	Tag,
	type AnyTag,
	type Inject,
	type ServiceTag,
	type TagType,
	type ValueTag,
} from './tag.js';
export type { PromiseOrValue } from './types.js';
export { value } from './value.js';
