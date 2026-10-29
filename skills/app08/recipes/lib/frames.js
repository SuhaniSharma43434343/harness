import { capability, hasWebGL, loadOrFallback, markMode } from '../capability.js';

// APP-08 runtime: a scroll-scrubbed frame sequence, drawn on a 2D canvas, with an optional 2.5D
// depth-map parallax over the key frame. The key frame is a real <img> and the first paint, so
// it is also the fallback (reduced motion, a low-end device, a slow network, a failed load).
// Frames load in two passes, every eighth first, so scrubbing works before all have arrived
// and no part of the scroll is left without a frame.

const loaded = () => new Promise((r) => (document.readyState === 'complete' ? r() : addEventListener('load', () => r(), { once: true })));

function frameUrl(pattern, i) {
  return pattern.replace(/%0?(\d*)d/, (_, width) => String(i + 1).padStart(Number(width || 1), '0'));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`frame ${src}`));
    img.src = src;
  });
}

// Every eighth frame, then every fourth, then every second, then the rest.
export function loadOrder(count) {
  const order = [];
  const seen = new Set();
  for (const step of [8, 4, 2, 1]) {
    for (let i = 0; i < count; i += step) if (!seen.has(i)) seen.add(i), order.push(i);
  }
  if (!seen.has(count - 1)) order.push(count - 1);
  return order;
}

export async function startFrames(section) {
  const decision = capability({ webgl: false });
  if (!decision.full) return markMode('app08', 'fallback', decision.reason);

  const { pattern, count } = JSON.parse(section.dataset.frames);
  const canvas = section.querySelector('.frames__canvas');
  const ctx = canvas.getContext('2d');
  const frames = new Array(count);
  await loaded();

  // The first frame must load, or the whole sequence is the key frame alone.
  try {
    frames[0] = await loadOrFallback(() => loadImage(frameUrl(pattern, 0)), 8000);
  } catch {
    return markMode('app08', 'fallback', 'load-failed');
  }
  canvas.width = frames[0].naturalWidth;
  canvas.height = frames[0].naturalHeight;

  let shown = -1;
  let failed = 0;
  const nearest = (i) => {
    for (let d = 0; d < count; d++) {
      if (frames[i - d]) return i - d;
      if (frames[i + d]) return i + d;
    }
    return 0;
  };
  const progress = () => {
    const r = section.getBoundingClientRect();
    const travel = r.height - innerHeight;
    return travel > 0 ? Math.min(1, Math.max(0, -r.top / travel)) : 0;
  };
  const render = () => {
    const want = Math.round(progress() * (count - 1));
    const i = nearest(want);
    if (i === shown) return;
    ctx.drawImage(frames[i], 0, 0, canvas.width, canvas.height);
    shown = i;
    section.dataset.frame = String(i);
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      render();
    });
  };

  section.classList.add('is-live');
  canvas.hidden = false;
  render();
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  markMode('app08', 'full');

  // Load the rest in the background. A frame that fails keeps its neighbour on screen; if most
  // fail the sequence gives up and shows the key frame.
  for (const i of loadOrder(count).slice(1)) {
    try {
      frames[i] = await loadImage(frameUrl(pattern, i));
    } catch {
      failed++;
      if (failed > count / 2) {
        removeEventListener('scroll', onScroll);
        section.classList.remove('is-live');
        canvas.hidden = true;
        return markMode('app08', 'fallback', 'load-failed');
      }
    }
    if (i === Math.round(progress() * (count - 1))) onScroll();
  }
  section.dataset.loaded = 'true';
}

// 2.5D parallax (the DepthParallax section): an image displaced by its depth map, following the
// pointer. The plain <img> stays underneath as the fallback.
export async function startDepth(section) {
  const decision = capability({ webgl: true });
  if (!decision.full || !hasWebGL()) return (section.dataset.depthMode = decision.reason ?? 'no-webgl');
  const { image, map } = JSON.parse(section.dataset.depth);
  await loaded();
  let img, depth;
  try {
    [img, depth] = await loadOrFallback(() => Promise.all([loadImage(image), loadImage(map)]));
  } catch {
    return (section.dataset.depthMode = 'load-failed');
  }
  const canvas = section.querySelector('.frames__depth');
  const gl = canvas.getContext('webgl', { alpha: false });
  if (!gl) return;
  const vs = 'attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; v.y = 1.0 - v.y; gl_Position = vec4(p, 0.0, 1.0); }';
  const fs = 'precision mediump float; varying vec2 v; uniform sampler2D img; uniform sampler2D dep; uniform vec2 off; void main(){ float d = texture2D(dep, v).r; gl_FragColor = texture2D(img, v + off * (d - 0.5)); }';
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    gl.attachShader(prog, s);
  }
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  [img, depth].forEach((source, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
  });
  gl.uniform1i(gl.getUniformLocation(prog, 'img'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'dep'), 1);
  const off = gl.getUniformLocation(prog, 'off');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
  let target = [0, 0];
  const draw = () => {
    gl.uniform2f(off, target[0] * 0.03, target[1] * 0.03);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  section.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    target = [((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1];
    requestAnimationFrame(draw);
  });
  draw();
  canvas.hidden = false;
  section.dataset.depthMode = 'full';
}
