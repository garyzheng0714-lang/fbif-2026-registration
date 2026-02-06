export async function retry<T>(
  fn: () => Promise<T>,
  options: { retries: number; baseDelayMs: number; maxDelayMs: number }
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > options.retries) {
        throw err;
      }
      const delay = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * Math.pow(2, attempt - 1)
      );
      const jitter = Math.floor(Math.random() * 200);
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }
}
