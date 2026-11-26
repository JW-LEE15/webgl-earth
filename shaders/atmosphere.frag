#version 300 es
// atmosphere.frag — 지구 가장자리 바깥의 대기 빛무리(halo)
//
// 원리: 대기 구의 뒷면(먼 쪽 반구)을 그리고, 각 픽셀로 향하는 시선 반직선이
//       지구 중심에 가장 가까이 다가가는 거리 d 를 구한다.
//   시선: C + t·D  (C: 카메라, D: 단위 방향).  최근접 매개변수 t* = −C·D,  d = |C + t*·D|
//   d < 1 이면 시선이 지구에 막힘 → 지구가 깊이 테스트로 앞에서 가린다.
//   1 ≤ d ≤ R_a 이면 대기를 스치는 시선 → 지표에 가까울수록(d → 1) 대기를 길게 통과하므로 밝게:
//       g = ((R_a − d) / (R_a − 1))^2.5
//   태양 쪽 가장자리만 밝도록 최근접점 방향과 태양 방향의 내적으로 가중한다.
// 혼합: 가산 혼합(ONE, ONE) — 배경(검은 우주) 위에 빛을 더한다.

precision highp float;

in vec3 vWorldPos;
out vec4 outColor;

uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform float uAtmoRadius;
uniform float uAtmoStrength;

void main() {
  vec3 D = normalize(vWorldPos - uCameraPos);
  float tc = -dot(uCameraPos, D);
  vec3 closest = uCameraPos + tc * D;
  float d = length(closest);

  float g = pow(clamp((uAtmoRadius - d) / (uAtmoRadius - 1.0), 0.0, 1.0), 2.5);
  float lit = smoothstep(-0.25, 0.35, dot(closest / max(d, 1e-4), normalize(uSunDir)));
  vec3 color = vec3(0.30, 0.55, 1.0) * g * (0.08 + 0.92 * lit) * uAtmoStrength;
  outColor = vec4(color, 1.0);
}
