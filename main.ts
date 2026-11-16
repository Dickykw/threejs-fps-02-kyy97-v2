// Dusty Yard — the entry program for the threejs-fps-02 bounty.
//
// The game itself is plain static files under game/ (three.js 0.187.0 from an
// import map, ES modules, no build step). This program is the handover: it
// copies game/ and screenshots/ from beside this file into the output
// directory and writes the dossier.json the judge reads, using the vendored
// make.fun library (vendor/makefun-threejs.ts).
//
// Locally, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader the program runs in a fresh container with no network, a
// read-only copy of this repository and a writable /output; it runs twice and
// both runs must write the same bytes, so nothing here depends on the clock,
// the environment or the order the filesystem returns files in — buildDossier
// walks the files deterministically.
//
// Serve the game while developing with `node serve.ts`, then open
// http://localhost:8080. Screenshots live in screenshots/ (the first by name
// is the cover); they are real renders of the game's own code, taken with
// headless Chrome against the ?shot= modes in shots.json.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// Directory of this file: the repository root at grading time.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// The scorer's own caps: only text_max_bytes shapes the dossier bytes; the
// rest refuse an entry the scorer would refuse anyway (more than 4 screenshots
// or one over 256 KiB; more than 993 files in game/ or 48 MiB of game files
// in all — game/ counts beside /output's own 1000-entry cap, its screenshots/
// and dossier.json).
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
