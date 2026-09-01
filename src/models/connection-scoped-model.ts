import type { Model, Schema } from "mongoose";
import { getActiveConnection } from "../lib/db";

/**
 * Binds a schema to whichever connection the caller currently owns.
 *
 * Every model here used to be compiled once against the default mongoose
 * instance (`mongoose.models.X || mongoose.model(...)`). That is right on a
 * long-lived Node server and wrong on workerd, where each request gets its own
 * connection because a socket cannot be reused across request contexts (see
 * `src/lib/db.ts`). Resolving the model per access rather than per process is
 * what lets that work without rewriting the ~43 files that import these models:
 * `Link.findOne(...)` still reads as a plain model.
 *
 * Under Node the resolved connection is the default one, so behaviour is
 * identical to the old registration, including for `scripts/`.
 *
 * Cost is one map lookup per property access, plus compiling each model once
 * per connection: per process under Node, per request on workerd.
 */
export function connectionScopedModel<T>(name: string, schema: Schema<T>): Model<T> {
  function resolve(): Model<T> {
    const connection = getActiveConnection();
    const compiled = connection.models[name] as Model<T> | undefined;
    return compiled ?? connection.model<T>(name, schema);
  }

  // A function target so `new Model(...)` keeps working. Nothing ever reads the
  // target itself; every trap goes to the resolved model.
  const target = function modelPlaceholder() {} as unknown as Model<T>;

  return new Proxy(target, {
    get(_target, property) {
      const model = resolve();
      const value = Reflect.get(model, property, model);
      // Bound so that a method plucked off the proxy still runs against the
      // real model rather than the proxy.
      return typeof value === "function" ? value.bind(model) : value;
    },
    set(_target, property, value) {
      const model = resolve();
      return Reflect.set(model, property, value, model);
    },
    has(_target, property) {
      return Reflect.has(resolve(), property);
    },
    construct(_target, args) {
      const model = resolve();
      return new model(...(args as ConstructorParameters<Model<T>>));
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(resolve());
    },
    deleteProperty(_target, property) {
      return Reflect.deleteProperty(resolve(), property);
    },
    // `ownKeys` and `getOwnPropertyDescriptor` are deliberately not forwarded.
    // A proxy must report the target's own non-configurable properties, and a
    // function target has `prototype`, so forwarding them wholesale throws.
    // Nothing enumerates a model, so the placeholder's keys are never read.
  });
}
