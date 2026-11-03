---
description: Draw one webtoon panel from a short description
argument-hint: "<what the panel shows>"
---

Draw one panel of the webtoon: $ARGUMENTS

Start with `get_project_state`. Read workflows/panel-generation (and reference/webtoon-style-guide) with `read_workflow_doc` before you draw. Call `list_panels` and continue from the previous panel. Attach every visible named character by id and variation, put dialogue in `dialogue`, then call `create_panel` and read its result, including the consistency check. If the panel matches a planned beat, mark that beat drawn with `update_beat`. Report what you drew in a few sentences. The tools come from the `webtoon` MCP server.
