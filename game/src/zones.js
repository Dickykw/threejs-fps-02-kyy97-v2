// Yard zones — Dusty Yard's own place names, shared by the HUD zone label,
// the radio callouts and the minimap. Sites first, then the lanes and yards:
//   SITE A / SITE B — inside a site ring (+2 m margin)
//   MID             — the centre lane (|x| <= 8)
//   YARD 07         — north-west, by the YARD 07 sign
//   SCRAP           — south-west, the scrap piles
//   FUEL            — east side, the fuel drums
// Nothing here is copied from any other game: these are this yard's names.
export const ZONE_NAMES = ['SITE A', 'SITE B', 'MID', 'YARD 07', 'SCRAP', 'FUEL'];

export function zoneAt(pos, siteA, siteB) {
  const ax = siteA && siteA.pos ? siteA.pos.x : -19;
  const az = siteA && siteA.pos ? siteA.pos.z : -13.5;
  const bx = siteB && siteB.pos ? siteB.pos.x : 19;
  const bz = siteB && siteB.pos ? siteB.pos.z : -13.5;
  const ar = (siteA && siteA.radius ? siteA.radius : 6) + 2;
  const br = (siteB && siteB.radius ? siteB.radius : 6) + 2;
  const dxA = pos.x - ax;
  const dzA = pos.z - az;
  if (dxA * dxA + dzA * dzA < ar * ar) return 'SITE A';
  const dxB = pos.x - bx;
  const dzB = pos.z - bz;
  if (dxB * dxB + dzB * dzB < br * br) return 'SITE B';
  if (Math.abs(pos.x) <= 8) return 'MID';
  if (pos.x < -8) return pos.z < -2 ? 'YARD 07' : 'SCRAP';
  return 'FUEL';
}
