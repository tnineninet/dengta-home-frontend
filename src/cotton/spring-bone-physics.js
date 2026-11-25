// VRM-inspired Spring Bone Physics & Sphere Collider System for DengTa CottonPet
// Implements Lesson 6 (弹簧骨骼和碰撞体) from BV1nn486sEbu in clean-room JS:
// damped spring-mass chains for ears and 4-segment fluffy tail with head/chest
// sphere colliders so secondary motion bounces organically without body clipping.

import * as THREE from 'three';

const DEFAULT_COLLIDERS = Object.freeze([
  { name: 'head_collider', bone: 'head', offset: [0, 0.02, 0.01], radius: 0.092 },
  { name: 'chest_collider', bone: 'chest', offset: [0, 0.01, 0.01], radius: 0.112 },
]);

const DEFAULT_CHAINS = Object.freeze([
  {
    name: 'ear_left',
    bones: ['ear.L'],
    stiffness: 28,
    drag: 7.5,
    gravity: 0.35,
    hitRadius: 0.014,
    maxAngle: 0.32,
    axis: 'z',
    sign: 1,
  },
  {
    name: 'ear_right',
    bones: ['ear.R'],
    stiffness: 28,
    drag: 7.5,
    gravity: 0.35,
    hitRadius: 0.014,
    maxAngle: 0.32,
    axis: 'z',
    sign: -1,
  },
  {
    name: 'tail_chain',
    bones: ['tail_0', 'tail_1', 'tail_2', 'tail_3'],
    stiffness: 20,
    drag: 5.2,
    gravity: 0.45,
    hitRadius: 0.016,
    maxAngle: 0.38,
    axis: 'z',
    sign: 1,
  },
]);

const _prevHeadWorld = new THREE.Vector3();
const _currHeadWorld = new THREE.Vector3();
const _colliderCenter = new THREE.Vector3();
const _boneWorld = new THREE.Vector3();
const _delta = new THREE.Vector3();

export class SpringBoneSystem {
  constructor(pet, { chains = DEFAULT_CHAINS, colliders = DEFAULT_COLLIDERS } = {}) {
    this.pet = pet;
    this.colliders = colliders.map((c) => ({
      ...c,
      offsetVec: new THREE.Vector3(...c.offset),
    }));
    this.chains = chains.map((chain) => ({
      ...chain,
      joints: chain.bones
        .filter((name) => Boolean(pet?.named?.[name]))
        .map((boneName, index) => ({
          boneName,
          index,
          angleZ: 0,
          velZ: 0,
          angleX: 0,
          velX: 0,
        })),
    }));
    this.hasPrevAnchor = false;
    this.lastAnchorPos = new THREE.Vector3();
    this.collisionsResolved = 0;
    this.enabled = true;
    this.externalImpulse = { x: 0, y: 0, z: 0 };
  }

  impulse(x = 0, y = 0, z = 0) {
    this.externalImpulse.x = Math.max(-2.5, Math.min(2.5, this.externalImpulse.x + (Number(x) || 0)));
    this.externalImpulse.y = Math.max(-2.5, Math.min(2.5, this.externalImpulse.y + (Number(y) || 0)));
    this.externalImpulse.z = Math.max(-2.5, Math.min(2.5, this.externalImpulse.z + (Number(z) || 0)));
  }

  update(dt, { beatEnergy = 0, swayX = 0 } = {}) {
    if (!this.enabled || !Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(0.05, dt);
    const headBone = this.pet?.named?.head;
    let anchorAccelX = 0;
    let anchorAccelY = 0;
    if (headBone) {
      headBone.getWorldPosition(_currHeadWorld);
      if (this.hasPrevAnchor) {
        _prevHeadWorld.copy(this.lastAnchorPos);
        anchorAccelX = THREE.MathUtils.clamp((_currHeadWorld.x - _prevHeadWorld.x) / Math.max(step, 0.008), -3, 3);
        anchorAccelY = THREE.MathUtils.clamp((_currHeadWorld.y - _prevHeadWorld.y) / Math.max(step, 0.008), -3, 3);
      }
      this.lastAnchorPos.copy(_currHeadWorld);
      this.hasPrevAnchor = true;
    }

    const driveX = anchorAccelX * 0.45 + this.externalImpulse.x + swayX * 0.65;
    const driveY = anchorAccelY * 0.35 + this.externalImpulse.y + beatEnergy * 0.9;
    this.externalImpulse.x *= Math.exp(-8 * step);
    this.externalImpulse.y *= Math.exp(-8 * step);
    this.externalImpulse.z *= Math.exp(-8 * step);

    // Precompute active collider world centers for fast projection checks
    const activeColliders = [];
    for (const c of this.colliders) {
      const refBone = this.pet?.named?.[c.bone];
      if (!refBone) continue;
      _colliderCenter.copy(c.offsetVec);
      refBone.localToWorld(_colliderCenter);
      activeColliders.push({
        center: _colliderCenter.clone(),
        radius: c.radius,
        bone: c.bone,
      });
    }

    for (const chain of this.chains) {
      for (const joint of chain.joints) {
        const bone = this.pet?.named?.[joint.boneName];
        if (!bone) continue;
        const depthFactor = 1 + joint.index * 0.32;
        const forceZ = (-chain.stiffness * joint.angleZ - chain.drag * joint.velZ) +
          (driveX * chain.sign * 1.4 + beatEnergy * Math.sin((this.pet.time || 0) * 10 - joint.index * 0.5) * 1.1) * depthFactor;
        const forceX = (-chain.stiffness * joint.angleX - chain.drag * joint.velX) +
          (driveY * 0.9 - chain.gravity * 0.04) * depthFactor;

        joint.velZ += forceZ * step;
        joint.velX += forceX * step;
        joint.angleZ = THREE.MathUtils.clamp(joint.angleZ + joint.velZ * step, -chain.maxAngle, chain.maxAngle);
        joint.angleX = THREE.MathUtils.clamp(joint.angleX + joint.velX * step, -chain.maxAngle * 0.75, chain.maxAngle * 0.75);

        // Apply spring secondary rotation on top of base pose
        bone.rotation.z += joint.angleZ;
        bone.rotation.x += joint.angleX;

        // Sphere collider push-out check (Lesson 6 anti-clipping rule)
        bone.updateMatrixWorld(true);
        bone.getWorldPosition(_boneWorld);
        for (const col of activeColliders) {
          if (col.bone === 'head' && chain.name === 'tail_chain') continue;
          if (col.bone === 'chest' && chain.name.startsWith('ear')) continue;
          _delta.copy(_boneWorld).sub(col.center);
          const dist = _delta.length();
          const minDist = col.radius + chain.hitRadius;
          if (dist > 0.0001 && dist < minDist) {
            const push = (minDist - dist) / minDist;
            const pushDir = _delta.x >= 0 ? 1 : -1;
            const correction = THREE.MathUtils.clamp(push * 0.35 * pushDir, -0.18, 0.18);
            joint.angleZ = THREE.MathUtils.clamp(joint.angleZ + correction, -chain.maxAngle, chain.maxAngle);
            bone.rotation.z += correction;
            this.collisionsResolved += 1;
          }
        }
      }
    }
  }

  diagnostics() {
    let energy = 0;
    let totalJoints = 0;
    for (const chain of this.chains) {
      for (const joint of chain.joints) {
        totalJoints += 1;
        energy += Math.abs(joint.velZ) + Math.abs(joint.velX);
      }
    }
    return {
      enabled: this.enabled,
      chains: this.chains.length,
      joints: totalJoints,
      colliders: this.colliders.length,
      collisionsResolved: this.collisionsResolved,
      energy: Number(energy.toFixed(4)),
    };
  }
}
