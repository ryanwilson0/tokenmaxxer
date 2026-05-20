import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteBody, rewriteHeaders } from '../src/proxy.js';

const config = {
  forceModel: 'claude-opus-4-7',
  forceEffort: 'max',
  minMaxTokens: 32000,
  betaHeaders: ['interleaved-thinking-2025-05-14'],
};

test('Sonnet medium request → Opus max adaptive', () => {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: 'hi' }],
  };
  const result = rewriteBody(body, config);
  assert.equal(result.model, 'claude-opus-4-7');
  assert.equal(result.output_config.effort, 'max');
  assert.deepEqual(result.thinking, { type: 'adaptive' });
  assert.equal(result.max_tokens, 32000);
});

test('preserves messages, system, tools, tool_choice', () => {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{ role: 'user', content: 'hi' }],
    system: 'You are helpful',
    tools: [{ name: 'foo', description: 'bar', input_schema: { type: 'object' } }],
    tool_choice: { type: 'auto' },
    stop_sequences: ['END'],
  };
  const result = rewriteBody(body, config);
  assert.deepEqual(result.messages, body.messages);
  assert.equal(result.system, body.system);
  assert.deepEqual(result.tools, body.tools);
  assert.deepEqual(result.tool_choice, body.tool_choice);
  assert.deepEqual(result.stop_sequences, body.stop_sequences);
});

test('preserves other output_config fields when injecting effort', () => {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    output_config: { effort: 'low', other_flag: true },
  };
  const result = rewriteBody(body, config);
  assert.equal(result.output_config.effort, 'max');
  assert.equal(result.output_config.other_flag, true);
});

test('max_tokens floor: raises 8000 to 32000', () => {
  const body = { model: 'claude-sonnet-4-6', max_tokens: 8000 };
  const result = rewriteBody(body, config);
  assert.equal(result.max_tokens, 32000);
});

test('max_tokens floor: does not lower 64000', () => {
  const body = { model: 'claude-sonnet-4-6', max_tokens: 64000 };
  const result = rewriteBody(body, config);
  assert.equal(result.max_tokens, 64000);
});

test('max_tokens floor: equal to floor stays put', () => {
  const body = { model: 'claude-sonnet-4-6', max_tokens: 32000 };
  const result = rewriteBody(body, config);
  assert.equal(result.max_tokens, 32000);
});

test('header: appends interleaved when prompt-caching already present', () => {
  const headers = { 'anthropic-beta': 'prompt-caching-2024-07-31' };
  const result = rewriteHeaders(headers, config);
  const betas = result['anthropic-beta'].split(',');
  assert.ok(betas.includes('prompt-caching-2024-07-31'));
  assert.ok(betas.includes('interleaved-thinking-2025-05-14'));
});

test('header: adds interleaved when anthropic-beta is missing', () => {
  const headers = {};
  const result = rewriteHeaders(headers, config);
  assert.equal(result['anthropic-beta'], 'interleaved-thinking-2025-05-14');
});

test('header: does not duplicate if interleaved already present', () => {
  const headers = { 'anthropic-beta': 'interleaved-thinking-2025-05-14' };
  const result = rewriteHeaders(headers, config);
  assert.equal(result['anthropic-beta'], 'interleaved-thinking-2025-05-14');
});

test('header: tolerates extra spaces in existing beta list', () => {
  const headers = { 'anthropic-beta': 'prompt-caching-2024-07-31 ,  some-other-beta' };
  const result = rewriteHeaders(headers, config);
  const betas = result['anthropic-beta'].split(',');
  assert.ok(betas.includes('prompt-caching-2024-07-31'));
  assert.ok(betas.includes('some-other-beta'));
  assert.ok(betas.includes('interleaved-thinking-2025-05-14'));
});

test('header: passes x-api-key and anthropic-version through unchanged', () => {
  const headers = {
    'x-api-key': 'sk-ant-secret',
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  const result = rewriteHeaders(headers, config);
  assert.equal(result['x-api-key'], 'sk-ant-secret');
  assert.equal(result['anthropic-version'], '2023-06-01');
  assert.equal(result['content-type'], 'application/json');
});
