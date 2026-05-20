export function shouldBypass(body, config, env = process.env) {
  if (env.BYPASS_MAXXING === '1') {
    return { bypass: true, reason: 'BYPASS_MAXXING=1' };
  }

  const model = typeof body?.model === 'string' ? body.model : '';
  for (const pattern of config.bypassPatterns?.modelContains ?? []) {
    if (model.includes(pattern)) {
      return { bypass: true, reason: `model contains "${pattern}"` };
    }
  }

  const maxTokens = typeof body?.max_tokens === 'number' ? body.max_tokens : null;
  const threshold = config.bypassPatterns?.maxTokensBelow;
  if (maxTokens !== null && typeof threshold === 'number' && maxTokens <= threshold) {
    return { bypass: true, reason: `max_tokens=${maxTokens} <= ${threshold}` };
  }

  return { bypass: false };
}
