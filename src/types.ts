/**
 * Type representing a value that can be either synchronous or a Promise.
 * Used throughout the DI system to support both sync and async factories/finalizers.
 */
export type PromiseOrValue<T> = T | Promise<T>;

/**
 * Variance marker types for type-level programming.
 * Used to control how generic types behave with respect to subtyping.
 */
export type Contravariant<A> = (_: A) => void;
export type Covariant<A> = (_: never) => A;
export type Invariant<A> = (_: A) => A;
