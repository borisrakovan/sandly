---
'sandly': patch
---

Fix `Layer.service` rejecting ValueTags whose value type is a union.

The internal `ValidDepFor<T>` conditional was a naked conditional, which TypeScript distributes over union `T`. For a parameter typed `'SANDBOX' | 'PRODUCTION'` the dep slot was inferred as `ValueTag<any, 'SANDBOX'> | ValueTag<any, 'PRODUCTION'>`, and a `ValueTag<any, 'SANDBOX' | 'PRODUCTION'>` is not assignable to either branch (ValueTag is invariant in its value type). Wrapping the conditional in a tuple (`[T] extends [object]`) prevents distribution and accepts the union-typed tag as expected.
