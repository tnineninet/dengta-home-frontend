// VRM MToon Cel-Shading, Pastel Shade Gradient, Outline, Night Ambient Lighting,
// and Dance Sparkle Particles for DengTa CottonPet (Lessons 3 & 8 of BV1nn486sEbu).

import * as THREE from 'three';

export function createMToonGradientTexture() {
  // 4-step warm cel-shading ramp. Shadow steps are deliberately deep so that the
  // near-white Pomeranian fur keeps readable volume on bright stages.
  const data = new Uint8Array([
    142, 120, 116, 255,
    196, 174, 164, 255,
    238, 226, 214, 255,
    255, 249, 240, 255,
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

// Soft elliptical contact shadow that grounds the white pet on any stage colour.
export function createContactShadow(radius = 0.2) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const alpha = Math.pow(1 - d, 1.8);
      const i = (y * size + x) * 4;
      data[i] = 52; data[i + 1] = 38; data[i + 2] = 34;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.3, radius * 1.6), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.002, 0.01);
  mesh.renderOrder = -1;
  mesh.name = 'Cotton_Contact_Shadow';
  return mesh;
}

export function createOutlineMesh(pet) {
  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x5a4238,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.82,
  });
  const outline = new THREE.SkinnedMesh(pet.mesh.geometry, outlineMat);
  outline.name = 'Cotton_MToon_Outline';
  outline.bind(pet.skeleton);
  outline.scale.setScalar(1.016);
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
