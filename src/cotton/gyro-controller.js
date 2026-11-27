/**
 * Mobile Gyroscope & Accelerometer Controller for DengTa CottonPet.
 *
 * Converts phone tilt (DeviceOrientationEvent gamma/beta) and shake
 * (DeviceMotionEvent) into smooth normalized 2D gravity vectors so Cotton
 * can trot/run around and the interactive toy ball rolls & bounces realistically.
 */

const CLAMP = (value, min, max) => Math.max(min, Math.min(max, value));

export function isGyroSupported() {
  return (
    typeof window !== 'undefined' &&
    ('DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window)
  );
}

export function needsGyroPermissionPrompt() {
  return (
    typeof window !== 'undefined' &&
    typeof window.DeviceOrientationEvent?.requestPermission === 'function'
  );
}

export function createGyroController({
  onTilt,
  onShake,
  deadzone = 0.08,
  maxTiltDeg = 36,
  smoothing = 0.22,
} = {}) {
  let active = false;
  let neutralBeta = 42; // Comfortable phone-in-hand viewing angle
  let neutralGamma = 0;
  let hasBaseline = false;
  let smoothX = 0;
  let smoothZ = 0;
  let lastShakeAt = 0;

  function applyDeadzone(val) {
    if (Math.abs(val) <= deadzone) return 0;
    const sign = Math.sign(val);
    return sign * ((Math.abs(val) - deadzone) / (1 - deadzone));
  }

  function handleOrientation(event) {
    if (!active) return;
    const rawBeta = Number(event?.beta);
    const rawGamma = Number(event?.gamma);
    if (!Number.isFinite(rawBeta) || !Number.isFinite(rawGamma)) return;

    if (!hasBaseline) {
      neutralBeta = CLAMP(rawBeta, 10, 75);
      neutralGamma = CLAMP(rawGamma, -15, 15);
      hasBaseline = true;
    }

    // Account for screen orientation (portrait vs landscape)
    const angle = Number(window.screen?.orientation?.angle ?? window.orientation ?? 0);
    let dGamma = rawGamma - neutralGamma;
    let dBeta = rawBeta - neutralBeta;
    if (angle === 90) {
      const tmp = dGamma;
      dGamma = dBeta;
      dBeta = -tmp;
    } else if (angle === -90 || angle === 270) {
      const tmp = dGamma;
      dGamma = -dBeta;
      dBeta = tmp;
    }

    const targetX = applyDeadzone(CLAMP(dGamma / maxTiltDeg, -1, 1));
    const targetZ = applyDeadzone(CLAMP(dBeta / maxTiltDeg, -1, 1));
    smoothX += (targetX - smoothX) * smoothing;
    smoothZ += (targetZ - smoothZ) * smoothing;
    onTilt?.({
      x: smoothX,
      z: smoothZ,
      rawBeta,
      rawGamma,
    });
  }

  function handleMotion(event) {
    if (!active || typeof onShake !== 'function') return;
    const acc = event?.acceleration || event?.accelerationIncludingGravity;
    if (!acc) return;
    const ax = Number(acc.x) || 0;
    const ay = Number(acc.y) || 0;
    const az = Number(acc.z) || 0;
    const mag = Math.hypot(ax, ay, az);
    const threshold = event?.acceleration ? 11.5 : 21.5;
    const now = Date.now();
    if (mag > threshold && now - lastShakeAt > 650) {
      lastShakeAt = now;
      onShake({
        x: CLAMP(ax / 12, -1.5, 1.5),
        y: CLAMP(Math.abs(ay) / 10, 0.5, 1.6),
        z: CLAMP(az / 12, -1.5, 1.5),
        strength: CLAMP(mag / 20, 0.6, 1.8),
      });
    }
  }

  async function start() {
    if (active) return { ok: true };
    if (!isGyroSupported()) {
      return { ok: false, reason: '当前设备暂不支持陀螺仪感应' };
    }
    try {
      if (typeof window.DeviceOrientationEvent?.requestPermission === 'function') {
        const res = await window.DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') {
          return { ok: false, reason: '未允许陀螺仪权限，请在系统设置中开启运动与方向访问' };
        }
      }
      if (typeof window.DeviceMotionEvent?.requestPermission === 'function') {
        await window.DeviceMotionEvent.requestPermission().catch(() => {});
      }
    } catch {
      return { ok: false, reason: '陀螺仪权限申请失败，请重试' };
    }
    hasBaseline = false;
    smoothX = 0;
    smoothZ = 0;
    active = true;
    window.addEventListener('deviceorientation', handleOrientation, true);
    window.addEventListener('devicemotion', handleMotion, true);
    return { ok: true };
  }

  function stop() {
    if (!active) return;
    active = false;
    smoothX = 0;
    smoothZ = 0;
    window.removeEventListener('deviceorientation', handleOrientation, true);
    window.removeEventListener('devicemotion', handleMotion, true);
    onTilt?.({ x: 0, z: 0, rawBeta: neutralBeta, rawGamma: neutralGamma });
  }

  function calibrate() {
    hasBaseline = false;
    smoothX = 0;
    smoothZ = 0;
  }

  return {
    start,
    stop,
    calibrate,
    isActive: () => active,
  };
}
