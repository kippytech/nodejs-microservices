function withTimeout(promise, timeoutMs, operation, cleanup) {
  let timeout;

  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      cleanup?.();

      reject(
        new Error(
          `${operation} timed out after ${timeoutMs}ms`
        )
      );
    }, timeoutMs);

    timeout.unref();
  });

  return Promise.race([promise, timeoutPromise])
    .finally(() => clearTimeout(timeout));
}

module.exports = withTimeout;