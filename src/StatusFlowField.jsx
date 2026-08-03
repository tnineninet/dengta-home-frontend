import { useEffect, useRef } from "react";

const FRAME_INTERVAL_MS = 1000 / 24;

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

  float phase = u_time * 0.17;
  vec2 firstWarp = vec2(
    fbm(point * 1.7 + vec2(phase, -phase * 0.7)),
    fbm(point * 1.8 + vec2(7.3 - phase * 0.5, 2.4 + phase))
  );
  vec2 flowPoint = point + (firstWarp - 0.5) * (0.48 + pointerGlow * u_energy * 0.55);
  float detail = fbm(flowPoint * 3.4 + vec2(-phase * 0.8, phase * 0.55));
  float filament = pow(1.0 - abs(detail * 2.0 - 1.0), 3.0);

  vec2 orbitA = vec2(cos(phase), sin(phase * 1.17));
  vec2 orbitB = vec2(cos(phase * 0.73 + 2.1), sin(phase * 0.91 - 1.4));
  float cyan = glow(flowPoint, vec2(-0.34, 0.38) + orbitA * 0.24, vec2(0.72, 0.55));
  float magenta = glow(flowPoint, vec2(0.42, 0.16) + orbitB * 0.26, vec2(0.62, 0.82));
  float lime = glow(flowPoint, vec2(-0.4, -0.34) - orbitB * 0.2, vec2(0.58, 0.72));
  float gold = glow(flowPoint, vec2(0.28, -0.48) - orbitA * 0.22, vec2(0.72, 0.48));

  vec3 color = vec3(0.0);
  color += cyan * vec3(0.02, 0.55, 0.98);
  color += magenta * vec3(1.0, 0.04, 0.58);
  color += lime * vec3(0.42, 1.0, 0.06);
  color += gold * vec3(1.0, 0.45, 0.025);
  color *= 0.35 + detail * 0.72 + filament * 0.58;
  color += pointerGlow * u_energy * vec3(0.12, 0.7, 1.0) * 1.25;
  color += pointerRing * u_energy * vec3(1.0, 0.25, 0.78) * 0.72;
  color = mix(color, vec3(0.95, 0.92, 1.0), filament * 0.16);
  color = pow(max(color, 0.0), vec3(0.84));

  float body = max(max(cyan, magenta), max(lime, gold));
  float alpha = clamp(body * 0.5 + filament * body * 0.28 + pointerGlow * u_energy * 0.42, 0.0, 0.86);
  gl_FragColor = vec4(color, alpha);
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

    const pointerState = { x: 0.5, y: 0.55, energy: 0.16 };
    let animationFrame = 0;
    let lastFrameAt = -Infinity;
    const startedAt = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = window.matchMedia("(max-width: 820px)").matches ? 0.62 : 0.78;
      const width = Math.max(2, Math.round(rect.width * scale));
      const height = Math.max(2, Math.round(rect.height * scale));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };

    const moveFlow = (event) => {
      const rect = panel.getBoundingClientRect();
      pointerState.x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      pointerState.y = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      pointerState.energy = event.type === "pointerdown" ? 1 : 0.78;
      field.style.setProperty("--status-flow-x", `${pointerState.x * 100}%`);
      field.style.setProperty("--status-flow-y", `${(1 - pointerState.y) * 100}%`);
    };

    const draw = (now) => {
      if (now - lastFrameAt >= FRAME_INTERVAL_MS || lastFrameAt < 0) {
        resize();
        pointerState.energy = Math.max(0.12, pointerState.energy * 0.935);
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

    panel.addEventListener("pointerdown", moveFlow, { passive: true });
    panel.addEventListener("pointermove", moveFlow, { passive: true });
    const resizeObserver = new ResizeObserver(() => {
      lastFrameAt = -Infinity;
    });
    resizeObserver.observe(panel);
    animationFrame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      panel.removeEventListener("pointerdown", moveFlow);
      panel.removeEventListener("pointermove", moveFlow);
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
