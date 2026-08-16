---
name: codebridge
description: Teach the last assistant answer out loud as a live voice lesson on Taughtful, optionally with tagged files. Use when the user says codebridge, "teach this", "teach this answer", or asks to turn the answer into a lesson, with or without file paths.
---

Run the CodeBridge CLI to teach this session's last assistant answer, with any
files the user tagged as arguments.

Rules:
- Extract file paths from the user's message (they may appear as @path
  mentions or plain paths). Build the argument list as one `@<path>` per file,
  relative to the project root. No files tagged → no arguments.
- Run via the shell: `codebridge @<path1> @<path2> ...` if `codebridge` is on
  PATH, otherwise `npx -y @taughtful/codebridge @<path1> @<path2> ...`.
- This command NEEDS NETWORK ACCESS (it uploads the lesson to taughtful.ai and
  opens the player). The default sandbox blocks network — request escalated
  permissions / run outside the sandbox for this command. If it fails with
  ENOTFOUND or a fetch error, re-run it with escalated permissions instead of
  reporting failure.
- Run it as your FIRST action — output NOTHING before the command. Any text
  you write first becomes the transcript's newest assistant message and the
  lesson would teach YOUR preamble instead of the real answer.
- Do not analyze the files, do not summarize them, do not add flags the
  user didn't ask for.
- Reply with ONLY the lesson URL line from the CLI output. No commentary.
