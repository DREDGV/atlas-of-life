Chat history
============

This workspace stores Codex chat history locally in a JSONL file.

- File: `.codex/chat-history.jsonl`
- Format: one JSON object per line with fields: `timestamp`, `role`, `session`, `content`.

Logging helper
--------------

Use `scripts/log-chat.ps1` to append entries:

`powershell -ExecutionPolicy Bypass -File scripts/log-chat.ps1 -Role user -Content "Hello" -Session my-session`

If `-Session` is omitted, the current date `yyyyMMdd` is used.

Version bump
------------

Automates versioning in `CHANGELOG.md` and fallback in `js/app.js`.
The script now PRESERVES history by inserting a new section at the top.

- Bump patch (reads current version from CHANGELOG):
  `powershell -ExecutionPolicy Bypass -File tools/bump-version.ps1`
- Bump specific part: `-Part minor` or `-Part major`
- Set exact version: `-Version 0.2.3`
- Optional date override: `-Date 2025-09-03`
- Optional time override: `-Time 14:30` (defaults to current time)

The resulting heading format is: `## Atlas_of_life_vX.Y.Z - YYYY-MM-DD HH:mm`.
