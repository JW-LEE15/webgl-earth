#version 300 es
// earth.vert — 정점 변위(displacement) + MVP 변환
//
// 1) 변위: 단위 구 위의 점 p (= 바깥 법선 n) 를 고도만큼 법선 방향으로 민다.
//      p' = p + s·n = (1 + s)·p,   s = k·h / R_earth   (common.glsl 의 reliefOf)
//    단위 구에서는 위치 벡터가 곧 법선이므로 반지름을 바꾸는 것과 같다.
//
// 2) 좌표 변환 (열 벡터 규약, column-major):
//      clip = P · V · M · p'
//    M (uModel): 모델 → 월드 (자전축 기울기·자전)
//    V (uView) : 월드 → 카메라 (lookAt)
//    P (uProj) : 카메라 → 클립 (원근 투영). 이후 GPU 가 w 로 나눠 NDC 로 만든다.

layout(location = 0) in vec3 aPosition; // 단위 구 위의 점
layout(location = 1) in vec2 aUV;       // equirectangular (u: 경도, v: 위도)

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;

out vec2 vUV;
out vec3 vWorldPos;     // 월드 공간 위치 (조명의 시선 벡터 계산용)
out vec3 vSphereNormal; // 월드 공간의 구 법선(지형 기복 없는 기하 법선)

void main() {
  vec2 uv = aUV;
  // 극점: 같은 위치에 u 만 다른 정점이 여러 개 겹친다. u 마다 다른 고도를 읽으면
  // 극에서 정점들이 벌어지며 틈이 생기므로, 극에서는 한 지점(u=0.5)만 읽는다.
  if (aUV.y < 1e-5 || aUV.y > 1.0 - 1e-5) uv.x = 0.5;

  float s = reliefOf(heightAt(uv));
  vec3 displaced = aPosition * (1.0 + s);

  vec4 world = uModel * vec4(displaced, 1.0);
  vWorldPos = world.xyz;
  // 모델 행렬은 회전만 포함(직교 행렬) → 법선 행렬 (M⁻¹)ᵀ = M. 따라서 mat3(M) 으로 법선을 변환해도 된다.
  vSphereNormal = mat3(uModel) * aPosition;
  vUV = aUV;
  gl_Position = uProj * uView * world;
}
