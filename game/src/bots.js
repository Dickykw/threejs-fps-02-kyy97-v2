// BOTS — "Vipers" enemy AI + humanoid models (Counter-Strike-STYLE, own art).
// Five bots vs the lone player. Humanoids built from shared primitives so they
// read as people (head + helmet/visor, vest torso, arms, legs, rifle) — not
// boxes. The sunset pass brightens the kit: a vivid orange vest, a glowing
// visor stripe, knee pads and a backpack, so a Viper reads instantly against
// the dusk. Owns: bot models, AI state machine, LOS, shooting events, death
// fall, defuse run. Does NOT import world.js — the world object is passed in
// by the integrator.
import * as THREE from 'three';

// ---------------------------------------------------------------- tuning ---
const BOT_COUNT = 5;
const BOT_HEALTH = 100;
const BOT_HEIGHT = 1.75;
const BOT_RADIUS = 0.34;
const WALK_SPEED = 3.2;      // patrol / investigate
const ENGAGE_SPEED = 2.2;    // closing in while engaging
const DEFUSE_SPEED = 3.6;    // rushing the planted bomb
const ARRIVE_RADIUS = 0.6;
const SIGHT_RANGE = 55;
const VISION_DOT = -0.2;     // ~150-degree vision cone (can notice behind, slowly)
const FALL_SECONDS = 0.4;
const DEFUSE_SECONDS = 5;    // uninterrupted channel to defuse the bomb
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.6;
const SHOT_MIN_GAP = 0.55;
const SHOT_MAX_GAP = 0.9;
const LOSE_SIGHT_SECONDS = 1.2; // LOS lost this long -> give up the engage
const INVESTIGATE_SCAN_SECONDS = 2.5;

// Team look: vivid orange Vipers vs the player's world. Dark kit, bright vest.
const COL = {
  skin: 0x8a5a3b,
  dark: 0x23262b,      // shirt, trousers, boots
  vest: 0xe84a10,      // team-color vest, brighter at dusk
  vestDark: 0x9c2f08,
  accent: 0xff6a1f,     // helmet stripe, visor, shoulder patch
  gun: 0x141518,
  gunMetal: 0x2e3238,
};

// ------------------------------------------------------- module scratch ---
// No per-frame allocation inside update(): everything below is reused.
const _toPlayer = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _move = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _probe = new THREE.Box3();
const _sep = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _events = []; // reused shot/defuse event array — consume synchronously

// ------------------------------------------------------------ helpers -----
function toVec3(p, fallback) {
  if (!p) return fallback ? fallback.clone() : new THREE.Vector3();
  if (p.isVector3) return p.clone();
  if (Array.isArray(p)) return new THREE.Vector3(p[0] || 0, p[1] || 0, p[2] || 0);
  return new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0);
}

function normalizeBounds(world) {
  const b = world && world.bounds;
  if (!b) return { minX: -11.4, maxX: 11.4, minZ: -11.4, maxZ: 11.4 };
  if (b.min && b.max) {
    return {
      minX: b.min.x + BOT_RADIUS, maxX: b.max.x - BOT_RADIUS,
      minZ: b.min.z + BOT_RADIUS, maxZ: b.max.z - BOT_RADIUS,
    };
  }
  return {
    minX: (b.minX ?? -11.4), maxX: (b.maxX ?? 11.4),
    minZ: (b.minZ ?? -11.4), maxZ: (b.maxZ ?? 11.4),
  };
}

function sitePos(world, site) {
  const s = site === 'B' ? world.siteB : world.siteA;
  if (!s) return new THREE.Vector3(site === 'B' ? 8 : -8, 0, -8);
  return toVec3(s.pos || s, new THREE.Vector3(site === 'B' ? 8 : -8, 0, -8));
}

function angleLerpDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

// ------------------------------------------------- shared model assets ---
// Geometry + materials are built ONCE and shared by all five bots.
function buildAssets() {
  const g = {};
  g.head = new THREE.SphereGeometry(0.13, 20, 14);
  // Helmet: shallow dome sitting on the head.
  g.helmet = new THREE.SphereGeometry(0.145, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  g.visor = new THREE.BoxGeometry(0.17, 0.035, 0.025);
  g.stripe = new THREE.BoxGeometry(0.035, 0.012, 0.27);
  g.torso = new THREE.BoxGeometry(0.48, 0.62, 0.28);
  g.shoulders = new THREE.BoxGeometry(0.56, 0.12, 0.3);
  g.vest = new THREE.BoxGeometry(0.5, 0.42, 0.06);   // chest plate, front
  g.vestBack = new THREE.BoxGeometry(0.5, 0.42, 0.06);
  g.belt = new THREE.BoxGeometry(0.5, 0.08, 0.3);
  g.patch = new THREE.BoxGeometry(0.12, 0.07, 0.02); // shoulder patch
  g.pack = new THREE.BoxGeometry(0.34, 0.42, 0.14);  // backpack
  g.knee = new THREE.BoxGeometry(0.16, 0.12, 0.05);  // knee pads
  // Limbs pivot at the joint: geometry translated so origin = top of the limb.
  g.arm = new THREE.BoxGeometry(0.11, 0.6, 0.11);
  g.arm.translate(0, -0.3, 0);
  g.leg = new THREE.BoxGeometry(0.15, 0.78, 0.15);
  g.leg.translate(0, -0.39, 0);
  g.boot = new THREE.BoxGeometry(0.16, 0.09, 0.26);
  g.gunBody = new THREE.BoxGeometry(0.07, 0.11, 0.5);
  g.gunBarrel = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8);
  g.gunBarrel.rotateX(Math.PI / 2);
  g.gunMag = new THREE.BoxGeometry(0.05, 0.16, 0.09);
  g.gunStock = new THREE.BoxGeometry(0.06, 0.09, 0.14);

  const m = {};
  m.skin = new THREE.MeshStandardMaterial({ color: COL.skin, roughness: 0.6, metalness: 0.05 });
  m.dark = new THREE.MeshStandardMaterial({ color: COL.dark, roughness: 0.85, metalness: 0.05 });
  m.vest = new THREE.MeshStandardMaterial({ color: COL.vest, roughness: 0.7, metalness: 0.1 });
  m.vestDark = new THREE.MeshStandardMaterial({ color: COL.vestDark, roughness: 0.75, metalness: 0.05 });
  m.accent = new THREE.MeshStandardMaterial({ color: COL.accent, roughness: 0.4, metalness: 0.2, emissive: COL.accent, emissiveIntensity: 0.85 });
  m.gun = new THREE.MeshStandardMaterial({ color: COL.gun, roughness: 0.45, metalness: 0.6 });
  m.gunMetal = new THREE.MeshStandardMaterial({ color: COL.gunMetal, roughness: 0.35, metalness: 0.7 });
  return { g, m };
}

// Build one humanoid (~1.75 m). Forward is +Z; yaw = atan2(dx, dz) faces a target.
function buildBotModel(assets, index) {
  const { g, m } = assets;
  // Per-bot clones of the materials a hit can strike: the emissive hit flash
  // lights up only this bot (the shared set would flash all five). The flash
  // colour is baked in at clone time; only emissiveIntensity is animated.
  const skin = m.skin.clone();
  const dark = m.dark.clone();
  const vest = m.vest.clone();
  const vestDark = m.vestDark.clone();
  for (const mat of [skin, dark, vest, vestDark]) {
    mat.emissive.setHex(0xffb347);
    mat.emissiveIntensity = 0;
  }
  const flashMats = [skin, dark, vest, vestDark];
  const group = new THREE.Group();

  // Legs — pivot at the hip (y 0.78), boots at the feet, knee pads up front.
  const legL = new THREE.Mesh(g.leg, dark);
  legL.position.set(-0.11, 0.78, 0);
  const legR = new THREE.Mesh(g.leg, dark);
  legR.position.set(0.11, 0.78, 0);
  const bootL = new THREE.Mesh(g.boot, m.gun);
  bootL.position.set(0, -0.74, 0.04);
  const bootR = new THREE.Mesh(g.boot, m.gun);
  bootR.position.set(0, -0.74, 0.04);
  const kneeL = new THREE.Mesh(g.knee, m.gun);
  kneeL.position.set(0, -0.42, 0.09);
  const kneeR = new THREE.Mesh(g.knee, m.gun);
  kneeR.position.set(0, -0.42, 0.09);
  legL.add(bootL, kneeL);
  legR.add(bootR, kneeR);

  // Torso — dark shirt, team-color vest front/back, belt, shoulder bar, pack.
  const torso = new THREE.Mesh(g.torso, dark);
  torso.position.y = 1.09;
  const shoulders = new THREE.Mesh(g.shoulders, dark);
  shoulders.position.y = 1.36;
  const vestMesh = new THREE.Mesh(g.vest, vest);
  vestMesh.position.set(0, 1.12, 0.16);
  const vestBack = new THREE.Mesh(g.vestBack, vestDark);
  vestBack.position.set(0, 1.12, -0.16);
  const pack = new THREE.Mesh(g.pack, m.dark);
  pack.position.set(0, 1.1, -0.26);
  const belt = new THREE.Mesh(g.belt, m.gun);
  belt.position.y = 0.8;
  // Shoulder patch: bright team marker, reads instantly at range.
  const patch = new THREE.Mesh(g.patch, m.accent);
  patch.position.set(-0.2, 1.42, 0.16);
  patch.rotation.x = -0.15;

  // Head — skin sphere, dark helmet dome, bright stripe, glowing visor strip.
  const head = new THREE.Mesh(g.head, skin);
  head.position.y = 1.6;
  const helmet = new THREE.Mesh(g.helmet, dark);
  helmet.position.y = 1.63;
  const stripe = new THREE.Mesh(g.stripe, m.accent);
  stripe.position.set(0, 1.76, 0);
  const visor = new THREE.Mesh(g.visor, m.accent);
  visor.position.set(0, 1.61, 0.115);

  // Arms — pivot at the shoulder (y 1.42). Right arm carries the rifle.
  const armL = new THREE.Mesh(g.arm, dark);
  armL.position.set(-0.3, 1.42, 0);
  const armR = new THREE.Mesh(g.arm, dark);
  armR.position.set(0.3, 1.42, 0);

  // Rifle — held forward from the right hand; tip marker for tracer origin.
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(g.gunBody, m.gun);
  const gunBarrel = new THREE.Mesh(g.gunBarrel, m.gunMetal);
  gunBarrel.position.set(0, 0.01, -0.36);
  const gunMag = new THREE.Mesh(g.gunMag, m.gun);
  gunMag.position.set(0, -0.12, 0.02);
  const gunStock = new THREE.Mesh(g.gunStock, m.dark);
  gunStock.position.set(0, 0, 0.3);
  const gunTip = new THREE.Object3D();
  gunTip.position.set(0, 0.01, -0.52);
  gun.add(gunBody, gunBarrel, gunMag, gunStock, gunTip);
  gun.position.set(0, -0.56, 0.1);
  armR.add(gun);

  group.add(legL, legR, torso, shoulders, vestMesh, vestBack, pack, belt, patch,
    head, helmet, stripe, visor, armL, armR);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  return { group, head, torso, gun, gunTip, armL, armR, legL, legR, flashMats, phase: index * 1.31 };
}

// -------------------------------------------------------------- factory ---
// `listener` is an optional THREE.AudioListener (already on the camera):
// with it, every bot gets directional PositionalAudio (gunfire + footsteps)
// from procedurally generated buffers. Without it, bots are silent —
// everything else works exactly the same.
export function createBots(scene, world, listener = null) {
  const colliders = world.colliders || [];
  const shootables = world.shootables || [];
  const bounds = normalizeBounds(world);
  const assets = buildAssets();

  // One shared noise buffer per sound, built from the listener's context.
  // Guarded: any failure leaves the buffers null and the bots silent.
  function makeNoiseBuffer(ctx, dur, gainPeak, thumpFreq) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) {
      const t = i / len;
      const env = (1 - t) * (1 - t);
      data[i] = ((Math.random() * 2 - 1) * 0.7
        + Math.sin(2 * Math.PI * thumpFreq * (i / ctx.sampleRate)) * 0.5) * env * gainPeak;
    }
    return buf;
  }
  let shotBuffer = null;
  let stepBuffer = null;
  if (listener && listener.context) {
    try {
      shotBuffer = makeNoiseBuffer(listener.context, 0.12, 0.5, 160);
      stepBuffer = makeNoiseBuffer(listener.context, 0.06, 0.3, 90);
    } catch { shotBuffer = null; stepBuffer = null; }
  }
  // PositionalAudio only rings when the listener's context is running: on a
  // suspended context a started source never ends, so isPlaying would stick
  // and block every later sound. The integrator resumes the context on the
  // first user gesture.
  function audioLive() {
    return !!(listener && listener.context && listener.context.state === 'running');
  }

  // Enemy spawns: north side by contract; fall back to a line at z = -10.
  const spawnList = (world.enemySpawns && world.enemySpawns.length >= BOT_COUNT)
    ? world.enemySpawns.map((p) => toVec3(p))
    : [new THREE.Vector3(-9, 0, -10), new THREE.Vector3(-4.5, 0, -10),
       new THREE.Vector3(0, 0, -10), new THREE.Vector3(4.5, 0, -10),
       new THREE.Vector3(9, 0, -10)];

  const siteA = sitePos(world, 'A');
  const siteB = sitePos(world, 'B');

  function pickRoute(site, botIndex) {
    const routes = world.routes || {};
    let list = null;
    if (site === 'A' && routes.A && routes.A.length) list = routes.A;
    else if (site === 'B' && routes.B && routes.B.length) list = routes.B;
    else if (routes.mid && routes.mid.length) list = routes.mid;
    if (list) {
      const pts = list.map((p) => toVec3(p));
      // Stagger start points so bots do not stack on waypoint 0.
      const start = botIndex % pts.length;
      return pts.slice(start).concat(pts.slice(0, start));
    }
    // Fallback: spawn -> mid -> site.
    const target = site === 'B' ? siteB : siteA;
    return [spawnList[botIndex].clone(),
      new THREE.Vector3((spawnList[botIndex].x + target.x) / 2, 0, -4),
      target.clone()];
  }

  const bots = [];
  const hitMeshes = [];
  let objective = null; // 'A' | 'B' | null — setObjective() drives this
  let defuseProgress = 0; // 0..1, shared channel progress of the current defuser
  let defusingBot = null;
  let time = 0;

  for (let i = 0; i < BOT_COUNT; i += 1) {
    const model = buildBotModel(assets, i);
    const spawn = spawnList[i];
    model.group.position.copy(spawn);
    scene.add(model.group);

    const bot = {
      group: model.group,
      head: model.head,
      torso: model.torso,
      gun: model.gun,
      gunTip: model.gunTip,
      armL: model.armL,
      armR: model.armR,
      legL: model.legL,
      legR: model.legR,
      flashMats: model.flashMats,
      flash: 0, // seconds left on the emissive hit flash (0 = off)
      shotAudio: null, // PositionalAudio: gunfire (null without a listener)
      stepAudio: null, // PositionalAudio: footsteps (null without a listener)
      lastStepPhase: Math.floor(model.phase / Math.PI),
      health: BOT_HEALTH,
      alive: true,
      state: 'patrol',
      pos: model.group.position, // same reference as group.position
      yaw: Math.PI, // face south, toward the player side
      speed: WALK_SPEED,
      route: pickRoute(null, i),
      routeIndex: 0,
      holdPos: null,
      lastSeen: new THREE.Vector3(),
      shootCooldown: 0,
      reactionAt: 0,
      // internals
      spawn: spawn.clone(),
      walkPhase: model.phase,
      losTime: 0,
      loseTimer: 0,
      strafeDir: i % 2 === 0 ? 1 : -1,
      strafeTimer: rand(1, 2),
      scanPhase: rand(0, Math.PI * 2),
      investigateAt: null,
      investigateTimer: 0,
      fall: 0,
      hasSeen: false,
    };
    model.group.rotation.y = bot.yaw;

    // Directional audio: one PositionalAudio per sound, parented to the bot
    // group so gunfire and footsteps come from where the bot stands.
    if (shotBuffer) {
      try {
        bot.shotAudio = new THREE.PositionalAudio(listener);
        bot.shotAudio.setBuffer(shotBuffer);
        bot.shotAudio.setRefDistance(6);
        bot.shotAudio.setVolume(0.9);
        model.group.add(bot.shotAudio);
        bot.stepAudio = new THREE.PositionalAudio(listener);
        bot.stepAudio.setBuffer(stepBuffer);
        bot.stepAudio.setRefDistance(6);
        bot.stepAudio.setVolume(0.5);
        model.group.add(bot.stepAudio);
      } catch { bot.shotAudio = null; bot.stepAudio = null; }
    }

    // Hit registration: head / torso / limb. The integrator raycasts hitMeshes
    // and passes the struck mesh to damage(); damage() no-ops on dead bots.
    for (const [mesh, part] of [
      [model.head, 'head'], [model.torso, 'torso'],
      [model.armL, 'limb'], [model.armR, 'limb'],
      [model.legL, 'limb'], [model.legR, 'limb'],
    ]) {
      mesh.userData.bot = bot;
      mesh.userData.part = part;
      hitMeshes.push(mesh);
    }
    bots.push(bot);
  }

  // ------------------------------------------------------------ movement --
  function blocked(x, z) {
    _probe.min.set(x - BOT_RADIUS, 0.04, z - BOT_RADIUS);
    _probe.max.set(x + BOT_RADIUS, BOT_HEIGHT - 0.04, z + BOT_RADIUS);
    for (const c of colliders) if (_probe.intersectsBox(c)) return true;
    return false;
  }

  // Axis-separated step, same pattern as player.js: try x, then z.
  function moveBot(bot, dx, dz, dt) {
    const nx = bot.pos.x + dx * dt;
    if (nx >= bounds.minX && nx <= bounds.maxX && !blocked(nx, bot.pos.z)) bot.pos.x = nx;
    const nz = bot.pos.z + dz * dt;
    if (nz >= bounds.minZ && nz <= bounds.maxZ && !blocked(bot.pos.x, nz)) bot.pos.z = nz;
  }

  function moveToward(bot, target, speed, dt) {
    _move.set(target.x - bot.pos.x, 0, target.z - bot.pos.z);
    const dist = _move.length();
    if (dist < 0.001) return 0;
    _move.divideScalar(dist);
    moveBot(bot, _move.x * speed, _move.z * speed, dt);
    return dist;
  }

  function faceToward(bot, tx, tz, dt, rate) {
    const want = Math.atan2(tx - bot.pos.x, tz - bot.pos.z);
    bot.yaw += Math.max(-rate * dt, Math.min(rate * dt, angleLerpDelta(bot.yaw, want)));
    bot.group.rotation.y = bot.yaw;
  }

  function facePlayer(bot, dt) {
    faceToward(bot, _chest.x, _chest.z, dt, 7);
  }

  // --------------------------------------------------------------- LOS ----
  function hasLOS(bot, playerPos, dist) {
    if (dist > SIGHT_RANGE) return false;
    _head.set(bot.pos.x, bot.pos.y + 1.55, bot.pos.z);
    _chest.copy(playerPos);
    _chest.y = playerPos.y + 1.2; // aim at the chest, not the feet
    _toPlayer.copy(_chest).sub(_head);
    const d = _toPlayer.length();
    if (d < 0.001) return true;
    _dir.copy(_toPlayer).divideScalar(d);
    // Vision cone: must be roughly in front (~150 deg).
    _forward.set(Math.sin(bot.yaw), 0, Math.cos(bot.yaw));
    if (_forward.dot(_dir) < VISION_DOT) return false;
    _ray.set(_head, _dir);
    _ray.far = d;
    const hit = _ray.intersectObjects(shootables, false)[0];
    return !hit || hit.distance >= d - 0.15;
  }

  // ------------------------------------------------------------ shooting --
  function fireShot(bot, ctx, dist) {
    // Hit chance: 0.32 under 10 m falling to 0.10 at 40 m, worse vs a fast or
    // crouched player, better the longer the bot has held LOS (max +0.15).
    let chance = 0.32 - Math.max(0, dist - 10) * (0.22 / 30);
    if (ctx.playerSpeed > 3) chance -= 0.12;
    if (ctx.playerCrouching) chance -= 0.08;
    chance += Math.min(0.15, bot.losTime * 0.05);
    chance = Math.max(0.03, Math.min(0.55, chance));

    const hit = Math.random() < chance;
    const damage = hit ? Math.round(rand(8, 22)) : 0;
    // Misses still land near the player (tracer + impact feedback).
    const err = (1 - chance) * 1.1;
    bot.gunTip.getWorldPosition(_tip);
    _events.push({
      from: _tip.clone(),
      to: new THREE.Vector3(
        _chest.x + (Math.random() * 2 - 1) * err,
        _chest.y + (Math.random() * 2 - 1) * err * 0.6,
        _chest.z + (Math.random() * 2 - 1) * err,
      ),
      hit,
      damage,
    });
    // Directional gunfire from the bot's own position (guarded: no listener
    // means no audio object, and a shot already ringing is not restarted).
    if (bot.shotAudio && audioLive() && !bot.shotAudio.isPlaying) bot.shotAudio.play();
  }

  // ---------------------------------------------------------- animation ---
  function animateWalk(bot, dt, moving) {
    if (moving) bot.walkPhase += dt * bot.speed * 2.4;
    // A footstep tick each half-stride, from the bot's own position.
    if (moving && bot.stepAudio && audioLive()) {
      const phase = Math.floor(bot.walkPhase / Math.PI);
      if (phase !== bot.lastStepPhase) {
        bot.lastStepPhase = phase;
        if (!bot.stepAudio.isPlaying) bot.stepAudio.play();
      }
    }
    const swing = moving ? Math.sin(bot.walkPhase) * 0.55 : 0;
    const armSwing = moving ? Math.sin(bot.walkPhase) * 0.35 : 0;
    if (bot.state === 'engage' || bot.state === 'defuse') {
      // Aim pose: rifle raised, both arms forward on the gun.
      bot.armR.rotation.x += (-1.45 - bot.armR.rotation.x) * Math.min(1, dt * 10);
      bot.armL.rotation.x += (-1.15 - bot.armL.rotation.x) * Math.min(1, dt * 10);
      bot.armL.rotation.z = 0.35;
      bot.legL.rotation.x = swing * 0.5;
      bot.legR.rotation.x = -swing * 0.5;
    } else {
      bot.armR.rotation.x = -armSwing;
      bot.armL.rotation.x = armSwing;
      bot.armL.rotation.z = 0;
      bot.legL.rotation.x = swing;
      bot.legR.rotation.x = -swing;
    }
  }

  function animateFall(bot, dt) {
    bot.fall = Math.min(1, bot.fall + dt / FALL_SECONDS);
    bot.group.rotation.x = -bot.fall * 1.45;
    bot.group.position.y = -bot.fall * 0.08;
  }

  // -------------------------------------------------------------- update --
  function update(dt, ctx) {
    time = ctx.time !== undefined ? ctx.time : time + dt;
    _events.length = 0;
    const playerPos = ctx.playerPos;
    const bombPlanted = !!ctx.bombPlanted;
    const bombSite = ctx.bombSite || null;
    const bombTarget = bombPlanted ? sitePos(world, bombSite) : null;

    // Nearest living bot to the bomb becomes the defuser while it is planted.
    let nearestDefuser = null;
    let nearestD = Infinity;
    if (bombPlanted && bombTarget) {
      for (const b of bots) {
        if (!b.alive) continue;
        const d = b.pos.distanceToSquared(bombTarget);
        if (d < nearestD) { nearestD = d; nearestDefuser = b; }
      }
    }
    if (defusingBot && (!defusingBot.alive || defusingBot !== nearestDefuser || !bombPlanted)) {
      defusingBot = null;
      defuseProgress = 0;
    }

    for (const bot of bots) {
      // Emissive hit flash: 90 ms of amber on the struck bot, then off.
      if (bot.flash > 0) {
        bot.flash -= dt;
        if (bot.flash <= 0) {
          bot.flash = 0;
          for (const mat of bot.flashMats) mat.emissiveIntensity = 0;
        }
      }
      if (!bot.alive) { animateFall(bot, dt); continue; }

      const dist = playerPos ? bot.pos.distanceTo(playerPos) : Infinity;
      const sees = !!(ctx.playerAlive && playerPos && hasLOS(bot, playerPos, dist));

      if (sees) {
        bot.lastSeen.copy(playerPos);
        bot.losTime += dt;
        bot.loseTimer = 0;
        if (!bot.hasSeen) {
          bot.hasSeen = true;
          bot.reactionAt = time + rand(REACTION_MIN, REACTION_MAX);
          bot.shootCooldown = bot.reactionAt;
        }
        if (bot.state !== 'engage') bot.state = 'engage';
      } else {
        bot.losTime = 0;
        if (bot.state === 'engage') {
          bot.loseTimer += dt;
          if (bot.loseTimer > LOSE_SIGHT_SECONDS) {
            bot.hasSeen = false;
            bot.state = 'investigate';
            bot.investigateAt = bot.lastSeen.clone();
            bot.investigateTimer = 0;
          }
        }
      }

      // Gunshot noise pulls patrolling/holding bots in to investigate.
      if (!sees && ctx.noisePos && (bot.state === 'patrol' || bot.state === 'hold')) {
        if (bot.pos.distanceTo(ctx.noisePos) < 40) {
          bot.state = 'investigate';
          bot.investigateAt = ctx.noisePos.clone();
          bot.investigateTimer = 0;
        }
      }

      // Bomb planted: the designated defuser runs to the site and channels;
      // the rest converge to hold the site (and still engage on sight).
      if (bombPlanted && bombTarget) {
        if (bot === nearestDefuser && bot.state !== 'engage') {
          bot.state = 'defuse';
        } else if (bot.state === 'patrol' || bot.state === 'hold') {
          bot.state = 'hold';
          if (!bot.holdPos) {
            bot.holdPos = bombTarget.clone();
            bot.holdPos.x += rand(-3, 3);
            bot.holdPos.z += rand(-3, 3);
          }
        }
      }

      let moving = false;
      switch (bot.state) {
        case 'engage': {
          facePlayer(bot, dt);
          if (sees) {
            // Strafe sideways so the player cannot pre-aim a static target.
            bot.strafeTimer -= dt;
            if (bot.strafeTimer <= 0) {
              bot.strafeDir *= -1;
              bot.strafeTimer = rand(0.8, 1.8);
            }
            const sideX = Math.cos(bot.yaw) * bot.strafeDir;
            const sideZ = -Math.sin(bot.yaw) * bot.strafeDir;
            // Close distance slowly if far, hold ground if close.
            const close = dist > 14 ? 1 : 0;
            _move.set(
              Math.sin(bot.yaw) * close + sideX * 0.7,
              0,
              Math.cos(bot.yaw) * close + sideZ * 0.7,
            );
            if (_move.lengthSq() > 0.001) {
              _move.normalize();
              moveBot(bot, _move.x * ENGAGE_SPEED, _move.z * ENGAGE_SPEED, dt);
              moving = true;
            }
            if (time >= bot.shootCooldown && time >= bot.reactionAt) {
              fireShot(bot, ctx, dist);
              bot.shootCooldown = time + rand(SHOT_MIN_GAP, SHOT_MAX_GAP);
            }
          } else {
            // Lost sight a moment ago: push toward where the player was.
            const d = moveToward(bot, bot.lastSeen, ENGAGE_SPEED, dt);
            if (d > 0.6) {
              faceToward(bot, bot.lastSeen.x, bot.lastSeen.z, dt, 6);
              moving = true;
            }
          }
          break;
        }
        case 'defuse': {
          const d = moveToward(bot, bombTarget, DEFUSE_SPEED, dt);
          if (d > 0.5) {
            faceToward(bot, bombTarget.x, bombTarget.z, dt, 6);
            moving = true;
            defuseProgress = 0; // moving breaks the channel
            defusingBot = null;
          } else {
            // On the bomb: stand on it and channel. Facing outward, gun up.
            faceToward(bot, bot.pos.x + Math.sin(bot.yaw), bot.pos.z + Math.cos(bot.yaw), dt, 2);
            if (defusingBot !== bot) { defusingBot = bot; defuseProgress = 0; }
            defuseProgress = Math.min(1, defuseProgress + dt / DEFUSE_SECONDS);
            _events.push({ defusing: true, progress: defuseProgress, bot });
          }
          break;
        }
        case 'investigate': {
          if (bot.investigateAt) {
            const d = moveToward(bot, bot.investigateAt, WALK_SPEED, dt);
            if (d > ARRIVE_RADIUS) {
              faceToward(bot, bot.investigateAt.x, bot.investigateAt.z, dt, 6);
              moving = true;
            } else {
              // Arrived: scan the area, then go back to the route.
              bot.investigateTimer += dt;
              bot.yaw += dt * 0.9;
              bot.group.rotation.y = bot.yaw;
              if (bot.investigateTimer > INVESTIGATE_SCAN_SECONDS) {
                bot.state = 'patrol';
                bot.investigateAt = null;
              }
            }
          } else {
            bot.state = 'patrol';
          }
          break;
        }
        case 'hold': {
          const target = bot.holdPos || bot.pos;
          const d = moveToward(bot, target, WALK_SPEED, dt);
          if (d > ARRIVE_RADIUS) {
            faceToward(bot, target.x, target.z, dt, 6);
            moving = true;
          } else {
            // Scan slowly side to side.
            bot.scanPhase += dt * 0.5;
            bot.group.rotation.y = bot.yaw + Math.sin(bot.scanPhase) * 0.9;
          }
          break;
        }
        case 'patrol':
        default: {
          bot.state = 'patrol';
          const wp = bot.route[bot.routeIndex];
          if (wp) {
            const d = moveToward(bot, wp, WALK_SPEED, dt);
            if (d > ARRIVE_RADIUS) {
              faceToward(bot, wp.x, wp.z, dt, 6);
              moving = true;
            } else {
              bot.routeIndex += 1;
              if (bot.routeIndex >= bot.route.length) {
                // Reached the objective: hold near the site, then loop.
                bot.routeIndex = 0;
                const site = objective ? sitePos(world, objective) : null;
                if (site) {
                  bot.state = 'hold';
                  bot.holdPos = site.clone();
                  bot.holdPos.x += rand(-4, 4);
                  bot.holdPos.z += rand(-4, 4);
                }
              }
            }
          }
          break;
        }
      }

      animateWalk(bot, dt, moving);
    }

    // Simple separation: bots never walk through each other.
    for (let i = 0; i < bots.length; i += 1) {
      const a = bots[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < bots.length; j += 1) {
        const b = bots[j];
        if (!b.alive) continue;
        _sep.set(b.pos.x - a.pos.x, 0, b.pos.z - a.pos.z);
        const d = _sep.length();
        if (d > 0.001 && d < 0.8) {
          _sep.divideScalar(d);
          const push = (0.8 - d) / 2;
          a.pos.x -= _sep.x * push;
          a.pos.z -= _sep.z * push;
          b.pos.x += _sep.x * push;
          b.pos.z += _sep.z * push;
        }
      }
    }

    return _events;
  }

  // -------------------------------------------------------------- damage --
  function damage(mesh, amount) {
    const bot = mesh && mesh.userData ? mesh.userData.bot : null;
    if (!bot || !bot.alive) return { killed: false, bot: null };
    bot.health -= amount;
    // Hit confirmation: this bot's materials flash amber for 90 ms.
    bot.flash = 0.09;
    for (const mat of bot.flashMats) mat.emissiveIntensity = 0.85;
    if (bot.health > 0) return { killed: false, bot };
    bot.health = 0;
    bot.alive = false;
    bot.fall = 0;
    bot.state = 'patrol';
    if (defusingBot === bot) { defusingBot = null; defuseProgress = 0; }
    return { killed: true, bot };
  }

  // --------------------------------------------------------------- reset --
  function reset() {
    defuseProgress = 0;
    defusingBot = null;
    time = 0;
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      bot.health = BOT_HEALTH;
      bot.alive = true;
      bot.state = 'patrol';
      bot.fall = 0;
      bot.flash = 0;
      for (const mat of bot.flashMats) mat.emissiveIntensity = 0;
      bot.lastStepPhase = Math.floor(bot.walkPhase / Math.PI);
      bot.route = pickRoute(objective, i);
      bot.routeIndex = 0;
      bot.holdPos = null;
      bot.lastSeen.set(0, 0, 0);
      bot.shootCooldown = 0;
      bot.reactionAt = 0;
      bot.losTime = 0;
      bot.loseTimer = 0;
      bot.hasSeen = false;
      bot.investigateAt = null;
      bot.investigateTimer = 0;
      bot.pos.copy(bot.spawn);
      bot.yaw = Math.PI;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.y = 0;
      bot.armL.rotation.set(0, 0, 0);
      bot.armR.rotation.set(0, 0, 0);
      bot.legL.rotation.set(0, 0, 0);
      bot.legR.rotation.set(0, 0, 0);
    }
  }

  function aliveCount() {
    let n = 0;
    for (const b of bots) if (b.alive) n += 1;
    return n;
  }

  function setObjective(site) {
    objective = site === 'A' || site === 'B' ? site : null;
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      if (!bot.alive) continue;
      bot.route = pickRoute(objective, i);
      bot.routeIndex = 0;
      if (bot.state === 'patrol' || bot.state === 'hold') bot.state = 'patrol';
      bot.holdPos = null;
    }
  }

  return {
    bots,
    hitMeshes,
    update,
    damage,
    reset,
    aliveCount,
    setObjective,
    // Live defuse channel state: 0..1 while a bot channels, 0 when nobody
    // is defusing; the defusing bot itself, or null.
    get defuseProgress() { return defuseProgress; },
    get defusingBot() { return defusingBot; },
    get objective() { return objective; },
  };
}
