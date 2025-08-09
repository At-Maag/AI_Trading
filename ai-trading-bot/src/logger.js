function logError(err, ctx = {}) {
  const asError = (() => {
    if (err instanceof Error) return err;
    try {
      if (typeof err === 'string') return new Error(err);
      if (err && typeof err === 'object') return new Error(JSON.stringify(err));
      return new Error(String(err));
    } catch {
      return new Error(String(err));
    }
  })();

  const title = ctx.title || 'Error';
  const extra = ctx.extra;
  const time = new Date().toISOString();

  console.error(`[${time}] ❌ ${title} | ${asError.name}: ${asError.message}`);
  if (asError.stack) console.error(asError.stack);
  if (extra !== undefined) {
    console.error('Context:', typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2));
  }
}

module.exports = { logError };
