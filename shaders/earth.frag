#version 300 es
// earth.frag — 지형 법선 재계산 + 조명(Lambert 확산, Blinn-Phong 반사, 주변광) + 고도별 색
//
// 색과 법선은 정점이 아니라 프래그먼트마다 고도 텍스처를 다시 읽어 계산한다.
// → 메시 분할 수가 낮아도 해안선·산맥의 음영은 고도 맵 해상도로 표현된다(일종의 노멀 매핑).

in vec2 vUV;
in vec3 vWorldPos;
in vec3 vSphereNormal;
out vec4 outColor;

uniform mat4 uModel;
uniform vec3 uSunDir;       // 월드 공간, 지표 → 태양 방향 단위 벡터 L
uniform vec3 uCameraPos;    // 월드 공간 카메라 위치
uniform float uAmbient;     // 주변광 세기
uniform float uSpecular;    // 바다 반사 세기
uniform float uAtmoStrength; // 대기 림 세기 (0 = 끔)
uniform int uViewMode;      // 0: 조명, 1: UV 격자, 2: 고도 그레이스케일, 3: 법선, 4: 조명 없는 고도 색

// ---------------------------------------------------------------------------
// 고도별 색상 램프 (sRGB 값)
// 바다: 수심이 깊을수록 어둡게. 육지: 해안(모래) → 저지(초록) → 고지(황갈) → 산(바위) → 만년설.
// 만년설 고도(설선)는 위도가 높을수록 낮아지게 근사: 적도 4500 m → 위도 72° 이상 0 m.
// (실제 설선은 기후·강수에 따라 다르며, 이 식은 시각적 근사일 뿐이다.)
vec3 terrainColor(float h, float latRad) {
  if (h <= 0.0) {
    float depth = -h;
    vec3 shallow = vec3(0.16, 0.42, 0.62);
    vec3 deep    = vec3(0.01, 0.05, 0.20);
    vec3 c = mix(shallow, deep, smoothstep(0.0, 5000.0, depth));
    // 대륙붕(수심 ~200 m 이내)은 더 밝게
    return mix(c, vec3(0.25, 0.60, 0.70), 1.0 - smoothstep(0.0, 200.0, depth));
  }
  vec3 sand   = vec3(0.78, 0.72, 0.52);
  vec3 low    = vec3(0.24, 0.48, 0.18);
  vec3 high   = vec3(0.58, 0.52, 0.30);
  vec3 rock   = vec3(0.46, 0.40, 0.36);
  vec3 snow   = vec3(0.95, 0.96, 0.98);
  vec3 c = mix(sand, low, smoothstep(0.0, 60.0, h));
  c = mix(c, high, smoothstep(400.0, 1500.0, h));
  c = mix(c, rock, smoothstep(1500.0, 3000.0, h));
  float latDeg = abs(latRad) * 180.0 / PI;
  float snowLine = 4500.0 * (1.0 - smoothstep(30.0, 72.0, latDeg));
  c = mix(c, snow, smoothstep(snowLine, snowLine + 400.0, h));
  return c;
}

// ---------------------------------------------------------------------------
// 고도 맵에서 지형 법선 계산 (모델 공간)
//
// 위도 φ, 경도 λ 에서의 국소 직교 좌표계 (sphere.js 의 x=cosφ sinλ, y=sinφ, z=cosφ cosλ 를 미분):
//   û (위)   = ( cosφ sinλ,  sinφ,  cosφ cosλ)        = p
//   ê (동쪽) = ∂p/∂λ / |∂p/∂λ| = ( cosλ, 0, −sinλ)
//   n̂ (북쪽) = ∂p/∂φ            = (−sinφ sinλ, cosφ, −sinφ cosλ)
//
// 지표면 p(λ,φ) = (1 + s)·û,  s = reliefOf(h).  동쪽·북쪽 호 길이를 x_e, x_n 이라 하면
//   ∂p/∂x_e = (1+s)·ê + s_e·û,   ∂p/∂x_n = (1+s)·n̂ + s_n·û     (s_e = ∂s/∂x_e, s_n = ∂s/∂x_n)
//   N ∝ ∂p/∂x_e × ∂p/∂x_n = (1+s)·[(1+s)·û − s_e·ê − s_n·n̂]
//   →  N = normalize((1+s)·û − s_e·ê − s_n·n̂)
//
// 기울기는 이웃 텍셀과의 중앙 차분으로 구한다 (텍셀 간격 Δu, Δv):
//   Δλ = 2π·Δu,  Δφ = π·Δv
//   s_e = (s(u+Δu) − s(u−Δu)) / (2·Δλ·cosφ)      ← 동서 호 길이는 cosφ 만큼 줄어든다
//   s_n = (s(v−Δv) − s(v+Δv)) / (2·Δφ)           ← v 가 커질수록 남쪽이므로 부호 반대
//   극 근처에서 cosφ → 0 이므로 하한을 둔다.
vec3 terrainNormalModel(vec2 uv, vec2 latLon, out vec3 up) {
  float phi = latLon.x, lam = latLon.y;
  float cp = cos(phi), sp = sin(phi), cl = cos(lam), sl = sin(lam);
  up = vec3(cp * sl, sp, cp * cl);
  vec3 east  = vec3(cl, 0.0, -sl);
  vec3 north = vec3(-sp * sl, cp, -sp * cl);

  vec2 texel = 1.0 / vec2(textureSize(uHeight, 0));
  float sE = reliefOf(heightAt(uv + vec2(texel.x, 0.0)));   // 가로 REPEAT → 경도 이음매에서도 연속
  float sW = reliefOf(heightAt(uv - vec2(texel.x, 0.0)));
  float sN = reliefOf(heightAt(uv - vec2(0.0, texel.y)));
  float sS = reliefOf(heightAt(uv + vec2(0.0, texel.y)));
  float s  = reliefOf(heightAt(uv));

  float dLam = 2.0 * PI * texel.x;
  float dPhi = PI * texel.y;
  float slopeE = (sE - sW) / (2.0 * dLam * max(cp, 0.02));
  float slopeN = (sN - sS) / (2.0 * dPhi);
  return normalize((1.0 + s) * up - slopeE * east - slopeN * north);
}

float gridLine(float coord, float stepSize, float px) {
  float c = coord / stepSize;
  float d = abs(fract(c - 0.5) - 0.5);
  return 1.0 - smoothstep(0.0, fwidth(c) * px, d);
}

// sRGB ↔ 선형: 조명은 빛의 세기가 선형으로 더해지는 공간에서 계산해야 한다(근사 감마 2.2).
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSRGB(vec3 c)   { return pow(c, vec3(1.0 / 2.2)); }

void main() {
  float h = heightAt(vUV);
  vec2 latLon = uvToLatLon(vUV);

  if (uViewMode == 1) {
    vec3 base = vec3(vUV.x, vUV.y, 0.35);
    float g = max(gridLine(vUV.x, 1.0 / 12.0, 1.0), gridLine(vUV.y, 1.0 / 12.0, 1.0));
    float eq = max(gridLine(vUV.y - 0.5, 1.0, 2.5), gridLine(vUV.x - 0.5, 1.0, 2.5));
    outColor = vec4(mix(base, vec3(1.0), max(g * 0.6, eq)), 1.0);
    return;
  }
  if (uViewMode == 2) {
    outColor = vec4(vec3(clamp((h + 11000.0) / 20000.0, 0.0, 1.0)), 1.0);
    return;
  }
  vec3 albedoSRGB = terrainColor(h, latLon.x);
  if (uViewMode == 4) {
    outColor = vec4(albedoSRGB, 1.0);
    return;
  }

  // ---- 법선 (모델 → 월드). 모델 행렬은 회전뿐이므로 mat3(M) 이 곧 법선 행렬 ----
  vec3 upModel;
  vec3 nModel = terrainNormalModel(vUV, latLon, upModel);
  mat3 normalMat = mat3(uModel);
  vec3 N  = normalize(normalMat * nModel);       // 지형 법선 (확산광)
  vec3 Ng = normalize(vSphereNormal);            // 기하 법선 (낮/밤 판정, 해수면)

  if (uViewMode == 3) {
    outColor = vec4(N * 0.5 + 0.5, 1.0);
    return;
  }

  // 해수면 평평 모드에서 바다는 수면이므로 기하 법선을 쓴다.
  float water = 1.0 - smoothstep(-1.0, 1.0, h);  // h ≤ 0 이면 1 (해안에서 살짝 부드럽게)
  if (uOceanMode == 0) N = normalize(mix(N, Ng, water));

  vec3 L = normalize(uSunDir);
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 H = normalize(L + V);                    // Blinn-Phong 반벡터

  // 낮/밤 경계(명암 경계선): 기하 법선과 태양 방향의 내적 cosθ 로 판정.
  //   cosθ > 0 이면 낮. 경계 근처(±약 7°)를 smoothstep 으로 부드럽게 이어 박명(황혼)을 흉내 낸다.
  //   지형 법선만 쓰면 밤 쪽의 산 경사면이 빛을 받는 오류가 생기므로 이 마스크를 곱한다.
  float cosSun = dot(Ng, L);
  float dayMask = smoothstep(-0.12, 0.12, cosSun);

  // Lambert 확산: I_d = albedo · max(N·L, 0)
  float diffuse = max(dot(N, L), 0.0) * dayMask;

  // Blinn-Phong 반사: I_s = k_s · max(N·H, 0)^n  — 바다(수면)는 강하고 날카롭게, 육지는 약하게
  //   수면 반사는 해저 지형 모드에서도 수면(기하 법선) 기준으로 계산한다.
  float specWater = pow(max(dot(Ng, H), 0.0), 300.0) * uSpecular;
  float specLand  = pow(max(dot(N, H), 0.0), 16.0) * 0.03;
  float spec = mix(specLand, specWater, water) * dayMask;

  vec3 sunColor = vec3(1.0, 0.98, 0.92);
  vec3 albedo = toLinear(albedoSRGB);
  // 주변광: 밤에도 지형이 아주 어둡게 보이도록 푸른빛 약간
  vec3 ambient = uAmbient * vec3(0.55, 0.65, 1.0);
  // 박명: 경계선 부근에 붉은 기운
  float twilight = exp(-pow(cosSun / 0.10, 2.0));
  vec3 twilightColor = vec3(0.9, 0.4, 0.2) * 0.08 * twilight;

  vec3 color = albedo * (ambient + diffuse * sunColor + twilightColor) + spec * sunColor;

  // 대기 림(rim): 시선이 표면을 비스듬히 볼수록(N·V → 0) 대기를 길게 통과하므로 푸르게 흐려진다.
  //   rim = (1 − max(Ng·V, 0))^4, 낮 쪽에서만(박명 포함) 보이게 한다.
  float rim = pow(1.0 - max(dot(Ng, V), 0.0), 4.0);
  float rimLight = smoothstep(-0.25, 0.35, cosSun);
  color = mix(color, vec3(0.30, 0.55, 1.0) * 0.9, clamp(rim * rimLight * uAtmoStrength, 0.0, 1.0) * 0.8);

  outColor = vec4(toSRGB(color), 1.0);
}
