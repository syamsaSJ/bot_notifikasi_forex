import config from './config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[config.LOG_LEVEL] ?? LEVELS.info;

function timestamp() {
  return new Date().toLocaleString('id-ID', { timeZone: config.TIMEZONE });
}

function formatMessage(level, module, message, data) {
  const prefix = `[${timestamp()}] [${level.toUpperCase()}] [${module}]`;
  if (data !== undefined) {
    return `${prefix} ${message} ${JSON.stringify(data)}`;
  }
  return `${prefix} ${message}`;
}

export function createLogger(module) {
  return {
    error: (msg, data) => {
      if (currentLevel >= LEVELS.error) console.error(formatMessage('error', module, msg, data));
    },
    warn: (msg, data) => {
      if (currentLevel >= LEVELS.warn) console.warn(formatMessage('warn', module, msg, data));
    },
    info: (msg, data) => {
      if (currentLevel >= LEVELS.info) console.log(formatMessage('info', module, msg, data));
    },
    debug: (msg, data) => {
      if (currentLevel >= LEVELS.debug) console.log(formatMessage('debug', module, msg, data));
    },
  };
}
