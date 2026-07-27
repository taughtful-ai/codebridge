---
description: Teach the last answer (plus optional @-tagged files) on Taughtful
allowed-tools: Bash(codebridge:*), Bash(npx -y @taughtful/codebridge:*)
---

Run the CodeBridge CLI to teach this session's last assistant answer, with any
files the user tagged as arguments.

User arguments: $ARGUMENTS

Rules:
- Extract file paths from the arguments (they may appear as @path mentions or
  plain paths). Build the argument list as one `@<path>` per file, relative to
  the project root. No files tagged → no arguments.
- Run via Bash: `codebridge @<path1> @<path2> ...` if `codebridge` is on PATH,
  otherwise `npx -y @taughtful/codebridge @<path1> @<path2> ...`.
- Run it immediately. Do not analyze the files, do not summarize them, do not
  add flags the user didn't ask for.
- Reply with ONLY the lesson URL line from the CLI output. No commentary.
