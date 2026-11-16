// Pooled, zero-per-frame-allocation visual effects.
// Tracers (24), impact bursts (12), explosions (4), enemy muzzle flashes (8),
// plus the sunset pass: drifting dust motes over the yard and looping steam
// from the vent stacks. Everything is pre-allocated at creation and reused
// round-robin; step(dt) only mutates existing objects. MeshBasicMaterial
// (unlit) for anything that must read as "bright"; additive blending on
// tracers/flashes.
import * as THREE from 'three';
import { makeGlowTexture } from './textures.js';

const MAX_TRACERS = 24;
const TRACER_LIFE = 0.06;
const MAX_IMPACTS = 12;
const IMPACT_PARTICLES = 6;
const IMPACT_LIFE = 0.35;
const MAX_EXPLOSIONS = 4;
const EXPLOSION_LIFE = 0.6;
const MAX_MUZZLES = 8;
const MUZZLE_LIFE = 0.05;
const DUST_COUNT = 140;

export function createEffects(scene) {
  // ------------------------------------------------------------- tracers ---
  const tracers = [];
  const tracerGeo = new THREE.BoxGeometry(0.014, 0.014, 1);
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(tracerGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, mat, life: 0 });
  }
  let tracerNext = 0;
  const tmpMid = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  function tracer(from, to, color = 0xffd27a) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % MAX_TRACERS;
    tmpDir.subVectors(to, from);
    const len = tmpDir.length() || 0.001;
    t.mesh.position.copy(tmpMid.addVectors(from, to).multiplyScalar(0.5));
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);
    t.mat.color.setHex(color);
    t.mat.opacity = 0.9;
    t.mesh.visible = true;
    t.life = TRACER_LIFE;
  }

  // ------------------------------------------------------------- impacts ---
  const impacts = [];
  for (let i = 0; i < MAX_IMPACTS; i += 1) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(IMPACT_PARTICLES * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffc861, size: 0.06, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.visible = false;
    points.frustumCulled = false;
    scene.add(points);
    impacts.push({
      points, mat, positions, life: 0,
      velocities: new Float32Array(IMPACT_PARTICLES * 3),
    });
  }
  let impactNext = 0;

  // Six pooled point sprites per burst. With an impact normal they spray
  // outward along it (plus a little random scatter); without one they use
  // the old up-biased cone (bot muzzle / explosion callers).
  function impact(point, color = 0xffc861, normal = null) {
    const b = impacts[impactNext];
    impactNext = (impactNext + 1) % MAX_IMPACTS;
    for (let i = 0; i < IMPACT_PARTICLES; i += 1) {
      b.positions[i * 3] = point.x;
      b.positions[i * 3 + 1] = point.y;
      b.positions[i * 3 + 2] = point.z;
      const sp = 1.5 + Math.random() * 2.5;
      if (normal) {
        const s = (Math.random() - 0.5) * 1.6;
        const t = (Math.random() - 0.5) * 1.6;
        b.velocities[i * 3] = normal.x * sp + s;
        b.velocities[i * 3 + 1] = normal.y * sp + Math.abs(t) * 0.5;
        b.velocities[i * 3 + 2] = normal.z * sp + t;
      } else {
        const a = Math.random() * Math.PI * 2;
        const up = 0.5 + Math.random() * 1.2;
        b.velocities[i * 3] = Math.cos(a) * sp * 0.7;
        b.velocities[i * 3 + 1] = up * sp * 0.6;
        b.velocities[i * 3 + 2] = Math.sin(a) * sp * 0.7;
      }
    }
    b.points.geometry.attributes.position.needsUpdate = true;
    b.mat.color.setHex(color);
    b.mat.opacity = 1;
    b.points.visible = true;
    b.life = IMPACT_LIFE;
  }

  // ---------------------------------------------------------- explosions ---
  // Expanding orange sphere + point light + 6 smoke planes, per slot.
  const explosions = [];
  const boomGeo = new THREE.SphereGeometry(1, 18, 14);
  const smokeGeo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < MAX_EXPLOSIONS; i += 1) {
    const group = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xff7a1a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const core = new THREE.Mesh(boomGeo, coreMat);
    const light = new THREE.PointLight(0xff8a2a, 0, 14);
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0x555550, transparent: true, opacity: 0, depthWrite: false,
    });
    const smokes = [];
    for (let s = 0; s < 6; s += 1) {
      const p = new THREE.Mesh(smokeGeo, smokeMat);
      p.visible = false;
      group.add(p);
      smokes.push(p);
    }
    group.add(core, light);
    group.visible = false;
    scene.add(group);
    explosions.push({ group, core, coreMat, light, smokeMat, smokes, life: 0 });
  }
  let explosionNext = 0;

  function explosion(point) {
    const e = explosions[explosionNext];
    explosionNext = (explosionNext + 1) % MAX_EXPLOSIONS;
    e.group.position.copy(point);
    e.group.visible = true;
    for (const p of e.smokes) {
      p.visible = true;
      p.position.set((Math.random() - 0.5) * 1.2, Math.random() * 0.8, (Math.random() - 0.5) * 1.2);
      p.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    }
    e.life = EXPLOSION_LIFE;
  }

  // ------------------------------------------------- smoke + flare -------
  // Smoke: a grey billow that blocks sight for 8 s. Three pooled spheres per
  // cloud, semi-opaque so a bot (or the player) inside it cannot be seen
  // through — the integrator also blocks bot LOS through live clouds.
  // Flare: a hot orange orb + point light that burns 10 s, lighting a dark
  // corner (and the bots in it). Both are pooled and fade out at the end.
  const SMOKE_LIFE = 8;
  const FLARE_LIFE = 10;
  const smokes = [];
  const cloudGeo = new THREE.SphereGeometry(1, 14, 10);
  for (let i = 0; i < 3; i += 1) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x9aa0a3, transparent: true, opacity: 0, depthWrite: false,
    });
    const balls = [];
    for (let s = 0; s < 3; s += 1) {
      const b = new THREE.Mesh(cloudGeo, mat);
      b.position.set((s - 1) * 1.1, 0.4 + s * 0.35, (s % 2 ? 0.7 : -0.6));
      b.scale.setScalar(1.6);
      group.add(b);
      balls.push(b);
    }
    group.visible = false;
    scene.add(group);
    smokes.push({ group, mat, life: 0, max: SMOKE_LIFE });
  }
  let smokeNext = 0;

  function smokeCloud(point) {
    const s = smokes[smokeNext];
    smokeNext = (smokeNext + 1) % smokes.length;
    s.group.position.copy(point);
    s.group.position.y = Math.max(0.2, point.y);
    s.group.visible = true;
    s.mat.opacity = 0.55; // visible from the first frame (step() animates the fade)
    s.life = SMOKE_LIFE;
  }

  const flares = [];
  const flareGeo = new THREE.SphereGeometry(0.16, 12, 10);
  for (let i = 0; i < 2; i += 1) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0 });
    const orb = new THREE.Mesh(flareGeo, mat);
    const light = new THREE.PointLight(0xffb347, 0, 16, 1.6);
    light.position.y = 0.3;
    group.add(orb, light);
    group.visible = false;
    scene.add(group);
    flares.push({ group, mat, light, life: 0, max: FLARE_LIFE });
  }
  let flareNext = 0;

  function flare(point) {
    const f = flares[flareNext];
    flareNext = (flareNext + 1) % flares.length;
    f.group.position.copy(point);
    f.group.position.y = Math.max(0.25, point.y + 0.15);
    f.group.visible = true;
    f.mat.opacity = 0.95; // lit from the first frame (step() animates the flicker)
    f.light.intensity = 26;
    f.life = FLARE_LIFE;
  }

  // ------------------------------------------------------- enemy muzzles ---
  // Brief flash quad + light at a world position (for bot shots). Pooled
  // lights stay in the scene with intensity 0 when idle.
  const muzzles = [];
  const muzzleGeo = new THREE.PlaneGeometry(0.3, 0.3);
  for (let i = 0; i < MAX_MUZZLES; i += 1) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffc861, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const quad = new THREE.Mesh(muzzleGeo, mat);
    const light = new THREE.PointLight(0xffb347, 0, 5);
    quad.add(light);
    quad.visible = false;
    scene.add(quad);
    muzzles.push({ quad, mat, light, life: 0 });
  }
  let muzzleNext = 0;

  function muzzle(position) {
    const m = muzzles[muzzleNext];
    muzzleNext = (muzzleNext + 1) % MAX_MUZZLES;
    m.quad.position.copy(position);
    m.quad.rotation.set(0, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
    m.mat.opacity = 0.95;
    m.light.intensity = 14;
    m.quad.visible = true;
    m.life = MUZZLE_LIFE;
  }

  // ---------------------------------------------------------- dust motes ---
  // Faint golden dust drifting over the yard in the low sun. One Points
  // cloud; each mote sinks slowly and wraps back to the top.
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST_COUNT * 3);
  const dustVel = new Float32Array(DUST_COUNT);
  for (let i = 0; i < DUST_COUNT; i += 1) {
    dustPos[i * 3] = (Math.random() - 0.5) * 52;
    dustPos[i * 3 + 1] = 0.3 + Math.random() * 5.5;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 36;
    dustVel[i] = 0.05 + Math.random() * 0.12;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xffd9a0, size: 0.05, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  // ------------------------------------------------------------ steam ------
  // Looping steam puffs above the vent stacks. addSteam(vents) builds one
  // sprite per vent per phase (4 phases); step() rises and fades them.
  const steamTex = makeGlowTexture();
  const steams = [];
  function addSteam(vents) {
    for (const vent of vents || []) {
      for (let p = 0; p < 4; p += 1) {
        const mat = new THREE.SpriteMaterial({
          map: steamTex, color: 0xcfd4d8, transparent: true, opacity: 0,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.position.copy(vent);
        scene.add(sprite);
        steams.push({ sprite, mat, base: vent.clone(), phase: p / 4 });
      }
    }
  }

  // ---------------------------------------------------------------- step ---
  function step(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; t.mat.opacity = 0; }
      else t.mat.opacity = 0.9 * (t.life / TRACER_LIFE);
    }
    for (const b of impacts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.points.visible = false; b.mat.opacity = 0; continue; }
      for (let i = 0; i < IMPACT_PARTICLES; i += 1) {
        b.velocities[i * 3 + 1] -= 9.8 * dt; // sparks fall
        b.positions[i * 3] += b.velocities[i * 3] * dt;
        b.positions[i * 3 + 1] += b.velocities[i * 3 + 1] * dt;
        b.positions[i * 3 + 2] += b.velocities[i * 3 + 2] * dt;
        if (b.positions[i * 3 + 1] < 0.01) b.positions[i * 3 + 1] = 0.01;
      }
      b.points.geometry.attributes.position.needsUpdate = true;
      b.mat.opacity = b.life / IMPACT_LIFE;
    }
    for (const e of explosions) {
      if (e.life <= 0) continue;
      e.life -= dt;
      const t = 1 - Math.max(0, e.life) / EXPLOSION_LIFE; // 0..1
      if (e.life <= 0) { e.group.visible = false; e.light.intensity = 0; continue; }
      const r = 0.4 + t * 3.2;
      e.core.scale.setScalar(r);
      e.coreMat.opacity = 0.9 * (1 - t);
      e.light.intensity = 60 * (1 - t);
      const s = 0.6 + t * 2.4;
      for (const p of e.smokes) {
        p.scale.setScalar(s);
        p.position.y += dt * 0.9;
      }
      e.smokeMat.opacity = 0.45 * Math.min(1, t * 3) * (1 - t);
    }
    for (const m of muzzles) {
      if (m.life <= 0) continue;
      m.life -= dt;
      if (m.life <= 0) { m.quad.visible = false; m.light.intensity = 0; m.mat.opacity = 0; }
      else { m.mat.opacity = 0.95 * (m.life / MUZZLE_LIFE); m.light.intensity = 14 * (m.life / MUZZLE_LIFE); }
    }
    // Smoke: full opacity while young, fading in the last 2 s.
    for (const s of smokes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.group.visible = false; s.mat.opacity = 0; continue; }
      s.mat.opacity = s.life < 2 ? 0.55 * (s.life / 2) : 0.55;
    }
    // Flare: steady burn with a small flicker, fading in the last 2 s.
    for (const f of flares) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.group.visible = false; f.light.intensity = 0; f.mat.opacity = 0; continue; }
      const fade = f.life < 2 ? f.life / 2 : 1;
      f.mat.opacity = 0.95 * fade;
      f.light.intensity = (26 + Math.sin(f.life * 23) * 4) * fade;
    }
    // Dust: slow sink + sideways drift, wrap at the floor.
    for (let i = 0; i < DUST_COUNT; i += 1) {
      dustPos[i * 3 + 1] -= dustVel[i] * dt;
      dustPos[i * 3] += dt * 0.08;
      if (dustPos[i * 3 + 1] < 0.2) dustPos[i * 3 + 1] = 5.8;
      if (dustPos[i * 3] > 26) dustPos[i * 3] = -26;
    }
    dustGeo.attributes.position.needsUpdate = true;
    // Steam: rise 2.4 m over 3 s, grow and fade out, then loop.
    for (const s of steams) {
      s.phase += dt / 3;
      if (s.phase > 1) s.phase -= 1;
      const p = s.phase;
      s.sprite.position.set(
        s.base.x + Math.sin(p * 9) * 0.15,
        s.base.y + p * 2.4,
        s.base.z + Math.cos(p * 7) * 0.12,
      );
      const sc = 0.5 + p * 1.6;
      s.sprite.scale.set(sc, sc, 1);
      s.mat.opacity = 0.28 * Math.sin(p * Math.PI);
    }
  }

  return { tracer, impact, explosion, muzzle, smokeCloud, flare, addSteam, step };
}
