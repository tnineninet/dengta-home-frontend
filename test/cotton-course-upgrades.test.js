import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { B1857Character } from '../src/cotton/upstream/b1857-character.js';
import { InteractionController, ACTIONS } from '../src/cotton/upstream/interaction-controller.js';
import { SpringBoneSystem } from '../src/cotton/spring-bone-physics.js';
import { EXPRESSION_NAMES, buildCottonMorphTargets, computeExpressionWeights } from '../src/cotton/expressions.js';
import { createMToonGradientTexture, createMToonMaterials, createOutlineMesh, DanceSparkles, updateOutlineAppearance } from '../src/cotton/mtoon-style.js';

const rawAsset = JSON.parse(readFileSync(new URL('../public/cotton/b1857.json', import.meta.url)));

test('Lesson 7: 5-morph expression targets preserve exact 49,853 vertices and Blink at index 0', () => {
  const targets = buildCottonMorphTargets(rawAsset.positions);
  assert.equal(targets.length, 5);
  assert.deepEqual(targets.map((t) => t.name), [...EXPRESSION_NAMES]);
  assert.equal(targets[0].name, 'Blink');
  assert.equal(targets[0].count, 49853);
  for (const attr of targets) {
    assert.equal(attr.count, 49853);
    let moved = 0;
    for (let i = 0; i < attr.array.length; i++) {
      if (Math.abs(attr.array[i] - rawAsset.positions[i]) > 1e-6) moved += 1;
    }
    assert.ok(moved > 20, `Expression ${attr.name} should deform facial vertices`);
  }

  const petWeights = computeExpressionWeights({ mode: 'pet', envelope: 1, blink: 0, close: 0 });
  assert.ok(petWeights.Happy > 0.8);
  const manualWeights = computeExpressionWeights({ mode: 'idle', manualExpression: 'Surprised' });
  assert.equal(manualWeights.Surprised, 1);
  assert.equal(manualWeights.Blink, 0);
});

test('Lesson 6: SpringBoneSystem animates ears & 4-segment tail with bounded angles and collider resolution', () => {
  const pet = new B1857Character({ asset: rawAsset });
  const springs = new SpringBoneSystem(pet);
  const beforeDiag = springs.diagnostics();
  assert.equal(beforeDiag.chains, 3);
  assert.equal(beforeDiag.joints, 6, 'ear.L + ear.R + tail_0..tail_3');
  assert.equal(beforeDiag.colliders, 2);

  springs.impulse(1.8, 0.9, 0);
  for (let i = 0; i < 30; i++) {
    pet.update(0.033);
    springs.update(0.033, { beatEnergy: 0.9, swayX: Math.sin(i * 0.4) * 0.7 });
  }
  const activeDiag = springs.diagnostics();
  assert.ok(activeDiag.energy > 0.01, 'spring bones should carry non-zero secondary velocity under impulse');

  // Verify angles remain strictly bounded inside maxAngle
  for (const chain of springs.chains) {
    for (const joint of chain.joints) {
      assert.ok(Math.abs(joint.angleZ) <= chain.maxAngle + 1e-6);
      assert.ok(Math.abs(joint.angleX) <= chain.maxAngle * 0.75 + 1e-6);
    }
  }
});

test('Lessons 3 & 8: MToon gradient texture, toon materials, outline SkinnedMesh, and DanceSparkles work cleanly', () => {
  const pet = new B1857Character({ asset: rawAsset });
  const gradient = createMToonGradientTexture();
  assert.equal(gradient.image.width, 4);
  assert.equal(gradient.image.height, 1);

  const toonMats = createMToonMaterials(gradient);
  assert.equal(toonMats.length, 3);
  assert.equal(toonMats[0].isMeshToonMaterial, true);
  assert.equal(toonMats[0].gradientMap, gradient);

  const outline = createOutlineMesh(pet);
  assert.equal(outline.isSkinnedMesh, true);
  assert.equal(outline.geometry, pet.mesh.geometry);
  assert.equal(outline.visible, false);
  assert.equal(outline.scale.x, 1, 'outline must extrude along normals instead of distorting via origin scale');
  const mockShader = { vertexShader: '#include <begin_vertex>\n#include <skinning_vertex>\n#include <project_vertex>' };
  outline.material.onBeforeCompile(mockShader);
  assert.ok(mockShader.vertexShader.includes('normalize( objectNormal )'), 'outline shader extrudes along post-skinning objectNormal');
  updateOutlineAppearance(outline, { night: true, toon: false });
  assert.equal(outline.material.color.getHex(), 0x241e3c);
  updateOutlineAppearance(outline, { night: false, toon: true });
  assert.equal(outline.material.color.getHex(), 0x442f2c);

  // Verify sculpted fur vertex colors include natural AO depth instead of flat white
  const colorAttr = pet.mesh.geometry.attributes.color;
  let minLum = 1;
  let maxLum = 0;
  for (let i = 0; i < colorAttr.count; i++) {
    const r = colorAttr.getX(i);
    const g = colorAttr.getY(i);
    const b = colorAttr.getZ(i);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum > 0.35) {
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
    }
  }
  assert.ok(maxLum - minLum > 0.14, `fur vertex shading should provide sculptural AO depth (spread=${(maxLum - minLum).toFixed(3)})`);

  // Verify studio backdrop CSS avoids pale white/peach washout behind the white Pomeranian
  const cottonCss = readFileSync(new URL('../src/cotton-pet.css', import.meta.url), 'utf8');
  assert.ok(!cottonCss.includes('#f3dccb'), 'MToon stage must not use pale peach washout');
  assert.ok(cottonCss.includes('#68857d') && cottonCss.includes('#76648b') && cottonCss.includes('#866858'));
  assert.ok(cottonCss.includes('--theme-card-rgb'), 'controls panel uses theme-aware frosted glass over custom wallpapers');

  const scene = new THREE.Scene();
  const sparkles = new DanceSparkles(scene, 18);
  assert.equal(sparkles.points.visible, false);
  for (let i = 0; i < 15; i++) sparkles.update(0.05, true);
  assert.equal(sparkles.points.visible, true);
  assert.ok(sparkles.points.material.opacity > 0.2);

  gradient.dispose();
  toonMats.forEach((m) => m.dispose());
  outline.material.dispose();
  sparkles.points.geometry.dispose();
  sparkles.points.material.dispose();
  pet.mesh.geometry.dispose();
  pet.materials.forEach((m) => m.dispose());
  pet.skeleton.dispose();
});

test('Course interactions: dance & nod actions, cursor gaze, bigHead toggle, and manual expressions', () => {
  assert.ok(ACTIONS.dance && ACTIONS.nod);
  const ctrl = new InteractionController();
  assert.equal(ctrl.request('dance').accepted, true);
  for (let i = 0; i < 12; i++) ctrl.update(0.1);
  assert.equal(ctrl.active.id, 'dance');

  const pet = new B1857Character({ asset: rawAsset });
  pet.setBigHead(true);
  pet.setGaze(0.7, -0.4, true);
  pet.setExpression('Happy');
  pet.setInteraction({ id: 'dance', age: ctrl.age, envelope: ctrl.envelope });
  for (let i = 0; i < 20; i++) pet.update(0.05);

  const diag = pet.diagnostics();
  assert.equal(diag.bigHead, true);
  assert.equal(pet.manualExpression, 'Happy');
  assert.ok(diag.expressions.Happy > 0.9, 'Happy expression weight reaches active state');
  assert.ok(pet.named.head.scale.x > 1.2, 'bigHead scales up head smoothly');
  assert.ok(pet.mesh.morphTargetInfluences[1] > 0.9, 'Happy morph weight reaches active state');
});
