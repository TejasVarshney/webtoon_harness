# Location Creation

## Purpose

This doc tells you how to create and use locations so a place keeps its layout from panel to panel: the door stays on the same side, the window stays behind the bed. It says what goes in a location, how to write its layout, how its pictures are made, and how a panel names its location, state and camera.

Read it before you call `list_locations`, `get_location`, `create_location`, `update_location`, `create_location_state` or `regenerate_location_state`, and before you draw the first panel in a place the story returns to.

A **location** is a recurring place: a room, a shop, a street corner, a rooftop. Image models do not remember a room between panels; they only see the frame. How the app keeps the place still:

1. Each location has a **layout**: the landmarks and which side of the frame each one is on, seen from the place's **main camera angle**.
2. Each location has a **base picture** ("Default"): the empty place from that main angle, made from the layout.
3. A panel set there names the location, a **state** and a **camera**. The app writes a [LOCATION] line into the image prompt with the place's name, its layout, the state and the camera, and sends the picture as a reference image right after the cast.
4. The consistency check gets the same layout and judges the landmarks against it.
5. The panel continues from the last panel in the same location (a wide or medium one first), not just from the panel above it.

The user can also create, edit, archive and upload pictures for locations in the Locations tab.

Every id in this doc is an example. Copy ids only from tool results.

## Location Sheet

These are the inputs of `create_location` (and the fields of `update_location`'s `patch`):

| Field | Required | What to write |
|---|---|---|
| `name` | yes | A clear, unique name: "Supermart back stockroom", not "room". |
| `layout` | yes | The landmarks and their sides of the frame, from the main camera angle (next section). |
| `aliases` | no | Other names the story uses for it, e.g. ["the stockroom"]. |
| `notes` | no | What the place is in the story: who lives or works there, what happened there. Never sent to the image model. |
| `generateBaseImage` | no | Default true. Set false only when the user wants to upload their own picture, or to save image quota: the panel is then drawn from the layout in words only. |

## Writing the Layout

Write the layout from one fixed camera, the angle most panels in the place will use. Start with what the camera faces, then name each landmark with its side of the frame: frame-left, center, frame-right, foreground, background. Use 3 to 6 landmarks: the ones a reader would notice moving.

Good:

> Camera faces the back wall. Steel back door at frame-left, half open. Metal shelves of canned food along the right wall at frame-right. A knocked-over oil drum in the center foreground. A bare bulb hanging at the top center.

Bad:

> A messy stockroom with a door and some shelves.

The bad one says nothing about where anything is, so every panel puts the door somewhere else.

Rules:

- Write sides of the frame, never compass points or "to his left": the image model only knows the frame.
- Keep the layout fixed. What changes over the story (light, weather, damage, what is open) goes in states, not in the layout.
- Write no people. Characters stand where the panel says; the layout is the empty place.

## Base Picture

`create_location` draws the base picture and waits for it. It shows the empty place, wide, from the main angle, in even neutral light with no lamps on, with no people and no text. Panels take only the place's architecture and landmarks from it: their light and time of day come from `setting` and the state, so write those there ("late night, lit only by the embers"). A picture with lamps or ceiling lights on carries them into every panel, even a dark night, and words do not switch them off: redraw it. If it fails, the location still exists with the base `failed`: retry with `regenerate_location_state` and the base state's id. A panel can use a location with no ready picture; it is then drawn from the layout in words only, and the save warns about it.

After `update_location` changes the layout, the result warns you: redraw the base with `regenerate_location_state`, and each state that has a picture of its own.

## States

A **state** is a recurring look of the place: "Night, embers only", "Back door open to a blizzard", "After the fire". Its `delta` says only what differs from the base: light, weather, damage, what is open or broken. The layout never changes between states.

A state has no picture of its own unless you ask for one (`generateImage: true`, or `regenerate_location_state` later). Without one, the panel gets the base picture plus the state's words, which is usually enough. Draw a state its own picture only when the change is large and visual (a burned room, a flooded street).

State names are unique per location. If `create_location_state` says the state already exists, use that one.

## Cameras

A panel's `location` has a `camera`:

- `"main"`: the angle the layout and the picture show. Every landmark stays on its stated side. Use it for most panels.
- `"reverse"`: facing the other way, for a reverse shot. The app tells the image model that frame-left and frame-right swap.
- Your own words for any other angle: `"low, from the floor by the shelves, looking at the door"`. Keep the landmarks consistent with the layout in your description.

A close-up still takes the location: the camera and the shot decide the framing, and the picture only shows the place's look and landmarks.

## When to Create a Location

Create one when the story will show a place in more than one panel and its layout matters: a home, a base, a shop, a classroom, a battlefield. Do not create one for a place seen once, or for an empty sky or a plain background.

Create it before the first panel set there, so every panel gets it. When the user asks to fix a place that drifted, create the location, then set it on the panels with `update_panel` and redraw them.

## Using Locations in Panels

Set the panel's `location` with the location's id, a state id and a camera:

```
create_panel {"episodeId": "epi_5d0c3b9a12", "description": "Taesik strides in from the open back door, pipe raised, toward Dohyun at his bedding by the shelves.", "setting": "Back stockroom, night, blizzard outside", "location": {"locationId": "loc_2b6e9d1a40", "stateId": "lst_1d8b4e6f93", "camera": "main"}, "shot": "wide", "characters": [{"characterId": "chr_9f61b2d47a", "variationId": "var_0a5e3f8c26", "position": "frame-left, by the door"}, {"characterId": "chr_3e8a51c0d2", "variationId": "var_7b20c4e9f1", "position": "frame-right, on his bedding by the shelves"}], "dialogue": []}
```

- Keep `setting` short: the time and what is special about this moment. The layout is already in the [LOCATION] line; do not copy it into the setting or the continuity notes.
- Place people relative to the landmarks ("between the door and the shelves"), not just "left".
- Every panel in the same place names the same location, whatever its state or camera. A panel without a location continues from the panel above it, as before.
- `update_panel` with `"location": null` takes a panel out of its location.

## Examples

### Example 1: a new recurring place

The story will stay in the stockroom for six panels. Create the location first:

```
create_location {"name": "Supermart back stockroom", "layout": "Camera faces the back wall. Steel back door at frame-left. Metal shelves along the right wall at frame-right. Dohyun's bedding on the floor by the shelves, frame-right foreground. An oil drum in the center.", "notes": "Where Dohyun and Yuna survived the first winter."}
```

The result has `locationId`, `baseStateId` and the picture. Use them in every stockroom panel.

### Example 2: the place changes

The back door is kicked open and snow blows in for the rest of the scene. Add a state, without a picture of its own:

```
create_location_state {"locationId": "loc_2b6e9d1a40", "name": "Back door open", "delta": "the back door wide open, blizzard light and snow blowing in, embers glowing in the drum"}
```

Then set the next panels to that state.

### Example 3: a reverse shot

The camera turns to face the door from behind Taesik. Use the same location and state with `"camera": "reverse"`, and say in the description that the door is now behind the camera's subject.

### Example 4: a failed picture

`create_location` returns `baseStatus: "failed"`. The location exists: do not create it again. Call `regenerate_location_state` with its `locationId` and `baseStateId`. If it fails twice, tell the user and go on: panels are drawn from the layout in words until the picture works.
