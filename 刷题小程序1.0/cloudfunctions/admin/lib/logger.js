'use strict';

function write(level, message, fields = {}) {
  const record = {
    level,
    message,
    time: new Date().toISOString(),
    ...fields,
  };
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
  console[method](JSON.stringify(record));
}

module.exports = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
};
