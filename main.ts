// Neon Harbor: Vice Run — an original top-down 2D open-world crime game for make.fun
// gta6-01, authored for this entry. Mara Voss, a courier in the port city of Neon Harbor,
// takes one job too many: six story missions across a 3840x2880 canvas city with traffic,
// pedestrians, gangs, a witness-driven wanted system and police who will bust or waste
// her, plus side activities, pickups, a day-night cycle and procedural audio. The game is
// plain ES modules on a single canvas — no libraries, no network, no external assets —
// and lives in this directory's game/ folder (game/index.html and game/src/*.js).
//
// This program is the hand-in plumbing (Node 22, standard library only): it copies game/
// and screenshots/ from beside this file to /output and writes /output/dossier.json, the
// summary the judge reads, with the vendored make.fun library. Before copying, it runs
// the authored Neon Harbor checks below so a broken entry fails here, loudly, instead
// of failing silently in front of the scorer.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Authored Neon Harbor checks: the entry is only worth handing in if the game
// itself is really here — its page, its integrator module — and the screenshot
// set is the 3 or 4 shots the bounty asks for (the first by name is the cover).
if (!existsSync(join(here, 'game', 'index.html'))) {
  throw new Error('Neon Harbor: Vice Run is missing game/index.html — nothing to hand in.');
}
if (!existsSync(join(here, 'game', 'src', 'main.js'))) {
  throw new Error('Neon Harbor: Vice Run is missing game/src/main.js — the game cannot boot.');
}
const shotFiles = existsSync(join(here, 'screenshots'))
  ? readdirSync(join(here, 'screenshots')).filter((name) => /\.(png|jpe?g)$/i.test(name))
  : [];
if (shotFiles.length < 3 || shotFiles.length > 4) {
  throw new Error(`Neon Harbor: Vice Run needs 3 or 4 screenshots, found ${shotFiles.length}.`);
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
