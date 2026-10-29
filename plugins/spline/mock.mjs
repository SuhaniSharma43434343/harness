import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Recorded responses for mock mode: a tiny placeholder scene, no call to Spline.
const MOCK_URL = 'https://prod.spline.design/forge-mock/scene.splinecode';

export async function sceneUrl(url) {
  return url ?? MOCK_URL;
}

export async function checkScene(url) {
  return { url: url ?? MOCK_URL, bytes: 245760, contentType: 'application/octet-stream' };
}

export async function downloadScene(_url, destDir, { name = 'scene' } = {}) {
  mkdirSync(destDir, { recursive: true });
  const file = `${name}.splinecode`;
  writeFileSync(join(destDir, file), 'forge-mock-scene');
  return { file, bytes: 16 };
}
