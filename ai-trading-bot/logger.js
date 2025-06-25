const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '..', 'logs');
const logFile = path.join(logDir, 'system.log');

function ensureDir() {
  try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
}

function write(line) {
  ensureDir();
  fs.appendFileSync(logFile, line + '\n');
}

function log(message) {
  const ts = new Date().toISOString();
  write(`[${ts}] ${message}`);
}

function error(err) {
  const msg = err instanceof Error ? err.stack || err.message : err;
  log(msg);
}

module.exports = { log, error };
