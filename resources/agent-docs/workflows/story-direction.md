# Story Direction

## Purpose

This doc tells you how to plan and advance the story: who decides what happens (the story mode), where the story is written down (the story bible and the beat outline), how an episode is shaped, and what to do when the user's wishes and the bible disagree.

Read it before you:

- plan the next beats, or answer `Continue the story (AI-led): plan the next beats and draw the next N panels.`
- write or change the story bible,
- start a new episode,
- handle a request that changes something already established.

The story lives in three places. Keep all three in step:

| Place | Tool | What it holds |
|---|---|---|
| Story bible | `get_story`, `update_story_bible` | Long-term facts: premise, world, tone, relationships, arcs, open threads. |
| Beat outline | `get_story`, `add_beats`, `update_beat` | The planned moments of each episode, one sentence each, with a status. |
| Panels | `list_panels`, `create_panel` | What has actually been drawn. |

All examples use a project called "Moon Diary": Mina, a high-school girl who can hear the moon talk; Jin, a quiet boy who rides the last night bus; Grandma Oksun, Mina's grandmother (alias "Grandma"). Every id is an example: use the ids from your own `<project_state>` and tool results.

## User-Led Mode

`story_mode: user` means the user is the author. You are the co-writer and the artist.

Do:

1. Carry out what the user asks, in the order they ask it.
2. Break a direction into beats yourself when it covers several moments ("draw the scene where Mina meets Jin" is about 4 to 6 beats). Those beats are the user's events, so you may plan them without asking.
3. Fill small details that change nothing in the plot: a background extra, a prop, the weather, a reaction panel, a transition panel.
4. Offer options when the direction is unclear or the user asks "what should happen next?".

Never do on your own (propose it and wait for a yes):

- a major plot event: a secret revealed, a betrayal, a confession, a fight with lasting harm, a time skip, a change to a new arc;
- a new named character (you may draw unnamed extras);
- a death, or an injury that lasts.

How to offer options:

- Give 2 or 3 options, numbered, one line each.
- Each option: a bold short name, then what happens and what it sets up.
- Make them really different (not three versions of the same idea).
- End with one question. Then stop and wait; do not draw before the user picks.

Example:

> The bus stops at a dark road. What happens?
> 1. **Jin wakes up** and warns Mina not to get off here; sets up that he knows the moon's route.
> 2. **The driver vanishes** and the bus drives on by itself; a mystery for the next episode.
> 3. **Grandma is waiting at the stop**, which should be impossible; a family secret.
> Which one, or your own idea?

When the user answers "you choose" or "surprise me", pick one, say which one in one sentence, and continue.

## AI-Led Mode

`story_mode: ai` means you are the author, inside what the story bible says. The user can still give direct instructions, and those win over your plans.

The "Continue story" button sends exactly:

```
Continue the story (AI-led): plan the next beats and draw the next N panels.
```

N is the project's autopilot panel count (4 unless the user changed it). When you get this message, run the autopilot loop:

1. **Read the story.** `get_story` with the current episode id (from `current_episode`). Note the bible's Arcs and Open Threads, and the episode's beats.
2. **Read the panels.** `list_panels` for the current episode. The last panel is where the story stands.
3. **Choose N beats.** Take the oldest `planned` beats of this episode first. If fewer than N are planned, write the missing ones and add them with `add_beats`. One beat per panel: N panels means N beats.
4. **Prepare the cast.** If a beat needs a named character who is not in the roster, create them first (R1; read `workflows/character-creation`). If a character needs a new look that will recur (a new outfit), create the variation first.
5. **Draw.** For each beat in order: draw one panel with `create_panel` (follow `workflows/panel-generation`), read the result, then `update_beat` it to `drawn`.
6. **Episode end.** If you just drew the episode's cliffhanger, do not start the next episode in the same run. Say that the episode is complete and the next Continue will open Episode N+1.
7. **Record.** Update the bible sections that changed (R9): usually Arcs and Open Threads, sometimes Characters & Relationships.
8. **Stop and summarize.** List the panels you drew (one line each), the bible updates, and the hook for the next Continue. Do not draw more than N panels.

When the next Continue arrives after a finished episode: call `list_episodes`. If a later episode already exists, continue in it. Otherwise `create_episode` with a title and a one-sentence synopsis, plan its first beats (hook first), then draw.

Choosing beats well in AI-led mode:

- Every beat must move something: the plot, a relationship, or a mystery.
- Pay off at least one Open Thread every episode, and open at most one new one.
- Keep the tone of the bible's Tone section.
- Do not kill, remove or radically change a main character unless the bible's Arcs already plan it.

## Story Bible

The bible is markdown with `## ` sections. Read it with `get_story`; change one section at a time with `update_story_bible`. The default sections:

| Section | What goes in it | Example line |
|---|---|---|
| Premise | 2 or 3 sentences: who, what they want, what stands in the way. | Mina can hear the moon. One night it tells her to ride the last bus. |
| World | Rules of the world, places, technology, magic and its limits. | The moon only speaks on nights when it is more than half full. |
| Tone | Genre, mood, humor level, what the story never does. | Quiet magical realism; warm, never gory. |
| Characters & Relationships | One bullet per character: role, goal, relation to others. | Jin: rides the night bus every night; Mina does not trust him yet. |
| Arcs | Where each storyline is going, and what has happened so far. | Episode 1: Mina finds the night bus and meets Jin. |
| Open Threads | Unanswered questions and planted setups, one bullet each. | Why does Grandma know the bus route? |

Rules for `update_story_bible`:

1. Call `get_story` first. The `content` you send **replaces the whole section**, so copy the lines that stay and add or change the rest.
2. `section` is the heading text without the hashes, e.g. "Open Threads". Matching ignores case.
3. Never put a `## ` heading inside `content`: it is rejected. Use `### ` for a sub-heading.
4. Use the six default sections. Add a new section only when nothing fits (for example "Glossary").
5. Keep it short: bullets, one fact per bullet, present tense. The bible is a reference, not prose.

Update the bible (R9) after:

- a reveal or a secret coming out,
- a new character (add them to Characters & Relationships),
- a relationship change (friends become rivals, a confession),
- a death, a serious injury, or someone leaving the story,
- a new mystery or setup (add it to Open Threads), or one being answered (remove it from Open Threads and note the answer in Arcs),
- the end of an episode (one line in Arcs).

Example of a full-section replacement. After `get_story` showed Open Threads as "- Why does the moon talk to Mina?", Jin revealed he hears the moon too:

```
update_story_bible {"section": "Open Threads", "content": "- Why does the moon talk to Mina?\n- Jin hears the moon too. Since when, and why does he hide it?"}
```

## Beats and Outline

A beat is one story moment, written as one sentence. The outline is the list of beats per episode.

Writing a beat:

- One sentence, present tense, concrete and visible: "Mina finds a bus ticket dated twenty years ago in her pocket."
- Name who acts and what changes. Not "Tension rises."
- One beat = one panel (R5). A big moment that needs a reaction can take a second panel, but never put two beats in one panel.

Statuses:

| Status | Meaning | Set it when |
|---|---|---|
| `planned` | Not drawn yet. Every new beat starts here. | `add_beats` does this for you. |
| `drawn` | Its panel exists. | Right after its panel rendered (`update_beat`). |
| `dropped` | Cut or retconned. | The story no longer goes this way. Never delete a beat. |

Planning:

```
add_beats {"episodeId": "epi_5d0c3b9a12", "beats": ["Mina steps onto the empty night bus.", "Mina notices Jin asleep in the back row.", "The bus doors close by themselves."]}
```

The result lists the new beats with their ids (bt_...). Keep those ids: you need them for `update_beat`.

```
update_beat {"beatId": "bt_3a9c1e7f52", "status": "drawn"}
```

Rewording a beat that changed a little while you drew it:

```
update_beat {"beatId": "bt_8d2b6f0a14", "summary": "Mina notices Jin pretending to sleep in the back row."}
```

Keep at most about 8 planned beats ahead of the drawn panels. Plans far ahead go stale; write them in the bible's Arcs instead.

## Episode Structure

An episode is one chapter the reader scrolls in one sitting, usually 20 to 50 panels. Shape every episode like this:

| Part | Panels | What it does |
|---|---|---|
| Hook | first 3 to 5 | Grab the reader: a striking image or a question. Re-establish where we are (an establishing or wide shot). |
| Rising | the middle | Complications. Each beat raises the stakes or deepens a relationship. Alternate action and quiet moments. |
| Turn | 2 to 4 before the end | A reveal, a decision or a reversal: the thing the episode was building to. |
| Cliffhanger | last 1 or 2 | Stop on an open question: a shocked face, a figure in the doorway, a line of dialogue that changes everything. |

Starting an episode:

1. In user-led mode, ask before you create a new episode. In AI-led mode, create it when the previous one has its cliffhanger.
2. Call `create_episode` with a title and a one-sentence synopsis.
3. Plan the hook beats with `add_beats`.
4. The first panel usually re-establishes the place: an establishing or wide shot (see `reference/webtoon-style-guide`).

```
create_episode {"title": "The Ticket", "synopsis": "Mina finds out the night bus stops at places that no longer exist."}
```

The result's `episode.id` is the id for `add_beats`, `list_panels` and `create_panel`. The app's open episode does not change by itself: the user switches episodes in the Webtoon tab. Until then, `current_episode` in `<project_state>` still shows the old episode, so use the new id from the result, and tell the user to switch to the new episode to see its panels.

## Vertical Pacing

A webtoon is read by scrolling down. Time on screen is space on the page:

- **Fast** (action, panic, comedy beats): several small or square panels (1:1, 3:4), medium and close-up shots, little dialogue.
- **Slow** (awe, sadness, a quiet moment): one tall panel (9:16) or a wide establishing panel, few or no words.
- **Reveal**: put the reveal in its own panel after a build-up panel. The reader scrolls into it.
- **Silence**: a panel with no dialogue is a pause. Use one after a big line.
- **Rhythm**: a common pattern is wide (where) → medium (who and what) → close-up (how they feel). Do not use the same shot three times in a row.

One beat per panel (R5) is what makes pacing work: the reader gets one new thing per scroll. Shot and aspect choices are in `reference/webtoon-style-guide`.

## Continuity Across Sessions

Each chat session has its own message history. A new session remembers nothing of the others, but the project (bible, beats, characters, panels) is shared by all of them.

So, at the start of story work in a session:

1. Call `get_story` (with the current episode id) before you plan anything.
2. Call `list_panels` for the current episode before you draw.
3. Treat the bible as your memory. If something important happened only in chat, it is lost unless you wrote it to the bible or the beats.

Write for the next session:

- Mark beats `drawn` as soon as their panels exist; a future session uses the statuses to know where the story stands.
- Keep Open Threads current; it is the list of promises the story still has to keep.
- When the user tells you a fact for later ("Jin's sister is the bus driver, reveal it in Episode 3"), put it in the bible right away (Arcs or Open Threads).

The user can also change things between sessions: they draw panels by hand, edit beats in the Story tab and edit the bible directly. If the panels and the beats disagree, the panels are what the reader sees; adjust the beats (mark them `drawn` or `dropped`) to match.

## Conflicts and Retcons

A conflict is a request that contradicts the bible or panels already drawn. Example: the bible says "The moon only speaks on nights when it is more than half full", and the user asks for the moon to speak at noon.

What to do:

1. Name the conflict in one sentence and quote the bible line.
2. Offer options:
   1. **Retcon:** follow the new direction and change the bible.
   2. **Keep the bible:** adjust the request so it fits (for example, "at noon, Mina remembers what the moon said last night").
   3. **Explain it in-story:** keep both, and add an Open Thread (for example, "something is wrong with the moon").
3. In user-led mode, wait for the user's choice. In AI-led mode, the user's direct instruction wins: do what they asked, and say which bible lines you changed.

How to retcon once the user agreed:

1. `get_story`, then `update_story_bible` every section the change touches.
2. `update_beat` with `dropped` for planned beats that no longer fit, then `add_beats` for the new plan.
3. Find drawn panels that now contradict the story (`list_panels`). Tell the user which ones and offer to fix them with `update_panel` or `regenerate_panel`. Never delete them (R8): the user can delete panels in the app.

Small slips are not conflicts. If a panel drew a wrong prop or a wrong time of day, fix the panel (`workflows/panel-editing`) and leave the bible alone.

## Examples

### Example 1: user-led, unclear direction

User: "Something weird should happen on the bus."

1. This is unclear and could add a major event, so offer options:

> Here are three weird things that could happen:
> 1. **The stops are wrong:** the display shows stations that closed decades ago.
> 2. **Jin talks in his sleep** and repeats exactly what the moon told Mina.
> 3. **The bus leaves the road** and drives along the river, quietly.
> Which one?

2. User: "2". Plan the beats and draw (the beats are now the user's choice):

```
add_beats {"episodeId": "epi_5d0c3b9a12", "beats": ["Jin mutters in his sleep.", "Mina leans closer and hears him repeat the moon's words.", "Mina backs away, shaken."]}
```

3. Draw three panels with `create_panel` (see `workflows/panel-generation`), and mark each beat `drawn`.
4. Jin hearing the moon is a reveal, so update the bible (R9):

```
update_story_bible {"section": "Open Threads", "content": "- Why does the moon talk to Mina?\n- Jin repeats the moon's words in his sleep. Does he hear it too?"}
```

5. Reply: what you drew and the open question it sets up.

### Example 2: AI-led autopilot with N = 2

User message: `Continue the story (AI-led): plan the next beats and draw the next 2 panels.`

1. Read the story for the current episode:

```
get_story {"episodeId": "epi_5d0c3b9a12"}
```

Result (shortened): mode `ai`; Open Threads "- Why does Grandma know the bus route?"; beats: "Mina steps onto the empty night bus." (drawn), "Mina notices Jin asleep in the back row." (drawn). No planned beats remain.

2. Read where the panels stand:

```
list_panels {"episodeId": "epi_5d0c3b9a12", "last": 3}
```

3. Plan two beats, one per panel:

```
add_beats {"episodeId": "epi_5d0c3b9a12", "beats": ["The bus stops at a dark, empty road.", "Grandma Oksun is waiting at the stop, holding an umbrella."]}
```

Result: beats bt_5e7a9c1b36 and bt_0f4d8b2e69, both planned.

4. Draw the first beat (only Mina is visible; Jin is asleep behind her and is not in this shot):

```
create_panel {
  "episodeId": "epi_5d0c3b9a12",
  "description": "The bus has stopped. Through the front window, a dark empty road with one dim streetlight. Mina stands in the aisle, gripping a pole, staring out.",
  "setting": "Inside the night bus, front section, midnight",
  "shot": "medium",
  "characters": [{"characterId": "chr_3e8a51c0d2", "variationId": "var_4c19d2e8a0", "action": "grips a pole, staring out the front window", "expression": "uneasy", "position": "right"}],
  "dialogue": [{"speakerId": null, "kind": "sfx", "text": "hsss"}],
  "continuityNotes": "Same bus interior and cold blue night light as the previous panel."
}
```

Result: status `ready`. Mark it:

```
update_beat {"beatId": "bt_5e7a9c1b36", "status": "drawn"}
```

5. Draw the second beat. Grandma is in the roster, so she can appear:

```
create_panel {
  "episodeId": "epi_5d0c3b9a12",
  "description": "View from the open bus door: Grandma Oksun stands alone at the stop under the streetlight, holding a closed umbrella, looking straight at the bus.",
  "setting": "Roadside bus stop at night, one streetlight, empty fields",
  "shot": "wide",
  "aspect": "9:16",
  "characters": [{"characterId": "chr_2d4f6a8c01", "variationId": "var_6e1a3c5b97", "action": "stands at the stop holding a closed umbrella", "expression": "calm, knowing", "position": "center"}],
  "dialogue": [{"speakerId": "chr_3e8a51c0d2", "kind": "speech", "text": "Grandma...?"}]
}
```

Mina speaks from inside the bus without being visible: a speaker does not have to be in the cast. If the description named her ("Mina's grandmother stands..."), she would have to go in `offPanelMentions` (R10).

Result: status `ready`. Mark it drawn:

```
update_beat {"beatId": "bt_0f4d8b2e69", "status": "drawn"}
```

6. Record the story change. The `get_story` result in step 1 showed Arcs as empty, so the new body is just the new line:

```
update_story_bible {"section": "Arcs", "content": "- Episode 1: Mina rides the night bus, meets Jin, and finds Grandma waiting at an impossible stop."}
```

7. Reply and stop:

> Drew 2 panels: the bus stops on a dark road, and Grandma Oksun is waiting at the stop. Both beats are marked drawn and the Arcs section is updated. Next time: Grandma steps on the bus and Mina has questions.

### Example 3: the user contradicts the bible

User (user-led): "Make Jin Mina's cousin."

The bible's Characters & Relationships says "Jin: a stranger Mina met on the night bus." Reply:

> The bible says Jin is a stranger Mina met on the bus, and panel 4 shows them not recognizing each other. Options:
> 1. **Retcon:** Jin is her cousin; I update the bible, and panel 4 can stay as "they had not met since they were small".
> 2. **Keep them strangers**, but make Jin a friend of the family.
> Which one?

After the user picks 1: `get_story`, `update_story_bible` for Characters & Relationships (and Open Threads if it creates a question), and no panel changes unless the user asks.

### Example 4: first message of a new session

User: "Let's keep going."

1. `get_story` with the current episode id. 2. `list_panels` for the current episode. 3. In user-led mode, summarize where the story stands in two sentences and offer 2 or 3 options for the next beat. In AI-led mode, treat it like a Continue with the autopilot panel count and run the autopilot loop.
