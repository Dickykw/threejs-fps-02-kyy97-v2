// All textures are generated in code on 2D canvases — no image loading, no
// network. Every texture is a THREE.CanvasTexture with RepeatWrapping,
// anisotropy 4 and sRGB colourspace. Seeded RNG keeps the noise identical
// on every load. The sunset pass raises the tile size (512) and adds
// corrugated metal, floor grate and painted signage textures.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function mulberry32(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size, h) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = h || size;
  return canvas;
}

function toTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Scattered speckles of light/dark grit over the whole tile.
function speckle(ctx, size, rand, count, alpha) {
  for (let i = 0; i < count; i += 1) {
    const v = rand();
    ctx.fillStyle = v > 0.5
      ? `rgba(255, 240, 210, ${(rand() * alpha).toFixed(3)})`
      : `rgba(20, 14, 8, ${(rand() * alpha).toFixed(3)})`;
    const s = 1 + rand() * 2;
    ctx.fillRect(rand() * size, rand() * size, s, s);
  }
}

// Soft blotches: weather patches, oil stains, sun-bleached areas.
function blotches(ctx, size, rand, count, colors, rMin, rMax, alpha) {
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    ctx.globalAlpha = alpha * (0.4 + rand() * 0.6);
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, rMin + rand() * (rMax - rMin), (rMin + rand() * (rMax - rMin)) * 0.6, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function groundTexture() {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(1337);
  ctx.fillStyle = '#8f7d5f';
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, rand, 26, ['#a08a64', '#7d6c4e', '#9c8461', '#6f6046'], 30, 120, 0.16);
  // Dark oil stains: glossy-looking pools near the yard's work spots.
  blotches(ctx, size, rand, 7, ['#1c1a16', '#26221c', '#141210'], 14, 48, 0.5);
  speckle(ctx, size, rand, 9000, 0.22);
  // Faint cracks: jagged dark polylines.
  ctx.strokeStyle = 'rgba(40, 30, 18, 0.5)';
  for (let i = 0; i < 9; i += 1) {
    ctx.lineWidth = 1 + rand() * 1.5;
    ctx.beginPath();
    let x = rand() * size;
    let y = rand() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 7; s += 1) {
      x += (rand() - 0.5) * 90;
      y += (rand() - 0.5) * 90;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Tire marks: two long, slightly curved dark arcs.
  ctx.strokeStyle = 'rgba(30, 24, 16, 0.13)';
  ctx.lineWidth = 20;
  for (const [cx, cy, r] of [[140, 420, 260], [180, 420, 260], [360, 90, 300]]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.15, Math.PI * 0.55);
    ctx.stroke();
  }
  // Faded painted centre dashes, as if an old road ran through the yard.
  ctx.fillStyle = 'rgba(232, 214, 170, 0.20)';
  for (let x = 24; x < size; x += 96) ctx.fillRect(x, 248, 48, 7);
  return toTexture(canvas);
}

function wallTexture() {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(4242);
  ctx.fillStyle = PALETTE.concrete;
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, rand, 14, ['#7d7568', '#9a9184', '#6f685c'], 16, 60, 0.18);
  speckle(ctx, size, rand, 2600, 0.16);
  // Concrete panel seams: 2 x 2 panels with a darker joint and a pale edge.
  ctx.strokeStyle = 'rgba(52, 46, 38, 0.75)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  ctx.beginPath();
  ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 244, 220, 0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size / 2 + 3, 0); ctx.lineTo(size / 2 + 3, size);
  ctx.moveTo(0, size / 2 + 3); ctx.lineTo(size, size / 2 + 3);
  ctx.stroke();
  // Grime creeping up from the bottom edge.
  const grime = ctx.createLinearGradient(0, size * 0.55, 0, size);
  grime.addColorStop(0, 'rgba(46, 38, 26, 0)');
  grime.addColorStop(1, 'rgba(46, 38, 26, 0.42)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, size * 0.55, size, size * 0.45);
  // Rust weeps running down from the top.
  for (let i = 0; i < 5; i += 1) {
    const x = rand() * size;
    const len = 20 + rand() * 60;
    const grad = ctx.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(140, 70, 30, 0.5)');
    grad.addColorStop(1, 'rgba(140, 70, 30, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 3 + rand() * 4, len);
  }
  return toTexture(canvas);
}

// Corrugated metal: vertical ribs with alternating light/shadow, rust in the
// valleys. Used on the shipping container and the outer wall top band.
function corrugatedTexture(base, ribColor, seed) {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rib = 32;
  for (let x = 0; x < size; x += rib) {
    const grad = ctx.createLinearGradient(x, 0, x + rib, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.34)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.20)');
    grad.addColorStop(0.5, ribColor);
    grad.addColorStop(0.75, 'rgba(255,255,255,0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, rib, size);
  }
  // Rust bleeding down the valleys.
  for (let i = 0; i < 14; i += 1) {
    const x = rand() * size;
    const len = 30 + rand() * 140;
    const grad = ctx.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(150, 74, 28, 0.45)');
    grad.addColorStop(1, 'rgba(150, 74, 28, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, rand() * 60, 4 + rand() * 6, len);
  }
  speckle(ctx, size, rand, 2200, 0.12);
  return toTexture(canvas);
}

// Floor grate: dark steel grid over a shadowed pit, for the mid-lane strips.
function grateTexture() {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101214';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#3a4046';
  ctx.lineWidth = 5;
  const step = 32;
  for (let x = 0; x <= size; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(size, x); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(200,210,220,0.16)';
  ctx.lineWidth = 1;
  for (let x = 2; x <= size; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(size, x); ctx.stroke();
  }
  const rand = mulberry32(515);
  speckle(ctx, size, rand, 500, 0.14);
  return toTexture(canvas);
}

function crateWoodTexture() {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(777);
  ctx.fillStyle = '#9a6b3f';
  ctx.fillRect(0, 0, size, size);
  const plankH = size / 4;
  for (let p = 0; p < 4; p += 1) {
    const y0 = p * plankH;
    ctx.fillStyle = ['#a1713f', '#96683a', '#a87a48', '#8f6236'][p];
    ctx.fillRect(0, y0 + 2, size, plankH - 4);
    ctx.strokeStyle = 'rgba(60, 38, 16, 0.35)';
    ctx.lineWidth = 1;
    for (let g = 0; g < 5; g += 1) {
      const gy = y0 + 6 + rand() * (plankH - 12);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let x = 0; x <= size; x += 32) ctx.lineTo(x, gy + (rand() - 0.5) * 5);
      ctx.stroke();
    }
    ctx.fillStyle = '#2e2620';
    for (const nx of [14, size - 14]) {
      ctx.beginPath();
      ctx.arc(nx, y0 + plankH / 2, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(30, 20, 10, 0.55)';
    ctx.fillRect(0, y0, size, 2);
  }
  ctx.strokeStyle = 'rgba(70, 44, 18, 0.35)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(0, size); ctx.lineTo(size, 0);
  ctx.stroke();
  ctx.fillStyle = 'rgba(240, 220, 180, 0.5)';
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText('07', 18, size - 18);
  speckle(ctx, size, rand, 900, 0.12);
  return toTexture(canvas);
}

function crateMetalTexture() {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(2024);
  ctx.fillStyle = '#77808a';
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, rand, 12, ['#6a737c', '#858f99', '#5f686f'], 14, 52, 0.2);
  speckle(ctx, size, rand, 1800, 0.12);
  ctx.strokeStyle = 'rgba(30, 34, 38, 0.8)';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, size - 12, size - 12);
  ctx.beginPath();
  ctx.moveTo(size / 2, 6); ctx.lineTo(size / 2, size - 6);
  ctx.moveTo(6, size / 2); ctx.lineTo(size - 6, size / 2);
  ctx.stroke();
  ctx.fillStyle = '#3a3f45';
  const rivet = (x, y) => { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); };
  for (let i = 0; i <= 4; i += 1) {
    const t = 16 + i * ((size - 32) / 4);
    rivet(t, 16); rivet(t, size - 16); rivet(16, t); rivet(size - 16, t);
  }
  for (let i = 0; i < 10; i += 1) {
    const x = 12 + rand() * (size - 24);
    const len = 24 + rand() * 70;
    const grad = ctx.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(150, 74, 28, 0.55)');
    grad.addColorStop(1, 'rgba(150, 74, 28, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 8 + rand() * 40, 4 + rand() * 5, len);
  }
  ctx.fillStyle = 'rgba(20, 22, 26, 0.35)';
  ctx.beginPath();
  ctx.moveTo(size, size - 46); ctx.lineTo(size - 46, size); ctx.lineTo(size, size);
  ctx.closePath();
  ctx.fill();
  return toTexture(canvas);
}

function hazardTexture() {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e8b820';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#161513';
  const stripe = 36;
  for (let x = -size; x < size * 2; x += stripe * 2) {
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.lineTo(x + stripe, size);
    ctx.lineTo(x + stripe + size, 0);
    ctx.lineTo(x + size, 0);
    ctx.closePath();
    ctx.fill();
  }
  const rand = mulberry32(99);
  speckle(ctx, size, rand, 1200, 0.14);
  ctx.fillStyle = 'rgba(120, 100, 60, 0.18)';
  for (let i = 0; i < 8; i += 1) ctx.fillRect(rand() * size, rand() * size, 20 + rand() * 40, 6 + rand() * 10);
  return toTexture(canvas);
}

function siteFloorTexture(letter, color) {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(letter === 'A' ? 5150 : 5151);
  ctx.fillStyle = '#6e6252';
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, rand, 10, ['#7d6f5a', '#5d5344'], 16, 60, 0.2);
  speckle(ctx, size, rand, 2200, 0.16);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.92;
  ctx.lineWidth = 14;
  ctx.strokeRect(12, 12, size - 24, size - 24);
  ctx.lineWidth = 3;
  ctx.strokeRect(34, 34, size - 68, size - 68);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.font = '900 150px "Arial Black", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, size / 2, size / 2 + 8);
  ctx.fillStyle = 'rgba(110, 98, 82, 0.5)';
  for (let i = 0; i < 14; i += 1) ctx.fillRect(rand() * size, rand() * size, 12 + rand() * 36, 3 + rand() * 5);
  return toTexture(canvas);
}

// Painted wall signage: big stencil text on a weathered panel. The caller
// picks the words; Dusty Yard's own names only.
export function makeSignTexture(text, sub, color) {
  const canvas = makeCanvas(512, 128);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(text.length * 977 + 13);
  ctx.fillStyle = '#3d3a33';
  ctx.fillRect(0, 0, 512, 128);
  blotches(ctx, 512, rand, 8, ['#4a463d', '#332f28'], 10, 40, 0.25);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = color;
  ctx.font = '900 64px "Arial Black", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, sub ? 52 : 64);
  if (sub) {
    ctx.font = 'bold 26px Arial, sans-serif';
    ctx.fillStyle = 'rgba(230, 220, 200, 0.85)';
    ctx.fillText(sub, 256, 102);
  }
  speckle(ctx, 512, rand, 700, 0.12);
  const tex = toTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function createTextures() {
  return {
    ground: groundTexture(),
    wall: wallTexture(),
    crateWood: crateWoodTexture(),
    crateMetal: crateMetalTexture(),
    hazard: hazardTexture(),
    corrugated: corrugatedTexture('#8a4a28', 'rgba(255,255,255,0.10)', 606),
    corrugatedGrey: corrugatedTexture('#5f6a72', 'rgba(255,255,255,0.12)', 707),
    grate: grateTexture(),
    siteFloorA: siteFloorTexture('A', PALETTE.siteA),
    siteFloorB: siteFloorTexture('B', PALETTE.siteB),
  };
}

// Vertical dusk gradient for the sky dome, with painted sunset clouds and a
// few stars near the zenith. Canvas top maps to the zenith.
export function makeSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#1d3350');
  grad.addColorStop(0.30, '#2e4a6b');
  grad.addColorStop(0.48, '#5a7d8e');
  grad.addColorStop(0.60, '#c98a4e');
  grad.addColorStop(0.68, '#f5a654');
  grad.addColorStop(0.74, '#e08a3e');
  grad.addColorStop(0.80, '#6a5a44');
  grad.addColorStop(1.0, '#2a211a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  const rand = mulberry32(20261116);
  // Stars: only high up, where the sky is already dark.
  for (let i = 0; i < 90; i += 1) {
    const y = rand() * 150;
    const a = 0.25 + rand() * 0.6;
    ctx.fillStyle = `rgba(255, 250, 230, ${a.toFixed(2)})`;
    const s = rand() < 0.12 ? 2 : 1;
    ctx.fillRect(rand() * 512, y, s, s);
  }
  // Sunset clouds: soft warm ellipses stacked near the horizon band.
  for (let i = 0; i < 26; i += 1) {
    const y = 230 + rand() * 110;
    const x = rand() * 512;
    const rx = 30 + rand() * 80;
    const ry = 5 + rand() * 12;
    const warm = rand() > 0.4;
    ctx.fillStyle = warm ? `rgba(255, 170, 100, ${0.10 + rand() * 0.16})` : `rgba(120, 140, 170, ${0.10 + rand() * 0.14})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(canvas);
}

// Soft radial glow for the sun glare sprite (tinted amber by the material).
export function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.55)');
  grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.12)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(canvas);
}
