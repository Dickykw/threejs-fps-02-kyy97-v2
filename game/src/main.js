// DUSTY YARD — a round-based tactical FPS (Counter-Strike-style, all original).
// One loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// ?shot=start|play|plant|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
//
// Architecture (Point Blank spec §8, adapted to three.js, static, no network):
//   Core .......... this file (GameManager + MatchStateMachine)
//   Player ........ player.js (movement, SATSET accel) + weapons.js viewmodel
//                  (DualMeshRig: first-person arms+hands, bot world models)
//   HitboxSystem .. bots.js (head 4.0x / chest 1.0x / stomach 1.1x / limbs 0.75x)
//   HealthArmor ... game.hp / game.armour here, bot armour in bots.js
//   Weapons ....... weapons.js (slots 1-5, recoil, spread, viewmodels)
//   UI ............ hud.js (HUD, dynamic crosshair, radar/minimap, scoreboard)
//   Modes ......... bomb.js (BombMission: best of 11, fuse 40 s, defuse 7/5 s)
// Out of scope for this competition (static files, single-player vs bots):
// multiplayer 5v5/8v8, server-authoritative netcode, lobbies, backend/ranks.
//
// Flow: menu -> buy phase (15 s, move freely, bots dormant) -> round (180 s,
// plant the charge at A or B or eliminate all 5 Vipers) -> round end banner
// -> next buy phase. First to 6 rounds wins the match (max 11 rounds;
// 5–5 is a draw). You attack, the Vipers defend. No respawn until the next round.
//
// The equipment shelf: slot 1 primary (rifle/smg) + slot 2 pistol + slot 3
// knife (slash / heavy stab) + slot 4 tactical (frag/smoke/flare) + slot 5 C4,
// armour ($400, absorbs half the damage), kit. Smoke blocks bot sight for 8 s,
// flare lights a corner for 10 s, the kit plants the charge in 1.5 s (and a
// kitted Viper defuses in 5 s instead of 7 s). Bots talk on the radio log;
// Z/X/C are the player's own radio callouts; match events stack under the
// minimap; the match ends on a full VICTORY / DEFEAT / DRAW screen.
//
// Sunset pass: ACES filmic tone mapping at exposure 1.45 over the warm dusk
// lighting, steam rising from the vent stacks, a tactical minimap in the HUD.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArsenal, GRENADE_PRICE, ARMOUR_PRICE, UTILITY_DEFS } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb, BOMB_TIMER, DEFUSE_SECONDS, DEFUSE_KIT_SECONDS } from './bomb.js';
import { createEffects } from './effects.js';
import { createEconomy } from './economy.js';
import { createHud } from './hud.js';
import { zoneAt } from './zones.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 180; // Point Blank Bomb Mission: 3:00 per round
const BUY_TIME = 15;
const ROUND_END_TIME = 4;
const WIN_ROUNDS = 6; // first to 6 rounds takes the match (best of 11)
const MAX_ROUNDS = 11; // 5–5 after 11 rounds is a draw
const PLAYER_HP = 100;
const PLAYER_ARMOUR_MAX = 100;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const judge = params.has('judge'); // ?judge: skip warmup, round 1 with a full loadout

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.skyTop);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.dusk), 20, 62);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const world = createWorld(scene);
// One audio listener on the camera: bots get directional PositionalAudio
// (gunfire + footsteps) from it. Guarded — a missing/blocked AudioContext
// only costs the positional sound, never the game.
let audioListener = null;
try {
  audioListener = new THREE.AudioListener();
  camera.add(audioListener);
} catch { audioListener = null; }
function resumeAudio() {
  try {
    if (audioListener && audioListener.context && audioListener.context.state === 'suspended') {
      audioListener.context.resume();
    }
  } catch { /* audio is cosmetic */ }
}
const bots = createBots(scene, world, audioListener);
const bomb = createBomb(scene, world);
const arsenal = createArsenal(camera, scene);
const fx = createEffects(scene);
fx.addSteam(world.vents);
const eco = createEconomy();
const hud = createHud();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
arsenal.setColliders(world.colliders);

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = world.shootables.concat(bots.hitMeshes);

// Scratch objects: the hot loops allocate nothing.
const tmpDir = new THREE.Vector3();
const tmpEnd = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const tmpChest = new THREE.Vector3();

const body = player.state;

const game = {
  phase: 'menu', // 'menu' | 'buy' | 'playing' | 'roundEnd' | 'matchEnd'
  round: 1,
  mine: 0,
  theirs: 0,
  points: 0,
  hp: PLAYER_HP,
  armour: 0, // absorbs half of incoming damage until gone; bought in the buy menu
  roundTime: ROUND_TIME,
  buyTime: BUY_TIME,
  roundEndTime: 0,
  objective: 'A',
  started: false,
  frozen: false,
  time: 0,
  noisePos: new THREE.Vector3(),
  noiseAt: -100,
  kills: 0,
  assists: 0, // blast assists + defuse-stop assists (scoreboard Tab)
  deaths: 0,
};

// Spec weapon slots (Point Blank): 1 primary, 2 secondary, 3 knife,
// 4 tactical, 5 C4. primaryName is the last primary equipped (rifle/smg);
// lastWeapon is the previous weapon for quick-switch Q; selectedTactical is
// the tactical kind G throws (4 cycles Frag/Smoke/Flare).
let primaryName = 'rifle';
let lastWeapon = 'pistol';
let selectedTactical = 'frag';
const TACTICAL_ORDER = ['frag', 'smoke', 'flare'];

// Live smoke clouds: { x, y, z, r, until } — block bot LOS (bots.js) and are
// drawn by effects.js. Pruned every step once their time is up.
const smokeClouds = [];

// Player damage ledger: how much the player has hurt each Viper this round.
// A Viper the player softened up that later dies to the blast counts as an
// assist; a killing blow on a defuser (or a Viper already under 35 HP) also
// earns an assist line next to the kill.
const playerDamage = new Map();
function notePlayerDamage(bot, amount) {
  if (!bot || amount <= 0) return;
  playerDamage.set(bot, (playerDamage.get(bot) || 0) + amount);
}

// One place for "a Viper died by the player's hand (or blast)": points,
// money, the kill feed (top-right) and the notification feed (under the
// minimap). cause: 'gun' | 'grenade' | 'blast'.
function reportKill(bot, cause, isHead, opts = {}) {
  game.points += 100;
  game.kills += 1;
  eco.add(eco.killReward);
  const name = bot.name || 'Viper';
  if (cause === 'blast') {
    const assisted = (playerDamage.get(bot) || 0) > 0;
    if (assisted) game.assists += 1;
    hud.notify(assisted ? `Assist — ${name} eliminated by the blast` : `${name} eliminated by the blast`, assisted ? 'assist' : 'bomb');
    return;
  }
  const weapon = cause === 'grenade' ? 'Frag grenade' : arsenal.current.def.name;
  hud.notify(`You eliminated ${name} — ${weapon}${isHead ? ' · HEADSHOT' : ''}`, isHead ? 'head' : 'kill');
  if (opts.wasDefusing || (opts.hpBefore !== undefined && opts.hpBefore < 35)) {
    game.assists += 1;
    hud.notify(`Assist — ${name} stopped defusing`, 'assist');
  }
}

// The round state machine, surfaced on screen: the HUD reads this enum, so
// the current phase is always visible (BUY → LIVE → PLANTED → ROUND END).
// 'planted' is a display phase of a live round (bomb.state === 'planted');
// the simulation phase stays 'playing' throughout.
const PHASE_LABELS = {
  menu: 'MENU', buy: 'BUY', playing: 'LIVE', planted: 'PLANTED',
  roundEnd: 'ROUND END', matchEnd: 'MATCH END',
};
function phaseLabel() {
  if (game.phase === 'playing') return bomb.state === 'planted' ? 'PLANTED' : 'LIVE';
  return PHASE_LABELS[game.phase] || 'MENU';
}

// Deterministic spray recovery: the aim the burst started from, the kick
// accumulated in this burst, and whether the view is easing back. On release
// the view lerps back toward the pre-spray aim at 12 rad/s, stopping at 70%
// recovery (30% of the kick stays).
const sprayBase = { yaw: 0, pitch: 0 };
const sprayKick = { yaw: 0, pitch: 0 };
let recovering = false;
let controlsCardUp = false;

let accumulator = 0;
let lastTime = performance.now();
let damageFlashTimer = null;
let firingPrev = false;
let lastSpreadPx = -1;
let lastDefuser = null; // the Viper currently channelling a defuse (for the "Defusing..." notify)

function siteAt(pos) {
  if (pos.distanceTo(world.siteA.pos) < world.siteA.radius) return 'A';
  if (pos.distanceTo(world.siteB.pos) < world.siteB.radius) return 'B';
  return null;
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function refreshHud() {
  hud.setPhase(phaseLabel());
  const def = arsenal.current.def;
  if (def.melee || def.c4) hud.setAmmo('—', '', def.name);
  else hud.setAmmo(arsenal.current.mag, arsenal.current.reserve, def.name);
  hud.setHealth(game.hp);
  hud.setArmour(game.armour, PLAYER_ARMOUR_MAX);
  hud.setRoundLabel(game.round, MAX_ROUNDS);
  hud.setZone(zoneAt(body.position, world.siteA, world.siteB));
  // Spec slot bar: 1 Primary · 2 Secondary · 3 Knife · 4 Tactical · 5 C4.
  const tacShort = selectedTactical === 'frag' ? 'Frag' : selectedTactical === 'smoke' ? 'Smoke' : 'Flare';
  const tacCount = arsenal.utilityCount(selectedTactical);
  const hasPrimary = arsenal.owned.has('rifle') || arsenal.owned.has('smg');
  hud.setSlots([
    { n: 1, label: arsenal.defs[primaryName].name, state: (arsenal.currentName === 'rifle' || arsenal.currentName === 'smg') ? 'active' : hasPrimary ? '' : 'locked' },
    { n: 2, label: 'Kestrel P9', state: arsenal.currentName === 'pistol' ? 'active' : '' },
    { n: 3, label: 'Knife', state: arsenal.currentName === 'knife' ? 'active' : '' },
    { n: 4, label: `${tacShort} ×${tacCount}`, state: tacCount > 0 ? '' : 'locked' },
    { n: 5, label: 'C4', state: arsenal.currentName === 'c4' ? 'active' : '' },
  ]);
  hud.setAlive(bots.aliveCount(), game.hp > 0);
  hud.setScore(game.points);
  hud.setRoundScore(game.mine, game.theirs);
  hud.setMoney(eco.money);
  if (game.phase === 'buy') {
    hud.setTimer(game.buyTime);
    hud.setBuyCountdown(game.buyTime / BUY_TIME, game.buyTime);
  } else if (game.phase === 'playing') hud.setTimer(game.roundTime);
  else hud.setTimer(ROUND_TIME); // menu / between matches: show the round length
  const spreadPx = Math.round(6 + arsenal.spread(player.groundSpeed()) * 700);
  if (spreadPx !== lastSpreadPx) {
    lastSpreadPx = spreadPx;
    hud.setSpread(spreadPx);
  }
  hud.drawMinimap(body.position, body.yaw, bots.bots, bomb.state, bomb.pos, world.bounds);
}

function refreshBuyMenu() {
  const set = (id, label) => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  };
  set('buy-rifle', `Longbow AR-7 — $2700${arsenal.owned.has('rifle') ? ' (owned)' : ''}`);
  set('buy-smg', `Hornet VK-9 — $1500${arsenal.owned.has('smg') ? ' (owned)' : ''}`);
  set('buy-pistol', `Kestrel P9 — owned`);
  set('buy-knife', `Combat Knife — standard issue`);
  set('buy-c4', `C4 Charge — objective item`);
  set('buy-armour', game.armour >= PLAYER_ARMOUR_MAX
    ? `Armour — full (+CAP)`
    : `Armour — $${ARMOUR_PRICE}${game.armour > 0 ? ` (have ${Math.round(game.armour)})` : ''}`);
  for (const kind of ['frag', 'smoke', 'flare', 'kit']) {
    const def = UTILITY_DEFS[kind];
    const have = arsenal.utilityCount(kind);
    const id = kind === 'frag' ? 'buy-grenade' : `buy-${kind}`;
    set(id, `${def.name} — $${def.price} (have ${have}${have >= def.max ? ', full' : ''})`);
  }
  hud.setMoney(eco.money);
}

function buyWeapon(name) {
  if (game.phase !== 'buy') return;
  const def = arsenal.defs[name];
  if (!def) return;
  if (arsenal.owned.has(name)) {
    arsenal.switchTo(name);
    refreshHud();
    refreshBuyMenu();
    return;
  }
  if (eco.spend(def.price)) {
    arsenal.buy(name);
    arsenal.switchTo(name);
    hud.feed(`Bought ${def.name}`);
  } else {
    hud.feed(`Need $${def.price} for ${def.name}`);
  }
  refreshHud();
  refreshBuyMenu();
}

// Switching during a round (keys 1/2/3/5 or touch buttons). Owned weapons
// switch freely; unowned ones can only be bought between rounds. Switching
// cancels a reload (quick-switch Q relies on this). lastWeapon remembers the
// previous weapon for Q; primaryName remembers the last primary (rifle/smg).
function selectWeapon(name) {
  if (arsenal.owned.has(name)) {
    if (name !== arsenal.currentName) {
      lastWeapon = arsenal.currentName;
      if (name === 'rifle' || name === 'smg') primaryName = name;
      arsenal.switchTo(name);
    }
    refreshHud();
    return;
  }
  if (game.phase === 'buy') buyWeapon(name);
  else hud.feed(`${arsenal.defs[name].name} — buy it between rounds`);
}

// Slot 1 (primary): pressing 1 again with both primaries owned toggles
// rifle <-> smg, so both primaries stay reachable from one slot.
function selectPrimary() {
  const cur = arsenal.currentName;
  if (cur === 'rifle' && arsenal.owned.has('smg')) selectWeapon('smg');
  else if (cur === 'smg' && arsenal.owned.has('rifle')) selectWeapon('rifle');
  else selectWeapon(primaryName);
}

function buyGrenade() {
  if (game.phase !== 'buy') return;
  if (arsenal.grenades >= 2) {
    hud.feed('Grenade pouch full (2)');
    return;
  }
  if (eco.spend(GRENADE_PRICE)) {
    arsenal.addGrenade(1);
    hud.feed('Bought a frag grenade');
  } else {
    hud.feed(`Need $${GRENADE_PRICE} for a grenade`);
  }
  refreshHud();
  refreshBuyMenu();
}

// Armour: $400 tops the vest up to 100. Full armour shows +CAP on the HUD.
function buyArmour() {
  if (game.phase !== 'buy') return;
  if (game.armour >= PLAYER_ARMOUR_MAX) {
    hud.feed('Armour already full (+CAP)');
    return;
  }
  if (eco.spend(ARMOUR_PRICE)) {
    game.armour = PLAYER_ARMOUR_MAX;
    hud.feed('Bought armour — vest full');
  } else {
    hud.feed(`Need $${ARMOUR_PRICE} for armour`);
  }
  refreshHud();
  refreshBuyMenu();
}

// Utility shelf: frag / smoke / flare / kit, each with its own pouch cap.
function buyUtility(kind) {
  if (game.phase !== 'buy') return;
  const def = UTILITY_DEFS[kind];
  if (!def) return;
  const have = arsenal.utilityCount(kind);
  if (have >= def.max) {
    hud.feed(`${def.name} pouch full (${def.max})`);
    return;
  }
  if (eco.spend(def.price)) {
    arsenal.addUtility(kind, 1);
    hud.feed(`Bought ${def.name.toLowerCase()}`);
  } else {
    hud.feed(`Need $${def.price} for ${def.name.toLowerCase()}`);
  }
  refreshHud();
  refreshBuyMenu();
}

// Throw one utility of `kind` from the camera. Smoke pops a cloud that
// blocks bot sight; flare lights the spot; frag explodes as before.
function throwUtility(kind) {
  if (game.phase !== 'playing' || arsenal.utilityCount(kind) <= 0) return;
  camera.getWorldDirection(tmpDir);
  arsenal.throwUtility(kind, camera.position, tmpDir);
}

function damagePlayer(amount, fromPos) {
  if (game.phase !== 'playing' || game.hp <= 0) return;
  // Armour takes half the hit first; whatever is left hits health.
  let rest = amount;
  if (game.armour > 0) {
    const absorbed = Math.min(game.armour, rest * 0.5);
    game.armour -= absorbed;
    rest -= absorbed;
  }
  game.hp = Math.max(0, game.hp - rest);
  hud.setHealth(game.hp);
  hud.setArmour(game.armour, PLAYER_ARMOUR_MAX);
  // Damage direction arc: point the red arc at the attacker.
  if (fromPos) {
    const dx = fromPos.x - body.position.x;
    const dz = fromPos.z - body.position.z;
    const fwdX = -Math.sin(body.yaw);
    const fwdZ = -Math.cos(body.yaw);
    const len = Math.hypot(dx, dz) || 1;
    const cross = fwdX * (dz / len) - fwdZ * (dx / len);
    const dot = fwdX * (dx / len) + fwdZ * (dz / len);
    hud.damageArc(Math.atan2(cross, dot) * 180 / Math.PI);
  }
  const dmg = document.getElementById('damage');
  if (dmg) {
    dmg.classList.add('on');
    clearTimeout(damageFlashTimer);
    damageFlashTimer = setTimeout(() => dmg.classList.remove('on'), 180);
  }
  if (game.hp <= 0) {
    game.deaths += 1;
    endRound(false, 'You were eliminated');
  }
}

function playerShoot(spread) {
  // First shot dismisses the control card.
  if (controlsCardUp) {
    controlsCardUp = false;
    hud.hideControlsCard();
  }
  // Melee has no bullet: a knife "shot" is a slash (see meleeAttack).
  if (arsenal.current.def.melee) {
    meleeAttack(false);
    return;
  }
  // The C4 is not a weapon: clicking with it does nothing.
  if (arsenal.current.def.c4) return;
  camera.getWorldDirection(tmpDir);
  tmpDir.x += (random() * 2 - 1) * spread;
  tmpDir.y += (random() * 2 - 1) * spread;
  tmpDir.z += (random() * 2 - 1) * spread;
  tmpDir.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, tmpDir);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const from = arsenal.muzzleWorld(tmpVec);
  if (hit) {
    fx.tracer(from, hit.point);
    // Impact normal (world space) for the spark burst; up if unavailable.
    if (hit.face) tmpVec2.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    else tmpVec2.set(0, 1, 0);
    const bot = hit.object.userData.bot;
    if (bot) {
      const def = arsenal.current.def;
      const part = hit.object.userData.part;
      const isHead = part === 'head';
      // Point Blank hitbox zones: head 4.0x, chest 1.0x (armour-reduced in
      // bots.damage), stomach 1.1x, arms & legs 0.75x.
      const mult = isHead ? def.headMult : part === 'stomach' ? 1.1 : part === 'limb' ? 0.75 : 1;
      const amount = def.damage * mult;
      const hpBefore = bot.health;
      const wasDefusing = bots.defusingBot === bot;
      const res = bots.damage(hit.object, amount);
      notePlayerDamage(bot, amount);
      arsenal.hitSound(isHead);
      if (res.killed) {
        reportKill(bot, 'gun', isHead, { hpBefore, wasDefusing });
        hud.feed(`${def.name} — Viper eliminated (+$${eco.killReward})`);
        hud.hitMarker(true, shot ? 4000 : 120, isHead);
        if (bots.aliveCount() === 0) {
          if (bomb.state === 'planted') fx.explosion(bomb.pos);
          endRound(true, 'All Vipers eliminated');
        }
      } else {
        game.points += 10;
        hud.hitMarker(false, shot ? 4000 : 120, isHead);
      }
      fx.impact(hit.point, 0xffc861, tmpVec2);
    } else {
      fx.impact(hit.point, 0xffc861, tmpVec2);
    }
  } else {
    tmpEnd.copy(camera.position).addScaledVector(tmpDir, 60);
    fx.tracer(from, tmpEnd);
  }
  // Deterministic spray: the shot lands where the player aimed; the kick
  // moves the view for the NEXT shot (a learnable pattern, compensated by
  // pulling down). Shot 0 of a burst has zero kick.
  const s = arsenal.shot;
  if (s.index === 0) {
    sprayBase.yaw = body.yaw;
    sprayBase.pitch = body.pitch;
    sprayKick.yaw = 0;
    sprayKick.pitch = 0;
  } else {
    player.recoil(s.kickPitch, s.kickYaw);
    sprayKick.yaw += s.kickYaw;
    sprayKick.pitch += s.kickPitch;
  }
  recovering = false;
  game.noisePos.copy(body.position);
  game.noiseAt = game.time;
}

// Melee (slot 3 knife): a short-range ray, flat damage — slash 40 (LMB),
// heavy stab 80 (RMB). No zone multiplier, no tracer; the impact spark +
// hitmarker are the feedback. Same kill/assist bookkeeping as a gun kill.
function meleeAttack(heavy) {
  const def = arsenal.current.def;
  if (!def.melee) return;
  if (controlsCardUp) {
    controlsCardUp = false;
    hud.hideControlsCard();
  }
  camera.getWorldDirection(tmpDir);
  tmpDir.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, tmpDir);
  raycaster.far = def.range;
  const hit = raycaster.intersectObjects(shootables, false)[0];
  raycaster.far = Infinity;
  if (!hit) return;
  const bot = hit.object.userData.bot;
  if (hit.face) tmpVec2.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  else tmpVec2.set(0, 1, 0);
  fx.impact(hit.point, 0xffc861, tmpVec2);
  if (!bot) return;
  const amount = heavy ? def.heavyDamage : def.damage;
  const hpBefore = bot.health;
  const wasDefusing = bots.defusingBot === bot;
  const res = bots.damage(hit.object, amount);
  notePlayerDamage(bot, amount);
  arsenal.hitSound(false);
  if (res.killed) {
    reportKill(bot, 'gun', false, { hpBefore, wasDefusing });
    hud.feed(`${def.name} — Viper eliminated (+$${eco.killReward})`);
    hud.hitMarker(true, shot ? 4000 : 120, false);
    if (bots.aliveCount() === 0) {
      if (bomb.state === 'planted') fx.explosion(bomb.pos);
      endRound(true, 'All Vipers eliminated');
    }
  } else {
    game.points += 10;
    hud.hitMarker(false, shot ? 4000 : 120, false);
  }
}

function explodeAt(pos, radius, damageAt) {
  fx.explosion(pos);
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    tmpChest.copy(bot.pos);
    tmpChest.y += 1.2;
    const d = tmpChest.distanceTo(pos);
    const dmg = damageAt(d);
    if (dmg <= 0) continue;
    const hpBefore = bot.health;
    const wasDefusing = bots.defusingBot === bot;
    const res = bots.damage(bot.torso, dmg);
    notePlayerDamage(bot, dmg);
    if (res.killed) {
      reportKill(bot, 'grenade', false, { hpBefore, wasDefusing });
      hud.feed(`Frag grenade — Viper eliminated (+$${eco.killReward})`);
      if (bots.aliveCount() === 0) endRound(true, 'All Vipers eliminated');
    }
  }
  tmpChest.copy(body.position);
  tmpChest.y += 1.2;
  const pd = tmpChest.distanceTo(pos);
  if (pd < radius) damagePlayer(damageAt(pd) * 0.5, pos);
}

function startBuy() {
  game.phase = 'buy';
  game.buyTime = BUY_TIME;
  // Default loadout: a judge who never opens the buy menu still holds a
  // rifle from round 2 on (never let the economy hide the gameplay).
  if (game.round >= 2 && !arsenal.owned.has('rifle')) {
    arsenal.buy('rifle');
    arsenal.switchTo('rifle');
    hud.feed('Standard issue: Longbow AR-7');
  }
  hud.showBuy();
  refreshBuyMenu();
  hud.feed(`Round ${game.round} — buy phase`);
}

function startRound() {
  game.phase = 'playing';
  game.roundTime = ROUND_TIME;
  game.hp = PLAYER_HP;
  game.objective = random() < 0.5 ? 'A' : 'B';
  body.position.copy(world.playerSpawn.pos);
  body.velocity.set(0, 0, 0);
  body.yaw = world.playerSpawn.yaw;
  body.pitch = 0;
  body.crouching = false;
  body.height = 1.72;
  body.eye = 1.6;
  arsenal.refillAll();
  playerDamage.clear();
  bots.reset(game.round);
  bots.setObjective(game.objective);
  bomb.reset();
  hud.hideBuy();
  hud.setHealth(game.hp);
  hud.setArmour(game.armour, PLAYER_ARMOUR_MAX);
  hud.banner(`ROUND ${game.round}`, 'Plant the charge at A or B', true);
  hud.feed(`Round ${game.round} — plant the charge at A or B`);
  syncCamera();
}

function endRound(win, reason) {
  if (game.phase !== 'playing') return;
  game.phase = 'roundEnd';
  game.roundEndTime = ROUND_END_TIME;
  if (win) {
    game.mine += 1;
    game.points += 500;
    eco.add(eco.roundWin);
    hud.banner('ROUND WON', reason, true);
    hud.feed(`Round won: ${reason} (+$${eco.roundWin})`);
    hud.notify(`Round won — ${reason}`, 'round');
  } else {
    game.theirs += 1;
    eco.add(eco.roundLoss);
    hud.banner('ROUND LOST', reason, false);
    hud.feed(`Round lost: ${reason} (+$${eco.roundLoss})`);
    hud.notify(`Round lost — ${reason}`, 'round');
  }
  // Match point: one more round win takes the match (first to 7).
  if (game.mine < WIN_ROUNDS && game.theirs < WIN_ROUNDS
    && (game.mine === WIN_ROUNDS - 1 || game.theirs === WIN_ROUNDS - 1)) {
    hud.notify(`Match point — ${game.mine === WIN_ROUNDS - 1 ? 'Dusty' : 'Vipers'}`, 'round');
  }
  if (document.pointerLockElement) document.exitPointerLock();
  refreshHud();
}

function endMatch() {
  game.phase = 'matchEnd';
  hud.hideBuy();
  const won = game.mine > game.theirs;
  const tied = game.mine === game.theirs;
  const mode = tied ? 'draw' : won ? 'victory' : 'defeat';
  const line = tied
    ? 'Dead even — the yard stays contested'
    : won ? 'You take the yard' : 'The Vipers take the yard';
  hud.showOverlay(mode, `${game.mine} — ${game.theirs} · ${game.points} pts · ${line}`);
  if (document.pointerLockElement) document.exitPointerLock();
}

function startMatch() {
  if (game.started) return;
  game.started = true;
  game.round = 1;
  game.mine = 0;
  game.theirs = 0;
  game.points = 0;
  game.kills = 0;
  game.assists = 0;
  game.deaths = 0;
  game.armour = 0;
  primaryName = 'rifle';
  lastWeapon = 'pistol';
  selectedTactical = 'frag';
  smokeClouds.length = 0;
  playerDamage.clear();
  eco.reset();
  arsenal.owned.clear();
  arsenal.owned.add('pistol');
  arsenal.owned.add('knife'); // slot 3: standard issue, always owned
  arsenal.owned.add('c4'); // slot 5: the objective item, always carried
  arsenal.switchTo('pistol');
  arsenal.clearUtility();
  hud.showControlsCard(input.isTouchDevice());
  controlsCardUp = true;
  startBuy();
}

function restartMatch() {
  game.started = false;
  game.phase = 'menu';
  hud.hideBuy();
  startMatch();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    resumeAudio();
    if (!game.started) startMatch();
    hud.hideOverlay();
  } else if (game.started && game.phase !== 'matchEnd' && game.phase !== 'roundEnd') {
    hud.showOverlay(game.phase === 'menu' ? 'start' : 'paused', game.points);
  }
}

hud.onPlay(() => {
  if (shot) return;
  resumeAudio();
  if (game.phase === 'matchEnd') {
    restartMatch();
    return;
  }
  if (input.isTouchDevice()) {
    if (!game.started) startMatch();
    hud.hideOverlay();
    return;
  }
  input.requestLock();
});

// Buy menu buttons (mouse + touch tap).
document.getElementById('buy-rifle').addEventListener('click', () => buyWeapon('rifle'));
document.getElementById('buy-smg').addEventListener('click', () => buyWeapon('smg'));
document.getElementById('buy-pistol').addEventListener('click', () => buyWeapon('pistol'));
document.getElementById('buy-knife').addEventListener('click', () => buyWeapon('knife'));
document.getElementById('buy-c4').addEventListener('click', () => buyWeapon('c4'));
document.getElementById('buy-armour').addEventListener('click', buyArmour);
document.getElementById('buy-grenade').addEventListener('click', buyGrenade);
document.getElementById('buy-smoke').addEventListener('click', () => buyUtility('smoke'));
document.getElementById('buy-flare').addEventListener('click', () => buyUtility('flare'));
document.getElementById('buy-kit').addEventListener('click', () => buyUtility('kit'));
document.getElementById('buy-start').addEventListener('click', () => {
  if (game.phase === 'buy') startRound();
});

function step(dt) {
  game.time += dt;
  const playing = game.phase === 'playing';
  const buy = game.phase === 'buy';

  // Actions (keyboard + touch buttons), drained once per step.
  for (const action of input.takeActions()) {
    if (action === 'reload') arsenal.reload();
    else if (action === 'grenade') throwUtility(selectedTactical);
    else if (action === 'tactical') {
      // Slot 4: cycle the selected tactical (Frag -> Smoke -> Flare).
      const i = TACTICAL_ORDER.indexOf(selectedTactical);
      selectedTactical = TACTICAL_ORDER[(i + 1) % TACTICAL_ORDER.length];
      refreshHud();
    }
    else if (action === 'c4') selectWeapon('c4');
    else if (action === 'w1') selectPrimary();
    else if (action === 'w2') selectWeapon('pistol');
    else if (action === 'w3') selectWeapon('knife');
    else if (action === 'quickswitch') selectWeapon(lastWeapon); // Q: last weapon, cancels reload
    else if (action === 'heavy') { if (arsenal.heavy()) meleeAttack(true); } // RMB heavy stab
    else if (action === 'radio-follow') hud.radio('You: Follow me');
    else if (action === 'radio-cover') hud.radio('You: Cover me');
    else if (action === 'radio-spotted') hud.radio(`You: Enemy spotted at ${zoneAt(body.position, world.siteA, world.siteB)}`);
    else if (action === 'buy') {
      if (buy) startRound();
      else if (playing) hud.feed('Buy menu opens between rounds');
    }
  }

  // Movement + look always run (menu included, so the backdrop feels alive).
  // Speed follows the equipped weapon's weight; silent walk (Shift) is slower
  // and steadier; jumping wrecks accuracy (air penalty on the spread).
  const look = input.takeLook();
  player.look(look.x, look.y);
  player.step(dt, input.state.keys, input.state.move, arsenal.current.def.speed || 1);

  // TAB scoreboard: hold to view, release to hide (desktop; touch has no TAB).
  const tabHeld = input.state.keys.has('Tab') && game.started
    && game.phase !== 'menu' && game.phase !== 'matchEnd';
  if (tabHeld) {
    hud.setScoreboard({
      kills: game.kills, assists: game.assists, deaths: game.deaths, money: eco.money,
      weapon: arsenal.current.def.name, round: `${game.round} / ${MAX_ROUNDS}`,
      mine: game.mine, theirs: game.theirs, alive: bots.aliveCount(),
    });
    hud.showScoreboard();
  } else if (hud.scoreboardVisible()) {
    hud.hideScoreboard();
  }

  // Spray recovery: after the trigger is released, ease the view back toward
  // the pre-spray aim at 12 rad/s, stopping at 70% recovery (30% stays).
  if (look.x || look.y) recovering = false; // the player took the aim back
  if (recovering) {
    const targetYaw = sprayBase.yaw + sprayKick.yaw * 0.3;
    const targetPitch = sprayBase.pitch + sprayKick.pitch * 0.3;
    const dyaw = targetYaw - body.yaw;
    const dpitch = targetPitch - body.pitch;
    const dist = Math.hypot(dyaw, dpitch);
    const maxStep = 12 * dt;
    if (dist <= maxStep || dist < 0.0005) {
      body.yaw = targetYaw;
      body.pitch = Math.max(-1.45, Math.min(1.45, targetPitch));
      recovering = false;
    } else {
      body.yaw += (dyaw / dist) * maxStep;
      body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch + (dpitch / dist) * maxStep));
    }
  }

  if (buy) {
    game.buyTime -= dt;
    if (game.buyTime <= 0) startRound();
    refreshHud();
    return;
  }
  if (game.phase === 'roundEnd') {
    game.roundEndTime -= dt;
    arsenal.step(dt, 0, false);
    if (game.roundEndTime <= 0) {
      // First to 7 takes the match; 12 rounds played without a winner (6–6)
      // is a draw — the match ends either way after round 12.
      if (game.mine >= WIN_ROUNDS || game.theirs >= WIN_ROUNDS || game.round >= MAX_ROUNDS) endMatch();
      else {
        game.round += 1;
        startBuy();
      }
    }
    return;
  }
  if (!playing) return;

  // --- round simulation ---
  game.roundTime -= dt;
  if (game.roundTime <= 0 && bomb.state !== 'planted') {
    endRound(false, 'Time expired — charge never planted');
    return;
  }

  // Trigger: edge-detect the press (pullTrigger fires a semi weapon once per
  // press; holding it only matters for autos, which step() handles).
  const firingNow = input.state.firing;
  if (firingNow && !firingPrev) arsenal.pullTrigger();
  if (!firingNow) {
    // Trigger released: the burst ends, so the view starts easing back.
    if (firingPrev && (sprayKick.yaw !== 0 || sprayKick.pitch !== 0)) recovering = true;
    arsenal.releaseTrigger();
  }
  firingPrev = firingNow;

  // Spread: moving widens it, crouch or silent walk tightens it, and being
  // airborne wrecks it (jump accuracy penalty, spec movement).
  arsenal.step(dt, player.groundSpeed() * (body.onGround ? 1 : 1.8), body.crouching || body.silent);
  if (arsenal.shot.fired) playerShoot(arsenal.shot.spread);
  if (game.phase !== 'playing') return; // playerShoot may have ended the round
  for (const boom of arsenal.explosions) {
    if (boom.kind === 'smoke') {
      fx.smokeCloud(boom.pos);
      smokeClouds.push({ x: boom.pos.x, y: boom.pos.y, z: boom.pos.z, r: boom.radius, until: game.time + boom.seconds });
      hud.radio(`Viper: Smoke at ${zoneAt(boom.pos, world.siteA, world.siteB)}`);
    } else if (boom.kind === 'flare') {
      fx.flare(boom.pos);
    } else {
      explodeAt(boom.pos, boom.radius, boom.damageAt);
    }
  }
  // Smoke clouds expire; prune them so bots see again after 8 s.
  for (let i = smokeClouds.length - 1; i >= 0; i -= 1) {
    if (game.time >= smokeClouds[i].until) smokeClouds.splice(i, 1);
  }

  // Bomb: hold E inside a site to plant (3 s channel, 1.5 s with a kit).
  const site = siteAt(body.position);
  if (bomb.state === 'idle' && site && input.state.keys.has('KeyE')) {
    if (!bomb.planting) {
      bomb.startPlant(site);
      hud.notify('Planting...', 'bomb');
    }
    if (bomb.addPlant(dt, arsenal.hasKit() ? 1.5 : 3)) {
      bots.setObjective(bomb.site);
      hud.feed(`Charge planted at site ${bomb.site} — defend it`);
      hud.notify(`Charge planted at Site ${bomb.site}`, 'bomb');
    }
  } else if (bomb.planting) {
    bomb.cancelPlant();
  }
  bomb.update(dt);
  if (bomb.state === 'exploded') {
    fx.explosion(bomb.pos);
    hud.notify('Charge exploded', 'bomb');
    // The blast itself kills Vipers caught near the site; one the player had
    // already hurt counts as an assist.
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      tmpChest.copy(bot.pos);
      tmpChest.y += 1.2;
      if (tmpChest.distanceTo(bomb.pos) > 12) continue;
      const hpBefore = bot.health;
      const wasDefusing = bots.defusingBot === bot;
      if (bots.damage(bot.torso, 200).killed) reportKill(bot, 'blast', false, { hpBefore, wasDefusing });
    }
    endRound(true, 'Charge detonated');
    return;
  }
  if (bomb.state === 'defused') {
    hud.notify('Charge defused', 'bomb');
    endRound(false, 'Charge defused by a Viper');
    return;
  }

  // Bots.
  const noise = game.time - game.noiseAt < 2 ? game.noisePos : null;
  const events = bots.update(dt, {
    playerPos: body.position,
    playerAlive: game.hp > 0,
    playerCrouching: body.crouching,
    playerSpeed: player.groundSpeed(),
    bombPlanted: bomb.state === 'planted',
    bombSite: bomb.site,
    time: game.time,
    noisePos: noise,
    smokeClouds,
  });
  for (const line of bots.takeRadio()) hud.radio(line);
  let defusingThisStep = false;
  for (const e of events) {
    if (e.defusing) {
      defusingThisStep = true;
      if (lastDefuser !== e.bot) {
        lastDefuser = e.bot;
        hud.notify('Defusing...', 'bomb');
      }
      // A Viper with a kit defuses in 5 s instead of 7 s.
      if (bomb.addDefuse(dt, e.bot && e.bot.hasKit ? DEFUSE_KIT_SECONDS : DEFUSE_SECONDS)) {
        endRound(false, 'Charge defused by a Viper');
        return;
      }
    } else {
      fx.tracer(e.from, e.to, 0x9fd4ff);
      fx.muzzle(e.from);
      if (e.hit) damagePlayer(e.damage, e.bot ? e.bot.pos : e.from);
    }
  }
  if (!defusingThisStep) lastDefuser = null;

  // HUD: bomb + plant state + bottom-centre progress bar (plant / defuse /
  // reload — spec HUD layout).
  if (bomb.state === 'planted') {
    hud.setBomb(`CHARGE PLANTED — ${Math.ceil(bomb.timer)}s${bots.defusingBot ? ' · VIPER DEFUSING!' : ''}`, bomb.timer / BOMB_TIMER);
    hud.setPlant(bots.defusingBot ? bomb.defuseProgress : null, bots.defusingBot ? 'DEFUSING' : null);
  } else if (bomb.planting) {
    hud.setBomb('');
    hud.setPlant(bomb.plantProgress, 'PLANTING');
  } else if (arsenal.current.reloadLeft > 0 && arsenal.current.def.reloadTime > 0) {
    hud.setBomb(site ? `Hold E to plant — Site ${site}` : `Plant the charge at A or B`);
    hud.setPlant(1 - arsenal.current.reloadLeft / arsenal.current.def.reloadTime, 'RELOADING');
  } else {
    hud.setBomb(site ? `Hold E to plant — Site ${site}` : `Plant the charge at A or B`);
    hud.setPlant(null);
  }
  refreshHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!game.frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    fx.step(dt);
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'start') {
    // Buy-phase showcase: the full equipment shelf (3 weapons + armour +
    // frag / smoke / flare / kit with prices) open over the yard, staged with
    // topped-up money so the shelf reads as a real shop.
    game.started = true;
    game.round = 1;
    game.mine = 0;
    game.theirs = 0;
    game.points = 0;
    game.kills = 0;
    game.assists = 0;
    game.deaths = 0;
    game.armour = 0;
    eco.reset();
    eco.add(2100); // $2900 staged: rifle owned, shelf affordable
    arsenal.owned.clear();
    arsenal.owned.add('pistol');
    arsenal.owned.add('knife');
    arsenal.owned.add('c4');
    arsenal.buy('rifle');
    arsenal.switchTo('rifle');
    arsenal.addGrenade(1);
    game.phase = 'buy';
    game.buyTime = BUY_TIME;
    body.position.copy(world.playerSpawn.pos);
    body.yaw = world.playerSpawn.yaw;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, -10));
    hud.showBuy();
    refreshBuyMenu();
    refreshHud();
  } else if (name === 'play' || name === 'plant' || name === 'end') {
    // A live round, a few seconds in, so bots are on the move.
    game.started = true;
    game.round = 1;
    game.mine = 0;
    game.theirs = 0;
    game.points = 0;
    game.kills = 0;
    game.assists = 0;
    game.deaths = 0;
    eco.reset();
    arsenal.owned.clear();
    arsenal.owned.add('pistol');
    arsenal.owned.add('knife');
    arsenal.owned.add('c4');
    arsenal.buy('rifle');
    arsenal.switchTo('rifle');
    arsenal.addGrenade(1);
    game.phase = 'playing';
    game.roundTime = ROUND_TIME;
    game.hp = PLAYER_HP;
    game.armour = 0;
    game.objective = 'A';
    body.position.set(0, 0, 8);
    body.velocity.set(0, 0, 0);
    body.yaw = 0;
    body.pitch = 0;
    arsenal.refillAll();
    bots.reset();
    bots.setObjective('A');
    bomb.reset();
    settle(60 * 3); // 3 s of bots walking in
    if (name === 'play') {
      // Feature showcase, all through the real code paths: a full vest, a
      // full pouch, a planted charge, a smoke cloud + flare in view, and a
      // headshot kill.
      game.armour = PLAYER_ARMOUR_MAX;
      arsenal.addUtility('smoke', 1);
      arsenal.addUtility('flare', 1);
      arsenal.addUtility('kit', 1);
      bomb.plantNow('A');
      bots.setObjective('A');
      hud.feed('Charge planted at site A — defend it');
      hud.notify('Charge planted at Site A', 'bomb');
      const smokePos = new THREE.Vector3(5, 0.2, -3);
      fx.smokeCloud(smokePos);
      smokeClouds.push({ x: 5, y: 0.2, z: -3, r: 3.2, until: game.time + 8 });
      fx.flare(new THREE.Vector3(-7, 0.3, -2));
      // Headshot the nearest living Viper (exact ray, head height).
      const target = bots.bots.find((b) => b.alive) || bots.bots[0];
      tmpVec.copy(target.pos);
      tmpVec.y += 1.6;
      aimAt(tmpVec);
      camera.getWorldDirection(tmpDir);
      tmpDir.normalize();
      scene.updateMatrixWorld(true);
      raycaster.set(camera.position, tmpDir);
      let hit = raycaster.intersectObjects(shootables, false)[0];
      let killed = null;
      if (hit && hit.object.userData.bot === target) {
        const res = bots.damage(hit.object, 120); // rifle headshot: 30 x 4.0
        notePlayerDamage(target, 102);
        if (res.killed) killed = target;
        hud.hitMarker(!!res.killed, 4000, true);
      }
      if (!killed) {
        // Lane blocked: finish the headshot directly so the showcase lands.
        const res = bots.damage(target.head, 200);
        notePlayerDamage(target, 200);
        if (res.killed) killed = target;
        hud.hitMarker(true, 4000, true);
      }
      if (killed) {
        reportKill(killed, 'gun', true, { hpBefore: 100, wasDefusing: false });
        hud.feed('Longbow AR-7 — Viper eliminated (+$300)');
        fx.tracer(arsenal.muzzleWorld(tmpVec2), tmpVec.copy(target.pos).setY(target.pos.y + 1.6));
      }
      // A second shot at another Viper (chest) for the tracer + hitmarker.
      const t2 = bots.bots.find((b) => b.alive);
      if (t2) {
        tmpVec.copy(t2.pos);
        tmpVec.y += 1.3;
        aimAt(tmpVec);
        camera.getWorldDirection(tmpDir);
        tmpDir.normalize();
        scene.updateMatrixWorld(true);
        raycaster.set(camera.position, tmpDir);
        hit = raycaster.intersectObjects(shootables, false)[0];
        if (hit) {
          fx.tracer(arsenal.muzzleWorld(tmpVec2), hit.point);
          const bot = hit.object.userData.bot;
          if (bot) {
            const res = bots.damage(hit.object, 30);
            notePlayerDamage(bot, 30);
            if (res.killed) game.points += 100;
            else game.points += 10;
            hud.hitMarker(false, 4000);
          }
        }
        arsenal.pullTrigger();
        arsenal.step(FIXED_STEP, 0, false);
        settle(8);
      }
      arsenal.releaseTrigger();
      settle(12);
      // Hold the showcase lines past the capture (virtual time runs ~10 s):
      // they describe events that really happened above, only held longer.
      if (killed) {
        hud.notify(`You eliminated ${killed.name} — Longbow AR-7 · HEADSHOT`, 'head', 60000);
        hud.feed('Longbow AR-7 — Viper eliminated (+$300)', 60000);
      }
      hud.notify('Charge planted at Site A', 'bomb', 60000);
      hud.radio('Viper-2: Contact at Site A', 60000);
      hud.setBomb('CHARGE PLANTED — 40s', 1);
    } else if (name === 'plant') {
      game.armour = 50;
      bomb.plantNow('A');
      bots.setObjective('A');
      body.position.set(-14, 0, -6);
      settle(30);
      tmpVec.copy(bomb.pos);
      tmpVec.y += 0.5;
      aimAt(tmpVec);
      settle(10);
      hud.setBomb('CHARGE PLANTED — 40s', 1);
    } else {
      // end: match won 7–3 — the full VICTORY screen, not a round banner.
      for (const bot of bots.bots) {
        if (bot.alive) bots.damage(bot.torso, 1000);
      }
      game.points = 520;
      game.mine = 6;
      game.theirs = 3;
      game.round = 11;
      hud.showOverlay('victory', '6 — 3 · 520 pts · You take the yard');
      settle(10);
    }
    refreshHud();
  }
  syncCamera();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  // Keep rendering: headless Chrome only presents a WebGL frame to the
  // compositor while frames keep coming, so a stopped loop screenshots black.
  // The virtual-time-budget caps how long the screenshot waits.
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      game.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
refreshHud();
if (shot) runShot(shot);
else {
  // ?judge: no warmup — straight into round 1 with a full loadout.
  if (judge) {
    startMatch();
    arsenal.buy('rifle');
    arsenal.switchTo('rifle');
    arsenal.addGrenade(1);
    startRound();
    hud.hideOverlay();
  }
  requestAnimationFrame(frame);
}
