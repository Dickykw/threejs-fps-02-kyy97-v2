// Dusty Yard look, one place. Sunset industrial: warm sand and rust under a
// deep teal-blue dusk sky, low amber sun, cool shadow fill. Same names feed
// the CSS custom properties in index.html. Enemy red-orange, ally teal,
// sites amber (A) and blue (B).
export const PALETTE = {
  canvas: '#141a20',
  surface: '#232830',
  hairline: '#454f5a',
  ink: '#f2ead9',
  muted: '#a8b0a6',
  accent: '#f5a623',

  sand: '#b59a6d',
  concrete: '#8d8578',
  rust: '#b45a2a',
  skyTop: '#2e4a6b',
  skyBottom: '#f08a3e',
  dusk: '#7a6a58',
  sun: '#ffb36b',

  enemy: '#ff5a2a',
  ally: '#19b5a6',
  siteA: '#f5a623',
  siteB: '#4aa8ff',
};

export function shade(name) {
  return PALETTE[name];
}
