// mat4.js — 4x4 행렬 연산 (gl-matrix 대신 직접 구현)
//
// 규약
//   - 행렬은 Float32Array(16), column-major(열 우선) 저장: m[col*4 + row] = (row, col) 원소.
//     WebGL의 uniformMatrix4fv(loc, false, m)에 전치 없이 그대로 넘길 수 있다.
//   - 열 벡터 규약: v' = M · v.  여러 변환의 합성 A·B 는 "B를 먼저, 그다음 A" 를 의미한다.
//   - 모든 함수는 새 배열을 반환하고 입력을 바꾸지 않는다(프레임당 몇 개 할당은 무시할 만한 비용).
//   - 회전은 오른손 법칙: 축의 + 방향에서 원점을 내려다볼 때 반시계 방향이 + 각도.

/** 단위 행렬 I */
export function create() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/**
 * 행렬 곱 C = A · B
 * C(r,c) = Σ_k A(r,k) · B(k,c)   →  column-major 인덱스로 C[c*4+r] = Σ_k A[k*4+r] · B[c*4+k]
 */
export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** 전치 행렬 Aᵀ. 순수 회전 행렬 R 은 직교 행렬이므로 R⁻¹ = Rᵀ (역행렬 대신 사용). */
export function transpose(a) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r * 4 + c];
  }
  return out;
}

/**
 * 원근 투영 행렬 (OpenGL 관례: 카메라는 -Z 방향을 바라봄)
 *   f = 1 / tan(fovy / 2)
 *         ┌ f/aspect  0        0                    0                ┐
 *   P  =  │ 0         f        0                    0                │
 *         │ 0         0   (far+near)/(near-far)  2·far·near/(near-far)│
 *         └ 0         0       -1                    0                ┘
 *   - x, y: 시야각에 따라 축소 (화면 비율 보정은 x에만)
 *   - w_clip = -z_eye  → 원근 나눗셈(x/w, y/w)으로 먼 물체가 작아짐
 *   - z_eye = -near → NDC z = -1,  z_eye = -far → NDC z = +1
 */
export function perspective(fovyRad, aspect, near, far) {
  const f = 1 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

/**
 * 뷰 행렬 (월드 → 카메라 공간)
 *   z축(카메라 뒤쪽) = normalize(eye − center)
 *   x축(오른쪽)      = normalize(up × z)
 *   y축(위쪽)        = z × x
 *   카메라 좌표계의 세 축을 행(row)으로 갖는 회전 R 과 평행이동 −eye 를 합성:
 *   V = R · T(−eye)  →  V 의 4번째 열 = (−x·eye, −y·eye, −z·eye)
 */
export function lookAt(eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz);
  zx /= len; zy /= len; zz /= len;

  // x = up × z
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz);
  if (len < 1e-8) throw new Error('lookAt: up 벡터가 시선 방향과 평행합니다');
  xx /= len; xy /= len; xz /= len;

  // y = z × x (이미 단위 벡터)
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  const m = new Float32Array(16);
  m[0] = xx; m[4] = xy; m[8] = xz;
  m[1] = yx; m[5] = yy; m[9] = yz;
  m[2] = zx; m[6] = zy; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

/**
 * X축 회전 m · Rx(θ)
 *        ┌ 1   0    0 ┐
 *   Rx = │ 0  cos −sin│   (y → z 방향으로 회전)
 *        └ 0  sin  cos┘
 */
export function rotateX(m, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const r = create();
  r[5] = c; r[6] = s;    // 1열 = (0, c, s)
  r[9] = -s; r[10] = c;  // 2열 = (0, −s, c)
  return multiply(m, r);
}

/**
 * Y축 회전 m · Ry(θ)
 *        ┌ cos  0  sin┐
 *   Ry = │  0   1   0 │   (z → x 방향으로 회전)
 *        └−sin  0  cos┘
 */
export function rotateY(m, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const r = create();
  r[0] = c; r[2] = -s;   // 0열 = (c, 0, −s)
  r[8] = s; r[10] = c;   // 2열 = (s, 0, c)
  return multiply(m, r);
}

/**
 * Z축 회전 m · Rz(θ)
 *        ┌cos −sin  0┐
 *   Rz = │sin  cos  0│   (x → y 방향으로 회전)
 *        └ 0    0   1┘
 */
export function rotateZ(m, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const r = create();
  r[0] = c; r[1] = s;    // 0열 = (c, s, 0)
  r[4] = -s; r[5] = c;   // 1열 = (−s, c, 0)
  return multiply(m, r);
}

/** 방향 벡터 변환: 3x3 부분만 곱한다(평행이동 무시). 반환은 [x, y, z] 배열. */
export function transformDirection(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ];
}
