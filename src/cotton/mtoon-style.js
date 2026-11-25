// VRM MToon Cel-Shading, Pastel Shade Gradient, Outline, Night Ambient Lighting,
// and Dance Sparkle Particles for DengTa CottonPet (Lessons 3 & 8 of BV1nn486sEbu).

import * as THREE from 'three';

export function createMToonGradientTexture() {
  // 4-step warm pastel cel-shading ramp inspired by Lesson 8 (soft almond shadow -> warm cream -> sunlit highlight)
  const data = new Uint8Array([
    196, 174, 162, 255,
    224, 206, 194, 255,
    248, 240, 232, 255,
    255, 252, 246, 255,
  ]);
  const texture = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function createMToonMaterials(gradientMap) {
  const fur = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap,
  });
  const eye = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const nose = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap,
  });
  return [fur, eye, nose];
}

export function createOutlineMesh(pet) {
  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x6b5346,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.72,
  });
  const outline = new THREE.SkinnedMesh(pet.mesh.geometry, outlineMat);
  outline.name = 'Cotton_MToon_Outline';
  outline.bind(pet.skeleton);
  outline.scale.setScalar(1.012);
  outline.visible = false;
  outline.frustumCulled = false;
  return outline;
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

  update(dt, active = false) {
    if (!Number.isFinite(dt) || dt < 0) return;
    const target = active ? 1 : 0;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-6 * Math.min(dt, 0.1)));
    this.points.visible = this.intensity > 0.02;
    if (!this.points.visible) return;
    this.time += Math.min(dt, 0.1);
    const attr = this.points.geometry.attributes.position;
    for (let i = 0; i < this.count; i++) {
      const phase = this.phases[i] + this.time * 2.2;
      const bx = this.basePositions[i * 3];
      const by = this.basePositions[i * 3 + 1];
      const bz = this.basePositions[i * 3 + 2];
      const cos = Math.cos(this.time * 0.7);
      const sin = Math.sin(this.time * 0.7);
      this.positions[i * 3] = bx * cos - bz * sin;
      this.positions[i * 3 + 1] = by + Math.sin(phase) * 0.045;
      this.positions[i * 3 + 2] = bx * sin + bz * cos;
    }
    attr.needsUpdate = true;
    this.points.material.opacity = this.intensity * (0.65 + 0.3 * Math.sin(this.time * 5));
  }
}
