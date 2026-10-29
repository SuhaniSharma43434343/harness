import { capability, loadOrFallback, markMode, reducedMotion } from '../capability.js';

// APP-06 runtime: one bounded mechanic. The visitor moves a light around the stage (arrow keys,
// WASD, or by dragging/tapping) and collects one orb per item; each orb opens that item in the
// explainer below. Progress is kept for the visit, sound is off until asked for, and a skip
// control ends the game and opens everything. The explainer is the fallback and is always in
// the page, so no content depends on playing.
const loaded = () => new Promise((r) => (document.readyState === 'complete' ? r() : addEventListener('load', () => r(), { once: true })));
const near = (el) =>
  new Promise((r) => {
    if (!('IntersectionObserver' in window)) return r();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        r();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
  });

export async function startGame(section) {
  const decision = capability({ webgl: true, motion: false });
  if (!decision.full) return markMode('app06', 'fallback', decision.reason);
  await loaded();
  await near(section);
  try {
    const Phaser = await loadOrFallback(() => import('phaser'));
    play(Phaser, section);
    markMode('app06', 'full');
  } catch {
    markMode('app06', 'fallback', 'load-failed');
  }
}

function play(Phaser, section) {
  const stage = section.querySelector('.game__stage');
  const mount = section.querySelector('.game__canvas');
  const progress = section.querySelector('.game__progress');
  const items = [...section.querySelectorAll('[data-item]')];
  const key = `forge-app06:${location.pathname}:${section.dataset.id ?? 'game'}`;
  const found = new Set(JSON.parse(sessionStorage.getItem(key) ?? '[]'));
  const calm = reducedMotion();
  let sound = false;
  let audio;

  const reveal = (i) => {
    const li = items[i];
    li.dataset.found = 'true';
    li.querySelector('details').open = true;
  };
  const report = () => {
    progress.textContent = found.size === items.length ? `All ${items.length} found. Everything is open below.` : `${found.size} of ${items.length} found`;
    section.dataset.progress = String(found.size);
  };
  const beep = () => {
    if (!sound) return;
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 660 + found.size * 110;
    g.gain.setValueAtTime(0.08, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.2);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.2);
  };
  found.forEach(reveal);

  const style = getComputedStyle(section);
  const color = (name, fallback) => Phaser.Display.Color.HexStringToColor((style.getPropertyValue(name) || fallback).trim()).color;
  const width = Math.min(mount.clientWidth || 720, 960);
  const height = 280;

  class Collect extends Phaser.Scene {
    create() {
      this.cameras.main.setBackgroundColor(color('--color-surface', '#f4f4f4'));
      this.player = this.add.circle(36, height / 2, 18, color('--color-primary', '#1f3a5f'));
      this.orbs = items.map((_, i) => {
        const x = width * (0.28 + (0.64 * i) / Math.max(items.length - 1, 1));
        const orb = this.add.circle(x, height / 2, 14, color('--color-accent', '#c58b2b'));
        orb.index = i;
        if (found.has(i)) orb.destroy();
        else if (!calm) this.tweens.add({ targets: orb, y: height / 2 - 10, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: i * 120 });
        return orb;
      });
      this.keys = this.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D');
      this.input.keyboard.disableGlobalCapture();
    }
    update(_, delta) {
      const k = this.keys;
      const p = this.input.activePointer;
      let dx = (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0);
      let dy = (k.DOWN.isDown || k.S.isDown ? 1 : 0) - (k.UP.isDown || k.W.isDown ? 1 : 0);
      if (p.isDown) {
        const ax = p.worldX - this.player.x;
        const ay = p.worldY - this.player.y;
        const len = Math.hypot(ax, ay);
        if (len > 4) {
          dx = ax / len;
          dy = ay / len;
        }
      }
      const len = Math.hypot(dx, dy) || 1;
      const step = (240 * delta) / 1000;
      this.player.x = Phaser.Math.Clamp(this.player.x + (dx / len) * step, 18, width - 18);
      this.player.y = Phaser.Math.Clamp(this.player.y + (dy / len) * step, 18, height - 18);
      for (const orb of this.orbs) {
        if (!orb.active || Phaser.Math.Distance.Between(orb.x, orb.y, this.player.x, this.player.y) > 32) continue;
        orb.destroy();
        found.add(orb.index);
        sessionStorage.setItem(key, JSON.stringify([...found]));
        reveal(orb.index);
        beep();
        report();
      }
    }
  }

  stage.hidden = false;
  const game = new Phaser.Game({ type: Phaser.AUTO, parent: mount, width, height, scene: Collect, banner: false, audio: { noAudio: true }, scale: { mode: Phaser.Scale.FIT } });
  section.game = game;
  report();

  section.querySelector('.game__skip').addEventListener('click', () => {
    items.forEach((_, i) => reveal(i));
    game.destroy(true);
    stage.hidden = true;
    section.dataset.skipped = 'true';
    section.querySelector('.game__explainer h3').focus();
  });
  const toggle = section.querySelector('.game__sound');
  toggle.addEventListener('click', () => {
    sound = !sound;
    toggle.setAttribute('aria-pressed', String(sound));
  });
}
