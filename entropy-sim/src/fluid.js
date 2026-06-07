// Stable Fluids solver — Jos Stam "Real-Time Fluid Dynamics for Games" (2003)
// Grid: N×N cells, flat Float32Array with idx(i,j) = i + j*(N+2)

export const N = 128;
const SIZE = (N + 2) * (N + 2);
const ITER = 20;

export function idx(i, j) { return i + j * (N + 2); }

function set_bnd(b, x) {
  for (let i = 1; i <= N; i++) {
    x[idx(0,     i)] = b === 1 ? -x[idx(1, i)] : x[idx(1, i)];
    x[idx(N+1,   i)] = b === 1 ? -x[idx(N, i)] : x[idx(N, i)];
    x[idx(i,     0)] = b === 2 ? -x[idx(i, 1)] : x[idx(i, 1)];
    x[idx(i,   N+1)] = b === 2 ? -x[idx(i, N)] : x[idx(i, N)];
  }
  x[idx(0,   0)]   = 0.5 * (x[idx(1, 0)]   + x[idx(0, 1)]);
  x[idx(0,   N+1)] = 0.5 * (x[idx(1, N+1)] + x[idx(0, N)]);
  x[idx(N+1, 0)]   = 0.5 * (x[idx(N, 0)]   + x[idx(N+1, 1)]);
  x[idx(N+1, N+1)] = 0.5 * (x[idx(N, N+1)] + x[idx(N+1, N)]);
}

function lin_solve(b, x, x0, a, c) {
  const cRecip = 1.0 / c;
  for (let k = 0; k < ITER; k++) {
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        x[idx(i,j)] = (x0[idx(i,j)] + a*(x[idx(i-1,j)] + x[idx(i+1,j)] + x[idx(i,j-1)] + x[idx(i,j+1)])) * cRecip;
      }
    }
    set_bnd(b, x);
  }
}

function diffuse(b, x, x0, diff, dt) {
  const a = dt * diff * N * N;
  lin_solve(b, x, x0, a, 1 + 4 * a);
}

function project(vx, vy, p, div) {
  const h = 1.0 / N;
  for (let j = 1; j <= N; j++) {
    for (let i = 1; i <= N; i++) {
      div[idx(i,j)] = -0.5 * h * (vx[idx(i+1,j)] - vx[idx(i-1,j)] + vy[idx(i,j+1)] - vy[idx(i,j-1)]);
      p[idx(i,j)] = 0;
    }
  }
  set_bnd(0, div); set_bnd(0, p);
  lin_solve(0, p, div, 1, 4);
  for (let j = 1; j <= N; j++) {
    for (let i = 1; i <= N; i++) {
      vx[idx(i,j)] -= 0.5 * (p[idx(i+1,j)] - p[idx(i-1,j)]) * N;
      vy[idx(i,j)] -= 0.5 * (p[idx(i,j+1)] - p[idx(i,j-1)]) * N;
    }
  }
  set_bnd(1, vx); set_bnd(2, vy);
}

function advect(b, d, d0, vx, vy, dt) {
  const dt0 = dt * N;
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
      d[idx(i,j)] = s0*(t0*d0[idx(i0,j0)] + t1*d0[idx(i0,j1)]) +
                    s1*(t0*d0[idx(i1,j0)] + t1*d0[idx(i1,j1)]);
    }
  }
  set_bnd(b, d);
}

export class FluidSolver {
  constructor() {
    this.vx  = new Float32Array(SIZE);
    this.vy  = new Float32Array(SIZE);
    this.vx0 = new Float32Array(SIZE);
    this.vy0 = new Float32Array(SIZE);
    this.p   = new Float32Array(SIZE);
    this.div = new Float32Array(SIZE);
  }

  addVelocity(i, j, amtX, amtY) {
    this.vx[idx(i,j)] += amtX;
    this.vy[idx(i,j)] += amtY;
  }

  step(viscosity, dt) {
    diffuse(1, this.vx0, this.vx, viscosity, dt);
    diffuse(2, this.vy0, this.vy, viscosity, dt);
    project(this.vx0, this.vy0, this.p, this.div);
    advect(1, this.vx, this.vx0, this.vx0, this.vy0, dt);
    advect(2, this.vy, this.vy0, this.vx0, this.vy0, dt);
    project(this.vx, this.vy, this.p, this.div);
  }

  reset() {
    this.vx.fill(0); this.vy.fill(0);
    this.vx0.fill(0); this.vy0.fill(0);
    this.p.fill(0); this.div.fill(0);
  }
}
