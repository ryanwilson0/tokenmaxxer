const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

let currentLevel = LEVELS.info;

export function setLogLevel(level) {
  if (level in LEVELS) currentLevel = LEVELS[level];
}

function ts() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function emit(level, line) {
  if (LEVELS[level] > currentLevel) return;
  process.stdout.write(`[${ts()}] ${line}\n`);
}

export const log = {
  info: (line) => emit('info', line),
  warn: (line) => emit('warn', line),
  error: (line) => emit('error', line),
  debug: (line) => emit('debug', line),
};
