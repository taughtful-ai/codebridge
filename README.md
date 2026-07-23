# CodeBridge, by Taughtful

**Your Claude Code answers, taught out loud.**

One command turns the last thing your coding agent said into a live lesson on
[Taughtful](https://taughtful.ai/codebridge): a voice tutor, a drawn board,
and room to ask why.

## Use

Inside any Claude Code session, after an answer worth understanding:

```
! codebridge
```

Zero model tokens, zero clicks. The answer opens as a live lesson at
`taughtful.ai/codebridge/<id>` and a voice tutor teaches it.

From any plain terminal:

```bash
npx @taughtful/codebridge            # teach this project's latest answer
npx @taughtful/codebridge browse     # pick from your recent sessions
npx @taughtful/codebridge --dry-run  # show what would be taught, send nothing
```

## In your IDE

In Cursor and VS Code, lessons can open inside the editor's own browser, voice
included. CodeBridge offers to install the tiny CodeBridge Opener extension on
first run; accept once and every lesson lands in the IDE.

## Privacy

- Only the one answer you choose leaves your machine, when you invoke it.
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
