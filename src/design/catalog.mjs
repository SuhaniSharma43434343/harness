import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGISTRY_DIR } from '../registry/load.mjs';

const read = (root, file) => JSON.parse(readFileSync(join(root, 'design', file), 'utf8'));

// The font and palette catalogs in registry/design/.
export function loadDesignCatalog(root = REGISTRY_DIR) {
  return { fonts: read(root, 'fonts.json').fonts, palettes: read(root, 'palettes.json').palettes };
}

function hue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const darkBg = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16) < 3 * 80;

// The palette family a direction's colours belong to: the catalog palette it uses, or, for
// colours outside the catalog, its mode and the hue of its primary colour in 30-degree steps.
export function paletteFamily(colour, palettes = loadDesignCatalog().palettes) {
  const t = colour.tokens;
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const hit = palettes.find((p) => same(p.tokens.bg, t.bg) && same(p.tokens.primary, t.primary));
  if (hit) return hit.id;
  return `custom-${darkBg(t.bg) ? 'dark' : 'light'}-${Math.round(hue(t.primary) / 30) % 12}`;
}

export const fontPair = (typography) => `${typography.display.family} / ${typography.body.family}`;
