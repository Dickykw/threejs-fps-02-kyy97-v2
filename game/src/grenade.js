// Live grenade simulation (thrown, gravity, bounce, fuse, boom). Standalone:
// the arsenal (weapons.js) owns the count and calls throwGrenade(); the
// integrator reads explosions from update()'s return value.
// Damage falloff: 120 at 0 m -> 10 at 6 m, 0 beyond (GRENADE_RADIUS).
// Fuse: 1.6 s after the FIRST bounce, or 2.2 s total from the throw,
// whichever comes first.
//
// Kinds: 'frag' explodes (the event carries damage); 'smoke' pops a vision
// blocking cloud that lives 8 s; 'flare' sticks a bright light that burns
// 10 s. Smoke/flare events carry no damage — the integrator turns them into
// clouds/lights through effects.js. All three share one physics pool.
import * as THREE from 'three';

export const GRENADE_RADIUS = 6;
export const GRENADE_MAX_DAMAGE = 120;
export const GRENADE_MIN_DAMAGE = 10;
export const GRENADE_THROW_SPEED = 13;
export const GRENADE_GRAVITY = -16;
export const GRENADE_BOUNCE_DAMP = 0.45;
export const GRENADE_FUSE_AFTER_BOUNCE = 1.6;
export const GRENADE_FUSE_TOTAL = 2.2;
export const SMOKE_SECONDS = 8;
export const FLARE_SECONDS = 10;
const MAX_LIVE = 4;
const BODY_RADIUS = 0.06;
const STOP_SPEED = 1.2;
const FLOOR_Y = 0;

export function grenadeDamageAt(distance) {
  if (distance >= GRENADE_RADIUS) return 0;
  const t = distance / GRENADE_RADIUS;
  return Math.round(GRENADE_MAX_DAMAGE + (GRENADE_MIN_DAMAGE - GRENADE_MAX_DAMAGE) * t);
}

export function createGrenadeSim(scene) {
  // Pre-allocated pool: 4 grenade bodies, reused round-robin. No per-frame
  // allocation except the small explosion-event objects returned by update().
  const pool = [];
  const bodyGeo = new THREE.SphereGeometry(BODY_RADIUS, 12, 10);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3d5a2e, roughness: 0.55, metalness: 0.45 });
  const pinMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.85 });
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.7, metalness: 0.2 });
  const flareMat = new THREE.MeshStandardMaterial({ color: 0xd86a10, roughness: 0.5, metalness: 0.3, emissive: 0xcc5500, emissiveIntensity: 0.6 });
  const kindMats = { frag: bodyMat, smoke: smokeMat, flare: flareMat };
  for (let i = 0; i < MAX_LIVE; i += 1) {
    const mesh = new THREE.Mesh(bodyGeo, bodyMat);
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.05), pinMat);
    pin.position.set(0, BODY_RADIUS + 0.01, 0);
    mesh.add(pin);
    mesh.visible = false;
    scene.add(mesh);
    pool.push({
      mesh, active: false, id: -1, kind: 'frag',
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      age: 0, fuseAt: Infinity, bounced: false,
    });
  }
  let nextId = 1;
  let nextSlot = 0;
  const tmpClosest = new THREE.Vector3();

  function throwGrenade(origin, dir, kind = 'frag') {
    const g = pool[nextSlot];
    nextSlot = (nextSlot + 1) % MAX_LIVE;
    g.kind = kind === 'smoke' || kind === 'flare' ? kind : 'frag';
    g.mesh.material = kindMats[g.kind];
    g.pos.copy(origin);
    g.vel.copy(dir).normalize().multiplyScalar(GRENADE_THROW_SPEED);
    g.vel.y += 2.0; // slight lob so a level throw still arcs
    g.age = 0;
    g.fuseAt = GRENADE_FUSE_TOTAL;
    g.bounced = false;
    g.active = true;
    g.id = nextId;
    nextId += 1;
    g.mesh.visible = true;
    g.mesh.position.copy(g.pos);
    return g.id;
  }

  // Sphere-vs-Box3 bounce: push out along the closest-point normal, reflect
  // the velocity component along it, dampen. Returns true on a bounce.
  function collideBox(g, box) {
    tmpClosest.copy(g.pos).clamp(box.min, box.max);
    const dx = g.pos.x - tmpClosest.x;
    const dy = g.pos.y - tmpClosest.y;
    const dz = g.pos.z - tmpClosest.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= BODY_RADIUS * BODY_RADIUS) return false;
    let nx = dx; let ny = dy; let nz = dz;
    if (d2 < 1e-9) {
      const px = Math.min(g.pos.x - box.min.x, box.max.x - g.pos.x);
      const py = Math.min(g.pos.y - box.min.y, box.max.y - g.pos.y);
      const pz = Math.min(g.pos.z - box.min.z, box.max.z - g.pos.z);
      if (px <= py && px <= pz) { nx = g.pos.x - box.min.x < box.max.x - g.pos.x ? -1 : 1; ny = 0; nz = 0; }
      else if (py <= pz) { nx = 0; ny = g.pos.y - box.min.y < box.max.y - g.pos.y ? -1 : 1; nz = 0; }
      else { nx = 0; ny = 0; nz = g.pos.z - box.min.z < box.max.z - g.pos.z ? -1 : 1; }
      g.pos.addScaledVector(new THREE.Vector3(nx, ny, nz), BODY_RADIUS);
    } else {
      const d = Math.sqrt(d2);
      nx /= d; ny /= d; nz /= d;
      g.pos.set(tmpClosest.x + nx * BODY_RADIUS, tmpClosest.y + ny * BODY_RADIUS, tmpClosest.z + nz * BODY_RADIUS);
    }
    const vn = g.vel.x * nx + g.vel.y * ny + g.vel.z * nz;
    if (vn < 0) {
      g.vel.x -= 2 * vn * nx;
      g.vel.y -= 2 * vn * ny;
      g.vel.z -= 2 * vn * nz;
      g.vel.multiplyScalar(GRENADE_BOUNCE_DAMP);
    }
    return true;
  }

  function update(dt, colliders = []) {
    const explosions = [];
    for (const g of pool) {
      if (!g.active) continue;
      g.age += dt;
      g.vel.y += GRENADE_GRAVITY * dt;
      g.pos.addScaledVector(g.vel, dt);

      if (g.pos.y < BODY_RADIUS) {
        g.pos.y = BODY_RADIUS;
        if (g.vel.y < 0) {
          g.vel.y = -g.vel.y * GRENADE_BOUNCE_DAMP;
          g.vel.x *= GRENADE_BOUNCE_DAMP;
          g.vel.z *= GRENADE_BOUNCE_DAMP;
          if (!g.bounced) { g.bounced = true; g.fuseAt = Math.min(g.fuseAt, g.age + GRENADE_FUSE_AFTER_BOUNCE); }
        }
      }
      for (const box of colliders) {
        if (collideBox(g, box) && !g.bounced) {
          g.bounced = true;
          g.fuseAt = Math.min(g.fuseAt, g.age + GRENADE_FUSE_AFTER_BOUNCE);
        }
      }
      if (g.vel.lengthSq() < STOP_SPEED * STOP_SPEED) g.vel.set(0, 0, 0);

      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += dt * 6;
      g.mesh.rotation.z += dt * 4;

      if (g.age >= g.fuseAt) {
        g.active = false;
        g.mesh.visible = false;
        if (g.kind === 'smoke') {
          explosions.push({ kind: 'smoke', pos: g.pos.clone(), radius: 3.2, seconds: SMOKE_SECONDS });
        } else if (g.kind === 'flare') {
          explosions.push({ kind: 'flare', pos: g.pos.clone(), radius: 2, seconds: FLARE_SECONDS });
        } else {
          explosions.push({
            kind: 'frag',
            pos: g.pos.clone(),
            radius: GRENADE_RADIUS,
            maxDamage: GRENADE_MAX_DAMAGE,
            minDamage: GRENADE_MIN_DAMAGE,
            damageAt: grenadeDamageAt,
          });
        }
      }
    }
    return explosions;
  }

  return {
    throwGrenade,
    update,
    damageAt: grenadeDamageAt,
    get live() { return pool.filter((g) => g.active); },
    get count() { return pool.reduce((n, g) => n + (g.active ? 1 : 0), 0); },
  };
}
