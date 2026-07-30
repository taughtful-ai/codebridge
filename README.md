# CodeBridge, by Taughtful

**Your coding agent's answers, taught out loud.** Works with Claude Code and
OpenAI Codex.

One command turns the last thing your coding agent said into a live lesson on
[Taughtful](https://taughtful.ai/codebridge): a voice tutor, a drawn board,
and room to ask why.

## Use

In Claude Code or the Codex TUI, after an answer worth understanding (needs
the CLI on PATH — `npm i -g @taughtful/codebridge`, see Install):

```
! codebridge
```

Zero model tokens, zero clicks. The answer opens as a live lesson at
`taughtful.ai/codebridge/<id>` and a voice tutor teaches it out loud. Interrupt
it mid-sentence and ask why; it answers.

With the plugin installed you also get it as a command, with your agent's own
fuzzy file suggestions on `@`:

```
/codebridge @src/auth.js     # Claude Code
$codebridge @src/auth.js     # Codex
```

## Install

**As a plugin** (recommended; adds the command + file picker):

Claude Code:

```
/plugin marketplace add taughtful-ai/codebridge
/plugin install codebridge@taughtful
```

Codex:

```bash
codex plugin marketplace add taughtful-ai/codebridge
codex plugin add codebridge@taughtful
```

Restart your agent once after installing (plugins register at startup) —
`/codebridge` and `$codebridge` are there in every session after.

**The CLI** (what powers the `! codebridge` bang inside sessions):

```bash
npm i -g @taughtful/codebridge       # puts `codebridge` on PATH → ! codebridge works
codebridge                           # teach this project's latest answer
codebridge browse                    # pick from your recent sessions (both agents)
codebridge --dry-run                 # show what would be taught, send nothing
```

Or try it once with no install: `npx @taughtful/codebridge` (the plugins use
this fallback too, so they work without the global install).

Codex note: Codex runs shell commands in a network-blocked sandbox; approve
the escalated run when it asks, since teaching uploads the lesson.

## Tag files into the lesson

The tutor teaches them alongside the answer, each as its own section:

```
! codebridge @src/auth.js @docs/design.md
```

You pick the files; nothing is auto-included. A char/context meter prints as
each file resolves; secrets (`.env`, keys, credentials) are refused, binaries
skipped, and a mistyped path aborts the run instead of teaching partial
context.

## In your IDE

In Cursor and VS Code, lessons can open inside the editor's own browser, voice
included. CodeBridge offers to install the tiny CodeBridge Opener extension on
first run; accept once and every lesson lands in the IDE.

## Privacy

- Only the one answer you choose (plus files you explicitly tag) leaves your
  machine, when you invoke it.
- It travels as an anonymous, unlisted lesson that expires in 48 hours.
- Your prompts, code, tool output, and other sessions stay local.
- The session picker daemon binds 127.0.0.1 only, is read-only, and refuses
  requests from non-Taughtful web origins.

## Config

| env | default | meaning |
| --- | --- | --- |
| `CODEBRIDGE_OPEN` | | `external` forces the system browser; `print` disables auto-open |
| `CODEBRIDGE_PORT` | `4519` | local picker port |

Requires Node 18+. MIT.
