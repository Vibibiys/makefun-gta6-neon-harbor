# makefun-gta6-neon-harbor
[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Vibibiys/makefun-gta6-neon-harbor/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Vibibiys/makefun-gta6-neon-harbor/reward.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Neon Harbor: Vice Run** is an original top-down 2D open-world crime game that runs
entirely in the browser — plain canvas and ES modules, no libraries, no network calls
and no external assets. Everything is drawn and synthesised at runtime.

You are **Mara Voss**, a courier in the port city of **Neon Harbor** who takes one job
too many. What starts as a simple package run pulls her into a six-job story across a
3840×2880 city of neon avenues, markets, docks and a southern waterfront: deliveries
that go sideways, a stolen prototype, gang pressure, police heat and one last run out
of the harbour. Between story jobs the city stays open — steal cars, run side
activities, chase cash shards, and try to keep your wanted level down.

## Features

- A full open city on a regular road grid (avenues every 480 px), with named
  buildings, parks, palms, lamps, a boardwalk and animated southern water.
- On-foot and driving play with traffic, pedestrians, gang members and a reactive
  police force — patrol cars, foot officers, a bust meter and a five-star wanted
  system driven by witnessed crime.
- Six story missions plus side activities, with on-screen objectives, a pulsing
  world marker, a minimap with police / objective / gang blips, and dialogue from
  Mara and Dispatch.
- Three firearms (pistol, SMG, shotgun) plus fists, health / armour / ammo / cash
  pickups, a day–night cycle (a full day every 240 seconds) with dusk headlights and
  night lamp glow, and procedural engine / siren audio — no audio files.
- Consequences: get **busted** and you pay a fine and wake up at the precinct; get
  **wasted** and the hospital takes 10%. Finish all six jobs for the completion
  screen, then keep roaming. Progress autosaves when a mission completes, `K`
  quick-saves, and the title screen can continue a saved game.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrow keys | Walk or drive |
| `Shift` | Sprint on foot / handbrake-feel boost while driving |
| `E` | Enter or exit the nearest car (within reach) |
| Mouse | Aim |
| Mouse button (hold) / `F` | Fire current weapon |
| `1` `2` `3` `4` | Fists / pistol / SMG / shotgun (once owned) |
| `Esc` / `P` | Pause |
| `K` | Quick-save |
| `M` | Mute |
| `Enter` | Start / confirm on title, busted, wasted and complete screens |
| `C` | Continue a saved game (title screen) |

## How missions and wanted work

**Missions.** Follow the gold marker (also on the minimap) and the objective line at
the bottom of the screen — it always shows the current task and its distance. Story
jobs chain automatically: finish one and Dispatch radios the next. Completing a job
pays cash, records it in your stats and autosaves. Side activities scattered around
the city pay smaller amounts and can be repeated.

**Wanted.** Crimes generate *heat*: stealing a car 25, firing a weapon 12, hitting a
car 6, hitting a pedestrian 30, a kill 45. A crime only counts in full when a
pedestrian or officer within about 300 px witnesses it (kills and gunfire around an
active mission always count); otherwise it counts for half. Heat converts to stars,
stars bring more and faster police, and standing close to an officer while wanted
fills the **bust meter** under the stars. Lose the police — break line of contact
and let heat cool — and the stars fade. Armour absorbs 60% of incoming damage while
it lasts.

## Run it

```sh
node serve.ts
```

then open <http://localhost:8080>. No build step and no install: any modern desktop
browser plays it offline from the `game/` folder.

To build the hand-in dossier exactly as the entry does:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

<sub>Entered on [make.fun](https://make.fun/?ref=y7p02qbz&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
