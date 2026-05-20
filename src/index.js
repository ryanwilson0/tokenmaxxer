import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { shouldBypass } from './bypass.js';
import { rewriteBody, rewriteHeaders } from './proxy.js';
import { log, setLogLevel } from './logger.js';

const config = loadConfig();
setLogLevel(config.logLevel);

const stats = {
  requests: 0,
  bypassed: 0,
  rewritten: 0,
  errors: 0,
  startedAt: Date.now(),
};

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'accept-encoding',
]);

function filterRequestHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const lk = key.toLowerCase();
    if (HOP_BY_HOP.has(lk)) continue;
    out[lk] = value;
  }
  return out;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function pipeUpstream(upstreamRes, res) {
  res.statusCode = upstreamRes.status;
  upstreamRes.headers.forEach((value, key) => {
    const lk = key.toLowerCase();
    if (lk === 'content-length' || lk === 'transfer-encoding' || lk === 'connection') return;
    res.setHeader(key, value);
  });
  res.flushHeaders?.();

  if (!upstreamRes.body) {
    res.end();
    return;
  }
  const reader = upstreamRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const ok = res.write(value);
      if (!ok) await new Promise((resolve) => res.once('drain', resolve));
    }
  } finally {
    res.end();
  }
}

async function forward({ method, url, headers, body }, res) {
  const target = `${config.upstream}${url}`;
  const init = {
    method,
    headers,
    body: body && body.length ? body : undefined,
  };
  if (init.body) init.duplex = 'half';

  const upstreamRes = await fetch(target, init);
  await pipeUpstream(upstreamRes, res);
}

function describeRequest(body) {
  const model = body?.model ?? 'unknown';
  const effort = body?.output_config?.effort ?? 'default';
  const max = body?.max_tokens ?? '?';
  return { model, effort, max };
}

const server = createServer(async (req, res) => {
  const isMessages = req.method === 'POST' && req.url?.startsWith('/v1/messages');
  let bodyBuf;
  try {
    bodyBuf = await readBody(req);
  } catch (err) {
    stats.errors++;
    log.error(`failed to read request body: ${err.message}`);
    if (!res.headersSent) {
      res.statusCode = 400;
      res.end();
    }
    return;
  }

  const fwdHeaders = filterRequestHeaders(req.headers);

  if (!isMessages) {
    try {
      await forward({ method: req.method, url: req.url, headers: fwdHeaders, body: bodyBuf }, res);
    } catch (err) {
      stats.errors++;
      log.error(`upstream error on ${req.method} ${req.url}: ${err.message}`);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: { type: 'proxy_error', message: err.message } }));
      } else {
        res.end();
      }
    }
    return;
  }

  stats.requests++;

  let parsed;
  try {
    parsed = JSON.parse(bodyBuf.toString('utf8'));
  } catch (err) {
    log.warn(`POST ${req.url} → forwarding non-JSON body unchanged (${err.message})`);
    try {
      await forward({ method: req.method, url: req.url, headers: fwdHeaders, body: bodyBuf }, res);
    } catch (e) {
      stats.errors++;
      log.error(`upstream error: ${e.message}`);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end();
      } else {
        res.end();
      }
    }
    return;
  }

  const before = describeRequest(parsed);
  const bypass = shouldBypass(parsed, config);

  if (bypass.bypass) {
    stats.bypassed++;
    log.info(`POST ${req.url} → BYPASS (${bypass.reason}) ${before.model} max_tokens=${before.max}`);
    try {
      await forward({ method: req.method, url: req.url, headers: fwdHeaders, body: bodyBuf }, res);
    } catch (err) {
      stats.errors++;
      log.error(`upstream error: ${err.message}`);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end();
      } else {
        res.end();
      }
    }
    return;
  }

  const rewrittenBody = rewriteBody(parsed, config);
  const rewrittenHeaders = rewriteHeaders(fwdHeaders, config);
  const newBuf = Buffer.from(JSON.stringify(rewrittenBody));
  rewrittenHeaders['content-type'] = rewrittenHeaders['content-type'] ?? 'application/json';

  stats.rewritten++;
  log.info(
    `POST ${req.url} → ${rewrittenBody.model} ${rewrittenBody.output_config.effort} ` +
    `(was: ${before.model} ${before.effort}) max_tokens=${rewrittenBody.max_tokens}`,
  );

  try {
    await forward(
      { method: req.method, url: req.url, headers: rewrittenHeaders, body: newBuf },
      res,
    );
  } catch (err) {
    stats.errors++;
    log.error(`upstream error: ${err.message}`);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { type: 'proxy_error', message: err.message } }));
    } else {
      res.end();
    }
  }
});

server.listen(config.port, '127.0.0.1', () => {
  log.info(`token-maxxer listening on http://127.0.0.1:${config.port}`);
  log.info(`upstream: ${config.upstream}`);
  log.info(`forcing: model=${config.forceModel} effort=${config.forceEffort} min_max_tokens=${config.minMaxTokens}`);
  if (process.env.BYPASS_MAXXING === '1') {
    log.warn('BYPASS_MAXXING=1 — every request will be forwarded unchanged');
  }
});

function shutdown(signal) {
  const elapsed = ((Date.now() - stats.startedAt) / 1000).toFixed(1);
  log.info(
    `${signal} — ${stats.requests} requests (${stats.rewritten} maxxed, ${stats.bypassed} bypassed, ${stats.errors} errors) over ${elapsed}s`,
  );
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
