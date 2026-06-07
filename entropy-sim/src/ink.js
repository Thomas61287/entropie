// Ink concentration grid — advected by fluid, diffuses slowly
import { N, idx } from './fluid.js';

const SIZE = (N + 2) * (N + 2);
const ITER = 4;

export class InkGrid {
  constructor() {
    this.C  = new Float32Array(SIZE); // concentration 0–1
    this.C0 = new Float32Array(SIZE);
  }

  addInk(i, j, amount) {
    this.C[idx(i,j)] = Math.min(1, this.C[idx(i,j)] + amount);
  }

  step(diffRate, dt, vx, vy) {
    // Diffuse
    const a = dt * diffRate * N * N;
    const c = 1 + 4 * a;
    this.C0.set(this.C);
    for (let k = 0; k < ITER; k++) {
      for (let j = 1; j <= N; j++) {
        for (let i = 1; i <= N; i++) {
          this.C[idx(i,j)] = (this.C0[idx(i,j)] + a*(
            this.C[idx(i-1,j)] + this.C[idx(i+1,j)] +
            this.C[idx(i,j-1)] + this.C[idx(i,j+1)]
          )) / c;
        }
      }
    }
    // Advect
    const dt0 = dt * N;
    const tmp = this.C0;
    tmp.set(this.C);
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
        this.C[idx(i,j)] = s0*(t0*tmp[idx(i0,j0)] + t1*tmp[idx(i0,j1)]) +
                            s1*(t0*tmp[idx(i1,j0)] + t1*tmp[idx(i1,j1)]);
      }
    }
  }

  reset() { this.C.fill(0); this.C0.fill(0); }
}
