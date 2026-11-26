// gl-utils.js — WebGL2 컨텍스트 생성, 셰이더 컴파일/링크, 메시 버퍼(VAO) 생성 헬퍼

/**
 * WebGL2 컨텍스트를 얻는다. 지원하지 않으면 null.
 * (과제 방침: WebGL1 fallback 없이 WebGL2 전용)
 */
export function createGL2Context(canvas) {
  return canvas.getContext('webgl2', { antialias: true });
}

/** 텍스트 파일(셰이더 소스 등)을 읽는다. file:// 에서는 대부분의 브라우저가 막는다. */
export async function loadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 로드 실패 (HTTP ${res.status})`);
  return res.text();
}

/** 셰이더 하나를 컴파일한다. 실패하면 드라이버의 로그를 포함해 예외를 던진다. */
export function compileShader(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`셰이더 컴파일 실패 (${label}):\n${log}`);
  }
  return shader;
}

/**
 * 정점/프래그먼트 셰이더를 링크해 프로그램을 만든다.
 * attribLocations: { aPosition: 0, ... } — VAO 설정과 위치를 맞추기 위해 링크 전에 고정한다.
 */
export function createProgram(gl, vsSource, fsSource, attribLocations, label = 'program') {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource, `${label}.vert`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource, `${label}.frag`);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  for (const [name, loc] of Object.entries(attribLocations)) {
    gl.bindAttribLocation(program, loc, name);
  }
  gl.linkProgram(program);
  // 링크 후에는 셰이더 객체가 필요 없다.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`프로그램 링크 실패 (${label}):\n${log}`);
  }
  return program;
}

/** 프로그램에서 사용하는 uniform 위치를 이름 → 위치 객체로 모은다. */
export function getUniformLocations(gl, program, names) {
  const out = {};
  for (const name of names) {
    out[name] = gl.getUniformLocation(program, name);
    // 셰이더에서 쓰지 않는 uniform은 컴파일러가 제거해 null이 될 수 있다(오류는 아님).
    if (out[name] === null) console.warn(`uniform '${name}' 위치를 찾지 못함(미사용으로 제거됐을 수 있음)`);
  }
  return out;
}

/**
 * 메시 데이터를 GPU 버퍼에 올리고 VAO로 묶는다.
 * attributes: [{ location, data: Float32Array, size }]  (size = 정점당 성분 수)
 * indices: Uint32Array — WebGL2는 32비트 인덱스를 확장 없이 지원한다.
 * 반환: { vao, indexCount, buffers }  (buffers는 나중에 삭제할 때 사용)
 */
export function createMesh(gl, attributes, indices) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffers = [];

  for (const { location, data, size } of attributes) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    buffers.push(buf);
  }

  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); // VAO에 인덱스 버퍼 바인딩이 함께 저장된다
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  buffers.push(ibo);

  gl.bindVertexArray(null);
  return { vao, indexCount: indices.length, buffers };
}

/** createMesh로 만든 GPU 자원을 해제한다(분할 수를 바꿔 메시를 다시 만들 때 사용). */
export function deleteMesh(gl, mesh) {
  gl.deleteVertexArray(mesh.vao);
  for (const b of mesh.buffers) gl.deleteBuffer(b);
}

/**
 * 캔버스의 실제 픽셀 크기를 CSS 크기 × devicePixelRatio 에 맞춘다.
 * 저사양 기기를 위해 DPR에 상한(maxDPR)을 둔다 — 고해상도 화면에서 픽셀 수가 4배가 되는 것을 막는다.
 * 크기가 바뀌었으면 true.
 */
export function resizeCanvasToDisplaySize(canvas, maxDPR = 1.5) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDPR);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}
