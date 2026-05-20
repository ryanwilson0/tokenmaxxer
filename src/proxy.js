export function rewriteBody(body, config) {
  const out = { ...body };
  out.model = config.forceModel;
  out.output_config = { ...(body.output_config ?? {}), effort: config.forceEffort };
  out.thinking = { type: 'adaptive' };

  const min = config.minMaxTokens;
  const current = typeof body.max_tokens === 'number' ? body.max_tokens : 0;
  if (current < min) {
    out.max_tokens = min;
  }
  return out;
}

export function rewriteHeaders(headers, config) {
  const out = { ...headers };
  const existing = out['anthropic-beta'];
  const present = typeof existing === 'string' && existing.length > 0
    ? existing.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  for (const beta of config.betaHeaders ?? []) {
    if (!present.includes(beta)) present.push(beta);
  }
  out['anthropic-beta'] = present.join(',');
  return out;
}
