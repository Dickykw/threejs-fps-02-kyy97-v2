// The map: "Dusty Yard" — a 56 x 40 m open-air industrial arena at sunset.
// Three lanes (A west, mid, B east) run from the player spawn in the south to
// two bombsites in the north. Every solid box is a collider for the player
// and a mesh a bullet stops on. The sunset pass keeps every collider and
// lane exactly where it was and spends the budget on the look: corrugated
// containers, pipes and vents, emissive lamps, painted signage, a grate
// floor strip, horizon silhouettes and a clouded dusk sky.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createTextures, makeSkyTexture, makeGlowTexture, makeSignTexture } from './textures.js';

const WALL_H = 4.5;
const MIN_X = -28;
const MAX_X = 28;
const MIN_Z = -20;
const MAX_Z = 20;

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const textures = createTextures();

  const colliders = [];
  const shootables = [];

  function texClone(base, rx, ry) {
    const tex = base.clone();
    tex.repeat.set(rx, ry);
    tex.needsUpdate = true;
    return tex;
  }

  const groundMat = new THREE.MeshStandardMaterial({
    map: texClone(textures.ground, 7, 5), roughness: 0.95, metalness: 0.02,
  });
  const wallMats = new Map();
  function wallMat(len, height) {
    const key = `${len}x${height}`;
    if (!wallMats.has(key)) {
      wallMats.set(key, new THREE.MeshStandardMaterial({
        map: texClone(textures.wall, Math.max(1, len / 4), Math.max(1, height / 4)),
        roughness: 0.92, metalness: 0.02,
      }));
    }
    return wallMats.get(key);
  }
  const concreteMat = new THREE.MeshStandardMaterial({
    map: texClone(textures.wall, 2, 1), color: new THREE.Color(PALETTE.concrete),
    roughness: 0.92, metalness: 0.02,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    map: textures.crateWood, roughness: 0.85, metalness: 0.02,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    map: texClone(textures.crateMetal, 1, 1), roughness: 0.55, metalness: 0.55,
  });
  // Corrugated container: rust-orange ribs with a stencilled yard mark.
  const containerMat = new THREE.MeshStandardMaterial({
    map: texClone(textures.corrugated, 3, 1.3), roughness: 0.6, metalness: 0.45,
  });
  const containerGreyMat = new THREE.MeshStandardMaterial({
    map: texClone(textures.corrugatedGrey, 3, 1.3), roughness: 0.55, metalness: 0.5,
  });
  const rustMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.rust), roughness: 0.65, metalness: 0.4,
  });
  const sandMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.sand), roughness: 1.0, metalness: 0.0,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2b2f33'), roughness: 0.8, metalness: 0.3,
  });
  const hazardMat = new THREE.MeshStandardMaterial({
    map: texClone(textures.hazard, 4, 1), roughness: 0.8, metalness: 0.05,
  });
  const grateMat = new THREE.MeshStandardMaterial({
    map: texClone(textures.grate, 6, 1), roughness: 0.5, metalness: 0.7,
  });
  const siteMatA = new THREE.MeshStandardMaterial({
    map: textures.siteFloorA, roughness: 0.9, metalness: 0.02,
  });
  const siteMatB = new THREE.MeshStandardMaterial({
    map: textures.siteFloorB, roughness: 0.9, metalness: 0.02,
  });
  // Horizon silhouettes: near-black shapes against the sunset, unlit.
  const silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x241a14, fog: false });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffc861, emissive: 0xffb347, emissiveIntensity: 2.2, roughness: 0.4,
  });

  const geoCache = new Map();
  function boxGeo(w, h, d) {
    const key = `${w}|${h}|${d}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d));
    return geoCache.get(key);
  }

  // Add a solid box: collider + shootable. y is the box centre.
  function box(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    ));
    shootables.push(mesh);
    return mesh;
  }

  // Visual-only mesh: a bullet still stops on it, but the player walks through
  // it (used for things flush against a wall, or above head height).
  function visual(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    shootables.push(mesh);
    return mesh;
  }

  // ---- ground: one big textured plane, plus a raised pad at each site ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(56, 40), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  shootables.push(ground);

  // Grate strips down the mid lane, flush with the floor.
  for (const z of [-6, 2, 10]) {
    const grate = new THREE.Mesh(new THREE.PlaneGeometry(3, 4), grateMat);
    grate.rotation.x = -Math.PI / 2;
    grate.position.set(0, 0.012, z);
    grate.receiveShadow = true;
    group.add(grate);
    shootables.push(grate);
  }

  function sitePad(cx, cz, siteMat) {
    box(12, 0.15, 10, cx, 0.075, cz, concreteMat);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(11, 9), siteMat);
    top.rotation.x = -Math.PI / 2;
    top.position.set(cx, 0.16, cz);
    top.receiveShadow = true;
    group.add(top);
    shootables.push(top);
    const strip = (w, d, x, z) => {
      const m = new THREE.Mesh(boxGeo(w, 0.04, d), hazardMat);
      m.position.set(x, 0.17, z);
      m.receiveShadow = true;
      group.add(m);
      shootables.push(m);
    };
    strip(12.4, 0.5, cx, cz - 5.1);
    strip(12.4, 0.5, cx, cz + 5.1);
    strip(0.5, 10.2, cx - 6.1, cz);
    strip(0.5, 10.2, cx + 6.1, cz);
  }
  sitePad(-19, -13.5, siteMatA);
  sitePad(19, -13.5, siteMatB);

  // ---- outer walls, 4.5 m high, open sky above ----
  box(56.8, WALL_H, 0.6, 0, WALL_H / 2, MIN_Z - 0.3, wallMat(56.8, WALL_H));
  box(56.8, WALL_H, 0.6, 0, WALL_H / 2, MAX_Z + 0.3, wallMat(56.8, WALL_H));
  box(0.6, WALL_H, 40.8, MIN_X - 0.3, WALL_H / 2, 0, wallMat(40.8, WALL_H));
  box(0.6, WALL_H, 40.8, MAX_X + 0.3, WALL_H / 2, 0, wallMat(40.8, WALL_H));
  // Corrugated steel band along the top of the outer walls, like a yard fence.
  for (const [w, d, x, z] of [
    [56.8, 0.1, 0, MIN_Z - 0.62], [56.8, 0.1, 0, MAX_Z + 0.62],
    [0.1, 40.8, MIN_X - 0.62, 0], [0.1, 40.8, MAX_X + 0.62],
  ]) {
    const band = new THREE.Mesh(boxGeo(w, 0.9, d), containerGreyMat);
    band.position.set(x, WALL_H + 0.45, z);
    visual(band);
  }

  // ---- lane dividers: 3.2 m walls with a mid gap (z -2..2) and a north gap
  // (z -14..-20) so each lane can rotate into the sites.
  for (const dx of [-8, 8]) {
    box(0.5, 3.2, 12, dx, 1.6, 8, wallMat(12, 3.2));
    box(0.5, 3.2, 12, dx, 1.6, -8, wallMat(12, 3.2));
  }
  box(4, 3.2, 0.5, -5, 1.6, -15.5, wallMat(4, 3.2));
  box(4, 3.2, 0.5, 5, 1.6, -15.5, wallMat(4, 3.2));

  // ---- mid lane: pillar, crouch cover, raised platform by the player spawn ----
  box(1.2, 3.2, 1.2, 2.5, 1.6, -4, concreteMat);
  box(1.1, 1.1, 1.1, -3, 0.55, 5, woodMat);
  box(1.1, 1.1, 1.1, 3.2, 0.55, 5, woodMat);
  box(1.1, 1.1, 1.1, -4, 0.55, -7, woodMat);
  box(1.1, 1.1, 1.1, 4, 0.55, -7, woodMat);
  box(6, 0.5, 3, 0, 0.25, 12, concreteMat); // jump-on platform
  box(1.1, 1.1, 1.1, -6, 0.55, 15, woodMat);
  box(1.1, 1.1, 1.1, 6, 0.55, 15, woodMat);
  box(1.8, 0.6, 0.6, -2.5, 0.3, -1, sandMat);
  box(1.8, 0.6, 0.6, 2.5, 0.3, 1, sandMat);

  // ---- site A (north-west): open yard, container, low wall, stacked crates ----
  box(6, 2.6, 2.4, -22, 1.3, -15, containerMat);
  box(4, 1.2, 0.6, -13.5, 0.6, -10.5, concreteMat);
  box(1.1, 1.1, 1.1, -18, 0.55, -10, woodMat);
  box(1.1, 1.1, 1.1, -18, 1.65, -10, woodMat); // 2.2 m full cover
  box(1.1, 1.1, 1.1, -24, 0.55, -9.5, metalMat);
  box(1.1, 1.1, 1.1, -12.5, 0.55, -16.5, woodMat);
  box(1.1, 1.1, 1.1, -15, 0.55, -18, metalMat);
  box(1.8, 0.6, 0.6, -19, 0.3, -8.2, sandMat);

  // ---- site B (north-east): tight yard, stacked crates for close corners ----
  box(1.1, 1.1, 1.1, 14, 0.55, -10, woodMat);
  box(1.1, 1.1, 1.1, 14, 1.65, -10, woodMat); // 2.2 m full cover
  box(1.1, 1.1, 1.1, 20, 0.55, -16, metalMat);
  box(1.1, 1.1, 1.1, 24.5, 0.55, -11, woodMat);
  box(1.1, 1.1, 1.1, 16, 0.55, -18.5, woodMat);
  box(1.1, 1.1, 1.1, 23, 0.55, -17.5, metalMat);
  box(0.6, 1.2, 4, 22, 0.6, -13.5, concreteMat);
  box(1.8, 0.6, 0.6, 19, 0.3, -8.2, sandMat);

  // ---- north spawn cover (enemy side) ----
  box(1.1, 1.1, 1.1, -14, 0.55, -17.5, woodMat);
  box(1.1, 1.1, 1.1, 14, 0.55, -17.5, woodMat);
  box(1.1, 1.1, 1.1, 2, 0.55, -15, metalMat);

  // ---- barrels (cylinders; collider is the bounding box) ----
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.05, 20);
  function barrel(x, z, collide = true) {
    const mesh = new THREE.Mesh(barrelGeo, rustMat);
    mesh.position.set(x, 0.53, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3(
        new THREE.Vector3(x - 0.45, 0, z - 0.45),
        new THREE.Vector3(x + 0.45, 1.05, z + 0.45),
      ));
    }
    shootables.push(mesh);
    return mesh;
  }
  barrel(-4.5, -7.5);
  barrel(5.5, 9.5);
  barrel(-25.5, -18);
  // Extra drums parked flush against the north wall: dressing, no new cover.
  barrel(-26.5, -19.3, false);
  barrel(26.5, -19.3, false);
  barrel(26.5, 18.5, false);

  // ---- watchtower (south-west): legs + platform are solid, ladder is visual ----
  const towerX = -24;
  const towerZ = 8;
  for (const [lx, lz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
    box(0.25, 3.0, 0.25, towerX + lx, 1.5, towerZ + lz, darkMat);
  }
  box(3.2, 0.3, 3.2, towerX, 3.15, towerZ, woodMat);
  for (const [w, d, x, z] of [
    [3.2, 0.08, towerX, towerZ - 1.56],
    [3.2, 0.08, towerX, towerZ + 1.56],
    [0.08, 3.2, towerX - 1.56, towerZ],
    [0.08, 3.2, towerX + 1.56, towerZ],
  ]) {
    const rail = new THREE.Mesh(boxGeo(w, 0.08, d), darkMat);
    rail.position.set(x, 4.05, z);
    visual(rail);
  }
  for (const dz of [-0.35, 0.35]) {
    const rail = new THREE.Mesh(boxGeo(0.08, 3.2, 0.08), darkMat);
    rail.position.set(towerX + 1.66, 1.6, towerZ + dz);
    visual(rail);
  }
  for (let i = 0; i < 6; i += 1) {
    const rung = new THREE.Mesh(boxGeo(0.08, 0.06, 0.7), darkMat);
    rung.position.set(towerX + 1.66, 0.5 + i * 0.5, towerZ);
    visual(rung);
  }

  // ---- pipes along the east and west walls, visual + shootable ----
  const pipeGeoLong = new THREE.CylinderGeometry(0.12, 0.12, 30, 12);
  const pipeGeoThin = new THREE.CylinderGeometry(0.08, 0.08, 30, 12);
  for (const [geo, y] of [[pipeGeoLong, 1.4], [pipeGeoThin, 1.75]]) {
    const pipe = new THREE.Mesh(geo, rustMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(MAX_X - 0.45, y, 0);
    visual(pipe);
    const pipeW = new THREE.Mesh(geo, rustMat);
    pipeW.rotation.x = Math.PI / 2;
    pipeW.position.set(MIN_X + 0.45, y + 0.35, 0);
    visual(pipeW);
  }
  // Vertical vent stacks with steam (steam puffs live in effects.js).
  const ventGeo = new THREE.CylinderGeometry(0.22, 0.26, 3.4, 12);
  const vents = [];
  for (const [x, z] of [[-27.2, -6], [27.2, 6], [-12, -19.4]]) {
    const vent = new THREE.Mesh(ventGeo, darkMat);
    vent.position.set(x, 1.7, z);
    visual(vent);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12), rustMat);
    cap.position.set(x, 3.45, z);
    visual(cap);
    vents.push(new THREE.Vector3(x, 3.5, z));
  }

  // ---- cables: sagging spans between the divider walls and the tower ----
  function cable(x1, y1, z1, x2, y2, z2) {
    const a = new THREE.Vector3(x1, y1, z1);
    const b = new THREE.Vector3(x2, y2, z2);
    const len = a.distanceTo(b);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 6), darkMat);
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.position.y -= 0.35; // sag
    mesh.lookAt(b);
    mesh.rotateX(Math.PI / 2);
    visual(mesh);
  }
  cable(-8, 3.4, 2, 8, 3.4, 2);
  cable(-24, 4.2, 8, -8, 3.4, 8);

  // ---- painted signage (Dusty Yard's own names) ----
  function sign(text, sub, color, w, x, y, z, ry) {
    const mat = new THREE.MeshStandardMaterial({
      map: makeSignTexture(text, sub, color), roughness: 0.85, metalness: 0.05,
      emissive: 0xffffff, emissiveMap: makeSignTexture(text, sub, color), emissiveIntensity: 0.12,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    visual(mesh);
    return mesh;
  }
  sign('DUSTY YARD', 'SCRAP · FUEL · FREIGHT', '#f5a623', 10, 0, 3.4, MIN_Z + 0.02, 0);
  sign('SITE A', '', '#f5a623', 5, -19, 3.2, MIN_Z + 0.02, 0);
  sign('SITE B', '', '#4aa8ff', 5, 19, 3.2, MIN_Z + 0.02, 0);
  sign('YARD 07', 'KEEP OUT', '#e8b820', 6, -22, 2.2, -13.78, 0);

  // ---- yard lamps: emissive heads on posts, warm pools of light ----
  function lamp(x, z) {
    const post = new THREE.Mesh(boxGeo(0.12, 3.4, 0.12), darkMat);
    post.position.set(x, 1.7, z);
    visual(post);
    const head = new THREE.Mesh(boxGeo(0.5, 0.14, 0.24), lampMat);
    head.position.set(x, 3.45, z);
    visual(head);
    const light = new THREE.PointLight(0xffb347, 6, 9, 1.6);
    light.position.set(x, 3.3, z);
    group.add(light);
  }
  lamp(-19, -8);
  lamp(19, -8);
  lamp(0, 16);

  // ---- horizon silhouettes beyond the walls: crane, water tower, chimney ----
  function silhouette(w, h, d, x, y, z, ry = 0) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), silhouetteMat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  }
  // Crane: mast + jib + counter-jib, north-west.
  silhouette(1.2, 26, 1.2, -38, 13, -34);
  silhouette(16, 1, 1, -34, 24, -34);
  silhouette(5, 1, 1, -43, 24, -34);
  silhouette(2, 3, 2, -38, 26.5, -34);
  // Water tower: legs + tank, north-east.
  silhouette(0.8, 12, 0.8, 36, 6, -32);
  silhouette(0.8, 12, 0.8, 40, 6, -32);
  silhouette(0.8, 12, 0.8, 36, 6, -28);
  silhouette(0.8, 12, 0.8, 40, 6, -28);
  silhouette(6, 5, 6, 38, 14.5, -30);
  // Chimney stack, far west.
  silhouette(2.4, 30, 2.4, -44, 15, 6);
  silhouette(3.2, 1.2, 3.2, -44, 30.5, 6);

  // ---- sky dome: clouded dusk gradient, BackSide, never fogged ----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 32, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  group.add(sky);

  // ---- lighting ----
  scene.background = new THREE.Color(PALETTE.skyTop);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.dusk), 20, 62);

  const hemi = new THREE.HemisphereLight(
    new THREE.Color('#5a7d9c'), // dusk sky, blue-teal
    new THREE.Color('#a8906a'), // warm sand ground
    1.6,
  );
  scene.add(hemi);

  // Low amber sun from the west-northwest, long shadows across the yard.
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.sun), 3.6);
  sun.position.set(-32, 14, -18);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 100;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // Cool fill from the opposite side so shadow faces stay readable.
  const fill = new THREE.DirectionalLight(new THREE.Color('#8fb4cc'), 0.7);
  fill.position.set(28, 14, 22);
  scene.add(fill);

  // Sun glare: soft additive sprite far out in the sun direction.
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: new THREE.Color(PALETTE.sun),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    transparent: true,
    opacity: 0.85,
  }));
  glare.position.set(-68, 26, -38);
  glare.scale.set(34, 34, 1);
  group.add(glare);

  const v = (x, z) => new THREE.Vector3(x, 0, z);
  return {
    colliders,
    shootables,
    group,
    vents,
    playerSpawn: { pos: new THREE.Vector3(0, 0, 17.5), yaw: 0 },
    enemySpawns: [
      { pos: new THREE.Vector3(-22, 0, -17), yaw: Math.PI },
      { pos: new THREE.Vector3(-11, 0, -17), yaw: Math.PI },
      { pos: new THREE.Vector3(0, 0, -17), yaw: Math.PI },
      { pos: new THREE.Vector3(11, 0, -17), yaw: Math.PI },
      { pos: new THREE.Vector3(22, 0, -17), yaw: Math.PI },
    ],
    siteA: { pos: new THREE.Vector3(-19, 0, -13.5), radius: 6, name: 'A' },
    siteB: { pos: new THREE.Vector3(19, 0, -13.5), radius: 6, name: 'B' },
    routes: {
      A: [v(-22, -17), v(-27, -14), v(-22, -11), v(-19, -13.5)],
      B: [v(22, -17), v(26, -13), v(23, -11), v(19, -13.5)],
      mid: [v(0, -17), v(0, -8), v(0, 0), v(0, 8)],
    },
    bounds: { minX: MIN_X, maxX: MAX_X, minZ: MIN_Z, maxZ: MAX_Z },
  };
}
