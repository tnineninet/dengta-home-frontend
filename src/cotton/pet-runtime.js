import * as THREE from 'three';
import { B1857Character } from './upstream/b1857-character.js';
import { ACTIONS, InteractionController } from './upstream/interaction-controller.js';
import { InteractionProps } from './upstream/interaction-props.js';
import { SpringBoneSystem } from './spring-bone-physics.js';
import { createContactShadow, createMToonGradientTexture, createMToonMaterials, createOutlineMesh, DanceSparkles, updateOutlineAppearance } from './mtoon-style.js';

function validateAsset(asset) {
  const fail = () => { throw new Error('pet_asset_invalid'); };
  if (!asset || !Array.isArray(asset.bones) || !asset.bones.length) fail();
  const names = new Set();
  for (const bone of asset.bones) {
    if (!bone || typeof bone.name !== 'string' || names.has(bone.name) ||
        !Array.isArray(bone.head) || bone.head.length !== 3 || !bone.head.every(Number.isFinite) ||
        (bone.parent && !names.has(bone.parent))) fail();
    names.add(bone.name);
  }
  for (const name of ['chest', 'neck', 'head', 'ear.L', 'ear.R', 'fore.L.lower', 'fore.R.lower', 'fore.L.paw', 'fore.R.paw', 'tail_0', 'tail_1', 'tail_2', 'tail_3']) {
    if (!names.has(name)) fail();
  }
  for (const name of ['positions', 'normals', 'indices', 'skinIndices', 'skinWeights']) {
    if (!Array.isArray(asset[name]) || !asset[name].length) fail();
  }
  const vertices = asset.positions.length / 3;
  if (!Number.isInteger(vertices) || asset.normals.length !== vertices * 3 ||
      asset.skinIndices.length !== vertices * 4 || asset.skinWeights.length !== vertices * 4 ||
      asset.indices.length % 3 !== 0) fail();
}

export async function createPetRuntime(canvas, { signal, initial, onChange, onError }) {
  const response = await fetch(`${import.meta.env.BASE_URL}cotton/b1857.json`, { signal });
  if (!response.ok) throw new Error('pet_asset_unavailable');
  const asset = await response.json();
  signal.throwIfAborted();
  validateAsset(asset);
  let renderer, scene, pet, observer, motionObserver, reduced;
  let hemiLight, dirLight, rimLight, springs, sparkles, outlineMesh, toonGradient, toonMaterials, standardMaterials;
  let disposed = false, raf = 0;
  function dispose() {
    if (disposed) return;
    settleStatic();
    disposed = true;
    let cleanupError;
    const release = cleanup => { try { cleanup(); } catch (error) { cleanupError ||= error; } };
    release(() => cancelAnimationFrame(raf));
    release(() => observer?.disconnect());
    release(() => motionObserver?.disconnect());
    release(() => document.removeEventListener('visibilitychange', resume));
    release(() => canvas.removeEventListener('webglcontextlost', lost));
    release(() => reduced?.removeEventListener?.('change', motionChanged));
    release(() => reduced?.removeListener?.(motionChanged));
    const geometries = new Set(), materials = new Set(), textures = new Set();
    for (const root of [scene, pet?.group, pet?.helper]) release(() => root?.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [].concat(object.material || [])) if (material) materials.add(material);
    }));
    for (const material of [...(standardMaterials || []), ...(toonMaterials || [])]) if (material) materials.add(material);
    if (toonGradient) textures.add(toonGradient);
    for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    geometries.forEach(geometry => release(() => geometry.dispose()));
    textures.forEach(texture => release(() => texture.dispose()));
    materials.forEach(material => release(() => material.dispose()));
    release(() => pet?.skeleton.dispose());
    release(() => renderer?.dispose());
    release(() => renderer?.forceContextLoss());
    if (cleanupError) throw cleanupError;
  }
  let camera, behavior, props;
  let quiet = initial.quiet === true, paused = false, pendingQuiet = false, visible = !document.hidden;
  let last = 0, lastNotify = 0, motionUntil = 0, reducedMotion = false, frozenAt = null;
  let orbitYaw = 0.4, orbitPitch = 0.14, cameraZoom = 1, visualStyle = { toon: false, outline: false, night: false, bigHead: false, skeleton: false };
  const cameraTarget = new THREE.Vector3(0, 0.24, 0.02);
  function applyCamera() {
    if (!camera) return;
    const radius = 1.48 / THREE.MathUtils.clamp(cameraZoom, 0.65, 1.65);
    const pitch = THREE.MathUtils.clamp(orbitPitch, -0.22, 0.62);
    camera.position.set(
      Math.sin(orbitYaw) * Math.cos(pitch) * radius,
      0.24 + Math.sin(pitch) * radius,
      Math.cos(orbitYaw) * Math.cos(pitch) * radius,
    );
    camera.lookAt(cameraTarget);
  }
  function applyVisualStyle() {
    if (!pet) return;
    if (visualStyle.toon) {
      if (!toonGradient) toonGradient = createMToonGradientTexture();
      if (!toonMaterials) toonMaterials = createMToonMaterials(toonGradient);
      pet.mesh.material = toonMaterials;
    } else if (standardMaterials) {
      pet.mesh.material = standardMaterials;
    }
    if (outlineMesh) {
      outlineMesh.visible = Boolean(visualStyle.outline);
      updateOutlineAppearance(outlineMesh, visualStyle);
    }
    if (pet.helper) pet.helper.visible = Boolean(visualStyle.skeleton);
    pet.setBigHead(visualStyle.bigHead);
    if (renderer) {
      renderer.toneMappingExposure = visualStyle.night ? 0.9 : visualStyle.toon ? 0.84 : 0.86;
    }
    if (hemiLight && dirLight && rimLight) {
      if (visualStyle.night) {
        hemiLight.color.setHex(0x9cb4ff);
        hemiLight.groundColor.setHex(0x221d38);
        hemiLight.intensity = visualStyle.toon ? 0.36 : 0.68;
        dirLight.color.setHex(0xffc992);
        dirLight.intensity = 1.65;
        rimLight.color.setHex(0x9ab6ff);
        rimLight.intensity = 2.15;
      } else if (visualStyle.toon) {
        // MToon: keep hemisphere ambient low so the 4-step cel ramp shows crisp
        // shadow bands instead of flooding snow-white fur into flat white.
        hemiLight.color.setHex(0xf6ecf4);
        hemiLight.groundColor.setHex(0x5d4c5c);
        hemiLight.intensity = 0.34;
        dirLight.color.setHex(0xfff3e6);
        dirLight.intensity = 1.65;
        rimLight.color.setHex(0xc5b8ff);
        rimLight.intensity = 0.78;
      } else {
        // Day studio PBR: sculptural warm key + balanced low fill + crisp cool rim
        // so every fur tuft, ear, ruff fold, and paw reads clearly.
        hemiLight.color.setHex(0xfff5e8);
        hemiLight.groundColor.setHex(0x594f47);
        hemiLight.intensity = 0.72;
        dirLight.color.setHex(0xfff0dc);
        dirLight.intensity = 1.92;
        rimLight.color.setHex(0xa4c4ff);
        rimLight.intensity = 1.48;
      }
    }
  }
  try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, 1, .01, 20);
  applyCamera();
  hemiLight = new THREE.HemisphereLight(0xfff5e8, 0x594f47, 0.72);
  scene.add(hemiLight);
  dirLight = new THREE.DirectionalLight(0xfff0dc, 1.92);
  dirLight.position.set(-1.1, 1.8, 1.35);
  scene.add(dirLight);
  rimLight = new THREE.DirectionalLight(0xa4c4ff, 1.48);
  rimLight.position.set(1.35, 1.0, -1.35);
  scene.add(rimLight);
  pet = new B1857Character({ asset });
  standardMaterials = pet.materials;
  outlineMesh = createOutlineMesh(pet);
  pet.group.add(outlineMesh);
  scene.add(createContactShadow());
  scene.add(pet.group, pet.helper);
  applyVisualStyle();
  springs = new SpringBoneSystem(pet);
  sparkles = new DanceSparkles(scene);
  behavior = new InteractionController();
  Object.assign(behavior.stats, initial.stats);
  props = new InteractionProps(scene, pet);
  reduced = matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = prefersReducedMotion();
  } catch (error) {
    try { dispose(); } catch { /* Preserve the initialization error after attempting every release. */ }
    throw error;
  }
  function prefersReducedMotion() { return reduced.matches || document.documentElement?.dataset?.dengtaReducedMotion === 'true'; }
  function snapshot() { settleStatic(); return { stats: { ...behavior.stats }, action: behavior.active.id }; }
  function notify() { onChange(snapshot()); }
  function draw() { renderer.render(scene, camera); }
  function resize() {
    if (disposed) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.PI / 10) * Math.max(1, 1 / camera.aspect)));
    camera.updateProjectionMatrix();
    draw();
  }
  function frame(now) {
    raf = 0;
    if (disposed || paused || document.hidden) return;
    const interval = quiet || reducedMotion ? 1000 / 15 : 1000 / 30;
    if (now - last < interval) { schedule(); return; }
    const dt = last ? Math.min(.1, (now - last) / 1000) : 0;
    last = now;
    behavior.update(dt);
    pet.setInteraction({ id: behavior.active.id, age: behavior.age, envelope: behavior.envelope });
    pet.update(dt);
    const dancing = behavior.active.id === 'dance';
    springs?.update(dt, { beatEnergy: dancing ? 0.95 : 0, swayX: dancing ? Math.sin(behavior.time * 4.4) * 0.65 : 0 });
    sparkles?.update(dt, dancing || behavior.active.id === 'pet');
    props.update(dt, behavior);
    // The upstream authoring history is diagnostic only; bound it for long visits.
    if (behavior.history.length > 32) behavior.history.splice(0, behavior.history.length - 32);
    draw();
    if (now - lastNotify > 1000) { lastNotify = now; notify(); }
    if (reducedMotion && behavior.time >= motionUntil) notify();
    schedule();
  }
  function schedule() {
    if (disposed || paused || document.hidden) return;
    if (!reducedMotion || behavior.time < motionUntil) { frozenAt = null; raf = requestAnimationFrame(frame); }
    else frozenAt = performance.now();
  }
  function settleStatic() {
    if (disposed || frozenAt === null) return;
    const now = performance.now(), elapsed = Math.max(0, now - frozenAt) / 1000;
    frozenAt = now;
    if (!visible || paused || !elapsed || !['idle', 'rest'].includes(behavior.active.id)) return;
    const time = behavior.time;
    behavior.update(elapsed);
    // The author's rest gain uses elapsed time; its animation clock clamps a tick to .1s.
    behavior.time = time + elapsed;
  }
  function resume() {
    settleStatic();
    visible = !document.hidden;
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    frozenAt = null;
    schedule();
  }
  function allowActionMotion() {
    const duration = ACTIONS[behavior.active.id].duration;
    motionUntil = behavior.time + (duration ? Math.max(0, duration - behavior.age) : .8) + .7;
  }
  function motionChanged() {
    if (disposed) return;
    const next = prefersReducedMotion();
    if (next === reducedMotion) return;
    settleStatic();
    reducedMotion = next;
    if (next && behavior.active.id !== 'idle') allowActionMotion();
    else motionUntil = behavior.time;
    if (!paused && !document.hidden) draw();
    resume();
  }
  function command(id) {
    if (disposed || paused) return { accepted: false, reason: '先继续陪伴，再和小棉花互动。' };
    settleStatic();
    const result = behavior.request(id);
    if (result.accepted) {
      pet.command(id);
      if (['pet', 'dance', 'greet', 'ball', 'nod'].includes(id)) springs?.impulse(id === 'dance' ? 1.4 : 0.75, 0.45, 0);
      allowActionMotion();
      notify();
      resume();
    }
    return result;
  }
  function lost(event) { event.preventDefault(); settleStatic(); paused = true; resume(); onError(); }
  try {
  observer = new ResizeObserver(resize);
  observer.observe(canvas);
  document.addEventListener('visibilitychange', resume);
  canvas.addEventListener('webglcontextlost', lost);
  if (reduced.addEventListener) reduced.addEventListener('change', motionChanged);
  else reduced.addListener?.(motionChanged);
  if (document.documentElement && typeof MutationObserver !== 'undefined') {
    motionObserver = new MutationObserver(motionChanged);
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dengta-reduced-motion'] });
  }
  if (quiet) command('rest');
  pet.setInteraction({ id: behavior.active.id, age: behavior.age, envelope: behavior.envelope });
  pet.update(0);
  props.update(0, behavior);
  notify(); resize(); resume();
  signal.throwIfAborted();
  } catch (error) {
    try { dispose(); } catch { /* Preserve the initialization error after attempting every release. */ }
    throw error;
  }
  return {
    command,
    snapshot,
    setPaused(value) {
      if (disposed) return;
      settleStatic();
      paused = value;
      if (!paused && pendingQuiet) { behavior.request(quiet ? 'rest' : 'wake', { force: true }); allowActionMotion(); pendingQuiet = false; notify(); }
      resume();
    },
    setQuiet(value) {
      if (disposed) return;
      settleStatic();
      quiet = value;
      pendingQuiet = paused;
      if (!paused) { behavior.request(value ? 'rest' : 'wake', { force: true }); allowActionMotion(); notify(); resume(); }
    },
    setGaze(nx, ny, active = true) {
      if (disposed || !pet) return;
      pet.setGaze(nx, ny, active);
    },
    setCameraOrbit(deltaYaw = 0, deltaPitch = 0, nextZoom = null) {
      if (disposed) return;
      orbitYaw += Number(deltaYaw) || 0;
      orbitPitch = THREE.MathUtils.clamp(orbitPitch + (Number(deltaPitch) || 0), -0.22, 0.62);
      if (nextZoom !== null && Number.isFinite(nextZoom)) cameraZoom = THREE.MathUtils.clamp(nextZoom, 0.65, 1.65);
      applyCamera();
      springs?.impulse((Number(deltaYaw) || 0) * 3.5, 0, 0);
      if (!paused && !document.hidden) draw();
    },
    resetCamera() {
      if (disposed) return;
      orbitYaw = 0.4; orbitPitch = 0.14; cameraZoom = 1;
      applyCamera();
      if (!paused && !document.hidden) draw();
    },
    setVisualStyle(patch = {}) {
      if (disposed) return;
      visualStyle = { ...visualStyle, ...patch };
      applyVisualStyle();
      if (!paused && !document.hidden) draw();
    },
    setExpression(name = 'auto') {
      if (disposed || !pet) return;
      pet.setExpression(name);
      if (!paused && !document.hidden) draw();
    },
    diagnostics() {
      return {
        character: pet?.diagnostics?.() || null,
        springs: springs?.diagnostics?.() || null,
        visualStyle: { ...visualStyle },
      };
    },
    dispose,
  };
}
