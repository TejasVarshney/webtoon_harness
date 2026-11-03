---
description: Create a webtoon character with an appearance lock and base image
argument-hint: "<who the character is>"
---

Create a new character for the webtoon: $ARGUMENTS

Start with `get_project_state` and check the cast with `list_characters` so you do not duplicate anyone. Read workflows/character-creation with `read_workflow_doc` before you write the character. Write the appearance lock as the doc describes, then call `create_character` and read its result: if the base image failed, say so or retry with `regenerate_variation`. Report who you created in a few sentences. The tools come from the `webtoon` MCP server.
