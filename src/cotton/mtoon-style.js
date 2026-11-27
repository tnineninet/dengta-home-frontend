// VRM MToon Cel-Shading, Pastel Shade Gradient, Outline, Night Ambient Lighting,
// and Dance Sparkle Particles for DengTa CottonPet (Lessons 3 & 8 of BV1nn486sEbu).

import * as THREE from 'three';

export function createMToonGradientTexture() {
  // 4-step anime cel-shading ramp calibrated for snow-white Pomeranian fur.
  // Deep plum-taupe shadows ensure unmistakable form separation in MToon mode.
  const data = new Uint8Array([
    118, 102, 118, 255,
    176, 158, 162, 255,
    232, 220, 210, 255,
    255, 249, 242, 255,
  ]);
  const texture = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function createMToonMaterials(gradientMap, { furMap = null } = {}) {
  const fur = new THREE.MeshToonMaterial({
    color: 0xfffaf3,
    vertexColors: true,
    ...(furMap ? { map: furMap } : {}),
    gradientMap,
  });
  const eye = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  const nose = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap,
  });
  return [fur, eye, nose];
}

// Soft grounded contact shadow + subtle cozy floor cushion ring beneath the paws.
export function createContactShadow(radius = 0.22) {
  const size = 96;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const core = Math.pow(Math.max(0, 1 - d / 0.72), 1.9) * 0.82;
      const rim = Math.pow(Math.max(0, 1 - d), 1.6) * 0.35;
      const alpha = Math.min(1, core + rim);
      const i = (y * size + x) * 4;
      data[i] = 28; data[i + 1] = 22; data[i + 2] = 24;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.45, radius * 1.75), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.002, 0.015);
  mesh.renderOrder = -1;
  mesh.name = 'Cotton_Contact_Shadow';
  return mesh;
}

export function createOutlineMesh(pet) {
  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x4c3730,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  // Extrude strictly along skinned vertex normals AFTER #include <skinning_vertex>
  // (where both transformed and objectNormal share skinned object space), so ears,
  // cheeks, paws, morph targets, and bigHead stay evenly inked with zero vertical drift.
  outlineMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <skinning_vertex>',
      `#include <skinning_vertex>
      #if defined( USE_SKINNING ) || defined( USE_ENVMAP )
      transformed += normalize( objectNormal ) * 0.0042;
      #else
      transformed += normalize( normal ) * 0.0042;
      #endif`,
    );
  };
  outlineMat.customProgramCacheKey = () => 'cotton-normal-outline-v2';
  const outline = new THREE.SkinnedMesh(pet.mesh.geometry, outlineMat);
  outline.name = 'Cotton_MToon_Outline';
  outline.bind(pet.skeleton);
  outline.scale.setScalar(1);
  outline.visible = false;
  outline.frustumCulled = false;
  return outline;
}

export function updateOutlineAppearance(outline, { night = false, toon = false } = {}) {
  if (!outline?.material) return;
  outline.material.color.setHex(night ? 0x241e3c : toon ? 0x442f2c : 0x4c3730);
  outline.material.opacity = night ? 0.72 : toon ? 0.88 : 0.78;
}

export class DanceSparkles {
  constructor(scene, count = 26) {
    this.count = count;
    this.time = 0;
    this.intensity = 0;
    this.basePositions = new Float32Array(count * 3);
    this.positions = new Float32Array(count * 3);
    this.phases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 0.22 + (i % 5) * 0.045;
      const y = 0.1 + (i % 7) * 0.068;
      this.basePositions[i * 3] = Math.cos(angle) * radius;
      this.basePositions[i * 3 + 1] = y;
      this.basePositions[i * 3 + 2] = Math.sin(angle) * radius;
      this.phases[i] = i * 0.61;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffdf99,
      size: 0.024,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.name = 'Cotton_Dance_Sparkles';
    this.points.visible = false;
    scene.add(this.points);
  }

  update(dt, active = false, { theme = 'sparkle', originX = 0, originZ = 0 } = {}) {
    if (!Number.isFinite(dt) || dt < 0) return;
    const target = active ? 1 : 0;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-6 * Math.min(dt, 0.1)));
    this.points.visible = this.intensity > 0.02;
    if (!this.points.visible) return;
    const palette = {
      sparkle: 0xffdf88,
      hearts: 0xff8ea8,
      water: 0x76e0ff,
      crumbs: 0xf9b86c,
      fluff: 0xfff0c2,
    };
    this.points.material.color.setHex(palette[theme] || palette.sparkle);
    this.time += Math.min(dt, 0.1);
    const attr = this.points.geometry.attributes.position;
    for (let i = 0; i < this.count; i++) {
      const phase = this.phases[i] + this.time * (theme === 'water' ? 3.8 : 2.5);
      const bx = this.basePositions[i * 3];
      const by = this.basePositions[i * 3 + 1];
      const bz = this.basePositions[i * 3 + 2];
      const cos = Math.cos(this.time * 0.85);
      const sin = Math.sin(this.time * 0.85);
      const rise = theme === 'hearts' || theme === 'fluff' ? ((this.time * 0.18 + i * 0.07) % 0.28) : 0;
      const splash = theme === 'water' ? Math.abs(Math.sin(phase)) * 0.09 : Math.sin(phase) * 0.045;
      this.positions[i * 3] = originX + (bx * cos - bz * sin) * (theme === 'water' ? 0.55 : 1);
      this.positions[i * 3 + 1] = (theme === 'water' ? 0.06 : by) + splash + rise;
      this.positions[i * 3 + 2] = originZ + (bx * sin + bz * cos) * (theme === 'water' ? 0.55 : 1);
    }
    attr.needsUpdate = true;
    this.points.material.opacity = this.intensity * (0.68 + 0.28 * Math.sin(this.time * 5.5));
  }
}
