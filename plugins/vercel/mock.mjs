// Recorded responses for mock mode: the shapes the real adapter returns, without calling Vercel.
let n = 0;
const next = (target) => {
  n += 1;
  return { id: `dpl_mock${n}`, url: `https://forge-mock-${n}${target === 'production' ? '' : '-preview'}.vercel.app`, target, files: 1 };
};

export async function deployPreview() {
  return next('preview');
}

export async function deployProduction() {
  return next('production');
}

export async function getDeployment(id) {
  return { id, url: `https://${id}.vercel.app`, readyState: 'READY' };
}
