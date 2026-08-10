async function waitFor(fn, timeout = 10000, interval = 500) {
  const end = Date.now() + timeout;

  while (Date.now() < end) {
    try {
      const result = await fn();

      if (result) {
        return result;
      }
    } catch (error) {
      console.log(
        "waitFor error:",
        error.response?.status,
        error.response?.data || error.message
      );
    }

    await new Promise((resolve) =>
      setTimeout(resolve, interval)
    );
  }

  throw new Error("Timed out waiting for condition");
}

module.exports = waitFor;