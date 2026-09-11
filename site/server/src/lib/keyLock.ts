// Keyed async mutex (PLAN-011 concurrency foundation).
//
// Node handles requests on one thread, so a keyed promise chain serializes
// critical sections that span multiple awaits within a single backend
// process (the deployed topology: one backend container). A check-then-insert
// race such as "already owned? -> create purchase" becomes exactly-once for
// any number of parallel requests.
//
// LIMITATION (documented in documents/history/MIGRATION.md — remaining tech
// debt): with multiple backend replicas the mutex only covers one process.
// Cross-instance exactly-once needs a database constraint (e.g. a unique
// partial index) authored through the formal migration path.

const locks = new Map<string, Promise<void>>();

/**
 * Run `fn` so that, for the same `key`, invocations never overlap.
 * Failures of one waiter do not affect the next.
 */
export function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const result = previous.then(fn, fn);
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return result;
}
