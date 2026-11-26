// heightmap.js — 고도 데이터(int16 equirectangular) 로드 → WebGL2 R16F 텍스처
//
// 파일 형식 (ETOPO1 원본을 블록 평균해 미리 변환한 파일):
//   int16 little-endian, W×H, 단위 m, 첫 행 = 북위 90° 쪽, 첫 열 = 서경 180° 쪽.
//
// 왜 그레이스케일 PNG 가 아닌가?
//   8비트 그레이스케일은 −11000…+9000 m 를 256 단계로 나눠 한 단계가 약 78 m 가 된다.
//   과장 계수를 키우면 계단 모양 지형이 보이고, 고도 차분으로 구하는 법선이 깨진다.
//   또한 이미지 디코딩 과정에서 브라우저의 색 공간 변환/감마가 값을 바꿀 수 있다.
//   → 원시 int16 을 그대로 읽고 R16F(반정밀도 부동소수) 텍스처로 올린다.
//     half float 은 가수 10비트라 8000 m 부근에서 약 4 m 간격 — 표시 목적에는 충분하다.
//     R16F 는 WebGL2 에서 확장 없이 LINEAR 필터링이 가능하다(R32F 는 확장 필요).
//
// 남북 방향 (UNPACK_FLIP_Y_WEBGL):
//   texImage2D 는 버퍼의 첫 행을 텍스처 좌표 t=0 행으로 올린다.
//   데이터의 첫 행이 북극이고, 구의 UV 규약도 v=0 이 북극이므로 뒤집으면 안 된다 → FLIP_Y = false.
//   (이미지 파일을 쓰면서 FLIP_Y=true 로 올리는 흔한 예제 방식과 섞으면 남북이 뒤집힌다.)

import { loadText } from './gl-utils.js';

const ASSET_DIR = 'assets/';

/** heightmaps.json 을 읽어 해상도 목록을 돌려준다. */
export async function loadManifest() {
  return JSON.parse(await loadText(ASSET_DIR + 'heightmaps.json'));
}

/** .i16 파일 하나를 받아 Float32Array(미터)로 변환한다. */
export async function loadHeightData(level) {
  const res = await fetch(ASSET_DIR + level.file);
  if (!res.ok) throw new Error(`${level.file} 로드 실패 (HTTP ${res.status}). assets/ 폴더를 확인하세요.`);
  const buf = await res.arrayBuffer();
  const n = level.width * level.height;
  if (buf.byteLength !== n * 2) {
    throw new Error(`${level.file} 크기 ${buf.byteLength} 바이트, 기대값 ${n * 2}`);
  }
  // DataView 로 명시적으로 little-endian 해석 (기기 바이트 순서와 무관하게)
  const dv = new DataView(buf);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true);
  return out;
}

/**
 * 고도 텍스처 생성.
 *   - 가로(S): REPEAT — 경도는 주기적이므로 u<0, u>1 이 반대편으로 이어진다(이음매 법선 계산에 필요).
 *   - 세로(T): CLAMP_TO_EDGE — 극을 넘어가지 않는다.
 *   - LINEAR 필터, 밉맵 없음: R16F 는 색 렌더 가능 포맷이 아니라 generateMipmap 을 쓸 수 없다.
 */
export function createHeightTexture(gl, data, width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); // Float32 한 행 = 4·W 바이트 → 항상 4의 배수
  // 내부 포맷 R16F, 업로드 데이터는 RED/FLOAT(32비트) — WebGL2 가 허용하는 조합, GPU 에서 half 로 변환
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, width, height, 0, gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}
