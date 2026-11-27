import * as THREE from 'three';
import { B1857Character } from './upstream/b1857-character.js';
import { ACTIONS, InteractionController } from './upstream/interaction-controller.js';
import { InteractionProps } from './upstream/interaction-props.js';
import { SpringBoneSystem } from './spring-bone-physics.js';
import {
  createContactShadow,
  createMToonGradientTexture,
  createMToonMaterials,
  createOutlineMesh,
  DanceSparkles,
  updateOutlineAppearance,
} from './mtoon-style.js';

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

function shortestAngleDelta(from, to) {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export async function createPetRuntime(canvas, { signal, initial, onChange, onError }) {
  const response = await fetch(`${import.meta.env.BASE_URL}cotton/b1857.json`, { signal });
  if (!response.ok) throw new Error('pet_asset_unavailable');
  const asset = await response.json();
  signal.throwIfAborted();
  validateAsset(asset);

  let renderer, scene, pet, contactShadow, observer, motionObserver, reduced;
  let hemiLight, dirLight, rimLight, springs, sparkles, outlineMesh, toonGradient, toonMaterials, standardMaterials;
  let disposed = false;
  let raf = 0;

  function dispose() {
    if (disposed) return;
    settleStatic();
    disposed = true;
    let cleanupError;
    const release = (cleanup) => { try { cleanup(); } catch (error) { cleanupError ||= error; } };
    release(() => cancelAnimationFrame(raf));
    release(() => observer?.disconnect());
    release(() => motionObserver?.disconnect());
    release(() => document.removeEventListener('visibilitychange', resume));
    release(() => canvas.removeEventListener('webglcontextlost', lost));
    release(() => reduced?.removeEventListener?.('change', motionChanged));
    release(() => reduced?.removeListener?.(motionChanged));
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    for (const root of [scene, pet?.group, pet?.helper]) {
      release(() => root?.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of [].concat(object.material || [])) if (material) materials.add(material);
      }));
    }
    for (const material of [...(standardMaterials || []), ...(toonMaterials || [])]) if (material) materials.add(material);
    if (toonGradient) textures.add(toonGradient);
    if (pet?.furColorMap) textures.add(pet.furColorMap);
    if (pet?.furBumpMap) textures.add(pet.furBumpMap);
    for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    geometries.forEach((geometry) => release(() => geometry.dispose()));
    textures.forEach((texture) => release(() => texture.dispose()));
    materials.forEach((material) => release(() => material.dispose()));
    release(() => pet?.skeleton.dispose());
    release(() => renderer?.dispose());
    release(() => renderer?.forceContextLoss());
    if (cleanupError) throw cleanupError;
  }

  let camera, behavior, props;
  let quiet = initial.quiet === true;
  let paused = false;
  let pendingQuiet = false;
  let visible = !document.hidden;
  let last = 0;
  let lastNotify = 0;
  let motionUntil = 0;
  let reducedMotion = false;
  let frozenAt = null;
  let orbitYaw = 0.24;
  let orbitPitch = 0.2;
  let cameraZoom = 1;
  let visualStyle = { toon: true, outline: true, night: false, bigHead: false, skeleton: false };

  // Live gyroscope & autonomous ball-chase locomotion state
  const gyroTilt = { x: 0, z: 0 };
  const petPos = { x: 0, z: 0, vx: 0, vz: 0, heading: 0 };
  let lastBatAt = 0;
  const raycaster = new THREE.Raycaster();
  const ndcVec = new THREE.Vector2();
  const ballDragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.09);
  const hitPoint = new THREE.Vector3();
  const prevBallDragPoint = new THREE.Vector3();
  let lastBallDragTime = 0;
  const ballThrowVel = { x: 0, y: 0, z: 0 };
  const cameraTarget = new THREE.Vector3(0, 0.23, 0.04);

  function applyCamera() {
    if (!camera) return;
    const radius = 1.56 / THREE.MathUtils.clamp(cameraZoom, 0.65, 1.65);
    const pitch = THREE.MathUtils.clamp(orbitPitch, -0.18, 0.68);
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
      if (!toonMaterials) toonMaterials = createMToonMaterials(toonGradient, { furMap: pet.furColorMap });
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
      renderer.toneMappingExposure = visualStyle.night ? 0.92 : visualStyle.toon ? 0.94 : 0.9;
    }
    if (hemiLight && dirLight && rimLight) {
      if (visualStyle.night) {
        hemiLight.color.setHex(0x9cb4ff);
        hemiLight.groundColor.setHex(0x221d38);
        hemiLight.intensity = visualStyle.toon ? 0.42 : 0.7;
        dirLight.color.setHex(0xffc992);
        dirLight.intensity = 1.72;
        rimLight.color.setHex(0x9ab6ff);
        rimLight.intensity = 2.2;
      } else if (visualStyle.toon) {
        hemiLight.color.setHex(0xfff1e6);
        hemiLight.groundColor.setHex(0x6e5552);
        hemiLight.intensity = 0.48;
        dirLight.color.setHex(0xfff4e4);
        dirLight.intensity = 1.68;
        rimLight.color.setHex(0xffd7b8);
        rimLight.intensity = 0.85;
      } else {
        hemiLight.color.setHex(0xfff5e8);
        hemiLight.groundColor.setHex(0x635046);
        hemiLight.intensity = 0.78;
        dirLight.color.setHex(0xfff0dc);
        dirLight.intensity = 1.92;
        rimLight.color.setHex(0xb4d0ff);
        rimLight.intensity = 1.48;
      }
    }
  }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 0.01, 20);
    applyCamera();
    hemiLight = new THREE.HemisphereLight(0xfff1e6, 0x6e5552, 0.48);
    scene.add(hemiLight);
    dirLight = new THREE.DirectionalLight(0xfff4e4, 1.68);
    dirLight.position.set(-1.1, 1.8, 1.35);
    scene.add(dirLight);
    rimLight = new THREE.DirectionalLight(0xffd7b8, 0.85);
    rimLight.position.set(1.35, 1.0, -1.35);
    scene.add(rimLight);

    pet = new B1857Character({ asset });
    standardMaterials = pet.materials;
    outlineMesh = createOutlineMesh(pet);
    pet.group.add(outlineMesh);
    contactShadow = createContactShadow();
    scene.add(contactShadow);
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
    try { dispose(); } catch { /* Preserve initialization error. */ }
    throw error;
  }

  function prefersReducedMotion() {
    return reduced.matches || document.documentElement?.dataset?.dengtaReducedMotion === 'true';
  }
  function snapshot() { settleStatic(); return { stats: { ...behavior.stats }, action: behavior.active.id }; }
  function notify() { onChange(snapshot()); }
  function draw() { renderer.render(scene, camera); }

  function resize() {
    if (disposed) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.PI / 9.5) * Math.max(1, 1 / camera.aspect)));
    camera.updateProjectionMatrix();
    draw();
  }

  function updateAutonomousLocomotion(dt) {
    if (!pet || !props || quiet || reducedMotion) return;
    const actionId = behavior.active.id;
    const ball = props.ballPhysics;
    const ballSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
    const dxBall = ball.position.x - petPos.x;
    const dzBall = ball.position.z - petPos.z;
    const distBall = Math.hypot(dxBall, dzBall);
    const tiltMag = Math.hypot(gyroTilt.x, gyroTilt.z);

    // Pause roaming while eating/drinking/grooming/resting/being held
    const busyStationary = ['feed', 'drink', 'brush', 'rest'].includes(actionId) || pet.bodyDrag.active;

    let targetVx = 0;
    let targetVz = 0;
    let targetHeading = petPos.heading;

    if (!busyStationary) {
      if (ball.held) {
        // Eagerly watch & face the ball held in the user's hand!
        targetHeading = Math.atan2(dxBall, dzBall);
        pet.setGaze(THREE.MathUtils.clamp(dxBall * 2.2, -1, 1), THREE.MathUtils.clamp((0.25 - ball.position.y) * 2, -1, 1), true);
      } else if ((ballSpeed > 0.12 || actionId === 'ball') && distBall > 0.15) {
        // Sprint happily after the rolling/thrown ball!
        const chaseSpeed = Math.min(0.58, 0.24 + ballSpeed * 0.45);
        targetVx = (dxBall / distBall) * chaseSpeed;
        targetVz = (dzBall / distBall) * chaseSpeed;
        targetHeading = Math.atan2(dxBall, dzBall);
        pet.setGaze(THREE.MathUtils.clamp(dxBall * 1.6, -1, 1), 0.25, true);
      } else if (tiltMag > 0.08) {
        // Gyroscope tilt: Cotton trots playfully toward the downhill slope!
        const runSpeed = Math.min(0.54, tiltMag * 0.62);
        targetVx = (gyroTilt.x / tiltMag) * runSpeed;
        targetVz = (gyroTilt.z / tiltMag) * runSpeed;
        targetHeading = Math.atan2(targetVx, targetVz);
      } else if (Math.hypot(petPos.x, petPos.z) > 0.14 && actionId === 'idle') {
        // Gently meander back toward cozy center when phone is level
        const dHome = Math.hypot(petPos.x, petPos.z);
        targetVx = (-petPos.x / dHome) * 0.14;
        targetVz = (-petPos.z / dHome) * 0.14;
        targetHeading = Math.atan2(targetVx, targetVz);
      } else if (actionId === 'idle') {
        // Face slightly toward viewer when resting near center
        targetHeading = 0;
      }

      // If Cotton catches a moving ball, joyfully bat/bounce it back!
      const nowMs = performance.now();
      if (!ball.held && ballSpeed > 0.14 && distBall < 0.17 && nowMs - lastBatAt > 900) {
        lastBatAt = nowMs;
        const kickDirX = -ball.velocity.x * 0.85 + (Math.random() - 0.5) * 0.55;
        const kickDirZ = -ball.velocity.z * 0.85 + 0.35;
        ball.impulse(kickDirX, 0.72 + Math.random() * 0.3, kickDirZ);
        springs?.impulse(0.95, 0.65, 0);
      }
    }

    const blend = 1 - Math.exp(-7 * dt);
    petPos.vx += (targetVx - petPos.vx) * blend;
    petPos.vz += (targetVz - petPos.vz) * blend;
    petPos.x = THREE.MathUtils.clamp(petPos.x + petPos.vx * dt, -0.36, 0.36);
    petPos.z = THREE.MathUtils.clamp(petPos.z + petPos.vz * dt, -0.22, 0.3);

    const turnDelta = shortestAngleDelta(petPos.heading, targetHeading);
    petPos.heading += turnDelta * (1 - Math.exp(-7.5 * dt));

    const speed = Math.hypot(petPos.vx, petPos.vz);
    pet.setLocomotion({
      x: petPos.x,
      z: petPos.z,
      heading: petPos.heading,
      speed,
      leanX: THREE.MathUtils.clamp(turnDelta * 0.4 + gyroTilt.x * 0.15, -0.35, 0.35),
      leanZ: THREE.MathUtils.clamp(speed * 0.15, -0.2, 0.25),
    });

    if (contactShadow) {
      contactShadow.position.x = petPos.x;
      contactShadow.position.z = petPos.z + 0.015;
      const liftShrink = Math.max(0.55, 1 - (pet.bodyDrag.lift || 0) * 0.35);
      contactShadow.scale.setScalar(liftShrink);
    }
  }

  function frame(now) {
    raf = 0;
    if (disposed || paused || document.hidden) return;
    const interval = quiet || reducedMotion ? 1000 / 20 : 1000 / 60;
    if (now - last < interval) { schedule(); return; }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;

    behavior.update(dt);
    updateAutonomousLocomotion(dt);
    pet.setInteraction({ id: behavior.active.id, age: behavior.age, envelope: behavior.envelope });
    pet.update(dt);

    const actionId = behavior.active.id;
    const dancing = actionId === 'dance';
    const running = pet.locomotion.speed > 0.08;
    springs?.update(dt, {
      beatEnergy: dancing ? 0.95 : running ? Math.min(0.85, pet.locomotion.speed * 1.8) : 0,
      swayX: dancing ? Math.sin(behavior.time * 5.2) * 0.72 : pet.locomotion.leanX * 1.4,
    });

    const particleTheme =
      actionId === 'pet' ? 'hearts'
      : actionId === 'feed' ? 'crumbs'
      : actionId === 'drink' ? 'water'
      : actionId === 'brush' ? 'fluff'
      : 'sparkle';
    const particleActive = ['dance', 'pet', 'feed', 'drink', 'brush', 'ball'].includes(actionId) ||
      Math.hypot(props.ballPhysics.velocity.x, props.ballPhysics.velocity.z) > 0.45;
    sparkles?.update(dt, particleActive, {
      theme: particleTheme,
      originX: petPos.x,
      originZ: petPos.z,
    });

    props.update(dt, behavior);
    if (behavior.history.length > 32) behavior.history.splice(0, behavior.history.length - 32);
    draw();
    if (now - lastNotify > 1000) { lastNotify = now; notify(); }
    if (reducedMotion && behavior.time >= motionUntil) notify();
    schedule();
  }

  function schedule() {
    if (disposed || paused || document.hidden) return;
    if (!reducedMotion || behavior.time < motionUntil) {
      frozenAt = null;
      raf = requestAnimationFrame(frame);
    } else {
      frozenAt = performance.now();
    }
  }

  function settleStatic() {
    if (disposed || frozenAt === null) return;
    const now = performance.now();
    const elapsed = Math.max(0, now - frozenAt) / 1000;
    frozenAt = now;
    if (!visible || paused || !elapsed || !['idle', 'rest'].includes(behavior.active.id)) return;
    const time = behavior.time;
    behavior.update(elapsed);
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
    motionUntil = behavior.time + (duration ? Math.max(0, duration - behavior.age) : 0.8) + 0.7;
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
      if (['pet', 'dance', 'greet', 'ball', 'nod', 'feed', 'drink'].includes(id)) {
        springs?.impulse(id === 'dance' ? 1.4 : 0.82, 0.5, 0);
      }
      allowActionMotion();
      notify();
      resume();
    }
    return result;
  }

  function lost(event) {
    event.preventDefault();
    settleStatic();
    paused = true;
    resume();
    onError();
  }

  // Interactive 3D hit testing for ball grab/throw & body-part drag!
  function pickTarget(nx, ny) {
    if (disposed || !camera || !props || !pet) return { hit: 'background' };
    ndcVec.set(THREE.MathUtils.clamp(nx, -1, 1), THREE.MathUtils.clamp(-ny, -1, 1));
    raycaster.setFromCamera(ndcVec, camera);

    // 1. Generous thumb hit test on the 3D toy ball
    const ballCenter = props.ball.position;
    const distToRay = raycaster.ray.distanceToPoint(ballCenter);
    if (distToRay <= props.ballPhysics.radius * 2.15) {
      return { hit: 'ball' };
    }

    // 2. Hit test Cotton's body & classify head / body / paw zone
    const hits = raycaster.intersectObject(pet.mesh, false);
    if (hits.length > 0) {
      const localY = hits[0].point.y - pet.group.position.y;
      const zone = localY >= 0.31 ? 'head' : localY <= 0.13 ? 'paw' : 'body';
      return { hit: 'pet', zone };
    }
    return { hit: 'background' };
  }

  function grabBall(nx, ny) {
    if (disposed || !props || !camera) return false;
    ndcVec.set(THREE.MathUtils.clamp(nx, -1, 1), THREE.MathUtils.clamp(-ny, -1, 1));
    raycaster.setFromCamera(ndcVec, camera);
    props.ballPhysics.held = true;
    props.ballPhysics.velocity = { x: 0, y: 0, z: 0 };
    if (raycaster.ray.intersectPlane(ballDragPlane, hitPoint)) {
      props.ballPhysics.position.x = THREE.MathUtils.clamp(hitPoint.x, -0.5, 0.5);
      props.ballPhysics.position.y = 0.14;
      props.ballPhysics.position.z = THREE.MathUtils.clamp(hitPoint.z, -0.26, 0.54);
      prevBallDragPoint.set(props.ballPhysics.position.x, props.ballPhysics.position.y, props.ballPhysics.position.z);
    }
    lastBallDragTime = performance.now();
    ballThrowVel.x = 0;
    ballThrowVel.y = 0;
    ballThrowVel.z = 0;
    resume();
    return true;
  }

  function dragBall(nx, ny) {
    if (disposed || !props || !props.ballPhysics.held || !camera) return;
    ndcVec.set(THREE.MathUtils.clamp(nx, -1, 1), THREE.MathUtils.clamp(-ny, -1, 1));
    raycaster.setFromCamera(ndcVec, camera);
    if (raycaster.ray.intersectPlane(ballDragPlane, hitPoint)) {
      const nextX = THREE.MathUtils.clamp(hitPoint.x, -0.52, 0.52);
      const nextZ = THREE.MathUtils.clamp(hitPoint.z, -0.28, 0.56);
      const nextY = THREE.MathUtils.clamp(0.11 + (0.2 - ny) * 0.18, 0.06, 0.34);
      const now = performance.now();
      const dtSec = Math.max(0.008, (now - lastBallDragTime) / 1000);
      lastBallDragTime = now;
      const instVx = (nextX - prevBallDragPoint.x) / dtSec;
      const instVy = (nextY - prevBallDragPoint.y) / dtSec;
      const instVz = (nextZ - prevBallDragPoint.z) / dtSec;
      ballThrowVel.x = ballThrowVel.x * 0.45 + instVx * 0.55;
      ballThrowVel.y = ballThrowVel.y * 0.45 + instVy * 0.55;
      ballThrowVel.z = ballThrowVel.z * 0.45 + instVz * 0.55;
      props.ballPhysics.position.x = nextX;
      props.ballPhysics.position.y = nextY;
      props.ballPhysics.position.z = nextZ;
      prevBallDragPoint.set(nextX, nextY, nextZ);
    }
  }

  function releaseBall() {
    if (disposed || !props || !props.ballPhysics.held) return;
    props.ballPhysics.held = false;
    const speed = Math.hypot(ballThrowVel.x, ballThrowVel.z);
    const boostY = Math.max(0.45, Math.min(1.65, 0.45 + speed * 0.38 + Math.max(0, ballThrowVel.y * 0.6)));
    props.ballPhysics.impulse(ballThrowVel.x * 1.15, boostY, ballThrowVel.z * 1.15);
    springs?.impulse(THREE.MathUtils.clamp(ballThrowVel.x * 0.6, -1.2, 1.2), 0.45, 0);
    resume();
  }

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
    notify();
    resize();
    resume();
    signal.throwIfAborted();
  } catch (error) {
    try { dispose(); } catch { /* Preserve initialization error. */ }
    throw error;
  }

  return {
    command,
    snapshot,
    pickTarget,
    grabBall,
    dragBall,
    releaseBall,
    setBodyDrag(params = {}) {
      if (disposed || !pet) return;
      pet.setBodyDrag(params);
      if (params.active) {
        springs?.impulse(-(Number(params.vx) || 0) * 0.9, (Number(params.vy) || 0) * 0.65, 0);
      } else {
        springs?.impulse(0, -1.1, 0);
      }
      resume();
    },
    setGyroTilt(x = 0, z = 0) {
      if (disposed) return;
      gyroTilt.x = THREE.MathUtils.clamp(Number(x) || 0, -1, 1);
      gyroTilt.z = THREE.MathUtils.clamp(Number(z) || 0, -1, 1);
      props?.ballPhysics?.setTiltGravity(gyroTilt.x * 2.4, gyroTilt.z * 2.4);
      if (Math.hypot(gyroTilt.x, gyroTilt.z) > 0.08) resume();
    },
    applyShake({ x = 0, y = 1, z = 0 } = {}) {
      if (disposed) return;
      props?.ballPhysics?.impulse(x * 1.4, Math.max(0.75, y * 1.1), z * 1.4);
      springs?.impulse(x * 1.6, y * 1.1, z);
      pet?.setBodyDrag({ active: false });
      resume();
    },
    setPaused(value) {
      if (disposed) return;
      settleStatic();
      paused = value;
      if (!paused && pendingQuiet) {
        behavior.request(quiet ? 'rest' : 'wake', { force: true });
        allowActionMotion();
        pendingQuiet = false;
        notify();
      }
      resume();
    },
    setQuiet(value) {
      if (disposed) return;
      settleStatic();
      quiet = value;
      pendingQuiet = paused;
      if (!paused) {
        behavior.request(value ? 'rest' : 'wake', { force: true });
        allowActionMotion();
        notify();
        resume();
      }
    },
    setGaze(nx, ny, active = true) {
      if (disposed || !pet) return;
      pet.setGaze(nx, ny, active);
    },
    setCameraOrbit(deltaYaw = 0, deltaPitch = 0, nextZoom = null) {
      if (disposed) return;
      orbitYaw += Number(deltaYaw) || 0;
      orbitPitch = THREE.MathUtils.clamp(orbitPitch + (Number(deltaPitch) || 0), -0.18, 0.68);
      if (nextZoom !== null && Number.isFinite(nextZoom)) cameraZoom = THREE.MathUtils.clamp(nextZoom, 0.65, 1.65);
      applyCamera();
      springs?.impulse((Number(deltaYaw) || 0) * 3.5, 0, 0);
      if (!paused && !document.hidden) draw();
    },
    resetCamera() {
      if (disposed) return;
      orbitYaw = 0.24;
      orbitPitch = 0.2;
      cameraZoom = 1;
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
    dispose,
  };
}
