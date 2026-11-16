# Dusty Yard — a three.js tactical FPS

[![threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Dickykw/threejs-fps-02-kyy97-v2/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Dickykw/threejs-fps-02-kyy97-v2/reward.svg)](https://make.fun/bounty/threejs-fps-02)

A round-based tactical shooter in the style Counter-Strike made famous — all
original map, art, sounds and names. One player against five Vipers in a
sunset industrial yard: plant the charge at site A or B, or eliminate the
whole team. Money between rounds buys the Longbow AR-7, the Hornet VK-9 and
frag grenades. First to 3 rounds takes the match.

## Play

```sh
node serve.ts
# open http://localhost:8080
```

Desktop: WASD move, mouse look (click to lock), click fire, R reload,
1/2/3 weapons, G grenade, E plant, B buy menu, Ctrl crouch, Space jump,
TAB scoreboard. Phones get a virtual joystick, drag-to-look and on-screen
FIRE / RLD / JUMP / CRCH / Plant / Nade buttons.

## The yard

- **Map** — 56 × 40 m, three lanes (A west, mid, B east), two bombsites,
  watchtower, containers, crates, sandbags and barrels for cover.
- **Look** — sunset dusk: clouded gradient sky, low amber sun with long
  shadows, ACES tone mapping, warm fog, corrugated containers, pipes and
  vent steam, emissive yard lamps, painted signage, horizon silhouettes
  (crane, water tower, chimney), drifting dust and a grate floor strip.
- **Gunplay** — deterministic spray (first shot exact, then a learnable
  sine/cosine climb), recoil with partial recovery, spread that punishes
  firing on the move, headshots ×3, tracers, muzzle flash and impacts.
- **Tactics** — bomb plant (3 s) / 35 s countdown / defuse run, buy economy
  ($800 start, $300 per kill, $900 round win), bots that patrol routes,
  hold sites, investigate gunfire, strafe while engaging and rush to defuse.
- **HUD** — health, ammo, round timer, round score, money, bomb status,
  kill feed, buy menu, scoreboard and a live tactical minimap.

## Layout

```
game/            the game — static files, no build step
  index.html     HUD + import map (three.js 0.187.0, vendored)
  src/           one module per job: main, world, textures, bots,
                 weapons, grenade, bomb, effects, player, input,
                 hud, economy, palette
  vendor/three/  three.js 0.187.0 (byte-for-byte, npm's build)
main.ts          the entry program: copies game/ + screenshots/ to
                 /output and writes /output/dossier.json
serve.ts         local static server for development
screenshots/    4 real renders of the game's own code (?shot= modes)
vendor/         make.fun dossier library (unchanged)
```

## Screenshots

Rendered with headless Chrome from the game's own `?shot=` modes
(`shots.json`): `1-start.jpg` menu, `2-play.jpg` live fire,
`3-plant.jpg` charge planted at A, `4-end.jpg` round won.

## License

MIT — see [LICENSE](LICENSE).
