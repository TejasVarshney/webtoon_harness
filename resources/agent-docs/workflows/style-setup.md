# Style Setup

## Purpose

Every image in a project starts with the project's art style, the `style` line of `<project_state>`. This doc tells you when to set it, how to write a new one and what to do once it is locked.

Set the style before the first character, item, location or panel is drawn. The sheets are drawn in the style and every panel copies from them, so a change after that leaves two styles fighting in one panel.

## Choosing a Style

Call `list_styles` to see the library and whether the style can still change.

- If the user named a look ("make it watercolor"), pick the closest style, or write one if nothing fits.
- **User-led:** when the user has not named a look, offer 2 or 3 styles that suit the story and ask which one to use. Do not set one until they answer.
- **AI-led:** pick the style that suits the story, set it and say which one you chose.
- The default is Korean webtoon. If `style` is anything else, someone chose it: change it only when the user asks.

Use `styleId` for a library style. Use `text` only when you write a one-off style for this project.

## Writing a Style

A style is one sentence fragment describing how the art looks:

- the kind of art, then the line, the shading, the palette and the rendering;
- 3 to 400 characters, with no period at the end;
- nothing about the story, the people or the place: those belong in locks, layouts and panels;
- no lettering, speech bubbles, captions, watermarks or signatures: every image prompt already forbids them, and the app refuses them;
- no living artist's name and no franchise. Describe the look itself.

Add a style with `create_style` when the user will want it again, then apply it with `set_style`. Change one you or the user added with `update_style`. Adding or changing a library style never changes a project. Only the user can edit the built-in styles.

## When the Style Is Locked

Once the project has a sheet or a panel, drawn or being drawn, `set_style` is refused and `list_styles` shows `canChange` as false. Do not try again and do not work around it by adding style words to locks or descriptions.

Tell the user they can switch it with the Style button in the chat header, and that the app will warn them first. The existing art is not redrawn, so offer to redraw the sheets after a switch.

`create_style` and `update_style` still work while the style is locked.

## Examples

See what is available:

```
list_styles {}
```

The user asks for a watercolor look on a new project:

```
set_style {"styleId": "watercolor"}
```

The user wants a look the library does not have and will reuse it:

```
create_style {"name": "Rainy city", "text": "Muted blue-gray watercolor wash, thin ink outlines, soft wet reflections"}
```

The user wants that style's lines heavier:

```
update_style {"styleId": "sty_3f9a1c0b7e", "text": "Muted blue-gray wash, heavier ink outlines"}
```

A one-off style for this project only:

```
set_style {"text": "Rough charcoal sketch style, smudged graphite shading, sparse red accents"}
```
