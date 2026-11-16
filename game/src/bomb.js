// BOMB — plant / countdown / explode / defuse objective (Counter-Strike-STYLE).
// The player plants with E inside a site; the bomb ticks 40 s, beeping faster
// as it runs down; the nearest living Viper runs in to defuse it (7 s channel,
// 5 s with a defuse kit). The integrator drives planting (startPlant/addPlant)
// and defusing (addDefuse) and reads state/timer/progress off the returned
// object every step.
//
// Point Blank Bomb Mission numbers (best of 11): round 180 s, fuse 40 s,
// defuse 7 s (5 s with kit), no respawn until the next round.
import * as THREE from 'three';

export const PLANT_SECONDS = 3;   // hold E this long to plant
export const DEFUSE_SECONDS = 7;  // uninterrupted enemy channel to defuse
export const DEFUSE_KIT_SECONDS = 5; // defuse with a kit
export const BOMB_TIMER = 40;     // seconds from plant to explosion
const DEFUSE_DECAY = 0.5;  // defuse progress lost per second when not channelled

// Site marker colours: A amber, B cyan — readable at a glance, distinct from
// the red-orange Vipers.
const SITE_COLORS = { A: 0xffb020, B: 0x20c8ff };

function siteInfo(world, site) {
  const s = site === 'B' ? world.siteB : world.siteA;
  const fallback = new THREE.Vector3(site === 'B' ? 8 : -8, 0, -8);
  if (!s) return { pos: fallback, radius: 5 };
  const pos = s.pos || s;
  return {
    pos: pos.isVector3 ? pos.clone() : new THREE.Vector3(pos.x || 0, 0, pos.z || 0),
    radius: s.radius || 5,
  };
}

export function createBomb(scene, world) {
  const group = new THREE.Group();
  scene.add(group);

  const state = {
    state: 'idle', // 'idle' | 'planted' | 'exploded' | 'defused'
    site: null,    // 'A' | 'B' | null
    timer: BOMB_TIMER,
    plantProgress: 0,
    defuseProgress: 0,
  };
  const pos = new THREE.Vector3(); // bomb position once planted
  let planting = false;
  let plantSite = null;
  let defuseTouched = false; // addDefuse() called since the last update()
  let beep = false;          // true only on the step a beep fires
  let beeps = 0;
  let nextBeepAt = BOMB_TIMER; // timer value the next beep fires at
  let elapsed = 0;

  // ------------------------------------------------------- bomb model -----
  const bomb = new THREE.Group();
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.4, metalness: 0.6 });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.35, metalness: 0.7 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xc22020, roughness: 0.6 });
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xe8c020, roughness: 0.6 });
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 1.5, roughness: 0.3,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.24), darkMat);
  body.position.y = 0.08;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.16), plateMat);
  plate.position.y = 0.175;
  const wireRed = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.02), redMat);
  wireRed.position.set(0, 0.05, 0.1);
  wireRed.rotation.y = 0.3;
  const wireYellow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.02), yellowMat);
  wireYellow.position.set(0, 0.05, -0.1);
  wireYellow.rotation.y = -0.25;
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), plateMat);
  antenna.position.set(0.14, 0.26, -0.08);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), lightMat);
  light.position.set(-0.12, 0.19, 0.08);
  // Red beacon light: the planted charge glows on the ground around it.
  const beacon = new THREE.PointLight(0xff2a1a, 0, 4, 1.8);
  beacon.position.set(0, 0.35, 0);
  bomb.add(body, plate, wireRed, wireYellow, antenna, light, beacon);
  bomb.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  bomb.visible = false;
  group.add(bomb);

  // ----------------------------------------------------- site markers -----
  // Flat rings on the ground at each site + a small centre disc, so the player
  // can read "plant here" without a HUD. They pulse while the round is live.
  const markers = {};
  for (const site of ['A', 'B']) {
    const info = siteInfo(world, site);
    const color = SITE_COLORS[site];
    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    });
    const discMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(info.radius - 0.18, info.radius, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(info.pos.x, 0.03, info.pos.z);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(info.radius - 0.18, 48), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(info.pos.x, 0.025, info.pos.z);
    group.add(ring, disc);
    markers[site] = { ring, disc, ringMat, discMat, pos: info.pos, radius: info.radius };
  }

  // ------------------------------------------------------------ actions ---
  function startPlant(site) {
    if (state.state !== 'idle' || planting) return;
    planting = true;
    plantSite = site === 'B' ? 'B' : 'A';
    state.plantProgress = 0;
  }

  // Advance planting by dt; returns true the step the plant completes.
  // `seconds` is the channel length (3 s normally; 1.5 s with a defuse kit —
  // the kit is the player's bomb tool, so it speeds the player's own plant).
  function addPlant(dt, seconds = PLANT_SECONDS) {
    if (!planting || state.state !== 'idle') return false;
    state.plantProgress = Math.min(1, state.plantProgress + dt / seconds);
    if (state.plantProgress < 1) return false;
    planting = false;
    const info = siteInfo(world, plantSite);
    state.state = 'planted';
    state.site = plantSite;
    state.timer = BOMB_TIMER;
    state.defuseProgress = 0;
    nextBeepAt = BOMB_TIMER;
    beeps = 0;
    pos.copy(info.pos);
    bomb.position.copy(info.pos);
    bomb.visible = true;
    return true;
  }

  function cancelPlant() {
    planting = false;
    plantSite = null;
    state.plantProgress = 0;
  }

  // Instant plant (screenshot / test mode) — no channel required.
  function plantNow(site) {
    planting = false;
    plantSite = site === 'B' ? 'B' : 'A';
    state.plantProgress = 1;
    const info = siteInfo(world, plantSite);
    state.state = 'planted';
    state.site = plantSite;
    state.timer = BOMB_TIMER;
    state.defuseProgress = 0;
    nextBeepAt = BOMB_TIMER;
    beeps = 0;
    pos.copy(info.pos);
    bomb.position.copy(info.pos);
    bomb.visible = true;
  }

  // Advance enemy defuse by dt; returns true the step the defuse completes.
  // The integrator calls this once per step while a bot is channelling; progress
  // decays in update() when nobody channels, so a killed/interrupted defuser
  // loses ground. `seconds` is the channel length (7 s normally; 5 s when
  // the defusing Viper carries a kit).
  function addDefuse(dt, seconds = DEFUSE_SECONDS) {
    if (state.state !== 'planted') return false;
    defuseTouched = true;
    state.defuseProgress = Math.min(1, state.defuseProgress + dt / seconds);
    if (state.defuseProgress < 1) return false;
    state.state = 'defused';
    state.defuseProgress = 1;
    bomb.visible = false;
    return true;
  }

  // ------------------------------------------------------------- update ---
  function update(dt) {
    elapsed += dt;
    beep = false;

    // Site rings pulse gently while the round is live; the planted site pulses
    // faster so the player can find the bomb at a glance.
    for (const site of ['A', 'B']) {
      const mk = markers[site];
      const plantedHere = state.state === 'planted' && state.site === site;
      const speed = plantedHere ? 6 : 1.6;
      const base = plantedHere ? 0.75 : 0.45;
      mk.ringMat.opacity = base + Math.sin(elapsed * speed) * 0.2;
      mk.discMat.opacity = 0.1 + Math.sin(elapsed * speed) * 0.04;
    }

    if (state.state !== 'planted') {
      lightMat.emissiveIntensity = 0;
      beacon.intensity = 0;
      return;
    }

    // Countdown.
    state.timer -= dt;

    // Beeps accelerate as the timer runs down: 1 s apart above 20 s,
    // 0.5 s apart above 10 s, 0.25 s apart under 10 s. `beep` is true only
    // on the step a beep fires — the integrator plays one blip per true.
    const interval = state.timer > 20 ? 1.0 : state.timer > 10 ? 0.5 : 0.25;
    if (state.timer <= nextBeepAt) {
      beep = true;
      beeps += 1;
      nextBeepAt = state.timer - interval;
    }
    // Blink the bomb light and its beacon in time with the beeps.
    lightMat.emissiveIntensity = beep ? 3 : 0.6 + Math.sin(elapsed * 10) * 0.3;
    beacon.intensity = beep ? 5 : 1.2 + Math.sin(elapsed * 10) * 0.5;

    // Defuse progress decays when no bot is channelling this step.
    if (!defuseTouched && state.defuseProgress > 0) {
      state.defuseProgress = Math.max(0, state.defuseProgress - DEFUSE_DECAY * dt);
    }
    defuseTouched = false;

    if (state.timer <= 0) {
      state.timer = 0;
      state.state = 'exploded';
      bomb.visible = false;
    }
  }

  function reset() {
    planting = false;
    plantSite = null;
    beep = false;
    beeps = 0;
    defuseTouched = false;
    nextBeepAt = BOMB_TIMER;
    state.state = 'idle';
    state.site = null;
    state.timer = BOMB_TIMER;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    pos.set(0, 0, 0);
    bomb.visible = false;
  }

  return {
    group,
    update,
    startPlant,
    addPlant,
    cancelPlant,
    plantNow,
    addDefuse,
    reset,
    pos,
    // Live state — read these, don't write them.
    get state() { return state.state; },
    get site() { return state.site; },
    get timer() { return state.timer; },
    get plantProgress() { return state.plantProgress; },
    get defuseProgress() { return state.defuseProgress; },
    get planting() { return planting; },
    // Sound hook: true only on the step a beep fires; `beeps` counts them.
    get beep() { return beep; },
    get beeps() { return beeps; },
  };
}
