import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(__dirname, '..', 'config.json');

export function loadConfig(path = DEFAULT_CONFIG_PATH) {
  const raw = readFileSync(path, 'utf8');
  const config = JSON.parse(raw);
  return applyEnvOverrides(config);
}

export function applyEnvOverrides(config) {
  const out = { ...config };
  if (process.env.PORT) out.port = Number.parseInt(process.env.PORT, 10);
  if (process.env.UPSTREAM) out.upstream = process.env.UPSTREAM;
  if (process.env.FORCE_MODEL) out.forceModel = process.env.FORCE_MODEL;
  if (process.env.FORCE_EFFORT) out.forceEffort = process.env.FORCE_EFFORT;
  if (process.env.MIN_MAX_TOKENS) out.minMaxTokens = Number.parseInt(process.env.MIN_MAX_TOKENS, 10);
  if (process.env.LOG_LEVEL) out.logLevel = process.env.LOG_LEVEL;
  return out;
}
