import { disablePlugin, enablePlugin, healthCheck, listPlugins } from '../core/plugins.mjs';

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

// forge plugins [list|enable <id>|disable <id>|check [id]]
export async function cmdPlugins(root, args) {
  const [sub = 'list', id] = args;
  const json = args.includes('--json');

  if (sub === 'list') {
    const plugins = listPlugins({ root });
    if (json) {
      console.log(JSON.stringify(plugins, null, 2));
      return 0;
    }
    if (!plugins.length) console.log('No plugins found.');
    for (const p of plugins) {
      const notes = [p.status, p.paid ? 'paid' : 'free'];
      if (p.approvals.length) notes.push(`needs ${p.approvals.join(', ')}`);
      if (p.missingEnv.length) notes.push(`missing ${p.missingEnv.join(', ')}`);
      console.log(`${p.enabled ? 'on ' : 'off'}  ${p.id.padEnd(16)} ${p.category.padEnd(9)} ${notes.join(', ')}`);
    }
    return 0;
  }

  if (sub === 'enable' || sub === 'disable') {
    if (!id) {
      console.error(`Usage: forge plugins ${sub} <id>${sub === 'enable' ? ' [--project <project>]' : ''}`);
      return 2;
    }
    if (sub === 'disable') {
      disablePlugin(id, { root });
      console.log(`Disabled ${id}. Its feature now uses the documented fallback.`);
      return 0;
    }
    const { health, manifest } = await enablePlugin(id, { root, project: flag(args, '--project') });
    console.log(`Enabled ${id} (${health.detail}).`);
    if (manifest.cost.paid) console.log(`  Paid plugin: ${manifest.cost.disclosure} Pricing: ${manifest.cost.pricingUrl}`);
    if (manifest.approvals?.length) console.log(`  Its gated actions also need ${manifest.approvals.join(', ')} recorded for each project.`);
    return 0;
  }

  if (sub === 'check') {
    const ids = id && !id.startsWith('-') ? [id] : listPlugins({ root }).filter((p) => p.enabled).map((p) => p.id);
    if (!ids.length) console.log('No plugins are enabled.');
    let failed = 0;
    for (const pid of ids) {
      const h = await healthCheck(pid, { root });
      if (!h.ok) failed++;
      console.log(`${h.ok ? 'OK  ' : 'FAIL'} ${pid}: ${h.detail}`);
      if (h.hint) console.log(`       -> ${h.hint}`);
    }
    return failed ? 1 : 0;
  }

  console.error('Usage: forge plugins [list|enable <id>|disable <id>|check [id]]');
  return 2;
}

// Health of every enabled plugin, as doctor checks.
export async function pluginDoctorChecks(root) {
  const enabled = listPlugins({ root }).filter((p) => p.enabled);
  const checks = [];
  for (const p of enabled) {
    const h = await healthCheck(p.id, { root });
    checks.push({ name: `Plugin ${p.id}`, status: h.ok ? 'ok' : 'fail', detail: h.detail, hint: h.hint });
  }
  return checks;
}
