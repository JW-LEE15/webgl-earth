// camera.js — 궤도(orbit) 카메라: 마우스/터치 드래그로 회전, 휠로 줌
//
// 구면 좌표로 카메라 위치를 정한다 (원점 = 지구 중심을 바라봄)
//   eye = d · (cos β · sin α,  sin β,  cos β · cos α)
//   α: 방위각(yaw), β: 고도각(pitch, ±89° 로 제한 — 90° 이면 up 벡터와 시선이 평행해져 lookAt 이 정의되지 않음)
//   d: 중심까지 거리 (줌)

import * as mat4 from './mat4.js';

export class OrbitCamera {
  constructor(canvas, { yaw = 0, pitch = 0.35, distance = 3.2, minDistance = 1.25, maxDistance = 10 } = {}) {
    this.initial = { yaw, pitch, distance };
    Object.assign(this, { yaw, pitch, distance, minDistance, maxDistance });
    this._attach(canvas);
  }

  reset() {
    Object.assign(this, this.initial);
  }

  eye() {
    const cp = Math.cos(this.pitch);
    return [
      this.distance * cp * Math.sin(this.yaw),
      this.distance * Math.sin(this.pitch),
      this.distance * cp * Math.cos(this.yaw),
    ];
  }

  viewMatrix() {
    return mat4.lookAt(this.eye(), [0, 0, 0], [0, 1, 0]);
  }

  _attach(canvas) {
    let dragging = false, lastX = 0, lastY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      // 가까이 갈수록 같은 드래그에 덜 돌도록(표면 기준 이동량이 비슷하게) 거리로 감도를 조절
      const k = 0.005 * Math.min(1, (this.distance - 1) / 1.5);
      this.yaw -= dx * k;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + dy * k));
    });
    const end = (e) => {
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // 지수 줌: 표면까지 거리(d−1)에 비례해 변하게 해서 가까이서도 부드럽게
      const surf = (this.distance - 1) * Math.exp(e.deltaY * 0.001);
      this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, 1 + surf));
    }, { passive: false });
    canvas.addEventListener('dblclick', () => this.reset());
  }
}
