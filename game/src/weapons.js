// Three-weapon arsenal + viewmodels + procedural gun sounds.
// Counter-Strike-STYLE, never a copy: own weapon names, own tuning.
// Imports only 'three' (+ the local grenade sim). No world.js / bots.js / main.js.
import * as THREE from 'three';
import { createGrenadeSim, GRENADE_MAX_DAMAGE, GRENADE_RADIUS } from './grenade.js';

// ---------------------------------------------------------------- tuning ---
export const GRENADE_PRICE = 400;
const MUZZLE_TIME = 0.06; // flash visible per shot (s)
const MOVE_REFERENCE = 5.2; // m/s at which the moving-spread penalty maxes out
const BASE_POS = { x: 0.24, y: -0.2, z: -0.42 }; // rifle/smg hip position (starter's)

export const DEFS = {
  pistol: {
    name: 'Kestrel P9',
    price: 0,
    damage: 34,
    headMult: 3.0,
    fireGap: 0.16,
    auto: false,
    mag: 12,
    reserve: 36,
    spreadStill: 0.0016,
    spreadMove: 0.014,
    reloadTime: 1.4,
    kick: 0.035,
    // Deterministic spray: straight up, no sideways wave.
    spray: { wave: 'none', yawAmp: 0, yawFreq: 0, pitchBase: 0.018, pitchGrow: 0.0008 },
  },
  rifle: {
    name: 'Longbow AR-7',
    price: 2700,
    damage: 30,
    headMult: 3.4,
    fireGap: 0.096,
    auto: true,
    mag: 30,
    reserve: 90,
    spreadStill: 0.0022,
    spreadMove: 0.028,
    reloadTime: 1.9,
    kick: 0.055,
    // Deterministic spray: sin-based sideways sway, pitch grows with shot index.
    spray: { wave: 'sin', yawAmp: 0.011, yawFreq: 0.9, pitchBase: 0.014, pitchGrow: 0.0016 },
  },
  smg: {
    name: 'Hornet VK-9',
    price: 1500,
    damage: 22,
    headMult: 3.0,
    fireGap: 0.07,
    auto: true,
    mag: 32,
    reserve: 96,
    spreadStill: 0.0026,
    spreadMove: 0.038,
    reloadTime: 1.7,
    kick: 0.042,
    // Deterministic spray: cos-based sideways sway, pitch grows with shot index.
    spray: { wave: 'cos', yawAmp: 0.009, yawFreq: 1.1, pitchBase: 0.011, pitchGrow: 0.0012 },
  },
};

// ------------------------------------------------------------ tiny synth ---
// Procedural WebAudio only — no audio files. Lazily created on first trigger
// (browsers require a user gesture); every call is try/catch-guarded so a
// missing/blocked AudioContext can never break shooting.
function createSfx() {
  let ctx = null;
  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    } catch {
      ctx = null;
    }
    return ctx;
  }
  function noiseBurst(dur, filterFreq, gainPeak) {
    const c = ensure();
    if (!c) return;
    try {
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      src.buffer = buf;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      const gain = c.createGain();
      gain.gain.setValueAtTime(gainPeak, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      src.connect(filter).connect(gain).connect(c.destination);
      src.start();
    } catch { /* audio is cosmetic */ }
  }
  function blip(freq, dur, gainPeak, type = 'square') {
    const c = ensure();
    if (!c) return;
    try {
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.4), c.currentTime + dur);
      const gain = c.createGain();
      gain.gain.setValueAtTime(gainPeak, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      osc.connect(gain).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + dur + 0.01);
    } catch { /* audio is cosmetic */ }
  }
  return {
    shot(kind) {
      if (kind === 'rifle') { noiseBurst(0.09, 3200, 0.5); blip(160, 0.08, 0.25); }
      else if (kind === 'smg') { noiseBurst(0.06, 4200, 0.38); blip(220, 0.05, 0.18); }
      else { noiseBurst(0.08, 2600, 0.45); blip(130, 0.07, 0.22); }
    },
    dry() { blip(900, 0.03, 0.12); },
    // Hit confirmation tick: body hit is a mid tick, a 3x headshot is higher.
    hit(head) { blip(head ? 2100 : 1400, 0.05, 0.18, 'sine'); },
    reload() { blip(500, 0.05, 0.1, 'triangle'); setTimeout(() => blip(700, 0.05, 0.1, 'triangle'), 180); },
  };
}

// ------------------------------------------------------------- viewmodels ---
// Every gun is built from boxes/cylinders with a distinct silhouette:
// receiver + barrel + magazine + stock + grip + sights. Dark gunmetal,
// polymer grip, one amber accent, and on the rifle a warm wooden handguard
// that catches the sunset. Scale is roughly real (1 unit = 1 m).
function buildMaterials() {
  return {
    metal: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.42, metalness: 0.65 }),
    metalLight: new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.35, metalness: 0.7 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.85, metalness: 0.05 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x2c323a, roughness: 0.9, metalness: 0.05 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a5a2e, roughness: 0.7, metalness: 0.05 }),
    woodDark: new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.75, metalness: 0.05 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.5, metalness: 0.3 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x1a4a5a, roughness: 0.15, metalness: 0.9, emissive: 0x0a2a33 }),
  };
}
function box(mat, w, h, d, x, y, z, rx = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  if (rz) m.rotation.z = rz;
  return m;
}
function cyl(mat, rTop, rBot, len, x, y, z, rx = Math.PI / 2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 12), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  return m;
}

function buildRifle(M) {
  const g = new THREE.Group();
  g.add(box(M.metal, 0.085, 0.105, 0.46, 0, 0, 0)); // receiver
  g.add(box(M.wood, 0.075, 0.055, 0.34, 0, 0.03, -0.36)); // wooden handguard
  g.add(box(M.woodDark, 0.077, 0.014, 0.34, 0, 0.062, -0.36)); // handguard top strip
  g.add(box(M.metalLight, 0.074, 0.012, 0.34, 0, 0.066, -0.36)); // picatinny rail
  g.add(cyl(M.metal, 0.021, 0.021, 0.22, 0, 0.02, -0.62)); // barrel
  g.add(cyl(M.metalLight, 0.032, 0.032, 0.09, 0, 0.02, -0.74)); // muzzle brake
  g.add(box(M.metal, 0.06, 0.02, 0.03, 0, 0.02, -0.79)); // brake ports
  g.add(box(M.metal, 0.055, 0.17, 0.09, 0, -0.12, 0.02, 0.22)); // magazine, canted
  g.add(box(M.accent, 0.058, 0.02, 0.092, 0, -0.2, 0.045, 0.22)); // mag base plate
  g.add(box(M.wood, 0.07, 0.085, 0.24, 0, -0.015, 0.33)); // wooden stock
  g.add(box(M.grip, 0.075, 0.1, 0.05, 0, -0.02, 0.46)); // butt pad
  g.add(box(M.grip, 0.055, 0.13, 0.07, 0, -0.1, 0.14, 0.3)); // pistol grip
  g.add(box(M.metalLight, 0.02, 0.05, 0.06, 0, 0.078, 0.1)); // rear sight
  g.add(box(M.metalLight, 0.014, 0.045, 0.014, 0, 0.075, -0.5)); // front post sight
  g.add(box(M.metalLight, 0.03, 0.02, 0.05, 0.055, 0.01, -0.05)); // charging handle
  g.add(box(M.polymer, 0.06, 0.04, 0.16, 0, -0.045, -0.32)); // foregrip panel
  g.add(box(M.accent, 0.02, 0.02, 0.1, 0.045, 0.01, -0.2)); // amber side stripe
  return { group: g, muzzle: new THREE.Vector3(0, 0.02, -0.8), base: { ...BASE_POS } };
}

function buildSmg(M) {
  const g = new THREE.Group();
  g.add(box(M.metal, 0.1, 0.11, 0.34, 0, 0, 0)); // fat receiver
  g.add(box(M.metalLight, 0.085, 0.07, 0.2, 0, 0.01, -0.26)); // shroud / handguard
  g.add(cyl(M.metal, 0.024, 0.024, 0.1, 0, 0.015, -0.4)); // short barrel
  g.add(cyl(M.polymer, 0.034, 0.034, 0.16, 0, 0.015, -0.5)); // suppressor
  g.add(box(M.metal, 0.06, 0.2, 0.08, 0, -0.14, -0.02, 0.12)); // long 32-rd mag
  g.add(box(M.accent, 0.063, 0.02, 0.082, 0, -0.235, -0.045, 0.12)); // mag base plate
  g.add(box(M.grip, 0.05, 0.12, 0.06, 0, -0.1, -0.24, 0.15)); // vertical foregrip
  g.add(box(M.grip, 0.055, 0.12, 0.07, 0, -0.1, 0.12, 0.3)); // pistol grip
  g.add(box(M.polymer, 0.07, 0.08, 0.12, 0, -0.01, 0.22)); // folding-stock stub
  g.add(box(M.metalLight, 0.05, 0.04, 0.09, 0, 0.075, -0.02)); // red-dot housing
  g.add(box(M.lens, 0.036, 0.028, 0.012, 0, 0.075, -0.065)); // red-dot lens
  g.add(box(M.metalLight, 0.014, 0.04, 0.014, 0, 0.07, -0.36)); // front sight
  g.add(box(M.accent, 0.02, 0.02, 0.08, 0.052, 0.01, -0.1)); // amber side stripe
  return { group: g, muzzle: new THREE.Vector3(0, 0.015, -0.59), base: { ...BASE_POS } };
}

function buildPistol(M) {
  const g = new THREE.Group();
  g.add(box(M.metalLight, 0.055, 0.05, 0.24, 0, 0.01, -0.06)); // slide
  g.add(box(M.metal, 0.05, 0.045, 0.2, 0, -0.025, -0.04)); // frame
  g.add(cyl(M.metal, 0.014, 0.014, 0.05, 0, 0.01, -0.2)); // barrel tip
  g.add(box(M.wood, 0.052, 0.13, 0.07, 0, -0.085, 0.06, 0.28)); // wooden grip
  g.add(box(M.accent, 0.054, 0.015, 0.072, 0, -0.145, 0.082, 0.28)); // grip base plate
  g.add(box(M.metalLight, 0.04, 0.018, 0.02, 0, 0.042, 0.05)); // rear sight
  g.add(box(M.metalLight, 0.01, 0.016, 0.01, 0, 0.042, -0.16)); // front sight
  g.add(box(M.metal, 0.008, 0.05, 0.09, 0, -0.055, -0.05)); // trigger guard
  g.add(box(M.metalLight, 0.012, 0.02, 0.04, 0, 0.01, -0.185)); // muzzle ring
  // Pistol sits lower and closer to centre than the long guns.
  return { group: g, muzzle: new THREE.Vector3(0, 0.01, -0.23), base: { x: 0.1, y: -0.26, z: -0.38 } };
}

const BUILDERS = { rifle: buildRifle, smg: buildSmg, pistol: buildPistol };

// ---------------------------------------------------------------- arsenal ---
export function createArsenal(camera, scene) {
  const sfx = createSfx();
  const mats = buildMaterials();
  const grenades = createGrenadeSim(scene);

  // One viewmodel group per weapon, all parented to the camera; only the
  // active one is visible. Each carries its own muzzle flash + light. The
  // flash is two crossed quads so it reads as a star from any angle.
  const models = {};
  for (const key of Object.keys(BUILDERS)) {
    const { group, muzzle, base } = BUILDERS[key](mats);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffc861, transparent: true, opacity: 0.95,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), flashMat);
    flash.position.copy(muzzle);
    flash.visible = false;
    const flash2 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), flashMat);
    flash2.position.copy(muzzle);
    flash2.rotation.y = Math.PI / 2;
    flash2.visible = false;
    const flashLight = new THREE.PointLight(0xffb347, 0, 6);
    flashLight.position.copy(muzzle);
    group.add(flash, flash2, flashLight);
    group.position.set(base.x, base.y, base.z);
    group.visible = false;
    camera.add(group);
    models[key] = { group, flash, flash2, flashLight, muzzle, base };
  }

  const owned = new Set(['pistol']);
  const current = {
    def: DEFS.pistol,
    mag: DEFS.pistol.mag,
    reserve: DEFS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
  };
  let currentName = 'pistol';
  let firing = false;
  let edgeShot = false; // a semi edge-shot fired by pullTrigger() this frame: step() must not clear it
  let lastMoveSpeed = 0;
  let bobPhase = 0;
  let aimLift = 0; // 0 hip .. 1 firing-held (slight raise, less bob)
  let grenadeCount = 0;
  let colliders = [];
  // Deterministic spray state: index of the next shot in the current burst.
  // Shot 0 is always perfectly accurate (zero kick, zero spread); the pattern
  // resets the moment the trigger is released (or the weapon changes).
  let shotIndex = 0;
  models.pistol.group.visible = true;

  // The shot the integrator must act on this frame. Set by tryFire() (and by
  // step() for held auto fire); read it right after step()/tryFire().
  // kickPitch/kickYaw are the deterministic camera kick for this shot (radians);
  // index is the shot's position in the burst (0 = first, always zero kick).
  const shot = { fired: false, spread: 0, index: 0, kickPitch: 0, kickYaw: 0 };

  function showModel(name) {
    for (const key of Object.keys(models)) models[key].group.visible = key === name;
  }

  // Deterministic spread (radians): a fixed base + a movement penalty + a
  // per-shot term that grows through the burst. The first shot is exact.
  function spread(moveSpeed) {
    if (shotIndex === 0) return 0;
    return 0.0015 + Math.min(1, moveSpeed / MOVE_REFERENCE) * 0.012 + shotIndex * 0.0006;
  }

  // Deterministic camera kick for shot `i` of the current burst (i = 0 is the
  // first shot: always zero). Rifle sways on a sine, SMG on a cosine, pistol
  // climbs straight up; pitch always grows with the shot index (learnable).
  function sprayKick(i) {
    if (i === 0) return { pitch: 0, yaw: 0 };
    const s = current.def.spray;
    const yaw = s.wave === 'sin' ? Math.sin(i * s.yawFreq) * s.yawAmp
      : s.wave === 'cos' ? Math.cos(i * s.yawFreq) * s.yawAmp : 0;
    return { pitch: s.pitchBase + i * s.pitchGrow, yaw };
  }

  function ready() {
    return current.mag > 0 && current.cooldown === 0 && current.reloadLeft === 0;
  }

  function tryFire() {
    shot.fired = false;
    shot.spread = spread(lastMoveSpeed);
    shot.index = shotIndex;
    shot.kickPitch = 0;
    shot.kickYaw = 0;
    if (!ready()) {
      if (current.mag === 0 && current.cooldown === 0 && current.reloadLeft === 0) sfx.dry();
      return { fired: false, spread: shot.spread };
    }
    current.mag -= 1;
    current.cooldown = current.def.fireGap;
    current.flash = MUZZLE_TIME;
    current.kick = current.def.kick;
    const kick = sprayKick(shotIndex);
    shot.kickPitch = kick.pitch;
    shot.kickYaw = kick.yaw;
    shotIndex += 1;
    sfx.shot(currentName);
    shot.fired = true;
    return { fired: true, spread: shot.spread };
  }

  function switchTo(name) {
    if (!owned.has(name) || !DEFS[name]) return false;
    if (name === currentName) return true;
    currentName = name;
    current.def = DEFS[name];
    current.mag = DEFS[name].mag;
    current.reserve = DEFS[name].reserve;
    current.cooldown = 0;
    current.reloadLeft = 0;
    current.flash = 0;
    current.kick = 0;
    shotIndex = 0;
    firing = false;
    showModel(name);
    return true;
  }

  function buy(name) {
    if (!DEFS[name] || owned.has(name)) return false;
    owned.add(name);
    return true; // affordability is the economy's job; price check lives there
  }

  function reload() {
    const def = current.def;
    if (current.reloadLeft > 0 || current.mag === def.mag || current.reserve === 0) return;
    current.reloadLeft = def.reloadTime;
    shotIndex = 0; // a reload breaks the burst
    sfx.reload();
  }

  function refillAll() {
    // Round start: full mag + reserve on the ACTIVE weapon. Owned weapons
    // refill when switched to (switchTo loads full mag/reserve).
    const def = current.def;
    current.mag = def.mag;
    current.reserve = def.reserve;
    current.cooldown = 0;
    current.reloadLeft = 0;
    current.flash = 0;
    current.kick = 0;
    shotIndex = 0;
  }

  function step(dt, moveSpeed, crouching) {
    lastMoveSpeed = moveSpeed;
    current.cooldown = Math.max(0, current.cooldown - dt);
    current.flash = Math.max(0, current.flash - dt);
    current.kick += (0 - current.kick) * Math.min(1, dt * 14);

    // Held auto fire: the arsenal fires; the integrator reads arsenal.shot.
    // A semi edge-shot from pullTrigger() this frame is preserved (edgeShot).
    if (!edgeShot) shot.fired = false;
    if (firing && current.def.auto) tryFire();
    edgeShot = false;

    // Reload progress; ammo tops up at the end, like the starter.
    if (current.reloadLeft > 0) {
      current.reloadLeft = Math.max(0, current.reloadLeft - dt);
      if (current.reloadLeft === 0) {
        const need = current.def.mag - current.mag;
        const take = Math.min(need, current.reserve);
        current.mag += take;
        current.reserve -= take;
      }
    }

    // --- viewmodel animation: bob + kick + reload dip + aim raise -------
    const model = models[currentName];
    const speedF = Math.min(1, moveSpeed / MOVE_REFERENCE) * (crouching ? 0.5 : 1);
    bobPhase += dt * (2 + moveSpeed * 1.7);
    const bobAmp = 0.011 * speedF * (1 - aimLift * 0.6);
    const targetLift = firing && current.mag > 0 ? 1 : 0;
    aimLift += (targetLift - aimLift) * Math.min(1, dt * 8);

    model.group.position.x = model.base.x + Math.sin(bobPhase * 2) * bobAmp;
    model.group.position.y = model.base.y + Math.abs(Math.cos(bobPhase * 2)) * bobAmp * 1.2
      + aimLift * 0.018;
    model.group.position.z = model.base.z + current.kick + aimLift * -0.03;
    model.group.rotation.x = current.kick * 2.2;
    model.group.rotation.z = Math.sin(bobPhase) * 0.012 * speedF;
    if (current.reloadLeft > 0) {
      const t = 1 - current.reloadLeft / current.def.reloadTime; // 0..1
      const dip = Math.sin(Math.min(1, t * 1.15) * Math.PI); // down then back
      model.group.rotation.x = -0.55 * dip;
      model.group.position.y -= 0.09 * dip;
    }
    model.flash.visible = current.flash > 0;
    model.flash2.visible = current.flash > 0;
    if (current.flash > 0) model.flash.rotation.z = current.flash * 40;
    model.flashLight.intensity = current.flash > 0 ? 16 : 0;

    // Grenades advance on the same clock (colliders via setColliders()).
    advanceGrenades(dt);
  }

  // --- grenades (sim lives in grenade.js; arsenal owns count + throw) ---
  let pendingExplosions = [];
  function advanceGrenades(dt) {
    pendingExplosions = grenades.update(dt, colliders);
    return pendingExplosions;
  }

  return {
    defs: DEFS,
    current,
    owned,
    shot, // { fired, spread, index, kickPitch, kickYaw } for the most recent step()/tryFire() — read after step()
    switchTo,
    buy,
    pullTrigger() {
      firing = true;
      if (!current.def.auto) { tryFire(); edgeShot = true; } // semi: one shot per press (edge)
    },
    releaseTrigger() {
      firing = false;
      shotIndex = 0; // trigger up: the burst ends, the spray resets
    },
    tryFire,
    reload,
    refillAll,
    step,
    spread,
    ready,
    hitSound(head) { sfx.hit(head); },
    get shotIndex() { return shotIndex; },
    get grenades() { return grenadeCount; },
    addGrenade(n) { grenadeCount = Math.max(0, grenadeCount + n); },
    throwGrenade(origin, dir) {
      if (grenadeCount <= 0) return -1;
      const id = grenades.throwGrenade(origin, dir);
      if (id < 0) return -1;
      grenadeCount -= 1;
      return id;
    },
    setColliders(list) { colliders = list || []; },
    // Explicit grenade advance (returns [{ pos, radius, maxDamage, minDamage }]
    // for explosions this step). Use this OR rely on step() — not both per frame.
    updateGrenades(dt, nextColliders) {
      if (nextColliders) colliders = nextColliders;
      return advanceGrenades(dt);
    },
    // Explosions that happened during the last step() call.
    get explosions() { return pendingExplosions; },
    get currentName() { return currentName; },
    get firing() { return firing; },
    // Test/debug helper: muzzle world position of the active viewmodel.
    muzzleWorld(out = new THREE.Vector3()) {
      const m = models[currentName];
      return m.group.localToWorld(out.copy(m.muzzle));
    },
  };
}

export { GRENADE_MAX_DAMAGE, GRENADE_RADIUS };
