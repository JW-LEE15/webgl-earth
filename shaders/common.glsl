// common.glsl — 정점/프래그먼트 셰이더가 함께 쓰는 상수·uniform·함수
// main.js 가 각 셰이더의 "#version 300 es" 바로 다음 줄에 이 내용을 끼워 넣는다(GLSL 에는 #include 가 없음).
//
// 정밀도: 두 단계에서 같은 이름의 uniform 은 정밀도까지 같아야 링크된다.
//   프래그먼트 셰이더의 int 기본 정밀도는 mediump, 정점 셰이더는 highp 이므로 여기서 통일한다.
precision highp float;
precision highp int;
precision highp sampler2D;

const float PI = 3.14159265358979;
const float EARTH_RADIUS_M = 6371000.0;   // 지구 평균 반지름 [m] — 모델에서는 반지름 1 로 정규화

uniform sampler2D uHeight;     // 고도 [m], R16F, equirectangular (v=0 북극)
uniform float uExaggeration;   // 고도 과장 계수 (1 = 실제 비율)
uniform int uOceanMode;        // 0: 해수면 평평, 1: 해저 지형(수심)까지 변위

// 고도 샘플 [m]. 밉맵이 없으므로 LOD 0 을 명시(정점 셰이더에는 미분이 없어 어차피 LOD 0).
float heightAt(vec2 uv) {
  return textureLod(uHeight, uv, 0.0).r;
}

// 고도 h[m] → 단위 구 기준 반지름 증가량 s.
//   실제 비율: s = h / R_earth  (에베레스트 8848 m → 0.0014, 즉 반지름의 0.14%)
//   과장 비율: s = k · h / R_earth   (k = uExaggeration)
//   해수면 평평 모드에서는 바다(h<0)를 0 으로 잘라 해수면(반지름 1)에 둔다.
float reliefOf(float h) {
  float hh = (uOceanMode == 0) ? max(h, 0.0) : h;
  return hh * uExaggeration / EARTH_RADIUS_M;
}

// UV → 위도 φ, 경도 λ  (sphere.js 의 u=(λ+π)/2π, v=(π/2−φ)/π 의 역변환)
vec2 uvToLatLon(vec2 uv) {
  return vec2(PI * 0.5 - uv.y * PI, uv.x * 2.0 * PI - PI);
}
