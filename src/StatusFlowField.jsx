import { useEffect, useRef } from "react";

const FRAME_INTERVAL_MS = 1000 / 40;
const MAX_CANVAS_PIXELS = 1_800_000;

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_time;
uniform float u_energy;
varying vec2 v_uv;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float noise21(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

mat2 rotate2d(float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return mat2(cosine, -sine, sine, cosine);
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.55;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise21(point);
    point = rotate2d(0.63) * point * 2.04 + vec2(8.2, 3.7);
    amplitude *= 0.48;
  }
  return value;
}

float glow(vec2 point, vec2 center, vec2 radius) {
  vec2 local = (point - center) / radius;
  return exp(-2.15 * dot(local, local));
}

void main() {
  vec2 point = v_uv * 2.0 - 1.0;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  point.x *= aspect;

  vec2 pointer = u_pointer * 2.0 - 1.0;
  pointer.x *= aspect;
  vec2 delta = point - pointer;
  float pointerGlow = exp(-4.6 * dot(delta, delta));
  float pointerRing = exp(-42.0 * abs(length(delta) - 0.19 - u_energy * 0.08));
  point = pointer + rotate2d(pointerGlow * u_energy * 1.8) * delta;

  float phase = u_time * 0.42;
  vec2 firstWarp = vec2(
    fbm(point * 1.38 + vec2(phase, -phase * 0.62)),
    fbm(point * 1.46 + vec2(7.3 - phase * 0.54, 2.4 + phase))
  );
  vec2 flowPoint = point + (firstWarp - 0.5) * (0.18 + pointerGlow * 0.48);
  vec2 flowDelta = flowPoint - pointer;
  float plume = exp(-1.72 * dot(flowDelta, flowDelta));
  float detail = fbm(flowPoint * 2.62 + vec2(-phase * 0.72, phase * 0.48));
  float filament = pow(1.0 - abs(detail * 2.0 - 1.0), 4.2);
  float spectralPhase = detail * 2.1 + atan(flowDelta.y, flowDelta.x) / 6.2831853 + phase * 0.08;
  vec3 color = 0.56 + 0.5 * cos(6.2831853 * (spectralPhase + vec3(0.0, 0.33, 0.67)));
  color *= plume * (0.44 + detail * 0.78 + filament * 0.38);
  color += pointerGlow * vec3(0.08, 0.64, 1.0) * 0.84;
  color += pointerRing * vec3(1.0, 0.18, 0.7) * 0.5;
  color = mix(color, vec3(0.98), filament * plume * 0.1);
  color = pow(max(color, 0.0), vec3(0.84));

  float alpha = clamp((plume * (0.28 + filament * 0.32) + pointerGlow * 0.34) * u_energy, 0.0, 0.9);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

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

    const position = gl.getAttribLocation(program, "a_position");
    const resolution = gl.getUniformLocation(program, "u_resolution");
    const pointer = gl.getUniformLocation(program, "u_pointer");
    const time = gl.getUniformLocation(program, "u_time");
    const energy = gl.getUniformLocation(program, "u_energy");
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.useProgram(program);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const pointerState = { x: 0.5, y: 0.55, energy: 0 };
    let animationFrame = 0;
    let lastFrameAt = -Infinity;
    let activePointer = null;
    const startedAt = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2.25, Math.max(1, window.devicePixelRatio || 1));
      const requestedPixels = rect.width * rect.height * dpr * dpr;
      const scale = dpr * Math.min(
        1,
        Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, requestedPixels)),
      );
      const width = Math.max(2, Math.round(rect.width * scale));
      const height = Math.max(2, Math.round(rect.height * scale));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };

    const startFlow = (event) => {
      activePointer = event.pointerId;
      moveFlow(event);
    };

    const moveFlow = (event) => {
      if (event.type === "pointermove" && event.pointerId !== activePointer) return;
      const rect = panel.getBoundingClientRect();
      pointerState.x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      pointerState.y = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      pointerState.energy = event.type === "pointerdown" ? 1 : 0.78;
      field.style.setProperty("--status-flow-x", `${pointerState.x * 100}%`);
      field.style.setProperty("--status-flow-y", `${(1 - pointerState.y) * 100}%`);
      if (!animationFrame) animationFrame = requestAnimationFrame(draw);
    };

    const endFlow = (event) => {
      if (event.pointerId === activePointer) activePointer = null;
    };

    const draw = (now) => {
      animationFrame = 0;
      if (now - lastFrameAt >= FRAME_INTERVAL_MS || lastFrameAt < 0) {
        resize();
        pointerState.energy *= 0.954;
        if (pointerState.energy < 0.008) {
          pointerState.energy = 0;
          gl.clear(gl.COLOR_BUFFER_BIT);
          field.classList.remove("status-flow-field--ready");
          return;
        }
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniform2f(resolution, canvas.width, canvas.height);
        gl.uniform2f(pointer, pointerState.x, pointerState.y);
        gl.uniform1f(time, (now - startedAt) / 1000);
        gl.uniform1f(energy, pointerState.energy);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        field.classList.add("status-flow-field--ready");
        lastFrameAt = now;
      }
      animationFrame = requestAnimationFrame(draw);
    };

    panel.addEventListener("pointerdown", startFlow, { passive: true });
    panel.addEventListener("pointermove", moveFlow, { passive: true });
    window.addEventListener("pointerup", endFlow, { passive: true });
    window.addEventListener("pointercancel", endFlow, { passive: true });
    const resizeObserver = new ResizeObserver(() => {
      lastFrameAt = -Infinity;
    });
    resizeObserver.observe(panel);
    resize();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      panel.removeEventListener("pointerdown", startFlow);
      panel.removeEventListener("pointermove", moveFlow);
      window.removeEventListener("pointerup", endFlow);
      window.removeEventListener("pointercancel", endFlow);
      gl.deleteBuffer(buffer);
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
