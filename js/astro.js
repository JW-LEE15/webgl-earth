// astro.js — 자전축 기울기, 자전, 태양 방향 계산 (WebGL 과 무관한 순수 함수)
//
// 월드 좌표계 (황도 좌표계로 둔다)
//   +Y = 황도면의 북쪽 법선. 태양은 지구에서 볼 때 1년 동안 Y축을 중심으로 한 바퀴 돈다.
//   지구 자전축은 +Y 에서 +X 쪽으로 ε = 23.44° 기울어져 있고, 공간에서 방향이 고정된다.
//
// 모델 행렬 (모델 공간 = 지구 고정 좌표계, sphere.js 의 위경도 좌표계)
//   M = Rz(−ε) · Ry(ω)
//   - Ry(ω): 자전. 북극(+Y) 위에서 볼 때 반시계 방향(오른손 법칙) = 서→동 자전
//   - Rz(−ε): 자전축을 +X 쪽으로 기울임. Rz(−ε)·(0,1,0) = (sin ε, cos ε, 0)
//
// 태양 방향 (지구 → 태양, 월드 공간)
//   황경 θ (춘분점 기준 태양의 위치각): θ ≈ 2π · (t − t_춘분) / 365.25
//   L(θ) = Ry(θ)·(0,0,1) = (sin θ, 0, cos θ)
//   - 춘분 θ=0  : L = +Z  (자전축 기울기 방향 +X 와 수직 → 적위 0°)
//   - 하지 θ=90°: L = +X  (북극이 태양 쪽 → 적위 +ε)
//   적위 δ (태양이 적도면에서 벗어난 각): sin δ = sin θ · sin ε   (구면 천문학의 표준식과 같음)
//
// 자전각 ω 결정 (태양 바로 아래 지점의 경도 = 그 시각의 정오 자오선)
//   지구 고정 좌표계로 옮긴 태양 방향  L' = M⁻¹ L = Ry(−ω) · Rz(ε) · L
//   Rz(ε)·L = (sin θ cos ε, sin θ sin ε, cos θ)  의 방위각 α = atan2(x, z)
//   Ry(−ω) 는 방위각을 ω 만큼 줄이므로 태양 직하점 경도 λ_s = α − ω
//   UTC 시각 T(시간) 에서 λ_s = −15°·(T − 12)  (UTC 12시에 본초자오선이 정오)
//   → ω = α + 2π·(T/24 − 1/2)
//
// 근사와 한계 (보고서에 명시)
//   - 공전 궤도를 원으로 가정(태양 각속도 일정), 균시차(최대 약 ±16분) 무시
//   - 춘분 시각을 매년 3월 20일 19시 UTC 근처(t = 78.8일)로 고정, 세차 운동 무시
//   → 적위 오차 1° 안팎, 정오 자오선 오차 최대 약 4° 수준의 시각화용 근사

import * as mat4 from './mat4.js';

export const OBLIQUITY = 23.44 * Math.PI / 180;  // 자전축 기울기 ε
export const TROPICAL_YEAR = 365.25;              // [일]
export const EQUINOX_DAY = 78.8;                  // 1월 1일 0시 UTC 기준 춘분까지의 일수(근사)

/**
 * t: 1월 1일 0시 UTC 부터 지난 일수(소수 포함). 예) 172.5 = 6월 21일(평년) 12시 UTC
 * 반환: { model, sunDir, declination, subsolarLon, spin }
 *   model: 지구 모델 행렬 (Float32Array 16), sunDir: 월드 공간 태양 방향 [x,y,z]
 */
export function earthAndSun(t) {
  const theta = 2 * Math.PI * (t - EQUINOX_DAY) / TROPICAL_YEAR;
  const sunDir = [Math.sin(theta), 0, Math.cos(theta)];

  // Rz(ε)·L 의 방위각
  const lx = Math.sin(theta) * Math.cos(OBLIQUITY);
  const ly = Math.sin(theta) * Math.sin(OBLIQUITY);
  const lz = Math.cos(theta);
  const alpha = Math.atan2(lx, lz);

  const hoursUTC = (t - Math.floor(t)) * 24;
  const spin = alpha + 2 * Math.PI * (hoursUTC / 24 - 0.5);

  const model = mat4.rotateY(mat4.rotateZ(mat4.create(), -OBLIQUITY), spin);
  const declination = Math.asin(ly);                       // sin δ = sin θ sin ε
  let subsolarLon = -(hoursUTC - 12) * 15 * Math.PI / 180; // λ_s = −15°(T−12)
  subsolarLon = Math.atan2(Math.sin(subsolarLon), Math.cos(subsolarLon)); // [−π, π] 로 정리
  return { model, sunDir, declination, subsolarLon, spin };
}

/** Date → 그 해 1월 1일 0시 UTC 부터 지난 일수 */
export function dateToDayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return (date.getTime() - start) / 86400000;
}

/** 일수 → "M월 D일 HH:MM UTC" (평년 기준 표시) */
export function formatDay(t) {
  const ms = Date.UTC(2025, 0, 1) + t * 86400000; // 2025년은 평년
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${hh}:${mm} UTC`;
}
