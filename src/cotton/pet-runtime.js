import * as THREE from 'three';
import { B1857Character } from './upstream/b1857-character.js';
import { InteractionController } from './upstream/interaction-controller.js';
import { InteractionProps } from './upstream/interaction-props.js';

export async function createPetRuntime(canvas, { signal, initial, onChange, onError }) {
  const response = await fetch(`${import.meta.env.BASE_URL}cotton/b1857.json`, { signal });
  if (!response.ok) throw new Error('pet_asset_unavailable');
  const asset = await response.json();
  signal.throwIfAborted();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, .01, 20);
  camera.position.set(.58, .42, 1.35);
  camera.lookAt(0, .24, .02);
  scene.add(new THREE.HemisphereLight(0xfffaf1, 0x7e8975, 2.5));
  const light = new THREE.DirectionalLight(0xfff8ef, 3);
  light.position.set(-.9, 1.5, 1.3);
  scene.add(light);
  const pet = new B1857Character({ asset });
  scene.add(pet.group, pet.helper);
  const behavior = new InteractionController();
  Object.assign(behavior.stats, initial.stats);
  const props = new InteractionProps(scene, pet);
  let quiet = initial.quiet === true, paused = false, disposed = false, pendingQuiet = false;
  let raf = 0, last = 0, lastNotify = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function snapshot() { return { stats: { ...behavior.stats }, action: behavior.active.id }; }
  function notify() { onChange(snapshot()); }
  function draw() { renderer.render(scene, camera); }
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.PI / 10) * Math.max(1, 1 / camera.aspect)));
    camera.updateProjectionMatrix();
    draw();
  }
  function frame(now) {
    if (disposed || paused || document.hidden) return;
    raf = requestAnimationFrame(frame);
    const interval = quiet || reduced.matches ? 1000 / 15 : 1000 / 30;
    if (now - last < interval) return;
    const dt = last ? Math.min(.1, (now - last) / 1000) : 0;
    last = now;
    behavior.update(dt);
    pet.setInteraction({ id: behavior.active.id, age: behavior.age, envelope: behavior.envelope });
    pet.update(dt);
    props.update(dt, behavior);
    // The upstream authoring history is diagnostic only; bound it for long visits.
    if (behavior.history.length > 32) behavior.history.splice(0, behavior.history.length - 32);
    draw();
    if (now - lastNotify > 1000) { lastNotify = now; notify(); }
  }
  function resume() {
    cancelAnimationFrame(raf);
    last = 0;
    if (!disposed && !paused && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function command(id) {
    if (disposed || paused) return { accepted: false, reason: '先继续陪伴，再和小棉花互动。' };
    const result = behavior.request(id);
    if (result.accepted) { pet.command(id); notify(); }
    return result;
  }
  function lost(event) { event.preventDefault(); paused = true; resume(); onError(); }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  document.addEventListener('visibilitychange', resume);
  canvas.addEventListener('webglcontextlost', lost);
  if (quiet) command('rest');
  notify(); resize(); resume();
  return {
    command,
    snapshot,
    setPaused(value) {
      paused = value;
      if (!paused && pendingQuiet) { behavior.request(quiet ? 'rest' : 'wake', { force: true }); pendingQuiet = false; }
      resume();
    },
    setQuiet(value) {
      quiet = value;
      pendingQuiet = paused;
      if (!paused) { behavior.request(value ? 'rest' : 'wake', { force: true }); notify(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', resume);
      canvas.removeEventListener('webglcontextlost', lost);
      const geometries = new Set(), materials = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of [].concat(object.material || [])) materials.add(material);
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      pet.skeleton.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
