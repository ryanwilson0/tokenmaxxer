# tokenmaxxer

A local proxy that forces every Claude Code request to use **Opus 4.7** with **`xhigh`** effort and **interleaved thinking**. The opposite of a cost-saving router.

If you read that and thought *"nice, now read the warnings before you turn it on"* — good. [Skip to them.](#warnings)

---

## Setup

Requires Node.js 20 or newer (uses native `fetch` and `node:test`).

```bash
git clone <this-repo>
cd tokenmaxxer
npm install      # nothing to install, but creates the lockfile
npm start
```

That boots the proxy on `127.0.0.1:3456`. Leave it running in its own terminal so you can see the request log.

In whatever shell you launch Claude Code from, point it at the proxy:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:3456
claude
```

Drop the same line into `~/.zshrc` / `~/.bashrc` if you want it on by default. Unset it (or just close the shell) when you're done.

You can also export it inline for a single session:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:3456 claude
```

## What it does to each request

For every `POST /v1/messages`, before forwarding to `https://api.anthropic.com`:

1. `model` → `claude-opus-4-7`
2. `output_config.effort` → `xhigh`
3. `thinking` → `{ "type": "adaptive" }`
4. `anthropic-beta` header — append `interleaved-thinking-2025-05-14` (existing beta tokens are preserved)
5. `max_tokens` — raised to `32000` if lower; left alone if already higher

Everything else passes through verbatim: `messages`, `system`, `tools`, `tool_choice`, `stop_sequences`, `x-api-key`, `anthropic-version`, etc.

## Bypass rules

Claude Code makes background calls (summarization, classification) that shouldn't be maxxed. Requests are forwarded **unchanged** when any of these are true:

- `body.model` contains `"haiku"`
- `body.max_tokens` is `<= 512`
- Env var `BYPASS_MAXXING=1` is set

Every bypass is logged so you can see what's being skipped:

```
[14:23:01] POST /v1/messages → claude-opus-4-7 xhigh (was: claude-sonnet-4-6 medium) max_tokens=32000
[14:23:04] POST /v1/messages → BYPASS (model contains "haiku") claude-haiku-4-5 max_tokens=200
```

## Kill switch

```bash
BYPASS_MAXXING=1 npm start
```

Every request will pass through unchanged. Use it when you want the proxy out of the loop without unsetting `ANTHROPIC_BASE_URL` everywhere.

## Configuration

Defaults live in `config.json`:

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

Env vars win over the file: `PORT`, `UPSTREAM`, `FORCE_MODEL`, `FORCE_EFFORT`, `MIN_MAX_TOKENS`, `LOG_LEVEL`, `BYPASS_MAXXING`.

## Verifying it works

With the proxy running and `ANTHROPIC_API_KEY` set in your shell:

```bash
curl -N http://127.0.0.1:3456/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Say hi in five words."}]
  }'
```

In the proxy's terminal you should see something like:

```
[14:23:01] POST /v1/messages → claude-opus-4-7 xhigh (was: claude-sonnet-4-6 default) max_tokens=32000
```

The body you asked for (Sonnet, 1024 tokens) got rewritten to Opus + xhigh + 32k before hitting Anthropic. If you instead see `BYPASS`, check that your `model` doesn't include `haiku` and `max_tokens` is above `512`.

Then try a request that *should* bypass:

```bash
curl http://127.0.0.1:3456/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-haiku-4-5",
    "max_tokens": 200,
    "messages": [{"role": "user", "content": "ping"}]
  }'
```

You should see a `BYPASS` line in the proxy log.

## Tests

```bash
node --test
```

Covers request rewriting, header append-not-clobber, max_tokens floor behavior, and bypass rules.

## Project layout

```
.
├── README.md
├── SPEC.md
├── package.json
├── config.json
├── src/
│   ├── index.js     # HTTP server, entry point
│   ├── proxy.js     # Request body + header rewriting
│   ├── bypass.js    # Bypass rule evaluation
│   ├── config.js    # Config loader + env overrides
│   └── logger.js    # Stdout logger
└── test/
    ├── rewrite.test.js
    └── bypass.test.js
```

---

## Warnings

**This proxy will substantially increase your token usage and API costs.** Read this section before you leave it running.

- **Cost.** Opus 4.7 at `xhigh` is the most expensive configuration Anthropic sells. Expect roughly **10–50× the per-turn cost** vs. default Sonnet adaptive. A long agentic session that would have cost dollars can cost tens of dollars.
- **Rate limits.** On a Max subscription this will burn through weekly allowances *much* faster. On pay-per-token API access, **monitor your spending daily for the first week.** Set a billing alert before you start.
- **Prompt cache invalidation.** Forcing a `thinking` block onto every request reduces cache hit rates. You'll pay full input-token cost on more turns than you would without the proxy. This compounds with long conversations.
- **Diminishing returns.** Anthropic's own docs note that Claude often won't use the full thinking budget past ~32k tokens. "Max thinking" plateaus — you can pay 4× for the same answer.
- **Latency.** Every non-bypassed turn now includes 5–60s of thinking, including trivial turns that didn't need it. Conversations feel slower; tab-completion-style interactions get painful.

**Use the bypass rules.** They exist for a reason — leave the `haiku` and small-`max_tokens` patterns alone unless you've checked the log and confirmed something important is getting bypassed.

**Use `BYPASS_MAXXING=1`** to temporarily disable without unsetting `ANTHROPIC_BASE_URL`. Set it before you start `claude` for a "normal" session, unset it before you start one where you want full thinking.

**Consider running this only for sessions where you're tackling genuinely hard problems** — design discussions, gnarly debugging, code review of complex changes. Don't use it for "fix this typo." The plateau is real.

---

## A note on the beta header

The interleaved-thinking beta is currently identified by `interleaved-thinking-2025-05-14`. Anthropic occasionally revs these headers. If you're reading this long after release and it's stopped working, check the current Anthropic API docs for the new header name and update `config.json` → `betaHeaders`.
