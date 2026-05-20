# Token-Maxxing Router for Claude Code

A local proxy that forces every Claude Code request to use Opus 4.7 with `xhigh` effort and interleaved thinking. The opposite of a cost-saving router.

## Goal

Build a Node.js HTTP proxy that:

1. Listens on `127.0.0.1:3456`
2. Accepts Anthropic Messages API requests from Claude Code
3. Rewrites them to maximize reasoning depth
4. Forwards to `https://api.anthropic.com`
5. Streams the response back unchanged

Claude Code connects by setting `ANTHROPIC_BASE_URL=http://127.0.0.1:3456`.

## Request rewrites (the core logic)

On every incoming `/v1/messages` request, before forwarding:

1. **Force model**: set `body.model = "claude-opus-4-7"`
2. **Force effort**: set `body.output_config = { ...body.output_config, effort: "xhigh" }`
3. **Force adaptive thinking**: set `body.thinking = { type: "adaptive" }`
4. **Add interleaved thinking header**: append `interleaved-thinking-2025-05-14` to the `anthropic-beta` request header (comma-separated if other betas are already there; don't clobber)
5. **Raise max_tokens floor**: if `body.max_tokens < 32000`, set it to `32000`. Don't lower it if it's already higher.

Preserve everything else verbatim — `messages`, `system`, `tools`, `tool_choice`, stop sequences, all of it. Pass through the `x-api-key` and `anthropic-version` headers untouched.

## Bypass rules (don't max-think trivial traffic)

Claude Code makes background requests that shouldn't be upgraded. Skip all rewrites and forward as-is when:

- The request body's original `model` field contains `haiku` (Claude Code uses Haiku for summarization and background tasks — leave it alone)
- The request has `max_tokens <= 512` (these are almost always background classification calls)
- An env var `BYPASS_MAXXING=1` is set (kill-switch for debugging)

Log every bypass with the reason so the user can see what's being skipped.

## Streaming

The Messages API uses SSE. The proxy must:

- Forward the request with `stream: true` preserved
- Pipe the response stream directly to the client without buffering
- Not parse or modify SSE events

A naive `fetch` + `ReadableStream` pipe is fine. Don't overthink this part.

## Config

Single `config.json` file at the repo root, loaded at startup:

```json
{
  "port": 3456,
  "upstream": "https://api.anthropic.com",
  "forceModel": "claude-opus-4-7",
  "forceEffort": "xhigh",
  "minMaxTokens": 32000,
  "betaHeaders": ["interleaved-thinking-2025-05-14"],
  "bypassPatterns": {
    "modelContains": ["haiku"],
    "maxTokensBelow": 512
  },
  "logLevel": "info"
}
```

All values overridable by env vars: `PORT`, `UPSTREAM`, `FORCE_MODEL`, `FORCE_EFFORT`, `MIN_MAX_TOKENS`, `LOG_LEVEL`. Env vars win over config file.

## Logging

Plain stdout, one line per request:

```
[14:23:01] POST /v1/messages → opus-4-7 xhigh (was: sonnet-4-6 medium) max_tokens=32000
[14:23:04] POST /v1/messages → BYPASS (haiku) sonnet-haiku-4-5 max_tokens=200
```

Include request count, bypass count, and total elapsed time on `SIGINT`.

## Project structure

```
/
├── README.md           # User-facing setup + warnings (see below)
├── SPEC.md             # This file
├── package.json
├── config.json         # Default config
├── src/
│   ├── index.js        # Entry point, server setup
│   ├── proxy.js        # Request rewriting + forwarding logic
│   ├── bypass.js       # Bypass rule evaluation
│   ├── config.js       # Config loading + env var overrides
│   └── logger.js       # Stdout logging
└── test/
    ├── rewrite.test.js # Unit tests for request rewriting
    └── bypass.test.js  # Unit tests for bypass logic
```

Use Node's built-in `node:test` and `node:http` — no Express, no extra deps beyond what's strictly needed. The only acceptable dep is `undici` if Node's native fetch isn't sufficient for streaming (it should be on Node 20+).

## Tests

At minimum:

- Rewrite test: given a Claude Code request body for Sonnet 4.6 medium, assert the output has Opus 4.7, xhigh, adaptive thinking, and the beta header.
- Bypass test: given a request with `model: "claude-haiku-4-5"`, assert no rewrites are applied.
- Bypass test: given `max_tokens: 200`, assert no rewrites.
- Header test: if `anthropic-beta` already contains `prompt-caching-2024-07-31`, assert the interleaved header is appended, not replaced.
- max_tokens test: if the original request has `max_tokens: 64000`, it stays at 64000 (don't lower).

Run with `node --test`.

## README content

The README is for the user, not for Claude Code. It must include:

**Setup section**: how to install, how to configure, the one-line `ANTHROPIC_BASE_URL` export to put in their shell.

**Warnings section, prominently placed**: this is critical. The user needs to understand what they're opting into.

> ### Warnings
>
> This proxy will substantially increase your token usage and API costs. Specifically:
>
> - **Cost**: Opus 4.7 at xhigh is the most expensive configuration Anthropic sells. Expect 10-50x the per-turn cost vs. default Sonnet adaptive.
> - **Rate limits**: On a Max subscription, this will exhaust weekly allowances dramatically faster. On pay-per-token API access, monitor your spending daily for the first week.
> - **Prompt cache invalidation**: Forcing thinking config on every request reduces cache hit rates. You'll pay full input-token cost on more turns than you would without the proxy.
> - **Diminishing returns**: Anthropic's docs note that Claude often won't use the full thinking budget past ~32k tokens. "Max thinking" plateaus.
> - **Latency**: Every turn now includes 5-60s of thinking, including trivial turns that don't need it.
>
> Use the bypass rules. Use `BYPASS_MAXXING=1` to temporarily disable. Consider running this only for sessions where you're tackling genuinely hard problems.

**Verifying it works section**: a `curl` example that hits the proxy and shows the rewritten request being forwarded.

## Non-goals

Don't build any of this, even if it seems useful:

- Multi-provider routing (this is single-purpose, Anthropic-only)
- A web UI or dashboard
- Cost estimation or token counting
- Automatic prompt injection (no rewriting messages or system prompts — only the request envelope)
- Authentication beyond passing through the user's existing `x-api-key`
- Caching of any kind
- Persistent storage

If you find yourself reaching for a database, an Express app, or a config UI, stop and re-read this section.

## Acceptance criteria

The build is done when:

1. `npm install && npm start` boots the proxy on port 3456
2. Setting `ANTHROPIC_BASE_URL=http://127.0.0.1:3456` and running `claude` in another terminal produces working Claude Code sessions
3. Every non-bypassed request shows the model upgraded to Opus 4.7 with xhigh in the logs
4. Haiku and small-max_tokens background requests appear as `BYPASS` in the logs
5. `node --test` passes all tests
6. The README warnings are present and unmissable

## A note on this spec

The bypass rules are heuristics, not guarantees. Claude Code internals can change. If after testing you find that the bypass list is missing important categories of background traffic (or is too aggressive and bypassing real work), update both the bypass logic and this spec to match what you learned. Don't silently diverge.

Same goes for the beta header name — verify `interleaved-thinking-2025-05-14` is still the current header before shipping. Anthropic occasionally rev's these. If it changed, use the current one and note it in the README.
