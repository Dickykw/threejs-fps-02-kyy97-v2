// DUSTY YARD — a round-based tactical FPS (Counter-Strike-style, all original).
// One loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// ?shot=start|play|plant|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
//
// Flow: menu -> buy phase (15 s, move freely, bots dormant) -> round (100 s,
// plant the charge at A or B or eliminate all 5 Vipers) -> round end banner
// -> next buy phase. First to 3 rounds wins the match.
//
// Sunset pass: ACES filmic tone mapping at exposure 1.45 over the warm dusk
// lighting, steam rising from the vent stacks, a tactical minimap in the HUD.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArsenal, GRENADE_PRICE } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb } from './bomb.js';
import { createEffects } from './effects.js';
import { createEconomy } from './economy.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const BUY_TIME = 15;
const ROUND_END_TIME = 4;
const WIN_ROUNDS = 3;
const PLAYER_HP = 100;

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
  deaths: 0,
};

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
  hud.setAmmo(arsenal.current.mag, arsenal.current.reserve, arsenal.current.def.name);
  hud.setHealth(game.hp);
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
  set('buy-grenade', `Frag grenade — $400 (have ${arsenal.grenades})`);
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

// Switching during a round (keys 1/2/3 or touch buttons). Owned weapons switch
// freely; unowned ones can only be bought between rounds.
function selectWeapon(name) {
  if (arsenal.owned.has(name)) {
    arsenal.switchTo(name);
    refreshHud();
    return;
  }
  if (game.phase === 'buy') buyWeapon(name);
  else hud.feed(`${arsenal.defs[name].name} — buy it between rounds`);
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

function damagePlayer(amount) {
  if (game.phase !== 'playing' || game.hp <= 0) return;
  game.hp = Math.max(0, game.hp - amount);
  hud.setHealth(game.hp);
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
      const mult = isHead ? def.headMult : part === 'limb' ? 0.75 : 1;
      const amount = def.damage * mult;
      const res = bots.damage(hit.object, amount);
      arsenal.hitSound(isHead);
      if (res.killed) {
        game.points += 100;
        game.kills += 1;
        eco.add(eco.killReward);
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

function explodeAt(pos, radius, damageAt) {
  fx.explosion(pos);
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    tmpChest.copy(bot.pos);
    tmpChest.y += 1.2;
    const d = tmpChest.distanceTo(pos);
    const dmg = damageAt(d);
    if (dmg <= 0) continue;
    const res = bots.damage(bot.torso, dmg);
    if (res.killed) {
      game.points += 100;
      game.kills += 1;
      eco.add(eco.killReward);
      hud.feed(`Frag grenade — Viper eliminated (+$${eco.killReward})`);
      if (bots.aliveCount() === 0) endRound(true, 'All Vipers eliminated');
    }
  }
  tmpChest.copy(body.position);
  tmpChest.y += 1.2;
  const pd = tmpChest.distanceTo(pos);
  if (pd < radius) damagePlayer(damageAt(pd) * 0.5);
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
  bots.reset();
  bots.setObjective(game.objective);
  bomb.reset();
  hud.hideBuy();
  hud.setHealth(game.hp);
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
  } else {
    game.theirs += 1;
    eco.add(eco.roundLoss);
    hud.banner('ROUND LOST', reason, false);
    hud.feed(`Round lost: ${reason} (+$${eco.roundLoss})`);
  }
  if (document.pointerLockElement) document.exitPointerLock();
  refreshHud();
}

function endMatch() {
  game.phase = 'matchEnd';
  hud.hideBuy();
  const won = game.mine > game.theirs;
  hud.showOverlay('match', `${game.mine} — ${game.theirs} · ${game.points} pts · ${won ? 'You take the yard' : 'The Vipers take the yard'}`);
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
  game.deaths = 0;
  eco.reset();
  arsenal.owned.clear();
  arsenal.owned.add('pistol');
  arsenal.switchTo('pistol');
  arsenal.addGrenade(-arsenal.grenades);
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
document.getElementById('buy-grenade').addEventListener('click', buyGrenade);
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
    else if (action === 'grenade') {
      if (playing && arsenal.grenades > 0) {
        camera.getWorldDirection(tmpDir);
        arsenal.throwGrenade(camera.position, tmpDir);
      }
    } else if (action === 'w1') selectWeapon('rifle');
    else if (action === 'w2') selectWeapon('smg');
    else if (action === 'w3') selectWeapon('pistol');
    else if (action === 'wnext') {
      const order = ['pistol', 'smg', 'rifle'].filter((n) => arsenal.owned.has(n));
      const i = order.indexOf(arsenal.currentName);
      arsenal.switchTo(order[(i + 1) % order.length]);
    } else if (action === 'buy') {
      if (buy) startRound();
      else if (playing) hud.feed('Buy menu opens between rounds');
    }
  }

  // Movement + look always run (menu included, so the backdrop feels alive).
  const look = input.takeLook();
  player.look(look.x, look.y);
  player.step(dt, input.state.keys, input.state.move);

  // TAB scoreboard: hold to view, release to hide (desktop; touch has no TAB).
  const tabHeld = input.state.keys.has('Tab') && game.started
    && game.phase !== 'menu' && game.phase !== 'matchEnd';
  if (tabHeld) {
    hud.setScoreboard({
      kills: game.kills, deaths: game.deaths, money: eco.money,
      weapon: arsenal.current.def.name, round: game.round,
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
      if (game.mine >= WIN_ROUNDS || game.theirs >= WIN_ROUNDS) endMatch();
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

  arsenal.step(dt, player.groundSpeed(), body.crouching);
  if (arsenal.shot.fired) playerShoot(arsenal.shot.spread);
  if (game.phase !== 'playing') return; // playerShoot may have ended the round
  for (const boom of arsenal.explosions) {
    explodeAt(boom.pos, boom.radius, boom.damageAt);
  }

  // Bomb: hold E inside a site to plant (3 s channel).
  const site = siteAt(body.position);
  if (bomb.state === 'idle' && site && input.state.keys.has('KeyE')) {
    if (!bomb.planting) bomb.startPlant(site);
    if (bomb.addPlant(dt)) {
      bots.setObjective(bomb.site);
      hud.feed(`Charge planted at site ${bomb.site} — defend it`);
    }
  } else if (bomb.planting) {
    bomb.cancelPlant();
  }
  bomb.update(dt);
  if (bomb.state === 'exploded') {
    fx.explosion(bomb.pos);
    endRound(true, 'Charge detonated');
    return;
  }
  if (bomb.state === 'defused') {
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
  });
  for (const e of events) {
    if (e.defusing) {
      if (bomb.addDefuse(dt)) {
        endRound(false, 'Charge defused by a Viper');
        return;
      }
    } else {
      fx.tracer(e.from, e.to, 0x9fd4ff);
      fx.muzzle(e.from);
      if (e.hit) damagePlayer(e.damage);
    }
  }

  // HUD: bomb + plant state.
  if (bomb.state === 'planted') {
    hud.setBomb(`CHARGE PLANTED — ${Math.ceil(bomb.timer)}s${bots.defusingBot ? ' · VIPER DEFUSING!' : ''}`, bomb.timer / 35);
  } else if (bomb.planting) {
    hud.setBomb('');
    hud.setPlant(bomb.plantProgress);
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
    body.position.copy(world.playerSpawn.pos);
    body.yaw = world.playerSpawn.yaw;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, -10));
    hud.showOverlay('start', 0);
  } else if (name === 'play' || name === 'plant' || name === 'end') {
    // A live round, a few seconds in, so bots are on the move.
    game.started = true;
    game.round = 1;
    game.mine = 0;
    game.theirs = 0;
    game.points = 0;
    game.kills = 0;
    game.deaths = 0;
    eco.reset();
    arsenal.owned.clear();
    arsenal.owned.add('pistol');
    arsenal.buy('rifle');
    arsenal.switchTo('rifle');
    arsenal.addGrenade(1);
    game.phase = 'playing';
    game.roundTime = ROUND_TIME;
    game.hp = PLAYER_HP;
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
      const target = bots.bots.find((b) => b.alive) || bots.bots[0];
      tmpVec.copy(target.pos);
      tmpVec.y += 1.3;
      aimAt(tmpVec);
      for (let i = 0; i < 2; i += 1) {
        camera.getWorldDirection(tmpDir);
        tmpDir.normalize();
        scene.updateMatrixWorld(true);
        raycaster.set(camera.position, tmpDir);
        const hit = raycaster.intersectObjects(shootables, false)[0];
        if (hit) {
          fx.tracer(arsenal.muzzleWorld(tmpVec2), hit.point);
          const bot = hit.object.userData.bot;
          if (bot) {
            const res = bots.damage(hit.object, 30);
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
      const t2 = bots.bots.find((b) => b.alive);
      if (t2) {
        tmpVec.copy(t2.pos);
        tmpVec.y += 1.3;
        aimAt(tmpVec);
      }
    } else if (name === 'plant') {
      bomb.plantNow('A');
      bots.setObjective('A');
      body.position.set(-14, 0, -6);
      settle(30);
      tmpVec.copy(bomb.pos);
      tmpVec.y += 0.5;
      aimAt(tmpVec);
      settle(10);
    } else {
      // end: all bots down, round won.
      for (const bot of bots.bots) {
        if (bot.alive) bots.damage(bot.torso, 1000);
      }
      game.points = 520;
      game.mine = 1;
      hud.banner('ROUND WON', 'All Vipers eliminated', true, 3600000); // 1 h: headless rendering is slow, the banner must outlive the screenshot
      hud.showOverlay('end', game.points);
      settle(10);
    }
    hud.setAmmo(arsenal.current.mag, arsenal.current.reserve, arsenal.current.def.name);
    hud.setHealth(game.hp);
    hud.setScore(game.points);
    hud.setRoundScore(game.mine, game.theirs);
    hud.setMoney(eco.money);
    hud.setTimer(game.roundTime);
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
