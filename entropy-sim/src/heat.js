// Heat diffusion grid — ∂T/∂t = α∇²T
import { N, idx } from './fluid.js';

const SIZE = (N + 2) * (N + 2);
const ITER = 4; // fewer iterations ok for heat — smoother result

export class HeatGrid {
  constructor() {
    this.T  = new Float32Array(SIZE); // current temperature (0=cold, 1=hot)
    this.T0 = new Float32Array(SIZE); // scratch buffer
  }

  addHeat(i, j, amount) {
    this.T[idx(i,j)] = Math.min(1, this.T[idx(i,j)] + amount);
  }

  step(alpha, dt, vx, vy) {
    // Diffuse
    const a = dt * alpha * N * N;
    const c = 1 + 4 * a;
    this.T0.set(this.T);
    for (let k = 0; k < ITER; k++) {
      for (let j = 1; j <= N; j++) {
        for (let i = 1; i <= N; i++) {
          this.T[idx(i,j)] = (this.T0[idx(i,j)] + a*(
            this.T[idx(i-1,j)] + this.T[idx(i+1,j)] +
            this.T[idx(i,j-1)] + this.T[idx(i,j+1)]
          )) / c;
        }
      }
    }
    // Advect with fluid velocity
    const dt0 = dt * N;
    const tmp = this.T0;
    tmp.set(this.T);
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        let x = i - dt0 * vx[idx(i,j)];
        let y = j - dt0 * vy[idx(i,j)];
        x = Math.max(0.5, Math.min(N + 0.5, x));
        y = Math.max(0.5, Math.min(N + 0.5, y));
        const i0 = Math.floor(x), i1 = i0 + 1;
        const j0 = Math.floor(y), j1 = j0 + 1;
        const s1 = x - i0, s0 = 1 - s1;
        const t1 = y - j0, t0 = 1 - t1;
        this.T[idx(i,j)] = s0*(t0*tmp[idx(i0,j0)] + t1*tmp[idx(i0,j1)]) +
                            s1*(t0*tmp[idx(i1,j0)] + t1*tmp[idx(i1,j1)]);
      }
    }
  }

  reset() { this.T.fill(0); this.T0.fill(0); }
}

// Map temperature 0→1 to RGB (cold blue → purple → warm orange-red)
export function tempToRGB(t) {
  if (t < 0.5) {
    // cold: deep blue (20,40,120) → purple (180,100,220)
    const s = t / 0.5;
    return [
      20  + s * (180 - 20),
      40  + s * (100 - 40),
      120 + s * (220 - 120),
    ];
  } else {
    // warm: purple (180,100,220) → yellow (255,200,50) → orange-red (255,80,20)
    const s = (t - 0.5) / 0.5;
    const mid = [255, 200, 50];
    const hot = [255, 80,  20];
    const base= [180, 100, 220];
    if (s < 0.5) {
      const u = s / 0.5;
      return [
        base[0] + u*(mid[0]-base[0]),
        base[1] + u*(mid[1]-base[1]),
        base[2] + u*(mid[2]-base[2]),
      ];
    } else {
      const u = (s - 0.5) / 0.5;
      return [
        mid[0] + u*(hot[0]-mid[0]),
        mid[1] + u*(hot[1]-mid[1]),
        mid[2] + u*(hot[2]-mid[2]),
      ];
    }
  }
}
