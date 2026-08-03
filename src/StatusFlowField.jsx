import { useEffect, useRef } from "react";

const FRAME_INTERVAL_MS = 1000 / 55;
const MAX_CANVAS_PIXELS = 2_400_000;
const MAX_PARTICLES = 820;
const MAX_VORTICES = 18;

const VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec4 a_color;
attribute float a_size;

uniform float u_pixel_ratio;
uniform float u_max_point_size;

varying vec4 v_color;

void main() {
  gl_Position = vec4(a_position * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = min(a_size * u_pixel_ratio, u_max_point_size);
  v_color = a_color;
}
`;

const FRAGMENT_SHADER = `
precision highp float;

varying vec4 v_color;

void main() {
  vec2 point = gl_PointCoord * 2.0 - 1.0;
  float radius = dot(point, point);
  if (radius > 1.0) discard;

  float feather = 1.0 - smoothstep(0.38, 1.0, radius);
  float vapor = exp(-3.2 * radius);
  float pearl = pow(max(0.0, 1.0 - radius), 4.0) * 0.2;
  float alpha = v_color.a * feather * (0.34 + vapor * 0.66);
  vec3 color = mix(v_color.rgb, vec3(1.0), pearl);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hsvToRgb(hue, saturation, value) {
  const normalized = ((hue % 1) + 1) % 1;
  const sector = normalized * 6;
  const index = Math.floor(sector);
  const fraction = sector - index;
  const p = value * (1 - saturation);
  const q = value * (1 - fraction * saturation);
  const t = value * (1 - (1 - fraction) * saturation);
  const colors = [
    [value, t, p],
    [q, value, p],
    [p, value, t],
    [p, q, value],
    [t, p, value],
    [value, p, q],
  ];
  return colors[index % 6];
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const reason = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(reason || "Unable to compile status flow shader");
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const reason = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(reason || "Unable to link status flow shader");
  }
  return program;
}

export default function StatusFlowField({ active }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    const canvas = canvasRef.current;
    const panel = canvas?.closest(".sun-glass-floating-status-panel");
    const field = canvas?.parentElement;
    if (!canvas || !panel || !field) return undefined;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    if (!gl) {
      field.classList.add("status-flow-field--fallback");
      return undefined;
    }

    let program;
    try {
      program = createProgram(gl);
    } catch {
      field.classList.add("status-flow-field--fallback");
      return undefined;
    }

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const colorLocation = gl.getAttribLocation(program, "a_color");
    const sizeLocation = gl.getAttribLocation(program, "a_size");
    const pixelRatioLocation = gl.getUniformLocation(program, "u_pixel_ratio");
    const maxPointSizeLocation = gl.getUniformLocation(program, "u_max_point_size");
    const positionBuffer = gl.createBuffer();
    const colorBuffer = gl.createBuffer();
    const sizeBuffer = gl.createBuffer();
    const drawPositions = new Float32Array(MAX_PARTICLES * 2);
    const drawColors = new Float32Array(MAX_PARTICLES * 4);
    const drawSizes = new Float32Array(MAX_PARTICLES);
    const particles = {
      x: new Float32Array(MAX_PARTICLES),
      y: new Float32Array(MAX_PARTICLES),
      vx: new Float32Array(MAX_PARTICLES),
      vy: new Float32Array(MAX_PARTICLES),
      age: new Float32Array(MAX_PARTICLES),
      life: new Float32Array(MAX_PARTICLES),
      size: new Float32Array(MAX_PARTICLES),
      alpha: new Float32Array(MAX_PARTICLES),
      red: new Float32Array(MAX_PARTICLES),
      green: new Float32Array(MAX_PARTICLES),
      blue: new Float32Array(MAX_PARTICLES),
      seed: new Float32Array(MAX_PARTICLES),
    };
    const vortices = [];
    const pointerState = {
      active: false,
      x: 0.5,
      y: 0.5,
      vx: 0,
      vy: 0,
      lastAt: 0,
      pointerId: null,
      touchId: null,
    };
    let particleCursor = 0;
    let animationFrame = 0;
    let lastFrameAt = -Infinity;
    let lastSimulationAt = performance.now();
    let renderPixelRatio = 1;

    gl.useProgram(program);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, drawPositions.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, drawColors.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, drawSizes.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(sizeLocation);
    gl.vertexAttribPointer(sizeLocation, 1, gl.FLOAT, false, 0, 0);

    const pointSizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    const maxPointSize = Math.max(32, pointSizeRange?.[1] || 96);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2.6, Math.max(1, window.devicePixelRatio || 1));
      const requestedPixels = rect.width * rect.height * dpr * dpr;
      const scale = dpr * Math.min(
        1,
        Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, requestedPixels)),
      );
      const width = Math.max(2, Math.round(rect.width * scale));
      const height = Math.max(2, Math.round(rect.height * scale));
      renderPixelRatio = width / Math.max(rect.width, 1);
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };

    const spawnParticle = (x, y, vx, vy, intensity, offset) => {
      const index = particleCursor;
      particleCursor = (particleCursor + 1) % MAX_PARTICLES;
      const seed = Math.random();
      const angle = Math.random() * Math.PI * 2;
      const cross = (Math.random() - 0.5) * (0.13 + intensity * 0.08);
      const spread = 0.018 + Math.random() * 0.045;
      const color = hsvToRgb(
        x * 0.43 + y * 0.18 + offset * 0.035 + seed * 0.22,
        0.7 + seed * 0.22,
        0.96,
      );
      particles.x[index] = x + Math.cos(angle) * spread * 0.24;
      particles.y[index] = y + Math.sin(angle) * spread * 0.24;
      particles.vx[index] = vx * (0.2 + seed * 0.31) - vy * cross + Math.cos(angle) * spread;
      particles.vy[index] = vy * (0.2 + seed * 0.31) + vx * cross + Math.sin(angle) * spread;
      particles.age[index] = 0;
      particles.life[index] = 1.05 + Math.random() * 1.45;
      particles.size[index] = 28 + Math.random() * 58 + intensity * 17;
      particles.alpha[index] = 0.13 + Math.random() * 0.22;
      particles.red[index] = color[0];
      particles.green[index] = color[1];
      particles.blue[index] = color[2];
      particles.seed[index] = seed * Math.PI * 2;
    };

    const addVortex = (x, y, vx, vy, intensity) => {
      const direction = Math.abs(vx) > Math.abs(vy) ? Math.sign(vx || 1) : -Math.sign(vy || 1);
      vortices.push({
        x,
        y,
        vx: vx * 0.09,
        vy: vy * 0.09,
        age: 0,
        life: 0.78 + Math.random() * 0.58,
        strength: 0.2 + intensity * 0.24,
        spin: direction * (Math.random() > 0.5 ? 1 : -1),
      });
      if (vortices.length > MAX_VORTICES) vortices.shift();
    };

    const requestDraw = () => {
      if (!animationFrame) animationFrame = requestAnimationFrame(draw);
    };

    const emitAt = (x, y, vx, vy, count, intensity, offset = 0) => {
      for (let index = 0; index < count; index += 1) {
        spawnParticle(x, y, vx, vy, intensity, offset + index);
      }
      requestDraw();
    };

    const localPoint = (clientX, clientY) => {
      const rect = panel.getBoundingClientRect();
      return {
        x: clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1),
        y: 1 - clamp((clientY - rect.top) / Math.max(rect.height, 1), 0, 1),
        width: rect.width,
        height: rect.height,
      };
    };

    const startTrail = (clientX, clientY, now = performance.now()) => {
      const point = localPoint(clientX, clientY);
      pointerState.active = true;
      pointerState.x = point.x;
      pointerState.y = point.y;
      pointerState.vx = 0;
      pointerState.vy = 0;
      pointerState.lastAt = now;
      emitAt(point.x, point.y, 0, 0, 34, 0.45);
      addVortex(point.x, point.y, 0, 0, 0.45);
      field.style.setProperty("--status-flow-x", `${point.x * 100}%`);
      field.style.setProperty("--status-flow-y", `${(1 - point.y) * 100}%`);
    };

    const continueTrail = (clientX, clientY, now = performance.now()) => {
      if (!pointerState.active) return;
      const point = localPoint(clientX, clientY);
      const elapsed = clamp((now - pointerState.lastAt) / 1000, 1 / 180, 0.08);
      const dx = point.x - pointerState.x;
      const dy = point.y - pointerState.y;
      const distancePixels = Math.hypot(dx * point.width, dy * point.height);
      if (distancePixels < 0.45) return;

      const rawVx = clamp(dx / elapsed, -3.2, 3.2);
      const rawVy = clamp(dy / elapsed, -3.2, 3.2);
      const velocityMix = 0.52;
      pointerState.vx += (rawVx - pointerState.vx) * velocityMix;
      pointerState.vy += (rawVy - pointerState.vy) * velocityMix;
      const speed = Math.hypot(pointerState.vx, pointerState.vy);
      const intensity = clamp(speed / 2.2, 0.24, 1);
      const samples = clamp(Math.ceil(distancePixels / 7), 1, 18);
      const particlesPerSample = speed > 1.45 ? 6 : 4;

      for (let sample = 1; sample <= samples; sample += 1) {
        const ratio = sample / samples;
        emitAt(
          pointerState.x + dx * ratio,
          pointerState.y + dy * ratio,
          pointerState.vx,
          pointerState.vy,
          particlesPerSample,
          intensity,
          sample,
        );
      }
      addVortex(point.x, point.y, pointerState.vx, pointerState.vy, intensity);
      pointerState.x = point.x;
      pointerState.y = point.y;
      pointerState.lastAt = now;
      field.style.setProperty("--status-flow-x", `${point.x * 100}%`);
      field.style.setProperty("--status-flow-y", `${(1 - point.y) * 100}%`);
    };

    const endTrail = () => {
      pointerState.active = false;
      pointerState.pointerId = null;
      pointerState.touchId = null;
    };

    const updateParticles = (deltaSeconds, nowSeconds) => {
      const drag = Math.exp(-1.32 * deltaSeconds);
      let alive = 0;
      for (let vortexIndex = vortices.length - 1; vortexIndex >= 0; vortexIndex -= 1) {
        const vortex = vortices[vortexIndex];
        vortex.age += deltaSeconds;
        vortex.x += vortex.vx * deltaSeconds;
        vortex.y += vortex.vy * deltaSeconds;
        vortex.vx *= Math.exp(-2.1 * deltaSeconds);
        vortex.vy *= Math.exp(-2.1 * deltaSeconds);
        if (vortex.age >= vortex.life) vortices.splice(vortexIndex, 1);
      }

      for (let index = 0; index < MAX_PARTICLES; index += 1) {
        if (particles.life[index] <= 0) continue;
        particles.age[index] += deltaSeconds;
        if (particles.age[index] >= particles.life[index]) {
          particles.life[index] = 0;
          continue;
        }

        let vx = particles.vx[index] * drag;
        let vy = particles.vy[index] * drag;
        const x = particles.x[index];
        const y = particles.y[index];
        const seed = particles.seed[index];
        const curlAngle =
          Math.sin(x * 10.7 + nowSeconds * 1.34 + seed) * 1.9 +
          Math.cos(y * 9.1 - nowSeconds * 1.08 - seed * 0.63);
        vx += Math.cos(curlAngle) * 0.055 * deltaSeconds;
        vy += (Math.sin(curlAngle) * 0.055 + 0.013) * deltaSeconds;

        for (const vortex of vortices) {
          const dx = x - vortex.x;
          const dy = y - vortex.y;
          const distanceSquared = dx * dx + dy * dy + 0.0008;
          if (distanceSquared > 0.095) continue;
          const vortexLife = 1 - vortex.age / vortex.life;
          const influence =
            vortex.strength * vortexLife * Math.exp(-distanceSquared * 31) * deltaSeconds;
          const inverseDistance = 1 / Math.sqrt(distanceSquared);
          vx += -dy * inverseDistance * influence * vortex.spin + vortex.vx * influence * 0.42;
          vy += dx * inverseDistance * influence * vortex.spin + vortex.vy * influence * 0.42;
        }

        const speed = Math.hypot(vx, vy);
        if (speed > 2.7) {
          vx = (vx / speed) * 2.7;
          vy = (vy / speed) * 2.7;
        }
        particles.vx[index] = vx;
        particles.vy[index] = vy;
        particles.x[index] += vx * deltaSeconds;
        particles.y[index] += vy * deltaSeconds;
        if (
          particles.x[index] < -0.18 ||
          particles.x[index] > 1.18 ||
          particles.y[index] < -0.18 ||
          particles.y[index] > 1.18
        ) {
          particles.life[index] = 0;
          continue;
        }
        alive += 1;
      }
      return alive;
    };

    const uploadAndDraw = () => {
      let count = 0;
      for (let index = 0; index < MAX_PARTICLES; index += 1) {
        const life = particles.life[index];
        if (life <= 0) continue;
        const progress = particles.age[index] / life;
        const fadeIn = clamp(particles.age[index] / 0.075, 0, 1);
        const fadeOut = Math.pow(Math.max(0, 1 - progress), 1.45);
        const alpha = particles.alpha[index] * fadeIn * fadeOut;
        const positionOffset = count * 2;
        const colorOffset = count * 4;
        drawPositions[positionOffset] = particles.x[index];
        drawPositions[positionOffset + 1] = particles.y[index];
        drawColors[colorOffset] = particles.red[index];
        drawColors[colorOffset + 1] = particles.green[index];
        drawColors[colorOffset + 2] = particles.blue[index];
        drawColors[colorOffset + 3] = alpha;
        drawSizes[count] = particles.size[index] * (0.72 + progress * 0.72);
        count += 1;
      }

      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!count) return 0;
      gl.useProgram(program);
      gl.uniform1f(pixelRatioLocation, renderPixelRatio);
      gl.uniform1f(maxPointSizeLocation, maxPointSize);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, drawPositions.subarray(0, count * 2));
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, drawColors.subarray(0, count * 4));
      gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, drawSizes.subarray(0, count));
      gl.vertexAttribPointer(sizeLocation, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, count);
      return count;
    };

    function draw(now) {
      animationFrame = 0;
      if (now - lastFrameAt < FRAME_INTERVAL_MS && lastFrameAt >= 0) {
        requestDraw();
        return;
      }
      resize();
      const deltaSeconds = clamp((now - lastSimulationAt) / 1000, 1 / 180, 0.045);
      lastSimulationAt = now;
      updateParticles(deltaSeconds, now / 1000);
      const count = uploadAndDraw();
      lastFrameAt = now;
      if (count > 0) {
        field.classList.add("status-flow-field--ready");
        requestDraw();
      } else {
        field.classList.remove("status-flow-field--ready");
      }
    }

    const startPointerFlow = (event) => {
      if (event.pointerType === "touch") return;
      pointerState.pointerId = event.pointerId;
      startTrail(event.clientX, event.clientY, event.timeStamp || performance.now());
    };

    const movePointerFlow = (event) => {
      if (event.pointerType === "touch" || event.pointerId !== pointerState.pointerId) return;
      continueTrail(event.clientX, event.clientY, event.timeStamp || performance.now());
    };

    const endPointerFlow = (event) => {
      if (event.pointerId === pointerState.pointerId) endTrail();
    };

    const startTouchFlow = (event) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      pointerState.touchId = touch.identifier;
      startTrail(touch.clientX, touch.clientY);
    };

    const moveTouchFlow = (event) => {
      const touch = Array.from(event.changedTouches).find(
        (item) => item.identifier === pointerState.touchId,
      );
      if (touch) continueTrail(touch.clientX, touch.clientY);
    };

    const endTouchFlow = (event) => {
      if (
        Array.from(event.changedTouches).some(
          (item) => item.identifier === pointerState.touchId,
        )
      ) {
        endTrail();
      }
    };

    panel.addEventListener("pointerdown", startPointerFlow, { passive: true });
    panel.addEventListener("pointermove", movePointerFlow, { passive: true });
    window.addEventListener("pointerup", endPointerFlow, { passive: true });
    window.addEventListener("pointercancel", endPointerFlow, { passive: true });
    panel.addEventListener("touchstart", startTouchFlow, { passive: true });
    panel.addEventListener("touchmove", moveTouchFlow, { passive: true });
    panel.addEventListener("touchend", endTouchFlow, { passive: true });
    panel.addEventListener("touchcancel", endTouchFlow, { passive: true });
    window.addEventListener("blur", endTrail);
    const resizeObserver = new ResizeObserver(() => {
      lastFrameAt = -Infinity;
      resize();
    });
    resizeObserver.observe(panel);
    resize();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      panel.removeEventListener("pointerdown", startPointerFlow);
      panel.removeEventListener("pointermove", movePointerFlow);
      window.removeEventListener("pointerup", endPointerFlow);
      window.removeEventListener("pointercancel", endPointerFlow);
      panel.removeEventListener("touchstart", startTouchFlow);
      panel.removeEventListener("touchmove", moveTouchFlow);
      panel.removeEventListener("touchend", endTouchFlow);
      panel.removeEventListener("touchcancel", endTouchFlow);
      window.removeEventListener("blur", endTrail);
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(colorBuffer);
      gl.deleteBuffer(sizeBuffer);
      gl.deleteProgram(program);
    };
  }, [active]);

  return (
    <div className="status-flow-field" aria-hidden="true">
      <canvas ref={canvasRef} className="status-flow-canvas" />
      <span className="status-flow-glint" />
    </div>
  );
}
