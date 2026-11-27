import * as THREE from 'three';
import { buildCottonMorphTargets, computeExpressionWeights, EXPRESSION_NAMES } from '../expressions.js';

const smooth = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (10 + x * (-15 + 6 * x));
};

/**
 * Generate a warm painterly cartoon Pomeranian fur brush-stroke texture + bump map.
 * Works cleanly in browser/WebView and safely returns null in headless Node unit tests.
 */
function createCartoonFurMaps() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return { colorMap: null, bumpMap: null };
  }
  try {
    const size = 256;
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = size;
    colorCanvas.height = size;
    const cctx = colorCanvas.getContext('2d');
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bctx = bumpCanvas.getContext('2d');
    if (!cctx || !bctx) return { colorMap: null, bumpMap: null };

    // Neutral-warm painterly base so vertex coat colors stay luminous and rich
    cctx.fillStyle = '#fffaf3';
    cctx.fillRect(0, 0, size, size);
    bctx.fillStyle = '#808080';
    bctx.fillRect(0, 0, size, size);

    // Deterministic soft fluffy fur tuft brush strokes
    let seed = 48271;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < 1600; i += 1) {
      const x = rand() * size;
      const y = rand() * size;
      const len = 8 + rand() * 14;
      const w = 1.6 + rand() * 2.2;
      const angle = (rand() - 0.5) * 0.45 + Math.PI * 0.5;
      const bright = rand() > 0.48;

      cctx.save();
      cctx.translate(x, y);
      cctx.rotate(angle);
      cctx.fillStyle = bright ? 'rgba(255, 253, 248, 0.42)' : 'rgba(226, 186, 146, 0.24)';
      cctx.beginPath();
      cctx.ellipse(0, 0, len * 0.5, w * 0.5, 0, 0, Math.PI * 2);
      cctx.fill();
      cctx.restore();

      bctx.save();
      bctx.translate(x, y);
      bctx.rotate(angle);
      bctx.fillStyle = bright ? 'rgba(218, 218, 218, 0.35)' : 'rgba(92, 92, 92, 0.28)';
      bctx.beginPath();
      bctx.ellipse(0, 0, len * 0.5, w * 0.5, 0, 0, Math.PI * 2);
      bctx.fill();
      bctx.restore();
    }

    const colorMap = new THREE.CanvasTexture(colorCanvas);
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.repeat.set(3, 3);
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.needsUpdate = true;

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(3, 3);
    bumpMap.needsUpdate = true;

    return { colorMap, bumpMap };
  } catch {
    return { colorMap: null, bumpMap: null };
  }
}

export class B1857Character {
  constructor({ asset } = {}) {
    const data = asset;
    this.group = new THREE.Group();
    this.group.name = 'B1857_Seated_Study';
    this.named = {};
    this.bones = [];
    this.rest = {};
    this.time = 0;
    this.mode = 'idle';
    this.started = 0;
    this.look = { yaw: 0, pitch: 0, roll: 0 };
    this.velocity = { yaw: 0, pitch: 0, roll: 0 };
    this.nextLook = 2.6;
    this.idleTarget = { yaw: 0.08, pitch: 0, roll: 0.02 };
    this.rng = 7381;

    for (const item of data.bones) {
      const b = new THREE.Bone();
      b.name = item.name;
      this.rest[item.name] = new THREE.Vector3(...item.head);
      this.named[item.name] = b;
      this.bones.push(b);
      if (item.parent) {
        this.named[item.parent].add(b);
        b.position.copy(this.rest[item.name]).sub(this.rest[item.parent]);
      } else {
        this.group.add(b);
        b.position.copy(this.rest[item.name]);
      }
    }
    this.group.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(data.skinIndices, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(data.skinWeights, 4));
    g.setIndex(data.indices);

    // Rich cartoon cream-apricot Pomeranian coat markings (goodbye blank white sculpt!)
    const colors = [];
    const uvs = [];
    const zones = [];
    const creamBase = new THREE.Color(0xfff8ee);
    const honeyCoat = new THREE.Color(0xf2c593);
    const biscuitCoat = new THREE.Color(0xe6a66c);
    const shadeColor = new THREE.Color(0xc89a78);
    const earTipColor = new THREE.Color(0xdc8c58);
    const innerEarColor = new THREE.Color(0xf49ba2);
    const cheekColor = new THREE.Color(0xff8e98);
    const pawPadColor = new THREE.Color(0xeea1a3);
    const mouthColor = new THREE.Color(0x6d423a);
    const browSpotColor = new THREE.Color(0xfffdf8);

    for (let i = 0; i < data.positions.length; i += 3) {
      const x = data.positions[i];
      const y = data.positions[i + 1];
      const z = data.positions[i + 2];
      const ny = data.normals[i + 1] || 0;
      const nz = data.normals[i + 2] || 0;

      // Cylindrical/spherical UV mapping for painterly fur brush texture
      const u = Math.atan2(x, z) / (Math.PI * 2) + 0.5;
      const v = THREE.MathUtils.clamp(y / 0.5, 0, 1);
      uvs.push(u, v);

      const c = creamBase.clone();
      let zone = 0;

      // Warm Pomeranian cream-honey dorsal coat (crown, back, outer ears, curled tail)
      // while keeping chest ruff, muzzle, tummy & cute socks snowy cream!
      const isFrontBib = z > 0.08 && Math.abs(x) < 0.09 && y > 0.12 && y < 0.36;
      const isMuzzle = z > 0.16 && Math.abs(x) < 0.055 && y > 0.31 && y < 0.38;
      const isPawSock = y < 0.085 && z > 0.04;
      const backCoatFactor =
        THREE.MathUtils.clamp((y - 0.12) * 1.9, 0, 1) *
        THREE.MathUtils.clamp(0.75 - z * 2.2, 0.2, 1);
      const crownFactor =
        y > 0.36 ? THREE.MathUtils.clamp((y - 0.36) * 5.2, 0, 1) : 0;
      const sideFluffFactor = THREE.MathUtils.clamp((Math.abs(x) - 0.045) * 4.5, 0, 0.85);
      let coatBlend = Math.max(backCoatFactor * 0.82, crownFactor * 0.78, sideFluffFactor * 0.62);
      if (isFrontBib) coatBlend *= 0.22;
      if (isMuzzle) coatBlend *= 0.15;
      if (isPawSock) coatBlend *= 0.18;
      c.lerp(honeyCoat, THREE.MathUtils.clamp(coatBlend, 0, 0.82));

      // Warm biscuit saddle & fluffy tail richness
      if (z < -0.04 && y > 0.14) {
        const tailRich = THREE.MathUtils.clamp((-z - 0.04) * 3.8, 0, 0.72);
        c.lerp(biscuitCoat, tailRich * 0.55);
      }

      // Sculptural ambient occlusion under chin, neck ruff crease, paw bases & underside
      const under = Math.max(0, Math.min(1, -ny * 0.54 + Math.max(0, 0.22 - y) * 1.18));
      const neckCrease = y > 0.2 && y < 0.33 && z > 0.06 ? Math.max(0, Math.min(1, (0.25 - ny) * 0.58)) : 0;
      const pawBase = y < 0.09 ? Math.max(0, Math.min(1, (0.09 - y) / 0.09)) * 0.32 : 0;
      const furShade = Math.min(0.46, under * 0.28 + neckCrease * 0.24 + pawBase + (nz < -0.25 ? (-nz - 0.25) * 0.15 : 0));
      if (furShade > 0.01) c.lerp(shadeColor, furShade);

      // Cute anime white eyebrow beans above eyes
      const brow = ((Math.abs(x) - 0.036) / 0.012) ** 2 + ((y - 0.405) / 0.0085) ** 2;
      if (z > 0.185 && brow < 1) {
        c.lerp(browSpotColor, (1 - brow) * 0.85);
      }

      // Warm apricot-toast ear tips & rosy inner ears
      if (Math.abs(x) > 0.052 && y > 0.405) {
        c.lerp(earTipColor, Math.min(0.62, (y - 0.405) * 4.5));
      }
      const ear = ((Math.abs(x) - 0.083) / 0.018) ** 2 + ((y - 0.466) / 0.022) ** 2;
      if (z > 0.105 && ear < 0.78) {
        c.lerp(innerEarColor, (1 - ear / 0.78) * 0.74);
      }

      // Rosy cartoon cheek blushes
      const cheek = ((Math.abs(x) - 0.062) / 0.03) ** 2 + ((y - 0.354) / 0.02) ** 2;
      if (z > 0.17 && cheek < 1) {
        c.lerp(cheekColor, (1 - cheek) * 0.44);
      }

      // Soft pink paw pads underneath paws
      if (y < 0.028 && ny < -0.35) {
        c.lerp(pawPadColor, 0.48);
      }

      // Defined happy puppy smile line
      const mouth = (x / 0.02) ** 2 + ((y - 0.343) / 0.0072) ** 2;
      if (z > 0.23 && mouth < 1) {
        c.lerp(mouthColor, (1 - mouth) * 0.65);
      }

      // Glossy dark puppy button eyes
      const eye = ((Math.abs(x) - 0.039) / 0.012) ** 2 + ((y - 0.383) / 0.012) ** 2;
      if (z > 0.192 && eye < 1) {
        c.setHex(eye < 0.3 ? 0x0b0706 : eye < 0.78 ? 0x382014 : 0x1b110d);
        zone = 1;
      }

      // Cute glossy cocoa-button nose
      const nose = (x / 0.0138) ** 2 + ((y - 0.3605) / 0.0075) ** 2;
      if (z > 0.25 && nose < 1.12) {
        c.setHex(0x4b2d26);
        zone = 2;
      }

      colors.push(c.r, c.g, c.b);
      zones.push(zone);
    }

    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.clearGroups();
    const buckets = [[], [], []];
    for (let i = 0; i < data.indices.length; i += 3) {
      const z = zones[data.indices[i]] === zones[data.indices[i + 1]] && zones[data.indices[i]] === zones[data.indices[i + 2]]
        ? zones[data.indices[i]]
        : 0;
      buckets[z].push(data.indices[i], data.indices[i + 1], data.indices[i + 2]);
    }
    let start = 0;
    for (let i = 0; i < 3; i += 1) {
      g.addGroup(start, buckets[i].length, i);
      start += buckets[i].length;
    }
    g.setIndex(buckets.flat());

    const { colorMap, bumpMap } = createCartoonFurMaps();
    this.furColorMap = colorMap;
    this.furBumpMap = bumpMap;
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      ...(colorMap ? { map: colorMap } : {}),
      ...(bumpMap ? { bumpMap, bumpScale: 0.0045 } : {}),
      roughness: 0.84,
      metalness: 0,
    });
    this.materials = [
      this.material,
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.08,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.24,
        metalness: 0.05,
      }),
    ];

    this.mesh = new THREE.SkinnedMesh(g, this.materials);
    this.mesh.name = 'Purchased_Pomeranian_Sculpt';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.mesh.bind(this.skeleton);
    this.mesh.normalizeSkinWeights();

    g.morphAttributes.position = buildCottonMorphTargets(data.positions);
    this.mesh.updateMorphTargets();

    // Sparkling white anime eye catchlights mounted on head bone
    const headRest = this.rest.head;
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const sparkGeo = new THREE.SphereGeometry(0.0034, 10, 8);
    this.eyeSparks = [];
    for (const side of [-1, 1]) {
      const spark = new THREE.Mesh(sparkGeo, sparkMat);
      spark.position.set(side * 0.0365 + 0.003, 0.3865 - headRest.y, 0.222 - headRest.z);
      spark.name = side < 0 ? 'Eye_Spark_L' : 'Eye_Spark_R';
      this.named.head.add(spark);
      this.eyeSparks.push(spark);
    }

    // Lively pink puppy tongue
    this.tongue = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 10),
      new THREE.MeshStandardMaterial({ color: 0xf08592, roughness: 0.42 }),
    );
    this.tongue.name = 'Pet_tongue';
    this.named.head.add(this.tongue);
    this.tongue.visible = false;

    this.channels = { liftL: 0, liftR: 0, close: 0, lick: 0, excite: 0.32 };
    this.interaction = null;
    this.nextBlink = 2.4;
    this.blinkAt = -Infinity;
    this.blinkDuration = 0.2;
    this.blink = 0;
    this.gaze = { yaw: 0, pitch: 0, active: false };
    this.bigHead = false;
    this.headScaleCurrent = 1;
    this.manualExpression = 'auto';
    this.expressionWeights = { Blink: 0, Happy: 0, Surprised: 0, Sleepy: 0, Excited: 0 };

    // Full-body locomotion (gyroscope + ball chase) & interactive body-part drag physics
    this.locomotion = { x: 0, z: 0, heading: 0, speed: 0, leanX: 0, leanZ: 0, stride: 0 };
    this.bodyDrag = {
      active: false,
      zone: 'body',
      vx: 0,
      vy: 0,
      swingX: 0,
      swingZ: 0,
      velSwingX: 0,
      velSwingZ: 0,
      lift: 0,
      landBounce: 0,
    };

    this.helper = new THREE.SkeletonHelper(this.group);
    this.helper.material.depthTest = false;
    this.helper.renderOrder = 5;
    this.helper.visible = false;
    this.accumulator = 0;
    this.updatePose();
  }

  random() {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  command(mode) {
    this.mode = mode;
    this.started = this.time;
  }

  setInteraction(frame) {
    this.interaction = frame;
  }

  setGaze(nx, ny, active = true) {
    this.gaze = {
      yaw: THREE.MathUtils.clamp(Number(nx) || 0, -1, 1) * 0.38,
      pitch: THREE.MathUtils.clamp(Number(ny) || 0, -1, 1) * 0.22,
      active: Boolean(active),
    };
  }

  setBigHead(enabled) {
    this.bigHead = Boolean(enabled);
  }

  setExpression(name) {
    this.manualExpression = name || 'auto';
  }

  setLocomotion(patch = {}) {
    if (Number.isFinite(patch.x)) this.locomotion.x = patch.x;
    if (Number.isFinite(patch.z)) this.locomotion.z = patch.z;
    if (Number.isFinite(patch.heading)) this.locomotion.heading = patch.heading;
    if (Number.isFinite(patch.speed)) this.locomotion.speed = Math.max(0, patch.speed);
    if (Number.isFinite(patch.leanX)) this.locomotion.leanX = THREE.MathUtils.clamp(patch.leanX, -0.45, 0.45);
    if (Number.isFinite(patch.leanZ)) this.locomotion.leanZ = THREE.MathUtils.clamp(patch.leanZ, -0.45, 0.45);
  }

  setBodyDrag({ active = false, zone = 'body', vx = 0, vy = 0 } = {}) {
    const wasActive = this.bodyDrag.active;
    this.bodyDrag.active = Boolean(active);
    this.bodyDrag.zone = zone || 'body';
    this.bodyDrag.vx = THREE.MathUtils.clamp(Number(vx) || 0, -3.5, 3.5);
    this.bodyDrag.vy = THREE.MathUtils.clamp(Number(vy) || 0, -3.5, 3.5);
    if (wasActive && !this.bodyDrag.active) {
      // Trigger joyful squash-and-stretch landing bounce on release!
      this.bodyDrag.landBounce = 1;
    }
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) return;
    this.accumulator += Math.min(0.1, dt);
    while (this.accumulator >= 1 / 120) {
      this.tick(1 / 120);
      this.accumulator -= 1 / 120;
    }
    this.updatePose();
  }

  tick(dt) {
    this.time += dt;
    const elapsed = this.time - this.started;

    if (this.time >= this.nextBlink) {
      this.blinkAt = this.time;
      this.blinkDuration = 0.16 + this.random() * 0.08;
      this.nextBlink = this.time + 2.6 + this.random() * 4.4;
    }
    const blinkAge = this.time - this.blinkAt;
    this.blink = blinkAge < this.blinkDuration ? Math.sin((blinkAge / this.blinkDuration) * Math.PI) ** 2 : 0;

    if (!this.interaction && this.mode !== 'idle' && elapsed > 5.5) {
      this.mode = 'idle';
      this.started = this.time;
    }
    if (this.time > this.nextLook) {
      this.nextLook = this.time + 2.4 + this.random() * 3.4;
      this.idleTarget = {
        yaw: (this.random() - 0.5) * 0.24,
        pitch: (this.random() - 0.5) * 0.08,
        roll: (this.random() - 0.5) * 0.08,
      };
    }

    const target = { ...this.idleTarget };
    if (this.mode === 'left') { target.yaw = -0.34; target.roll = -0.05; }
    if (this.mode === 'right') { target.yaw = 0.34; target.roll = 0.05; }
    if (this.mode === 'greet') { target.yaw = 0.06 * Math.sin(elapsed * 3.2); target.pitch = -0.09; target.roll = 0.13 * smooth(elapsed / 0.5); }
    if (this.mode === 'paw') { target.yaw = 0.09; target.pitch = 0.04; target.roll = -0.07; }

    const f = this.interaction;
    const age = f?.age ?? elapsed;
    const env = f?.envelope ?? 1;
    if (f) {
      this.mode = f.id;
      if (f.look) Object.assign(target, f.look);
    }

    if (['pet', 'brush'].includes(this.mode)) {
      target.pitch = (0.06 + Math.sin(age * 4.2) * 0.045) * env;
      target.roll = Math.sin(age * 3.1) * 0.095 * env;
    }
    if (this.mode === 'feed') {
      // Lean eagerly down toward the food bowl & munch!
      const munch = age > 0.65 && age < 4.9 ? Math.sin(age * 16) * 0.075 : 0;
      target.yaw = Math.sin(age * 3.2) * 0.05 * env;
      target.pitch = (0.31 + munch) * env;
      target.roll = Math.sin(age * 5.4) * 0.04 * env;
    }
    if (this.mode === 'drink') {
      // Dip snout to the water bowl & lap rhythmically, then cute shake at end
      const lapping = age > 0.65 && age < 4.5 ? Math.sin(age * 13) * 0.055 : 0;
      const shake = age >= 4.5 && age < 5.4 ? Math.sin((age - 4.5) * 32) * 0.24 : 0;
      target.yaw = shake;
      target.pitch = (age < 4.5 ? 0.34 + lapping : -0.06) * env;
      target.roll = shake * 0.85;
    }
    if (this.mode === 'rest') { target.pitch = 0.16 * env; target.roll = 0.06 * env; target.yaw = 0; }
    if (this.mode === 'wake') { target.pitch = -0.09 * env; target.roll = Math.sin(age * 6) * 0.08 * env; }
    if (this.mode === 'pawRight') { target.yaw = -0.09; target.pitch = 0.04; target.roll = 0.07; }
    if (this.mode === 'dance') {
      target.yaw = Math.sin(age * 5.2) * 0.3 * env;
      target.pitch = Math.sin(age * 10.4) * 0.1 * env;
      target.roll = Math.cos(age * 5.2) * 0.18 * env;
    }
    if (this.mode === 'nod') {
      target.pitch = (-0.06 + Math.sin(age * 8.5) * 0.13) * env;
      target.roll = Math.sin(age * 4.2) * 0.05 * env;
    }
    if (this.mode === 'ball') {
      target.pitch = (0.14 + Math.sin(age * 7) * 0.06) * env;
      target.roll = Math.sin(age * 4.5) * 0.08 * env;
    }

    if (this.gaze?.active && ['idle', 'rest', 'pet', 'greet', 'ball'].includes(this.mode)) {
      target.yaw = this.gaze.yaw;
      target.pitch = this.gaze.pitch;
    }

    // Body-part drag spring pendulum physics (zero stutter, organic swing!)
    const drag = this.bodyDrag;
    const targetLift = drag.active ? 1 : 0;
    drag.lift += (targetLift - drag.lift) * (1 - Math.exp(-14 * dt));
    const driveZ = drag.active ? THREE.MathUtils.clamp(-drag.vx * 0.28, -0.48, 0.48) : 0;
    const driveX = drag.active ? THREE.MathUtils.clamp(drag.vy * 0.22 + 0.16, -0.35, 0.45) : 0;
    drag.velSwingZ += (38 * (driveZ - drag.swingZ) - 6.8 * drag.velSwingZ) * dt;
    drag.velSwingX += (38 * (driveX - drag.swingX) - 6.8 * drag.velSwingX) * dt;
    drag.swingZ = THREE.MathUtils.clamp(drag.swingZ + drag.velSwingZ * dt, -0.55, 0.55);
    drag.swingX = THREE.MathUtils.clamp(drag.swingX + drag.velSwingX * dt, -0.45, 0.5);
    if (drag.landBounce > 0.002) {
      drag.landBounce *= Math.exp(-6.5 * dt);
    } else {
      drag.landBounce = 0;
    }
    if (drag.active) {
      drag.vx *= Math.exp(-10 * dt);
      drag.vy *= Math.exp(-10 * dt);
    }

    // Running stride phase for gyroscope & ball-chase locomotion
    if (this.locomotion.speed > 0.02) {
      this.locomotion.stride += dt * (7.5 + this.locomotion.speed * 14);
    } else {
      this.locomotion.stride *= Math.exp(-4 * dt);
    }

    const lift = smooth(age / 0.55) * (1 - smooth((age - 2.6) / 0.8));
    const danceLiftL = this.mode === 'dance' ? Math.max(0, Math.sin(age * 5.2)) * env : 0;
    const danceLiftR = this.mode === 'dance' ? Math.max(0, -Math.sin(age * 5.2)) * env : 0;
    const ballBat = this.mode === 'ball' && age > 0.9 && age < 2.2 ? Math.sin(((age - 0.9) / 1.3) * Math.PI) : 0;

    const desired = {
      liftL: this.mode === 'paw' ? lift : this.mode === 'ball' ? ballBat : danceLiftL,
      liftR: this.mode === 'pawRight' ? lift : danceLiftR,
      close: this.mode === 'rest' ? env : ['pet', 'brush'].includes(this.mode) ? 0.72 * env : 0,
      lick:
        this.mode === 'lick'
          ? Math.max(0, Math.sin(age * 10)) * env
          : this.mode === 'drink' && age > 0.7 && age < 4.5
            ? (0.35 + 0.65 * Math.max(0, Math.sin(age * 15))) * env
            : this.mode === 'feed' && age > 0.8 && age < 4.8
              ? Math.max(0, Math.sin(age * 13)) * 0.75 * env
              : 0,
      excite: ['greet', 'ball', 'dance', 'nod', 'feed', 'drink', 'pet'].includes(this.mode) || this.locomotion.speed > 0.08
        ? 1
        : 0.34,
    };
    for (const k of Object.keys(this.channels)) {
      this.channels[k] += (desired[k] - this.channels[k]) * (1 - Math.exp(-(k === 'lick' ? 28 : 11) * dt));
    }

    const effectiveManual = drag.active ? 'Surprised' : this.manualExpression;
    const targetExpr = computeExpressionWeights({
      mode: this.locomotion.speed > 0.14 && this.mode === 'idle' ? 'ball' : this.mode,
      age,
      envelope: env,
      blink: this.blink ?? 0,
      close: this.channels?.close ?? 0,
      manualExpression: effectiveManual,
    });
    for (const key of EXPRESSION_NAMES) {
      this.expressionWeights[key] += (targetExpr[key] - this.expressionWeights[key]) * (1 - Math.exp(-16 * dt));
    }

    this.headScaleCurrent += ((this.bigHead ? 1.38 : 1) - this.headScaleCurrent) * (1 - Math.exp(-8 * dt));
    for (const key of ['yaw', 'pitch', 'roll']) {
      const omega = key === 'yaw' ? 8.5 : 7;
      this.velocity[key] += (omega * omega * (target[key] - this.look[key]) - 2 * omega * this.velocity[key]) * dt;
      this.look[key] += this.velocity[key] * dt;
    }
  }

  updatePose() {
    const t = this.time;
    const f = this.interaction;
    const age = f?.age ?? (t - this.started);
    const env = f?.envelope ?? 1;

    for (const b of this.bones) {
      b.quaternion.identity();
      b.scale.set(1, 1, 1);
      if (b.parent.isBone) b.position.copy(this.rest[b.name]).sub(this.rest[b.parent.name]);
      else b.position.copy(this.rest[b.name]);
    }

    // Apply locomotion arena position + bouncy trot + body-drag suspension lift!
    const runRatio = THREE.MathUtils.clamp(this.locomotion.speed / 0.45, 0, 1);
    const runHop = runRatio > 0.04 ? Math.abs(Math.sin(this.locomotion.stride)) * 0.03 * runRatio : 0;
    const danceHop = this.mode === 'dance' ? Math.abs(Math.sin(t * 5.2)) * 0.026 * env : 0;
    const petHop = this.mode === 'pet' ? Math.abs(Math.sin(age * 6.5)) * 0.012 * env : 0;
    const dragLiftY = this.bodyDrag.lift * 0.068;
    this.group.position.set(this.locomotion.x, runHop + danceHop + petHop + dragLiftY, this.locomotion.z);
    this.group.rotation.set(0, this.locomotion.heading, 0);

    // Squash-and-stretch on landing / petting / dance
    const landWave = this.bodyDrag.landBounce > 0.01
      ? Math.sin((1 - this.bodyDrag.landBounce) * Math.PI * 2.5) * this.bodyDrag.landBounce * 0.14
      : 0;
    const breath = Math.sin((t * 2 * Math.PI) / 3.1) * 0.007;
    const petSquash = this.mode === 'pet' ? Math.sin(age * 7) * 0.045 * env : 0;
    const danceBob = this.mode === 'dance' ? Math.abs(Math.sin(t * 5.2)) * 0.025 * env : 0;
    const danceSway = this.mode === 'dance' ? Math.sin(t * 5.2) * 0.11 * env : 0;

    // Pelvis & spine full-body dynamics (eating/drinking bow, gyro lean, dangling drag)
    const eatBow = ['feed', 'drink'].includes(this.mode) ? 0.16 * env : 0;
    const playLunge = this.mode === 'ball' && age > 0.6 && age < 2.3 ? Math.sin(((age - 0.6) / 1.7) * Math.PI) * 0.14 : 0;
    const runPitch = runRatio > 0.04 ? Math.sin(this.locomotion.stride * 2) * 0.06 * runRatio : 0;
    const dragSwingZ = this.bodyDrag.swingZ;
    const dragSwingX = this.bodyDrag.swingX;

    if (this.named.pelvis) {
      this.named.pelvis.rotation.x = eatBow * 0.45 + playLunge * 0.4 + runPitch + dragSwingX * 0.65;
      this.named.pelvis.rotation.z = danceSway * 0.55 - this.locomotion.leanX * 0.35 + dragSwingZ * 0.85;
      this.named.pelvis.scale.set(
        1 + breath + landWave + petSquash * 0.6,
        1 + breath * 0.4 - landWave * 1.15 - petSquash * 0.7 + this.bodyDrag.lift * 0.05,
        1 + breath * 0.6 + landWave * 0.5,
      );
    }
    if (this.named.spine) {
      this.named.spine.rotation.x = eatBow * 0.55 + playLunge * 0.5 + dragSwingX * 0.35;
      this.named.spine.rotation.z = danceSway * 0.45 - this.locomotion.leanX * 0.25 + dragSwingZ * 0.45;
    }

    this.named.chest.scale.set(1 + breath, 1 + breath * 0.5 + danceBob, 1 + breath * 0.6);
    this.named.chest.rotation.z = danceSway * 0.4 + (this.mode === 'brush' ? Math.sin(age * 4) * 0.06 * env : 0);
    this.named.chest.rotation.x = eatBow * 0.38;

    this.named.neck.rotation.set(
      this.look.pitch * 0.3 + eatBow * 0.45 - dragSwingX * 0.25,
      this.look.yaw * 0.28,
      this.look.roll * 0.24 - dragSwingZ * 0.3,
    );
    this.named.head.rotation.set(
      this.look.pitch * 0.74 - dragSwingX * 0.2,
      this.look.yaw * 0.76,
      this.look.roll * 0.78 - dragSwingZ * (this.bodyDrag.zone === 'head' ? 0.55 : 0.25),
    );
    this.named.head.scale.setScalar(this.headScaleCurrent || 1);

    // Expressive ear twitch & joyful floppy ear bounce
    const earTwitch = Math.max(0, 1 - Math.abs((t % 5.4) - 0.35) / 0.2);
    const happyEarFlop = ['pet', 'brush', 'feed', 'drink'].includes(this.mode) ? 0.14 * env : 0;
    const runEarBounce = runRatio * Math.sin(this.locomotion.stride * 2) * 0.12;
    this.named['ear.L'].rotation.z = earTwitch * 0.08 + happyEarFlop + runEarBounce - dragSwingZ * 0.35;
    this.named['ear.R'].rotation.z = -earTwitch * 0.04 - happyEarFlop - runEarBounce - dragSwingZ * 0.35;

    // Lively 4-segment fluffy Pomeranian tail wag!
    const excited = this.channels?.excite ?? 0.34;
    const wagFreq = excited > 0.6 ? 9.5 : 3.6;
    const wagAmp = excited > 0.6 ? 0.085 : 0.032;
    for (let i = 0; i < 4; i += 1) {
      const tb = this.named[`tail_${i}`];
      if (!tb) continue;
      tb.rotation.z = Math.sin(t * wagFreq - i * 0.42) * (wagAmp + i * 0.025) * excited;
      tb.rotation.x = Math.cos(t * wagFreq * 0.5 - i * 0.3) * 0.025 * excited;
    }

    // 4-leg animation: front & hind legs paddle on run/trot, kick playfully when lifted/dragged,
    // and wave/bat enthusiastically during paw/ball/dance!
    const liftL = this.channels?.liftL ?? 0;
    const liftR = this.channels?.liftR ?? 0;
    const kickPhase = this.bodyDrag.lift > 0.15 ? Math.sin(t * 16) * 0.24 * this.bodyDrag.lift : 0;
    const trotL = runRatio > 0.04 ? Math.sin(this.locomotion.stride) * 0.26 * runRatio : 0;
    const trotR = runRatio > 0.04 ? -Math.sin(this.locomotion.stride) * 0.26 * runRatio : 0;

    if (this.named['fore.L.upper']) this.named['fore.L.upper'].rotation.x = -liftL * 0.22 + trotL * 0.65 + kickPhase;
    if (this.named['fore.R.upper']) this.named['fore.R.upper'].rotation.x = -liftR * 0.22 + trotR * 0.65 - kickPhase;
    this.named['fore.L.lower'].rotation.x = -liftL * 0.18 + Math.max(0, trotL) * 0.45 + kickPhase * 0.7;
    this.named['fore.R.lower'].rotation.x = -liftR * 0.18 + Math.max(0, trotR) * 0.45 - kickPhase * 0.7;

    if (this.named['hind.L.upper']) this.named['hind.L.upper'].rotation.x = trotR * 0.55 - kickPhase * 0.8;
    if (this.named['hind.R.upper']) this.named['hind.R.upper'].rotation.x = trotL * 0.55 + kickPhase * 0.8;
    if (this.named['hind.L.lower']) this.named['hind.L.lower'].rotation.x = Math.max(0, trotR) * 0.35 - kickPhase * 0.45;
    if (this.named['hind.R.lower']) this.named['hind.R.lower'].rotation.x = Math.max(0, trotL) * 0.35 + kickPhase * 0.45;

    this.group.updateMatrixWorld(true);

    // Keep resting paws grounded when stationary and not lifted
    if (runRatio < 0.04 && this.bodyDrag.lift < 0.08) {
      for (const side of ['L', 'R']) {
        const paw = this.named[`fore.${side}.paw`];
        const position = this.rest[paw.name].clone();
        position.y += (side === 'L' ? liftL : liftR) * 0.024;
        paw.position.copy(paw.parent.worldToLocal(this.group.localToWorld(position)));
        paw.quaternion.copy(paw.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
        paw.updateMatrixWorld(true);
      }
    }

    // Morph target facial expressions + hide eye sparks when eyes close/squint!
    const blinkAmt = Math.max(this.blink ?? 0, this.channels?.close ?? 0, this.expressionWeights.Blink ?? 0);
    const happyAmt = this.expressionWeights.Happy ?? 0;
    const eyesMostlyClosed = blinkAmt > 0.55 || happyAmt > 0.68 || (this.expressionWeights.Sleepy ?? 0) > 0.6;
    for (const spark of this.eyeSparks) {
      spark.visible = !eyesMostlyClosed;
    }

    EXPRESSION_NAMES.forEach((name, idx) => {
      if (this.mesh.morphTargetInfluences && idx < this.mesh.morphTargetInfluences.length) {
        this.mesh.morphTargetInfluences[idx] = idx === 0 ? blinkAmt : (this.expressionWeights[name] ?? 0);
      }
    });

    const lick = this.channels?.lick ?? 0;
    this.tongue.visible = lick > 0.03;
    this.tongue.scale.set(0.0075, 0.0022, 0.0055 + 0.015 * lick);
    this.tongue.position.set(0, -0.016 + 0.015 * lick, 0.112 + 0.009 * lick);
    this.tongue.rotation.x = -0.58 * lick;

    this.group.updateMatrixWorld(true);
    this.skeleton.update();
    this.helper.updateMatrixWorld(true);
  }

  diagnostics() {
    return {
      time: this.time,
      mode: this.mode,
      look: { ...this.look },
      bones: this.bones.length,
      triangles: this.mesh.geometry.index.count / 3,
      expressions: { ...this.expressionWeights },
      bigHead: this.bigHead,
      locomotion: { ...this.locomotion },
      bodyDragActive: this.bodyDrag.active,
    };
  }
}
