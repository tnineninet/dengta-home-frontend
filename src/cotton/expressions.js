// Multi-BlendShape Expression System for DengTa CottonPet
// Implements Lesson 7 (表情制作 / Shape Keys & VRM Expressions) on top of b1857.json
// without altering vertex count (keeps exact 49,853 vertices & Blink at index 0).

import * as THREE from 'three';

export const EXPRESSION_NAMES = Object.freeze([
  'Blink',
  'Happy',
  'Surprised',
  'Sleepy',
  'Excited',
]);

export const EXPRESSION_LABELS = Object.freeze({
  auto: '自动表情',
  Blink: '眨眼',
  Happy: '眯眼笑',
  Surprised: '惊喜瞪眼',
  Sleepy: '困倦半眯',
  Excited: '元气开心',
});

export function buildCottonMorphTargets(positions) {
  const len = positions.length;
  const blink = positions.slice();
  const happy = positions.slice();
  const surprised = positions.slice();
  const sleepy = positions.slice();
  const excited = positions.slice();

  for (let i = 0; i < len; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const absX = Math.abs(x);

    // Eye region (preserves exact upstream Blink region)
    const eyeR = ((absX - 0.039) / 0.019) ** 2 + ((y - 0.383) / 0.022) ** 2;
    if (z > 0.185 && eyeR < 1) {
      const falloff = Math.cos(Math.sqrt(eyeR) * Math.PI * 0.5) ** 2;
      // 0: Blink — natural eyelid closure
      blink[i + 1] = y - (y - 0.383) * 0.96 * falloff;

      // 1: Happy — upward crescent arc (^_^) + gentle lower-lid smile lift
      const arch = Math.cos(((absX - 0.039) / 0.019) * Math.PI * 0.5);
      happy[i + 1] = y - (y - (0.385 + 0.004 * arch)) * 0.86 * falloff + 0.003 * falloff;

      // 2: Surprised — widen eye vertically & perk upper brow slightly
      surprised[i + 1] = y + (y - 0.383) * 0.34 * falloff + 0.002 * falloff;

      // 3: Sleepy — droop upper eyelid halfway
      sleepy[i + 1] = y > 0.383 ? y - (y - 0.381) * 0.62 * falloff : y + 0.001 * falloff;
    }

    // Cheek & smile region for Happy & Excited expressions
    const cheekR = ((absX - 0.052) / 0.036) ** 2 + ((y - 0.354) / 0.028) ** 2;
    if (z > 0.16 && cheekR < 1) {
      const falloff = Math.cos(Math.sqrt(cheekR) * Math.PI * 0.5) ** 2;
      happy[i + 1] += 0.0045 * falloff;
      happy[i + 2] += 0.0025 * falloff;
      excited[i + 1] += 0.006 * falloff;
      excited[i + 2] += 0.0035 * falloff;
    }

    // Muzzle / mouth lift for Excited & Surprised
    const muzzleR = (x / 0.028) ** 2 + ((y - 0.346) / 0.02) ** 2;
    if (z > 0.21 && muzzleR < 1) {
      const falloff = Math.cos(Math.sqrt(muzzleR) * Math.PI * 0.5) ** 2;
      excited[i + 1] += 0.003 * falloff;
      surprised[i + 1] -= 0.0035 * falloff;
    }
  }

  const arrays = [blink, happy, surprised, sleepy, excited];
  return arrays.map((arr, idx) => {
    const attr = new THREE.Float32BufferAttribute(arr, 3);
    attr.name = EXPRESSION_NAMES[idx];
    return attr;
  });
}

export function computeExpressionWeights({
  mode = 'idle',
  age = 0,
  envelope = 1,
  blink = 0,
  close = 0,
  manualExpression = 'auto',
} = {}) {
  const weights = {
    Blink: Math.max(blink, close),
    Happy: 0,
    Surprised: 0,
    Sleepy: 0,
    Excited: 0,
  };

  if (manualExpression && manualExpression !== 'auto' && Object.hasOwn(weights, manualExpression)) {
    weights.Blink = manualExpression === 'Blink' ? 1 : 0;
    weights[manualExpression] = 1;
    return weights;
  }

  if (mode === 'pet' || mode === 'brush') {
    weights.Happy = Math.min(1, 0.92 * envelope);
    weights.Blink = Math.max(blink, 0.25 * envelope);
  } else if (mode === 'dance' || mode === 'greet' || mode === 'nod') {
    weights.Happy = Math.min(1, 0.65 * envelope);
    weights.Excited = Math.min(1, 0.85 * envelope);
  } else if (mode === 'ball' || mode === 'wake') {
    const burst = Math.max(0, 1 - Math.abs(age - 0.55) / 0.7);
    weights.Surprised = Math.min(1, burst * 0.85);
    weights.Excited = Math.min(1, 0.65 * envelope);
  } else if (mode === 'feed' || mode === 'drink') {
    weights.Excited = Math.min(1, 0.72 * envelope);
    weights.Happy = Math.min(1, 0.45 * envelope);
  } else if (mode === 'rest') {
    weights.Sleepy = Math.min(1, 0.9 * envelope);
    weights.Blink = Math.max(blink, close, 0.88 * envelope);
  }

  return weights;
}
