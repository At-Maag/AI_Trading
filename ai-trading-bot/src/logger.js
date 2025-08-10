const util = require('util');

function basePayload(msg, context) {
  const time = new Date().toISOString();
  let line = `[${time}] ${msg}`;
  if (context && Object.keys(context).length) {
    try {
      line += ' ' + JSON.stringify(context);
    } catch {
      line += ' ' + util.inspect(context);
    }
  }
  return line;
}

function logError(err, context = {}) {
  const message = (err && err.message) ? err.message : String(err);
  console.error(basePayload(`ERROR: ${message}`, context));
  if (err && err.stack) {
    console.error(err.stack);
  }
}

function logInfo(message, context = {}) {
  console.log(basePayload(`INFO: ${message}`, context));
}

module.exports = { logError, logInfo };
