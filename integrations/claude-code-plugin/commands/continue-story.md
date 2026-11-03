---
description: Continue the webtoon story on its own (AI-led autopilot) for N panels
argument-hint: "[number of panels, default 4]"
---

Continue the story (AI-led): plan the next beats and draw the next $ARGUMENTS panels.

The number of panels is `$ARGUMENTS`; the default is 4 when no argument is given.

Follow workflows/story-direction (AI-Led Mode). Start with `get_project_state`, then read that doc with `read_workflow_doc`. Draw no more than that many panels, and finish with a short summary of what you drew and the hook for the next run. The tools come from the `webtoon` MCP server.
