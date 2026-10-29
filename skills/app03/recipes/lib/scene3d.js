import { capability, loadOrFallback, markMode, reducedMotion } from '../capability.js';
import { claimWebgl } from './webgl-slot.js';

// APP-03 runtime: a Three.js scene behind a poster. The poster is the first paint (the LCP),
// and Three.js, the glTF loader and the model load only after the page has loaded and the
// section is near the viewport. The visitor turns the object by dragging, with the arrow keys
// when the stage has focus, or by scrolling past it. Fallback: the poster with a CSS depth tilt
// (reduced motion: the poster alone).

const loaded = () => new Promise((r) => (document.readyState === 'complete' ? r() : addEventListener('load', () => r(), { once: true })));
const near = (el) =>
  new Promise((r) => {
    if (!('IntersectionObserver' in window)) return r();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        r();
      }
    }, { rootMargin: '300px' });
    io.observe(el);
  });

const SLOW_FRAME_MS = 40; // below about 25 fps the plan's 30 fps floor is lost
const SAMPLE = 60;

// The CSS depth fallback: the poster tilts a little towards the pointer.
function tilt(section) {
  if (reducedMotion()) return;
  const stage = section.querySelector('.scene3d__stage');
  stage.classList.add('is-tilt');
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    stage.style.setProperty('--tilt-x', `${(-y * 8).toFixed(2)}deg`);
    stage.style.setProperty('--tilt-y', `${(x * 10).toFixed(2)}deg`);
  });
  stage.addEventListener('pointerleave', () => {
    stage.style.removeProperty('--tilt-x');
    stage.style.removeProperty('--tilt-y');
  });
}

function fallback(section, reason) {
  markMode('app03', 'fallback', reason);
  tilt(section);
}

export async function startScene(section) {
  const decision = capability({ webgl: true });
  if (!decision.full) return fallback(section, decision.reason);
  await loaded();
  await near(section);

  let THREE;
  let gltf = null;
  try {
    [THREE, gltf] = await loadOrFallback(async () => {
      const three = await import('three');
      const model = section.dataset.model;
      if (!model) return [three, null];
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      return [three, await loader.loadAsync(model)];
    }, 12000);
  } catch {
    return fallback(section, 'load-failed');
  }
  try {
    run(THREE, section, gltf);
  } catch {
    fallback(section, 'load-failed');
  }
}

function run(THREE, section, gltf) {
  const stage = section.querySelector('.scene3d__stage');
  const canvas = section.querySelector('.scene3d__canvas');
  const style = getComputedStyle(section);
  const token = (name, fallbackColour) => new THREE.Color((style.getPropertyValue(name) || fallbackColour).trim());

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'default' });
  let pixelRatio = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 6);
  scene.add(new THREE.HemisphereLight(0xffffff, token('--color-surface', '#e8e8e8'), 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 4, 5);
  scene.add(key);

  const pivot = new THREE.Group();
  scene.add(pivot);
  if (gltf) {
    const object = gltf.scene;
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    object.position.sub(box.getCenter(new THREE.Vector3()));
    object.scale.setScalar(3 / size);
    pivot.add(object);
  } else {
    // A procedural object in the token colours, when the brief has no model.
    const mesh = new THREE.Mesh(
      new THREE.TorusKnotGeometry(1, 0.34, 160, 24),
      new THREE.MeshStandardMaterial({ color: token('--color-primary', '#1f3a5f'), metalness: 0.35, roughness: 0.35, emissive: token('--color-accent', '#c58b2b'), emissiveIntensity: 0.08 }),
    );
    pivot.add(mesh);
  }

  const resize = () => {
    const w = stage.clientWidth || 640;
    const h = stage.clientHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize, { passive: true });

  // Interaction: drag, arrow keys and scroll all turn the object.
  const target = { x: 0.2, y: 0 };
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, tx: target.x, ty: target.y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    target.y = drag.ty + (e.clientX - drag.x) * 0.01;
    target.x = Math.max(-1, Math.min(1, drag.tx + (e.clientY - drag.y) * 0.01));
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('keydown', (e) => {
    const step = 0.2;
    if (e.key === 'ArrowLeft') target.y -= step;
    else if (e.key === 'ArrowRight') target.y += step;
    else if (e.key === 'ArrowUp') target.x = Math.max(-1, target.x - step);
    else if (e.key === 'ArrowDown') target.x = Math.min(1, target.x + step);
    else return;
    e.preventDefault();
  });
  let scrollTurn = 0;
  addEventListener('scroll', () => {
    const r = section.getBoundingClientRect();
    scrollTurn = ((innerHeight - r.top) / (innerHeight + r.height)) * Math.PI;
  }, { passive: true });

  let running = false;
  let raf = 0;
  let last = 0;
  let samples = [];
  const tick = (now) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (last) samples.push(now - last);
    last = now;
    pivot.rotation.x += (target.x - pivot.rotation.x) * 0.08;
    pivot.rotation.y += (target.y + scrollTurn - pivot.rotation.y) * 0.08;
    renderer.render(scene, camera);
    if (samples.length >= SAMPLE) {
      const sorted = samples.sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      samples = [];
      if (p90 > SLOW_FRAME_MS) {
        if (pixelRatio > 1) {
          pixelRatio = 1;
          renderer.setPixelRatio(1);
          resize();
          section.dataset.quality = 'reduced';
        } else {
          stop();
        }
      }
    }
  };
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
  const stop = () => {
    pause();
    section.dataset.quality = 'off';
    section.classList.remove('is-live');
    canvas.hidden = true;
    renderer.dispose();
    fallback(section, 'slow-frames');
  };

  renderer.render(scene, camera);
  canvas.hidden = false;
  section.classList.add('is-live');
  section.dataset.quality = 'full';
  markMode('app03', 'full');
  const slot = claimWebgl(section, { resume, pause });
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : slot.running && resume()));
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stop();
  });
}
