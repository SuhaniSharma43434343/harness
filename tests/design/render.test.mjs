// T17 acceptance: 3 distinct directions rendered at desktop and mobile for each sample brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeDirections } from '../../src/design/propose.mjs';
import { renderDirections, specimenHtml } from '../../src/design/render.mjs';
import { checkDesignRules } from '../../src/design/rules.mjs';
import { launchBrowser } from '../../src/tools/load.mjs';

const TYPES = ['business', 'event', 'flagship', 'launch', 'nonprofit', 'portfolio', 'showroom'];
let skip = false;
try {
  await (await launchBrowser()).close();
} catch (err) {
  skip = `no browser: ${err.message}`;
}

test('a specimen uses only the brief’s own words', async () => {
  const brief = JSON.parse(readFileSync(new URL('../../samples/briefs/business.json', import.meta.url), 'utf8'));
  const d = (await proposeDirections(brief)).directions[0];
  const html = specimenHtml(d, brief);
  assert.match(html, new RegExp(brief.client.name));
  assert.match(html, new RegExp(brief.pages[0].cta));
  assert.ok(!/lorem/i.test(html));
});

for (const type of TYPES) {
  test(`${type}: three directions rendered at desktop and mobile`, { skip }, async () => {
    const brief = JSON.parse(readFileSync(new URL(`../../samples/briefs/${type}.json`, import.meta.url), 'utf8'));
    const record = await proposeDirections(brief);
    const dir = mkdtempSync(join(tmpdir(), 'forge-render-'));
    const r = await renderDirections(record, brief, dir);
    assert.equal(r.screenshots, true);
    for (const d of record.directions) {
      for (const view of ['desktop', 'mobile']) assert.ok(existsSync(join(dir, d.renders[view])), d.renders[view]);
    }
    assert.deepEqual(checkDesignRules(record, brief, { dir }), []);
  });
}
