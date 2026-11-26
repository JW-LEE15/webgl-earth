// main.js — 진입점: WebGL2 초기화, 메시·고도 텍스처 생성, 렌더 루프, UI 연결

import {
  createGL2Context, loadText, createProgram, getUniformLocations,
  createMesh, deleteMesh, resizeCanvasToDisplaySize,
} from './gl-utils.js';
import * as mat4 from './mat4.js';
import { createUVSphere } from './sphere.js';
import { loadManifest, loadHeightData, createHeightTexture } from './heightmap.js';
import { earthAndSun, dateToDayOfYear, formatDay } from './astro.js';
import { OrbitCamera } from './camera.js';
import { Panel } from './ui.js';

// ---- 상태 (UI 에서 바꾸는 값) ----
const state = {
  // 성능
  latBands: 128,       // 위도 방향 분할 수
  lonBands: 256,       // 경도 방향 분할 수 (경도 범위가 위도의 2배라 2배로 두면 격자가 대략 정사각형)
  maxDPR: 1.5,         // devicePixelRatio 상한 (저사양 대비)
  heightLevel: 1,      // heightmaps.json 의 levels 인덱스 (기본 2160×1080)
  // 지형
  exaggeration: 40,    // 고도 과장 계수
  oceanMode: 0,        // 0: 해수면 평평, 1: 해저 지형
  viewMode: 0,         // 0: 조명, 1: UV 격자, 2: 고도 그레이스케일, 3: 법선, 4: 조명 없는 고도 색
  // 조명
  ambient: 0.04,       // 주변광 세기
  specular: 0.6,       // 바다 반사 세기
  atmosphere: 1.0,     // 대기 효과 세기 (0 = 끔)
  // 시간 (자전·태양)
  day: 0,              // 1월 1일 기준 날짜 (0 … 364)
  hour: 12,            // UTC 시각 (0 … 24)
  timeSpeed: 1,        // 시뮬레이션 속도 [시간/초]  1 → 하루가 24초
  paused: false,
  annual: true,        // 날짜도 함께 흐르게 할지(공전에 따른 태양 적위 변화)
  followEarth: false,  // 카메라를 지구와 함께 돌릴지(지표 기준으로 낮/밤 경계가 움직이는 모습)
};

const ATMO_RADIUS = 1.05;  // 대기 구 반지름 (지구 = 1)

// 셰이더 attribute 위치 — createProgram 과 VAO 설정에서 같은 값을 쓴다.
const ATTRIB = { aPosition: 0, aUV: 1 };

const canvas = document.getElementById('gl-canvas');
const hud = {
  fps: document.getElementById('fps'),
  vertexCount: document.getElementById('vertex-count'),
  triCount: document.getElementById('tri-count'),
  glInfo: document.getElementById('gl-info'),
  status: document.getElementById('status'),
};

function showError(message) {
  const el = document.getElementById('error');
  el.textContent = message;
  el.hidden = false;
  console.error(message);
}

/** 공통 GLSL 을 "#version" 줄 바로 뒤에 끼워 넣는다(#version 은 반드시 첫 줄이어야 함). */
function injectCommon(source, common) {
  const nl = source.indexOf('\n');
  return source.slice(0, nl + 1) + common + '\n' + source.slice(nl + 1);
}

/** 현재 시각(UTC)으로 day/hour 를 맞춘다. */
function setTimeToNow() {
  const t = dateToDayOfYear(new Date());
  state.day = Math.min(364, Math.floor(t));
  state.hour = (t - Math.floor(t)) * 24;
}

async function main() {
  const gl = createGL2Context(canvas);
  if (!gl) {
    showError('이 브라우저/그래픽 환경은 WebGL2를 지원하지 않습니다.\n' +
      '최신 Chrome, Edge, Firefox에서 열거나, 브라우저 설정에서 하드웨어 가속을 켜 주세요.');
    return;
  }
  hud.glInfo.textContent = gl.getParameter(gl.VERSION);

  const [common, earthVS, earthFS, atmoVS, atmoFS, manifest] = await Promise.all([
    loadText('shaders/common.glsl'),
    loadText('shaders/earth.vert'),
    loadText('shaders/earth.frag'),
    loadText('shaders/atmosphere.vert'),
    loadText('shaders/atmosphere.frag'),
    loadManifest(),
  ]);
  const earthProg = createProgram(gl,
    injectCommon(earthVS, common), injectCommon(earthFS, common), ATTRIB, 'earth');
  const ue = getUniformLocations(gl, earthProg, [
    'uModel', 'uView', 'uProj', 'uHeight', 'uExaggeration', 'uOceanMode', 'uViewMode',
    'uSunDir', 'uCameraPos', 'uAmbient', 'uSpecular', 'uAtmoStrength',
  ]);
  const atmoProg = createProgram(gl, atmoVS, atmoFS, { aPosition: ATTRIB.aPosition }, 'atmosphere');
  const ua = getUniformLocations(gl, atmoProg, [
    'uView', 'uProj', 'uAtmoRadius', 'uCameraPos', 'uSunDir', 'uAtmoStrength',
  ]);

  // ---- 구 메시 (분할 수를 바꾸면 다시 만든다). 대기층도 같은 메시를 반지름만 키워 쓴다 ----
  let mesh = null;
  function rebuildMesh() {
    if (mesh) deleteMesh(gl, mesh);
    const s = createUVSphere(state.latBands, state.lonBands);
    mesh = createMesh(gl, [
      { location: ATTRIB.aPosition, data: s.positions, size: 3 },
      { location: ATTRIB.aUV, data: s.uvs, size: 2 },
    ], s.indices);
    hud.vertexCount.textContent = (s.positions.length / 3).toLocaleString();
    hud.triCount.textContent = (s.indices.length / 3).toLocaleString();
  }
  rebuildMesh();

  // ---- 고도 텍스처 (해상도를 바꾸면 다시 받는다. 한 번 받은 데이터는 캐시) ----
  let heightTex = null;
  const heightCache = new Map();
  let loadToken = 0;
  async function loadHeightLevel(index) {
    const token = ++loadToken;  // 연달아 바꿀 때 마지막 요청만 반영
    const level = manifest.levels[index];
    hud.status.textContent = `고도 데이터 로드 중: ${level.width}×${level.height}`;
    let data = heightCache.get(index);
    if (!data) {
      data = await loadHeightData(level);
      heightCache.set(index, data);
    }
    if (token !== loadToken) return;
    const tex = createHeightTexture(gl, data, level.width, level.height);
    if (heightTex) gl.deleteTexture(heightTex);
    heightTex = tex;
    hud.status.textContent = `고도 맵: ${level.width}×${level.height}`;
  }
  await loadHeightLevel(state.heightLevel);

  setTimeToNow();
  // URL 파라미터로 초기 상태 지정 (보고서 스크린샷 재현용)
  //   예) index.html?day=171&hour=12&paused=1&yaw=0.5&pitch=0.3&dist=3&exag=60&follow=1
  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  state.day = Math.max(0, Math.min(364, Math.round(num('day', state.day))));
  state.hour = Math.max(0, Math.min(24, num('hour', state.hour)));
  state.paused = q.get('paused') === '1';
  state.followEarth = q.get('follow') === '1';
  state.exaggeration = num('exag', state.exaggeration);
  const camera = new OrbitCamera(canvas, {
    yaw: num('yaw', 0), pitch: num('pitch', 0.35), distance: num('dist', 3.2),
  });

  // ---- UI ----
  const panel = new Panel(document.getElementById('panel'));

  panel.section('시간 · 자전');
  const readTime = panel.readout('날짜/시각');
  const readSun = panel.readout('태양 직하점');
  const daySlider = panel.slider('날짜', {
    min: 0, max: 364, step: 1, value: state.day,
    format: (v) => formatDay(v + 0.5).split(' ').slice(0, 2).join(' '),
    onInput: (v) => { state.day = v; },
  });
  const hourSlider = panel.slider('시각(UTC)', {
    min: 0, max: 24, step: 0.05, value: state.hour,
    format: (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.floor((v % 1) * 60)).padStart(2, '0')}`,
    onInput: (v) => { state.hour = v; },
  });
  panel.slider('시간 속도', {
    min: 0, max: 48, step: 0.25, value: state.timeSpeed,
    format: (v) => `${v}시간/초`, onInput: (v) => { state.timeSpeed = v; },
  });
  const pauseBtn = panel.button(state.paused ? '재생' : '일시정지', () => {
    state.paused = !state.paused;
    pauseBtn.textContent = state.paused ? '재생' : '일시정지';
  });
  panel.button('현재 시각', () => setTimeToNow());
  panel.checkbox('날짜도 진행', { checked: state.annual, onChange: (v) => { state.annual = v; } });
  panel.checkbox('지구 고정 시점', { checked: state.followEarth, onChange: (v) => { state.followEarth = v; } });

  panel.section('지형');
  panel.slider('과장 계수', {
    min: 0, max: 100, step: 1, value: state.exaggeration,
    format: (v) => `×${v}`, onInput: (v) => { state.exaggeration = v; },
  });
  panel.select('바다', {
    options: [{ value: 0, label: '해수면 평평' }, { value: 1, label: '해저 지형(수심)' }],
    value: state.oceanMode, onChange: (v) => { state.oceanMode = Number(v); },
  });
  panel.select('보기', {
    options: [{ value: 0, label: '조명' }, { value: 4, label: '고도 색(조명 없음)' },
      { value: 3, label: '법선(디버그)' }, { value: 1, label: 'UV 격자(디버그)' },
      { value: 2, label: '고도 그레이스케일' }],
    value: state.viewMode, onChange: (v) => { state.viewMode = Number(v); },
  });

  panel.section('조명');
  panel.slider('주변광', {
    min: 0, max: 0.3, step: 0.01, value: state.ambient,
    format: (v) => v.toFixed(2), onInput: (v) => { state.ambient = v; },
  });
  panel.slider('바다 반사', {
    min: 0, max: 2, step: 0.05, value: state.specular,
    format: (v) => v.toFixed(2), onInput: (v) => { state.specular = v; },
  });
  panel.slider('대기', {
    min: 0, max: 2, step: 0.05, value: state.atmosphere,
    format: (v) => (v === 0 ? '끔' : v.toFixed(2)), onInput: (v) => { state.atmosphere = v; },
  });

  // 성능: 저사양(내장 그래픽)에서는 메시 분할 수와 렌더 해상도를 먼저 낮춘다.
  //   정점 셰이더 비용 ∝ 정점 수,  프래그먼트 셰이더 비용 ∝ 화면 픽셀 수 (픽셀당 고도 텍스처 6회 읽기: 색 1 + 법선 5)
  panel.section('성능');
  const meshOptions = [[32, 64], [64, 128], [128, 256], [256, 512], [512, 1024]];
  panel.select('구 분할', {
    options: meshOptions.map(([la, lo], i) => ({
      value: i, label: `${la}×${lo} (정점 ${((la + 1) * (lo + 1)).toLocaleString()})`,
    })),
    value: meshOptions.findIndex(([la]) => la === state.latBands),
    onChange: (v) => {
      [state.latBands, state.lonBands] = meshOptions[Number(v)];
      rebuildMesh();
    },
  });
  panel.select('고도 맵', {
    options: manifest.levels.map((l, i) => ({
      value: i, label: `${l.width}×${l.height} (${(l.width * l.height * 2 / 1048576).toFixed(1)} MB)`,
    })),
    value: state.heightLevel,
    onChange: (v) => {
      state.heightLevel = Number(v);
      loadHeightLevel(state.heightLevel).catch((e) => showError(e.message));
    },
  });
  panel.slider('렌더 해상도', {
    min: 0.5, max: 2, step: 0.25, value: state.maxDPR,
    format: (v) => `DPR ≤ ${v}`, onInput: (v) => { state.maxDPR = v; },
  });
  const readRes = panel.readout('캔버스');

  // ---- 렌더 상태 ----
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.frontFace(gl.CCW);
  gl.clearColor(0.0, 0.0, 0.02, 1.0);

  let fpsFrames = 0, fpsLast = performance.now();
  let lastTime = performance.now();
  let uiLast = 0;

  function advanceTime(dt) {
    if (state.paused) return;
    state.hour += state.timeSpeed * dt;
    while (state.hour >= 24) {
      state.hour -= 24;
      if (state.annual) state.day = (state.day + 1) % 365;
    }
  }

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1); // 탭 복귀 시 큰 점프 방지
    lastTime = now;
    advanceTime(dt);

    // 시뮬레이션 시각 t[일] → 지구 모델 행렬(기울기·자전), 태양 방향
    const t = state.day + state.hour / 24;
    const astro = earthAndSun(t);
    const model = astro.model;

    // 카메라: 기본은 월드(황도) 고정 → 지구가 도는 모습이 보인다.
    // "지구 고정 시점"이면 카메라도 지구와 함께 돈다: V' = V · M⁻¹ = V · Mᵀ (M 은 회전뿐)
    //   → 화면에서 지구는 멈춰 있고 낮/밤 경계가 지표 위를 지나간다.
    let view = camera.viewMatrix();
    let eye = camera.eye();
    if (state.followEarth) {
      view = mat4.multiply(view, mat4.transpose(model));
      eye = mat4.transformDirection(model, eye);  // 월드 공간 카메라 위치 = M · eye
    }

    resizeCanvasToDisplaySize(canvas, state.maxDPR);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const near = Math.max(0.01, (camera.distance - 1.1) * 0.5);
    const proj = mat4.perspective(45 * Math.PI / 180, canvas.width / canvas.height, near, 50);

    // ---- 1) 지구 ----
    gl.useProgram(earthProg);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.cullFace(gl.BACK);
    gl.uniformMatrix4fv(ue.uModel, false, model);
    gl.uniformMatrix4fv(ue.uView, false, view);
    gl.uniformMatrix4fv(ue.uProj, false, proj);
    gl.uniform1f(ue.uExaggeration, state.exaggeration);
    gl.uniform1i(ue.uOceanMode, state.oceanMode);
    gl.uniform1i(ue.uViewMode, state.viewMode);
    gl.uniform3fv(ue.uSunDir, astro.sunDir);
    gl.uniform3fv(ue.uCameraPos, eye);
    gl.uniform1f(ue.uAmbient, state.ambient);
    gl.uniform1f(ue.uSpecular, state.specular);
    gl.uniform1f(ue.uAtmoStrength, state.viewMode === 0 ? state.atmosphere : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, heightTex);
    gl.uniform1i(ue.uHeight, 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);

    // ---- 2) 대기 빛무리: 뒷면만 그리고(앞면 제거) 가산 혼합, 깊이는 쓰지 않음 ----
    if (state.atmosphere > 0 && state.viewMode === 0) {
      gl.useProgram(atmoProg);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.cullFace(gl.FRONT);
      gl.uniformMatrix4fv(ua.uView, false, view);
      gl.uniformMatrix4fv(ua.uProj, false, proj);
      gl.uniform1f(ua.uAtmoRadius, ATMO_RADIUS);
      gl.uniform3fv(ua.uCameraPos, eye);
      gl.uniform3fv(ua.uSunDir, astro.sunDir);
      gl.uniform1f(ua.uAtmoStrength, state.atmosphere);
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.cullFace(gl.BACK);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);

    // ---- UI 갱신 (매 프레임 DOM 을 건드리지 않도록 0.1초 간격) ----
    if (now - uiLast > 100) {
      uiLast = now;
      readTime(formatDay(t));
      readRes(`${canvas.width}×${canvas.height}`);
      const deg = 180 / Math.PI;
      const lat = astro.declination * deg, lon = astro.subsolarLon * deg;
      readSun(`${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`);
      if (!state.paused && state.timeSpeed > 0) {
        daySlider.set(state.day);
        hourSlider.set(state.hour);
      }
    }

    fpsFrames++;
    if (now - fpsLast >= 500) {
      hud.fps.textContent = (fpsFrames * 1000 / (now - fpsLast)).toFixed(1);
      fpsFrames = 0;
      fpsLast = now;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((e) => showError(e.message));
