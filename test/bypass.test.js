import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldBypass } from '../src/bypass.js';

const config = {
  bypassPatterns: {
    modelContains: ['haiku'],
    maxTokensBelow: 512,
  },
};

const emptyEnv = {};

test('bypass: haiku model', () => {
  const body = { model: 'claude-haiku-4-5', max_tokens: 8000 };
  const result = shouldBypass(body, config, emptyEnv);
  assert.equal(result.bypass, true);
  assert.match(result.reason, /haiku/);
});

test('bypass: max_tokens=200 (well below threshold)', () => {
  const body = { model: 'claude-sonnet-4-6', max_tokens: 200 };
  const result = shouldBypass(body, config, emptyEnv);
  assert.equal(result.bypass, true);
});

test('bypass: max_tokens exactly at threshold (512)', () => {
  const body = { model: 'claude-sonnet-4-6', max_tokens: 512 };
  const result = shouldBypass(body, config, emptyEnv);
  assert.equal(result.bypass, true);
});

test('no bypass: max_tokens just above threshold (513)', () => {
  const body = { model: 'claude-sonnet-4-6', max_tokens: 513 };
  const result = shouldBypass(body, config, emptyEnv);
  assert.equal(result.bypass, false);
});

test('no bypass: normal Sonnet request', () => {
  const body = { model: 'claude-sonnet-4-6', max_tokens: 8000 };
  const result = shouldBypass(body, config, emptyEnv);
  assert.equal(result.bypass, false);
});

test('bypass: BYPASS_MAXXING=1 wins even on normal request', () => {
  const body = { model: 'claude-sonnet-4-6', max_tokens: 8000 };
  const result = shouldBypass(body, config, { BYPASS_MAXXING: '1' });
  assert.equal(result.bypass, true);
  assert.match(result.reason, /BYPASS_MAXXING/);
});

test('no bypass: BYPASS_MAXXING=0 does not trigger', () => {
  const body = { model: 'claude-sonnet-4-6', max_tokens: 8000 };
  const result = shouldBypass(body, config, { BYPASS_MAXXING: '0' });
  assert.equal(result.bypass, false);
});

test('no bypass: missing model and large max_tokens', () => {
  const body = { max_tokens: 8000 };
  const result = shouldBypass(body, config, emptyEnv);
  assert.equal(result.bypass, false);
});
