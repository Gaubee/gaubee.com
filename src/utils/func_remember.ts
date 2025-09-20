/**
 * A memoization utility. It ensures that the factory function is called only once.
 * On subsequent calls, it returns the remembered result.
 * @param factory The function that produces the value to be remembered.
 * @returns A function that returns the remembered value.
 */
export function func_remember<T>(factory: () => T): () => T {
  let instance: T | undefined;
  let called = false;
  return () => {
    if (!called) {
      instance = factory();
      called = true;
    }
    return instance as T;
  };
}
