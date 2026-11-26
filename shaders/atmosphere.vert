#version 300 es
// atmosphere.vert — 대기층 구 (지구보다 약간 큰 반지름의 구를 같은 메시로 그림)
//   대기는 구 대칭이라 자전과 무관 → 모델 행렬 없이 반지름만 키운다: p = R_a · p_unit

layout(location = 0) in vec3 aPosition;

uniform mat4 uView;
uniform mat4 uProj;
uniform float uAtmoRadius;

out vec3 vWorldPos;

void main() {
  vec3 p = aPosition * uAtmoRadius;
  vWorldPos = p;
  gl_Position = uProj * uView * vec4(p, 1.0);
}
