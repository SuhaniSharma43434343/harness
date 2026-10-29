import { capability, markMode, reducedMotion } from '../capability.js';
import { claimWebgl } from './webgl-slot.js';

// APP-05 runtime: a GLSL background drawn with plain WebGL (no library, so the only JavaScript
// is this file). It follows a quality ladder:
//   full     native resolution (capped at 2x), every frame
//   reduced  half resolution, at most 30 frames a second
//   off      the CSS gradient underneath, which is always in the page
// It starts at full and steps down when frames take too long (the plan's budget is 8 ms of GPU
// time a frame on a mid-range phone). Reduced motion draws one still frame and stops. It pauses
// off screen, in a background tab, and while another WebGL section is in view.

const VERTEX = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

// Our own fragment shaders: smooth value noise and a domain-warped field. No third-party noise
// functions, so there is nothing to license.
const FRAGMENT = `
precision mediump float;
uniform vec2 uSize;
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform float uWaves;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 p = uv * vec2(uSize.x / uSize.y, 1.0) * 2.2;
  float t = uTime * 0.05;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  float f = fbm(p + uWaves * q);
  vec3 col = mix(uA, uB, smoothstep(0.2, 0.8, f));
  col = mix(col, uC, 0.6 * smoothstep(0.55, 0.95, q.x * f));
  gl_FragColor = vec4(col, 1.0);
}`;

const LEVELS = { full: { scale: 1, fps: 60 }, reduced: { scale: 0.5, fps: 30 } };
const SLOW_FRAME_MS = 22; // a frame this slow, measured on the main thread, means the GPU is behind
const SAMPLE = 45;

function rgb(value, fallback) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = fallback;
  c.fillStyle = (value || fallback).trim();
  const hex = c.fillStyle.startsWith('#') ? c.fillStyle : fallback;
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

export function startShader(section) {
  const decision = capability({ webgl: true, motion: false });
  if (!decision.full) return markMode('app05', 'fallback', decision.reason);

  const canvas = section.querySelector('.shader__canvas');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) return markMode('app05', 'fallback', 'no-webgl');

  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
  } catch {
    return markMode('app05', 'fallback', 'load-failed');
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = (name) => gl.getUniformLocation(program, name);
  const style = getComputedStyle(section);
  // The field runs from the text colour (dark) to primary, with accent highlights, so the light
  // copy on top keeps its contrast on light and dark themes alike (as the CSS fallback does).
  gl.uniform3fv(u('uA'), rgb(style.getPropertyValue('--shader-a') || style.getPropertyValue('--color-fg'), '#0f1b2d'));
  gl.uniform3fv(u('uB'), rgb(style.getPropertyValue('--shader-b') || style.getPropertyValue('--color-primary'), '#1f3a5f'));
  gl.uniform3fv(u('uC'), rgb(style.getPropertyValue('--shader-c') || style.getPropertyValue('--color-accent'), '#c58b2b'));
  gl.uniform1f(u('uWaves'), Number(section.dataset.intensity ?? 2) * 0.9);
  const uSize = u('uSize');
  const uTime = u('uTime');

  let level = 'full';
  let raf = 0;
  let running = false;
  let last = 0;
  let samples = [];
  const started = performance.now();

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2) * LEVELS[level].scale;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uSize, w, h);
  };
  const draw = (now) => {
    resize();
    gl.uniform1f(uTime, (now - started) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const setLevel = (next) => {
    level = next;
    section.dataset.quality = next;
    markMode('app05', next === 'full' ? 'full' : 'reduced', next === 'full' ? undefined : 'slow-frames');
  };

  const off = () => {
    cancelAnimationFrame(raf);
    running = false;
    canvas.hidden = true;
    section.dataset.quality = 'off';
    markMode('app05', 'fallback', 'slow-frames');
  };

  const tick = (now) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const gap = now - last;
    if (gap < 1000 / LEVELS[level].fps - 2) return;
    if (last) samples.push(gap * (LEVELS[level].fps === 30 ? 0.5 : 1));
    last = now;
    draw(now);
    if (samples.length >= SAMPLE) {
      const sorted = samples.sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      samples = [];
      if (p90 > SLOW_FRAME_MS) level === 'full' ? setLevel('reduced') : off();
    }
  };

  if (reducedMotion()) {
    // A still frame: the effect without the motion.
    canvas.hidden = false;
    draw(started + 4000);
    section.dataset.quality = 'still';
    return markMode('app05', 'fallback', 'reduced-motion');
  }

  canvas.hidden = false;
  setLevel('full');
  const resume = () => {
    if (running || section.dataset.quality === 'off') return;
    running = true;
    last = 0;
    samples = [];
    raf = requestAnimationFrame(tick);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const slot = claimWebgl(section, { resume, pause });
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : slot.running && resume()));
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    off();
  });
}
