---
paths:
  - "resources/agent-docs/**"
---
Everything here ships: it is copied into each project's `agent/` folder, and every `.md` is listed to the in-app agent. Don't add notes for coding agents.

- `AGENTS.md` is the in-app agent's system prompt.
- `reference/consistency-checklist.md` and `reference/sheet-checklist.md` are the vision checker's instructions and must keep their JSON output contract.
- `src/main/agent/workflow-docs.lint.test.ts` checks required sections, tool names, example tool calls and prompt templates against the code.
- Existing projects keep their copies until the user presses Reset all to defaults. Only missing files are copied in.
