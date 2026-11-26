// sphere.js — 위도/경도 격자(UV sphere) 메시 생성
//
// 좌표계: 오른손 좌표계, +Y = 북극, 위도 0°·경도 0°(적도·본초자오선) = +Z 방향, 경도 +90°(동경) = +X 방향.
//
// 위경도 → 직교 좌표 (반지름 1)
//   φ: 위도 ∈ [−π/2, π/2],  λ: 경도 ∈ [−π, π]
//   x = cos φ · sin λ
//   y = sin φ
//   z = cos φ · cos λ
//   (검산: x² + y² + z² = cos²φ(sin²λ + cos²λ) + sin²φ = 1)
//   단위 구에서는 위치 벡터 자체가 바깥 방향 법선이다: n = (x, y, z).
//
// equirectangular UV (이미지 왼쪽 위 = 경도 −180°, 북위 90°)
//   u = (λ + π) / 2π      → 0(−180°) … 1(+180°)
//   v = (π/2 − φ) / π     → 0(북극) … 1(남극)
//
// 정점 배치: index = i·(lonBands+1) + j
//   i = 0 … latBands : 북극(φ=+π/2) → 남극(φ=−π/2)
//   j = 0 … lonBands : λ=−π → λ=+π
//   j=0 과 j=lonBands 는 같은 위치지만 u 가 0 과 1 로 다르므로 따로 둔다(경도 이음매에서 텍스처가 끊기지 않게).
//   극점 행(i=0, i=latBands)도 정점을 lonBands+1 개 두어 모두 같은 점에 겹친다 → 극 부근 삼각형 하나는 넓이 0(퇴화).
//
// 삼각형 감김 방향: 구 바깥에서 볼 때 반시계(CCW).
//   격자 한 칸의 네 정점  a=(i,j)  c=(i,j+1)
//                         b=(i+1,j) d=(i+1,j+1)
//   바깥에서 보면 j 증가 = 동쪽 = 오른쪽, i 증가 = 남쪽 = 아래쪽이므로
//   (a, b, c), (c, b, d) 순서가 반시계가 된다.
//   검산: (b−a) × (c−a) 가 바깥 법선과 같은 방향(내적 > 0)이어야 함.

export function createUVSphere(latBands, lonBands) {
  if (!(Number.isInteger(latBands) && Number.isInteger(lonBands) && latBands >= 2 && lonBands >= 3)) {
    throw new Error(`createUVSphere: 분할 수가 잘못됨 (latBands=${latBands}, lonBands=${lonBands})`);
  }
  const rowLen = lonBands + 1;
  const vertexCount = (latBands + 1) * rowLen;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(latBands * lonBands * 6);

  let p = 0, t = 0;
  for (let i = 0; i <= latBands; i++) {
    const v = i / latBands;
    const phi = Math.PI / 2 - v * Math.PI;      // v = (π/2 − φ)/π  의 역변환
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    for (let j = 0; j <= lonBands; j++) {
      const u = j / lonBands;
      const lambda = u * 2 * Math.PI - Math.PI;  // u = (λ + π)/2π  의 역변환
      positions[p++] = cosPhi * Math.sin(lambda);
      positions[p++] = sinPhi;
      positions[p++] = cosPhi * Math.cos(lambda);
      uvs[t++] = u;
      uvs[t++] = v;
    }
  }

  let k = 0;
  for (let i = 0; i < latBands; i++) {
    for (let j = 0; j < lonBands; j++) {
      const a = i * rowLen + j;
      const b = a + rowLen;
      const c = a + 1;
      const d = b + 1;
      indices[k++] = a; indices[k++] = b; indices[k++] = c;
      indices[k++] = c; indices[k++] = b; indices[k++] = d;
    }
  }

  return { positions, uvs, indices };
}
