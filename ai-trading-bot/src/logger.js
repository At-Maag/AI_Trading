const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');
const ERROR_LOG = path.join(LOG_DIR, 'errors.log');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(ERROR_LOG)) fs.writeFileSync(ERROR_LOG, '');

function logError(context, error) {
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const msg = `[${timestamp}] \u274c ${context}\n${error.stack || error.message || error}\n\n`;
  try {
    fs.appendFileSync(ERROR_LOG, msg);
  } catch (e) {
    console.error('Failed to write to error log:', e);
  }
}

process.on('unhandledRejection', err => logError('Unhandled Rejection', err));
process.on('uncaughtException', err => logError('Uncaught Exception', err));

module.exports = { logError };
