// ============================================================
//  ENTROPY IN MOTION — single bundle, no ES modules
//  Expects globals: THREE, THREE.OrbitControls
// ============================================================

window.addEventListener('error', e => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:8px;left:8px;right:8px;background:#180010;color:#ff6688;'
    + 'padding:10px;font:11px monospace;z-index:9999;border:1px solid #ff4466;white-space:pre-wrap;';
  d.textContent = 'JS Error: ' + e.message + '\n' + (e.filename || '').split('/').pop() + ':' + e.lineno;
  document.body.appendChild(d);
});

// ─── fluid.js ────────────────────────────────────────────────────────────────

const N = 128;
const FLUID_SIZE = (N + 2) * (N + 2);
const LIN_SOLVE_ITER = 20;

function idx(i, j) { return i + j * (N + 2); }

function _set_bnd(b, x) {
  for (let i = 1; i <= N; i++) {
    x[idx(0,   i)] = b === 1 ? -x[idx(1, i)] : x[idx(1, i)];
    x[idx(N+1, i)] = b === 1 ? -x[idx(N, i)] : x[idx(N, i)];
    x[idx(i,   0)] = b === 2 ? -x[idx(i, 1)] : x[idx(i, 1)];
    x[idx(i, N+1)] = b === 2 ? -x[idx(i, N)] : x[idx(i, N)];
  }
  x[idx(0,   0)]   = 0.5 * (x[idx(1, 0)]   + x[idx(0, 1)]);
  x[idx(0,   N+1)] = 0.5 * (x[idx(1, N+1)] + x[idx(0, N)]);
  x[idx(N+1, 0)]   = 0.5 * (x[idx(N, 0)]   + x[idx(N+1, 1)]);
  x[idx(N+1, N+1)] = 0.5 * (x[idx(N, N+1)] + x[idx(N+1, N)]);
}

function _lin_solve(b, x, x0, a, c) {
  const cR = 1.0 / c;
  for (let k = 0; k < LIN_SOLVE_ITER; k++) {
    for (let j = 1; j <= N; j++)
      for (let i = 1; i <= N; i++)
        x[idx(i,j)] = (x0[idx(i,j)] + a*(x[idx(i-1,j)] + x[idx(i+1,j)] + x[idx(i,j-1)] + x[idx(i,j+1)])) * cR;
    _set_bnd(b, x);
  }
}

function _diffuse(b, x, x0, diff, dt) {
  const a = dt * diff * N * N;
  _lin_solve(b, x, x0, a, 1 + 4 * a);
}

function _project(vx, vy, p, div) {
  const h = 1.0 / N;
  for (let j = 1; j <= N; j++)
    for (let i = 1; i <= N; i++) {
      div[idx(i,j)] = -0.5 * h * (vx[idx(i+1,j)] - vx[idx(i-1,j)] + vy[idx(i,j+1)] - vy[idx(i,j-1)]);
      p[idx(i,j)] = 0;
    }
  _set_bnd(0, div); _set_bnd(0, p);
  _lin_solve(0, p, div, 1, 4);
  for (let j = 1; j <= N; j++)
    for (let i = 1; i <= N; i++) {
      vx[idx(i,j)] -= 0.5 * (p[idx(i+1,j)] - p[idx(i-1,j)]) * N;
      vy[idx(i,j)] -= 0.5 * (p[idx(i,j+1)] - p[idx(i,j-1)]) * N;
    }
  _set_bnd(1, vx); _set_bnd(2, vy);
}

function _advect(b, d, d0, vx, vy, dt) {
  const dt0 = dt * N;
  for (let j = 1; j <= N; j++) {
    for (let i = 1; i <= N; i++) {
      let x = Math.max(0.5, Math.min(N + 0.5, i - dt0 * vx[idx(i,j)]));
      let y = Math.max(0.5, Math.min(N + 0.5, j - dt0 * vy[idx(i,j)]));
      const i0 = Math.floor(x), i1 = i0 + 1, j0 = Math.floor(y), j1 = j0 + 1;
      const s1 = x - i0, s0 = 1 - s1, t1 = y - j0, t0 = 1 - t1;
      d[idx(i,j)] = s0*(t0*d0[idx(i0,j0)] + t1*d0[idx(i0,j1)]) +
                    s1*(t0*d0[idx(i1,j0)] + t1*d0[idx(i1,j1)]);
    }
  }
  _set_bnd(b, d);
}

class FluidSolver {
  constructor() {
    this.vx  = new Float32Array(FLUID_SIZE);
    this.vy  = new Float32Array(FLUID_SIZE);
    this.vx0 = new Float32Array(FLUID_SIZE);
    this.vy0 = new Float32Array(FLUID_SIZE);
    this.p   = new Float32Array(FLUID_SIZE);
    this.div = new Float32Array(FLUID_SIZE);
  }
  addVelocity(i, j, ax, ay) { this.vx[idx(i,j)] += ax; this.vy[idx(i,j)] += ay; }
  step(viscosity, dt) {
    _diffuse(1, this.vx0, this.vx, viscosity, dt);
    _diffuse(2, this.vy0, this.vy, viscosity, dt);
    _project(this.vx0, this.vy0, this.p, this.div);
    _advect(1, this.vx, this.vx0, this.vx0, this.vy0, dt);
    _advect(2, this.vy, this.vy0, this.vx0, this.vy0, dt);
    _project(this.vx, this.vy, this.p, this.div);
  }
  reset() { this.vx.fill(0); this.vy.fill(0); this.vx0.fill(0); this.vy0.fill(0); this.p.fill(0); this.div.fill(0); }
}

// ─── heat.js ─────────────────────────────────────────────────────────────────

class HeatGrid {
  constructor() {
    this.T  = new Float32Array(FLUID_SIZE);
    this.T0 = new Float32Array(FLUID_SIZE);
  }
  addHeat(i, j, amount) { this.T[idx(i,j)] = Math.min(1, this.T[idx(i,j)] + amount); }
  step(alpha, dt, vx, vy) {
    const a = dt * alpha * N * N, c = 1 + 4 * a;
    this.T0.set(this.T);
    for (let k = 0; k < 4; k++)
      for (let j = 1; j <= N; j++)
        for (let i = 1; i <= N; i++)
          this.T[idx(i,j)] = (this.T0[idx(i,j)] + a*(
            this.T[idx(i-1,j)] + this.T[idx(i+1,j)] +
            this.T[idx(i,j-1)] + this.T[idx(i,j+1)])) / c;
    const dt0 = dt * N, tmp = this.T0;
    tmp.set(this.T);
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        let x = Math.max(0.5, Math.min(N + 0.5, i - dt0 * vx[idx(i,j)]));
        let y = Math.max(0.5, Math.min(N + 0.5, j - dt0 * vy[idx(i,j)]));
        const i0 = Math.floor(x), i1 = i0+1, j0 = Math.floor(y), j1 = j0+1;
        const s1 = x-i0, s0 = 1-s1, t1 = y-j0, t0 = 1-t1;
        this.T[idx(i,j)] = s0*(t0*tmp[idx(i0,j0)] + t1*tmp[idx(i0,j1)]) +
                            s1*(t0*tmp[idx(i1,j0)] + t1*tmp[idx(i1,j1)]);
      }
    }
  }
  reset() { this.T.fill(0); this.T0.fill(0); }
}

// ─── ink.js ──────────────────────────────────────────────────────────────────

class InkGrid {
  constructor() {
    this.C  = new Float32Array(FLUID_SIZE);
    this.C0 = new Float32Array(FLUID_SIZE);
  }
  addInk(i, j, amount) { this.C[idx(i,j)] = Math.min(1, this.C[idx(i,j)] + amount); }
  step(diffRate, dt, vx, vy) {
    const a = dt * diffRate * N * N, c = 1 + 4 * a;
    this.C0.set(this.C);
    for (let k = 0; k < 4; k++)
      for (let j = 1; j <= N; j++)
        for (let i = 1; i <= N; i++)
          this.C[idx(i,j)] = (this.C0[idx(i,j)] + a*(
            this.C[idx(i-1,j)] + this.C[idx(i+1,j)] +
            this.C[idx(i,j-1)] + this.C[idx(i,j+1)])) / c;
    const dt0 = dt * N, tmp = this.C0;
    tmp.set(this.C);
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        let x = Math.max(0.5, Math.min(N + 0.5, i - dt0 * vx[idx(i,j)]));
        let y = Math.max(0.5, Math.min(N + 0.5, j - dt0 * vy[idx(i,j)]));
        const i0 = Math.floor(x), i1 = i0+1, j0 = Math.floor(y), j1 = j0+1;
        const s1 = x-i0, s0 = 1-s1, t1 = y-j0, t0 = 1-t1;
        this.C[idx(i,j)] = s0*(t0*tmp[idx(i0,j0)] + t1*tmp[idx(i0,j1)]) +
                            s1*(t0*tmp[idx(i1,j0)] + t1*tmp[idx(i1,j1)]);
      }
    }
  }
  reset() { this.C.fill(0); this.C0.fill(0); }
}

// ─── gasroom.js ──────────────────────────────────────────────────────────────

class GasRoom {
  constructor(GN = 80) {
    this.N     = GN;
    this.C     = new Float32Array(GN * GN);
    this.C0    = new Float32Array(GN * GN);
    this.walls = new Uint8Array(GN * GN);
    this.D     = 2.0;
    this.dx    = 1.0;
    this.doorJ0 = Math.floor(GN * 0.40);
    this.doorJ1 = Math.floor(GN * 0.60);
    this._initWalls();
  }
  _initWalls() {
    const { N: GN, walls } = this;
    for (let i = 0; i < GN; i++) {
      walls[i]                  = 1;
      walls[i + (GN-1)*GN]     = 1;
      walls[i * GN]             = 1;
      walls[i * GN + (GN-1)]   = 1;
    }
    for (let j = this.doorJ0; j <= this.doorJ1; j++) walls[j * GN + (GN-1)] = 0;
  }
  addSource(ci, cj, amount) {
    const i = Math.max(1, Math.min(this.N-2, Math.floor(ci)));
    const j = Math.max(1, Math.min(this.N-2, Math.floor(cj)));
    this.C[i + j * this.N] = Math.min(1, this.C[i + j * this.N] + amount);
  }
  step(dt) {
    const { N: GN, C, C0, walls, D, dx } = this;
    const a = Math.min(0.24, D * dt / (dx * dx));
    C0.set(C);
    for (let j = 1; j < GN-1; j++) {
      for (let i = 1; i < GN-1; i++) {
        const id = i + j * GN;
        if (walls[id]) { C[id] = 0; continue; }
        const cn = walls[id-GN] ? C0[id] : C0[id-GN];
        const cs = walls[id+GN] ? C0[id] : C0[id+GN];
        const cw = walls[id-1]  ? C0[id] : C0[id-1];
        const ce = walls[id+1]  ? C0[id] : C0[id+1];
        C[id] = Math.max(0, C0[id] + a * (cn + cs + cw + ce - 4 * C0[id]));
      }
    }
    for (let j = this.doorJ0; j <= this.doorJ1; j++) C[j * GN + (GN-2)] *= 0.97;
  }
  reset() { this.C.fill(0); this.C0.fill(0); }
}

// ─── analytics.js ────────────────────────────────────────────────────────────

const K_B   = 1.38e-23;
const R_GAS = 8.314;

function stokesEinsteinD(T_C, viscMPas, radius_nm = 1.0) {
  return (K_B * (T_C + 273.15)) / (6 * Math.PI * (viscMPas * 1e-3) * (radius_nm * 1e-9));
}
function carnotEfficiency(T_cold_C, T_hot_C) {
  const Tc = T_cold_C + 273.15, Th = T_hot_C + 273.15;
  return Th > Tc ? Math.max(0, 1 - Tc / Th) : 0;
}
function osmoticPressure(concentration_norm, T_C) {
  return (concentration_norm * 100) * R_GAS * (T_C + 273.15);
}
function thermalEntropyChange(heatDelta, T_water_C, heatScale = 1e-18) {
  return (heatDelta * heatScale) / (T_water_C + 273.15);
}
function rayleighNumber(inkTempC, waterTempC, viscMPas, h_m = 0.08) {
  const g = 9.81, beta = 2.07e-4, kappa = 1.43e-7;
  const nu = viscMPas * 1e-6;
  const dT = Math.abs(inkTempC - waterTempC);
  return (g * beta * dT * Math.pow(h_m, 3)) / (nu * kappa);
}

// ─── entropy.js ──────────────────────────────────────────────────────────────

const HISTORY_MAX = 400;

class EntropyMeter {
  constructor() { this.history = []; this.currentS = 0; }
  update(inkC, threshold = 0.005) {
    let W = 0;
    const total = (N + 2) * (N + 2);
    for (let i = 0; i < total; i++) if (inkC[i] > threshold) W++;
    this.currentS = W > 0 ? Math.log(W) / Math.log(total) : 0;
    this.history.push(this.currentS);
    if (this.history.length > HISTORY_MAX) this.history.shift();
  }
  draw(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#050510'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,255,204,0.3)'; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w-1, h-1);
    ctx.strokeStyle = 'rgba(0,255,204,0.07)';
    for (let i = 1; i < 4; i++) {
      const y = Math.round(h * i / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      const x = Math.round(w * i / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    if (this.history.length < 2) return;
    const step = w / (HISTORY_MAX - 1);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0,255,204,0.35)');
    grad.addColorStop(1, 'rgba(0,255,204,0.02)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let i = 0; i < this.history.length; i++)
      ctx.lineTo(i * step, h - this.history[i] * (h - 4) - 2);
    ctx.lineTo((this.history.length - 1) * step, h);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 1.5;
    ctx.shadowColor = '#00ffcc'; ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = 0; i < this.history.length; i++) {
      const x = i * step, y = h - this.history[i] * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#00ffcc'; ctx.font = '10px "Space Mono", monospace';
    ctx.fillText('S = ' + this.currentS.toFixed(3), 6, 14);
  }
  reset() { this.history = []; this.currentS = 0; }
}

// ─── simulation.js ───────────────────────────────────────────────────────────

const WATER_SURFACE_FRAC = 0.28;
const _GRAVITY  = 12;
const _BUOYANCY = 3.5;

class Simulation {
  constructor({ inkTempC = 65, waterTempC = 15, D_nm2s = 0.8, viscMPas = 1.0, heatAlpha = 1.5 } = {}) {
    this.fluid = new FluidSolver();
    this.heat  = new HeatGrid();
    this.ink   = new InkGrid();
    this.inkTempC        = inkTempC;
    this.waterTempC      = waterTempC;
    this.D_nm2s          = D_nm2s;
    this.viscMPas        = viscMPas;
    this.heatAlphaSlider = heatAlpha;
    this.prevHeat  = new Float32Array(FLUID_SIZE);
    this.cumDeltaQ = 0;
    this.gravityScale  = 1.0;
    this.buoyancyScale = 1.0;
    this.dropRadius    = 4;
    this._computeParams();
  }
  _computeParams() {
    this.inkTemp   = Math.max(0, Math.min(1, (this.inkTempC  - 10) / 85));
    this.waterTemp = Math.max(0, Math.min(1,  this.waterTempC / 100));
    const tempFactor = (273.15 + this.waterTempC) / 288.15;
    const viscFactor = 1.0 / Math.max(0.1, this.viscMPas);
    this.diffRate  = this.D_nm2s * 1e-4 * tempFactor * viscFactor;
    this.viscosity = this.viscMPas * 5e-6;
    this.heatAlpha = this.heatAlphaSlider * 1e-4;
  }
  step(dt = 0.12) {
    const waterJ = Math.round(WATER_SURFACE_FRAC * N);
    this.prevHeat.set(this.heat.T);
    for (let j = waterJ; j <= N; j++)
      for (let i = 1; i <= N; i++) {
        const c = this.ink.C[idx(i,j)];
        const t = this.heat.T[idx(i,j)];
        if (c > 0.01) this.fluid.addVelocity(i, j, 0,  c * _GRAVITY  * this.gravityScale  * dt);
        if (t > this.waterTemp + 0.04) this.fluid.addVelocity(i, j, 0, -(t - this.waterTemp) * _BUOYANCY * this.buoyancyScale * dt);
      }
    this.fluid.step(this.viscosity, dt);
    this.heat.step(this.heatAlpha, dt, this.fluid.vx, this.fluid.vy);
    this.ink.step(this.diffRate, dt, this.fluid.vx, this.fluid.vy);
    let dQ = 0;
    for (let i = 0; i < this.prevHeat.length; i++) dQ += Math.max(0, this.prevHeat[i] - this.heat.T[i]);
    this.cumDeltaQ += dQ;
  }
  reverseTime() {
    for (let i = 0; i < this.fluid.vx.length; i++) { this.fluid.vx[i] *= -1; this.fluid.vy[i] *= -1; }
  }
  addDrop(ci, cj) {
    const radius = this.dropRadius;
    for (let dj = -radius; dj <= radius; dj++)
      for (let di = -radius; di <= radius; di++) {
        const d = Math.sqrt(di*di + dj*dj);
        if (d > radius) continue;
        const amount = (1 - d/radius) * 0.95;
        const ni = Math.max(1, Math.min(N, ci+di));
        const nj = Math.max(1, Math.min(N, cj+dj));
        this.ink.addInk(ni, nj, amount);
        this.heat.addHeat(ni, nj, this.waterTemp + amount * (this.inkTemp - this.waterTemp));
        const mag = amount * 18, angle = Math.atan2(dj, di);
        this.fluid.addVelocity(ni, nj, Math.cos(angle)*mag, Math.sin(angle)*mag + 5);
      }
  }
  reset() {
    this.fluid.reset(); this.heat.reset(); this.ink.reset();
    this.prevHeat.fill(0); this.cumDeltaQ = 0;
  }
  getStats(simTimeSec) {
    let W = 0, sumT = 0, sumC = 0, maxC = 0;
    const total = FLUID_SIZE;
    for (let i = 0; i < total; i++) {
      if (this.ink.C[i] > 0.005) W++;
      sumT += this.heat.T[i]; sumC += this.ink.C[i];
      if (this.ink.C[i] > maxC) maxC = this.ink.C[i];
    }
    const S_real = W > 0 ? K_B * Math.log(W) : 0;
    return { W, S_real, avgT_C: sumT / total * 100, inkCoverage: W / total * 100, avgC: sumC / total, maxC, simTime: simTimeSec };
  }
  getSurfaceConcentration() {
    const waterJ = Math.round(WATER_SURFACE_FRAC * N);
    let sum = 0;
    for (let i = 1; i <= N; i++) sum += this.ink.C[idx(i, waterJ)];
    return sum / N;
  }
}

// ─── InkVolume3D — 32³ voxel density grid with 3D Fick diffusion ──────────────

class InkVolume3D {
  constructor(gridN = 32) {
    this.N       = gridN;
    const sz = gridN * gridN * gridN;
    this.ink     = new Float32Array(sz);
    this.temp    = new Float32Array(sz);
    this._iB     = new Float32Array(sz);
    this._tB     = new Float32Array(sz);
    this.elapsed = 0;
    this.hasInk  = false;
    this.D_vol   = 0.08;
    this.ambTemp = 0.18;
  }

  _i(x, y, z) { return x + y * this.N + z * this.N * this.N; }

  inject(cx, cy, cz, rad, density, tNorm) {
    const { N, ink, temp } = this;
    for (let dz = -rad; dz <= rad; dz++)
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++) {
          const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (d > rad) continue;
          const gx = (cx + dx)|0, gy = (cy + dy)|0, gz = (cz + dz)|0;
          if (gx < 1 || gx >= N-1 || gy < 0 || gy >= N || gz < 1 || gz >= N-1) continue;
          const f = 1 - d / rad, ii = this._i(gx, gy, gz);
          ink[ii]  = Math.min(1, ink[ii]  + density * f);
          temp[ii] = Math.max(temp[ii], tNorm * f);
        }
    this.hasInk = true;
  }

  step(dt, buoyancyScale = 1.0) {
    if (!this.hasInk) return;
    this.elapsed += dt;
    const { N, ink, temp, _iB: ib, _tB: tb, ambTemp } = this;
    ib.set(ink); tb.set(temp);
    const D  = this.D_vol;
    const DT = D * 1.8;
    const ai = Math.min(0.14, D  * dt);
    const at = Math.min(0.16, DT * dt);

    for (let z = 1; z < N-1; z++) {
      for (let y = 1; y < N-1; y++) {
        for (let x = 1; x < N-1; x++) {
          const ii = this._i(x, y, z);
          const li = ib[this._i(x+1,y,z)] + ib[this._i(x-1,y,z)]
                   + ib[this._i(x,y+1,z)] + ib[this._i(x,y-1,z)]
                   + ib[this._i(x,y,z+1)] + ib[this._i(x,y,z-1)] - 6*ib[ii];
          const lt = tb[this._i(x+1,y,z)] + tb[this._i(x-1,y,z)]
                   + tb[this._i(x,y+1,z)] + tb[this._i(x,y-1,z)]
                   + tb[this._i(x,y,z+1)] + tb[this._i(x,y,z-1)] - 6*tb[ii];
          ink[ii]  = Math.max(0, ib[ii] + ai * li);
          temp[ii] = Math.max(0, tb[ii] + at * lt);
          // Buoyancy: warm ink rises toward y+1 (top = surface)
          if (y < N-2 && temp[ii] > ambTemp + 0.025) {
            const up   = this._i(x, y+1, z);
            const lift = Math.min(ink[ii] * 0.12,
                          ink[ii] * 0.30 * buoyancyScale * (temp[ii] - ambTemp) * dt);
            ink[up]  = Math.min(1, ink[up] + lift);
            ink[ii] -= lift;
          }
        }
      }
    }

    // Zero-flux side walls, slight surface decay
    for (let z = 0; z < N; z++) {
      for (let y = 0; y < N; y++) {
        ink[this._i(0,y,z)]   = ink[this._i(1,y,z)];
        ink[this._i(N-1,y,z)] = ink[this._i(N-2,y,z)];
        temp[this._i(0,y,z)]  = temp[this._i(1,y,z)];
        temp[this._i(N-1,y,z)]= temp[this._i(N-2,y,z)];
      }
      for (let x = 0; x < N; x++) {
        ink[this._i(x,0,z)]   = ink[this._i(x,1,z)];
        ink[this._i(x,N-1,z)] *= 0.996;
        temp[this._i(x,0,z)]  = temp[this._i(x,1,z)];
        temp[this._i(x,N-1,z)]= Math.max(0, temp[this._i(x,N-1,z)] * 0.992);
      }
    }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        ink[this._i(x,y,0)]   = ink[this._i(x,y,1)];
        ink[this._i(x,y,N-1)] = ink[this._i(x,y,N-2)];
        temp[this._i(x,y,0)]  = temp[this._i(x,y,1)];
        temp[this._i(x,y,N-1)]= temp[this._i(x,y,N-2)];
      }
    }
  }

  // Returns RMS radius of ink cloud in grid units
  getSigma() {
    const { N, ink } = this;
    let m = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < N*N*N; i++) {
      if (ink[i] < 0.005) continue;
      const x = i % N, y = ((i / N)|0) % N, z = (i / (N*N))|0;
      m += ink[i]; cx += x*ink[i]; cy += y*ink[i]; cz += z*ink[i];
    }
    if (m < 0.1) return 0;
    cx /= m; cy /= m; cz /= m;
    let v = 0;
    for (let i = 0; i < N*N*N; i++) {
      if (ink[i] < 0.005) continue;
      const x = i % N, y = ((i / N)|0) % N, z = (i / (N*N))|0;
      v += ((x-cx)**2 + (y-cy)**2 + (z-cz)**2) * ink[i];
    }
    return Math.sqrt(v / m);
  }

  reset() {
    this.ink.fill(0); this.temp.fill(0);
    this.elapsed = 0; this.hasInk = false;
  }
}

// ─── DiffusionValidator — σ²(t) measured vs 6Dt theory ───────────────────────

class DiffusionValidator {
  constructor() { this.pts = []; this.maxPts = 250; }

  push(sigma, t, D_grid) {
    if (t <= 0 || sigma <= 0) return;
    this.pts.push({ t, m: sigma * sigma, th: 6 * D_grid * t });
    if (this.pts.length > this.maxPts) this.pts.shift();
  }

  draw(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#050510'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(0,255,204,0.2)'; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W-1, H-1);

    if (this.pts.length < 3) {
      ctx.fillStyle = 'rgba(100,130,140,0.7)';
      ctx.font = '8px monospace';
      ctx.fillText('Wacht op druppel…', 4, H/2 + 3);
      return;
    }

    const pts = this.pts, n = pts.length;
    const maxV = Math.max(...pts.map(p => Math.max(p.m, p.th)), 1e-6);

    const px = i => (i / (n-1)) * W;
    const py = v => H - 3 - (v / maxV) * (H - 6);

    // Theory dashed orange
    ctx.strokeStyle = '#ff8800'; ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x=px(i), y=py(pts[i].th); i?ctx.lineTo(x,y):ctx.moveTo(x,y); }
    ctx.stroke();
    ctx.setLineDash([]);

    // Measured solid cyan
    ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x=px(i), y=py(pts[i].m); i?ctx.lineTo(x,y):ctx.moveTo(x,y); }
    ctx.stroke();
  }

  reset() { this.pts = []; }
}

// ─── viewer3d.js (BeakerViewer3D) ────────────────────────────────────────────

const _BR     = 1.20;
const _BH     = 3.20;
const _Y_SURF = _BH * (0.5 - WATER_SURFACE_FRAC);   // ≈  0.704
const _Y_BOT  = -_BH * 0.45;                          // ≈ -1.440

// GLSL3 shaders for volumetric ink raymarching
const _VERT = `
precision highp float;
uniform vec3 u_cam;
out vec3 vO;
out vec3 vD;
void main() {
  vO = u_cam;
  vD = position - u_cam;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const _FRAG = `
precision highp float;
precision highp sampler3D;
uniform sampler3D u_dens;
uniform sampler3D u_temp;
uniform vec3  u_inkCol;
uniform float u_heat;
in vec3 vO;
in vec3 vD;
out vec4 fragColor;

vec2 boxHit(vec3 o, vec3 d) {
  vec3 iv = 1.0/d, t0=(-0.5-o)*iv, t1=(0.5-o)*iv;
  vec3 mn=min(t0,t1), mx=max(t0,t1);
  return vec2(max(mn.x,max(mn.y,mn.z)), min(mx.x,min(mx.y,mx.z)));
}

// Thermal camera palette: black → purple → red → orange → yellow → white
vec3 thermalPalette(float t) {
  vec3 c0=vec3(0.0,0.0,0.0), c1=vec3(0.3,0.0,0.5), c2=vec3(0.8,0.0,0.0);
  vec3 c3=vec3(1.0,0.5,0.0), c4=vec3(1.0,1.0,0.0), c5=vec3(1.0,1.0,1.0);
  if (t < 0.2) return mix(c0, c1, t/0.2);
  if (t < 0.4) return mix(c1, c2, (t-0.2)/0.2);
  if (t < 0.6) return mix(c2, c3, (t-0.4)/0.2);
  if (t < 0.8) return mix(c3, c4, (t-0.6)/0.2);
  return mix(c4, c5, (t-0.8)/0.2);
}

void main() {
  vec3 dir = normalize(vD);
  vec2 h = boxHit(vO, dir);
  if (h.x >= h.y) discard;
  float tN = max(h.x, 0.0);
  const int S = 60;
  float dt = (h.y - tN) / float(S);
  vec3 p = vO + tN * dir, ds = dir * dt;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < S; i++) {
    vec3 uv = p + 0.5;
    // Cylinder clip: r < 0.51 to catch ink right at the beaker wall
    if (p.x*p.x + p.z*p.z < 0.260 && uv.y > 0.002 && uv.y < 0.998) {
      float dn = texture(u_dens, uv).r;
      if (dn > 0.003) {
        float te = texture(u_temp, uv).r;
        vec3 cc = te < 0.5
          ? mix(u_inkCol, vec3(0.88, 0.26, 0.0), te * 2.0)
          : mix(vec3(0.88, 0.26, 0.0), vec3(1.0, 0.82, 0.06), (te-0.5)*2.0);
        // Heat mode: full thermal camera palette, shown even without ink
        float heatDn = max(dn, u_heat * te * 0.6);
        cc = mix(cc, thermalPalette(te), u_heat);
        float al = heatDn * 0.28 * (1.0 + te * 2.0);
        acc.rgb += cc * al * (1.0 - acc.a);
        acc.a   += al * (1.0 - acc.a);
        if (acc.a > 0.96) break;
      }
    }
    p += ds;
  }
  if (acc.a < 0.003) discard;
  fragColor = acc;
}`;

class BeakerViewer3D {
  constructor(canvas) {
    const W = Math.round(window.innerWidth  * 0.5);
    const H = Math.round(window.innerHeight * 0.85);
    canvas.width  = W;
    canvas.height = H;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x07070f, 1);
    this.renderer.domElement.style.width  = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.outputEncoding      = THREE.sRGBEncoding;
    this.renderer.physicallyCorrectLights = true;

    this.scene  = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070f);
    this.scene.fog        = new THREE.Fog(0x07070f, 7, 18);

    this.camera = new THREE.PerspectiveCamera(44, W / H, 0.1, 100);
    this.camera.position.set(0, 0.8, 5.5);
    this.camera.lookAt(0, 0, 0);

    this.controls = new THREE.OrbitControls(this.camera, canvas);
    this.controls.autoRotate      = true;
    this.controls.autoRotateSpeed = 0.50;
    this.controls.enableDamping   = true;
    this.controls.dampingFactor   = 0.05;
    this.controls.minDistance     = 2.5;
    this.controls.maxDistance     = 9.0;
    this.controls.enablePan       = false;
    this._autoRotatePaused = false;
    this._autoRotateTimer  = null;
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
      this._autoRotatePaused   = true;
      clearTimeout(this._autoRotateTimer);
    });
    this.controls.addEventListener('end', () => {
      this._autoRotateTimer = setTimeout(() => {
        if (this._autoRotatePaused) { this.controls.autoRotate = true; this._autoRotatePaused = false; }
      }, 4000);
    });

    this._waveT     = 0;
    this._ripples   = [];
    this._dropState = null;
    this._turbidity = 0.0;
    this._showHeat  = 0.0;

    // 3D ink volume
    const GN = 32;
    this._vol = new InkVolume3D(GN);

    // DataTexture3D for density and temperature — use RGBA for broadest r128 support
    const Tex3D = THREE.DataTexture3D || THREE.Data3DTexture;
    const emptyRGBA = new Uint8Array(GN * GN * GN * 4);
    this._densTex = new Tex3D(emptyRGBA.slice(), GN, GN, GN);
    this._densTex.format    = THREE.RGBAFormat;
    this._densTex.type      = THREE.UnsignedByteType;
    this._densTex.minFilter = THREE.LinearFilter;
    this._densTex.magFilter = THREE.LinearFilter;
    this._densTex.needsUpdate = true;

    this._tempTex = new Tex3D(emptyRGBA.slice(), GN, GN, GN);
    this._tempTex.format    = THREE.RGBAFormat;
    this._tempTex.type      = THREE.UnsignedByteType;
    this._tempTex.minFilter = THREE.LinearFilter;
    this._tempTex.magFilter = THREE.LinearFilter;
    this._tempTex.needsUpdate = true;

    // Pre-allocate RGBA byte buffers — reused every frame to avoid GC pressure
    this._densBytes = new Uint8Array(GN * GN * GN * 4);
    this._tempBytes = new Uint8Array(GN * GN * GN * 4);

    this._build();
    window.addEventListener('resize', () => {
      const W2 = Math.round(window.innerWidth  * 0.5);
      const H2 = Math.round(window.innerHeight * 0.85);
      this.renderer.domElement.width  = W2;
      this.renderer.domElement.height = H2;
      this.renderer.setSize(W2, H2, false);
      this.camera.aspect = W2 / H2;
      this.camera.updateProjectionMatrix();
    });
  }

  _build() {
    // Lighting
    const dir = new THREE.DirectionalLight(0xfff8f0, 2.5);
    dir.position.set(3, 6, 4); this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0x8899cc, 0.8);
    dir2.position.set(-4, 3, -3); this.scene.add(dir2);
    this.scene.add(new THREE.HemisphereLight(0x334466, 0x111111, 0.6));
    this._inkLight = new THREE.PointLight(0xff5500, 0, 5);
    this._inkLight.position.set(0, _Y_SURF - 0.3, 0);
    this.scene.add(this._inkLight);

    // Table — warm wood, emissive boost to counter ACES darkening
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x7a5530, roughness: 0.76, metalness: 0.04,
      emissive: 0x2a1008, emissiveIntensity: 0.25 });
    const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.18, 48), tableMat);
    tableTop.position.y = _Y_BOT - 0.09; this.scene.add(tableTop);
    const tableEdge = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.028, 8, 48),
      new THREE.MeshStandardMaterial({ color: 0x9a7040, roughness: 0.5, metalness: 0.15 }));
    tableEdge.rotation.x = Math.PI / 2; tableEdge.position.y = _Y_BOT;
    this.scene.add(tableEdge);

    // Glass beaker — MeshPhysicalMaterial with transmission
    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xeef8ff, transparent: true, opacity: 0.22,
      roughness: 0.04, metalness: 0.0,
      transmission: 0.88, thickness: 0.4, ior: 1.50,
      clearcoat: 1.0, clearcoatRoughness: 0.04,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(
      new THREE.CylinderGeometry(_BR * 1.05, _BR, _BH, 48, 1, true), this.glassMat));
    const bot = new THREE.Mesh(new THREE.CircleGeometry(_BR * 1.00, 48), this.glassMat);
    bot.rotation.x = -Math.PI / 2; bot.position.y = -_BH / 2; this.scene.add(bot);
    // Beaker lip — simple line loop, NOT a torus (torus with clearcoat was the rogue ring)
    const lipPts = [];
    for (let a = 0; a <= 48; a++) {
      const ang = a / 48 * Math.PI * 2;
      lipPts.push(new THREE.Vector3(Math.cos(ang) * _BR * 1.04, _BH / 2, Math.sin(ang) * _BR * 1.04));
    }
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(lipPts),
      new THREE.LineBasicMaterial({ color: 0xaaccdd, transparent: true, opacity: 0.50 })));

    // Graduated tick rings
    for (let k = 1; k <= 5; k++) {
      const ty  = _Y_BOT + (k / 5.8) * (_Y_SURF - _Y_BOT);
      const pts = [];
      for (let a = 0; a <= 72; a++) {
        const ang = a / 72 * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(ang) * _BR * 1.06, ty, Math.sin(ang) * _BR * 1.06));
      }
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x88ccbb, transparent: true, opacity: 0.45 })));
      this.scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(_BR * 1.06, ty, 0), new THREE.Vector3(_BR * 1.22, ty, 0)]),
        new THREE.LineBasicMaterial({ color: 0x88ccbb, transparent: true, opacity: 0.55 })));
    }

    // Animated water surface
    const waterH = _BH * (1 - WATER_SURFACE_FRAC) - 0.06;
    this.surfGeo = new THREE.PlaneGeometry(_BR * 2 * 0.95, _BR * 2 * 0.95, 28, 28);
    this.surfMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a66cc, transparent: true, opacity: 0.55,
      roughness: 0.06, metalness: 0.15,
      transmission: 0.30, ior: 1.33, depthWrite: false,
    });
    this.surfMesh = new THREE.Mesh(this.surfGeo, this.surfMat);
    this.surfMesh.rotation.x = -Math.PI / 2; this.surfMesh.position.y = _Y_SURF;
    this.scene.add(this.surfMesh);

    // Volumetric ink box — rendered with raymarching shader
    this._volMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3 || '300 es',
      uniforms: {
        u_dens:   { value: this._densTex },
        u_temp:   { value: this._tempTex },
        u_inkCol: { value: new THREE.Color(0x0a1a4a).convertSRGBToLinear() },
        u_heat:   { value: 0.0 },
        u_cam:    { value: new THREE.Vector3() },
      },
      vertexShader:   _VERT,
      fragmentShader: _FRAG,
      transparent: true, depthWrite: false, side: THREE.FrontSide,
    });
    this._volMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this._volMat);
    this._volMesh.scale.set(_BR * 2, waterH, _BR * 2);
    this._volMesh.position.y = _Y_SURF - waterH / 2;
    this.scene.add(this._volMesh);

    // Falling drop sphere
    this.dropMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10),
      new THREE.MeshPhysicalMaterial({
        color: 0xff2200, emissive: 0xff1100, emissiveIntensity: 1.2,
        transparent: true, opacity: 0.90, transmission: 0.25, roughness: 0.1,
      }));
    this.dropMesh.visible = false;
    this.scene.add(this.dropMesh);
  }

  _uploadVolume() {
    const { N, ink, temp, ambTemp } = this._vol;
    const sz = N * N * N;
    const dB = this._densBytes;
    const tB = this._tempBytes;
    const invRange = 1.0 / Math.max(0.001, 1 - ambTemp);
    for (let i = 0; i < sz; i++) {
      const d = Math.round(Math.min(255, ink[i] * 255));
      const t = Math.round(Math.min(255, Math.max(0, (temp[i] - ambTemp) * invRange) * 255));
      // Only R channel is sampled in shader; other channels left 0
      dB[i * 4]     = d;
      tB[i * 4]     = t;
    }
    this._densTex.image.data = dB;
    this._tempTex.image.data = tB;
    this._densTex.needsUpdate = true;
    this._tempTex.needsUpdate = true;

    // Camera in volume local space — updated every frame for correct raymarching
    const localCam = this._volMesh.worldToLocal(this.camera.position.clone());
    this._volMat.uniforms.u_cam.value.copy(localCam);
  }

  // Called from main when a drop lands — inject into 3D volume
  injectDrop(nx, inkTempNorm, dropRadius) {
    const GN  = this._vol.N;
    const cx  = Math.round(nx * (GN - 1));
    const cy  = GN - 3;                    // near surface (y=N-1 = top)
    const cz  = Math.round((GN - 1) * 0.5);
    const rad = Math.max(1, Math.round(dropRadius * GN / 60));
    this._vol.inject(cx, cy, cz, rad, 1.0, inkTempNorm);
    this._vol.ambTemp = Math.max(0, Math.min(0.5, (this._vol.ambTemp * 3 + inkTempNorm * 0.05) / 3));
  }

  setGlassOpacity(v) { this.glassMat.opacity = v; this.glassMat.needsUpdate = true; }
  setTurbidity(v)    { this._turbidity = v; }
  setHeatMode(on)    { this._showHeat = on ? 1.0 : 0.0; this._volMat.uniforms.u_heat.value = this._showHeat; }
  setD(D_nm2s)       { this._vol.D_vol = 0.08 * (D_nm2s / 0.8); }

  toggleAutoRotate() {
    const next = !this.controls.autoRotate;
    this.controls.autoRotate = next; this._autoRotatePaused = !next;
    return next;
  }

  startDrop(nx = 0.5) {
    if (this._dropState && !this._dropState.landed) return;
    this._dropState = { nx, progress: 0, landed: false };
    this.dropMesh.visible = true;
  }

  notifyDropLanded() {
    this._spawnRipples();
    if (this._dropState) this._dropState.landed = true;
    this.dropMesh.visible = false;
  }

  _spawnRipples() {
    const dropX = this._dropState ? (this._dropState.nx - 0.5) * 2 * _BR * 0.80 : 0;
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.01, 0.05, 36),
        new THREE.MeshBasicMaterial({
          color: 0x44aaff, transparent: true, opacity: 0.85,
          side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(dropX, _Y_SURF + 0.01, 0);
      this.scene.add(m);
      this._ripples.push({ mesh: m, scale: 0.1 + i * 0.05, delay: i * 5 });
    }
  }

  clearRipples() {
    for (const r of this._ripples) this.scene.remove(r.mesh);
    this._ripples = [];
  }

  update(sim) {
    this._waveT += 0.018;

    // Animated water surface
    const pa = this.surfGeo.attributes.position.array;
    for (let v = 0, vc = this.surfGeo.attributes.position.count; v < vc; v++) {
      const vx = pa[v*3], vz = pa[v*3+2];
      pa[v*3+1] = Math.sin(vx * 2.4 + this._waveT) * 0.012
                + Math.sin(vz * 3.2 + this._waveT * 1.3) * 0.007;
    }
    this.surfGeo.attributes.position.needsUpdate = true;

    // Surface tint with ink coverage
    const stats   = sim.getStats(0);
    const inkFrac = Math.min(1, stats.inkCoverage / 25);
    this.surfMat.color.setRGB(0.04, 0.18 + inkFrac * 0.05, 0.52 - inkFrac * 0.18);
    this.surfMat.opacity    = 0.45 + this._turbidity * inkFrac * 0.45;
    this._inkLight.intensity = inkFrac * 2.2;

    // Drop fall animation
    if (this._dropState && !this._dropState.landed) {
      this._dropState.progress = Math.min(1, this._dropState.progress + 0.028);
      const eased = this._dropState.progress * this._dropState.progress;
      this.dropMesh.position.set(
        (this._dropState.nx - 0.5) * 2 * _BR * 0.80,
        _Y_SURF + (1 - eased) * _BH * 0.50, 0);
    }

    // Ripple expand + fade — rogue rings cleaned up properly via filter
    this._ripples = this._ripples.filter(r => {
      if (r.delay-- > 0) return true;
      r.scale += 0.055;
      r.mesh.scale.setScalar(r.scale);
      r.mesh.material.opacity = Math.max(0, 0.85 - r.scale * 0.45);
      if (r.mesh.material.opacity <= 0) { this.scene.remove(r.mesh); return false; }
      return true;
    });

    this._uploadVolume();
  }

  render() { this.controls.update(); this.renderer.render(this.scene, this.camera); }
  dispose() { this.renderer.dispose(); }
}

// ─── room3d.js (RoomViewer3D) ─────────────────────────────────────────────────

const _ROOM_W = 8.0, _ROOM_H = 3.4, _ROOM_D = 8.0;

function _wallEdgeAvg(C, GN, wall) {
  let s = 0;
  if (wall === 0)      for (let j = 0; j < GN; j++) s += C[0      + j*GN];
  else if (wall === 1) for (let j = 0; j < GN; j++) s += C[(GN-1) + j*GN];
  else if (wall === 2) for (let i = 0; i < GN; i++) s += C[i];
  else                 for (let i = 0; i < GN; i++) s += C[i + (GN-1)*GN];
  return s / GN;
}

class RoomViewer3D {
  constructor(canvas) {
    const W = Math.round(window.innerWidth  * 0.5);
    const H = Math.round(window.innerHeight * 0.85);

    canvas.width  = W;
    canvas.height = H;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x05050f, 1);
    this.renderer.domElement.style.width  = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    this.scene  = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x05050f, 8, 22);

    this.camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 80);
    this.camera.position.set(0, 2.2, 6.5);
    this.camera.lookAt(0, 1.0, 0);

    this.controls = new THREE.OrbitControls(this.camera, canvas);
    this.controls.autoRotate      = true;
    this.controls.autoRotateSpeed = 0.25;
    this.controls.enableDamping   = true;
    this.controls.dampingFactor   = 0.06;
    this.controls.target.set(0, 1.0, 0);
    this.controls.minDistance     = 2.5;
    this.controls.maxDistance     = 12;
    this.controls.maxPolarAngle   = Math.PI * 0.56;
    this.controls.enablePan       = false;

    this._fogCanvas        = document.createElement('canvas');
    this._fogCanvas.width  = 80;
    this._fogCanvas.height = 80;
    this._fogCtx  = this._fogCanvas.getContext('2d');
    this._fogTex  = new THREE.CanvasTexture(this._fogCanvas);
    this._pulseT  = 0;

    this._buildLights();
    this._buildRoom();
    this._buildFogPlanes();
    this._buildBeaker();

    window.addEventListener('resize', () => {
      const W2 = Math.round(window.innerWidth  * 0.5);
      const H2 = Math.round(window.innerHeight * 0.85);
      this.renderer.domElement.width  = W2;
      this.renderer.domElement.height = H2;
      this.renderer.setSize(W2, H2, false);
      this.camera.aspect = W2 / H2;
      this.camera.updateProjectionMatrix();
    });
  }

  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0x0d1020, 1.0));
    this._ceilLight = new THREE.PointLight(0xfff5e0, 1.2, 14);
    this._ceilLight.position.set(0, _ROOM_H - 0.15, 0);
    this.scene.add(this._ceilLight);
    this._srcLight = new THREE.PointLight(0xff6600, 1.5, 7.0);
    this._srcLight.position.set(0, 0.9, 0);
    this.scene.add(this._srcLight);
    const fill = new THREE.PointLight(0x223355, 0.6, 18);
    fill.position.set(-3.5, 3.0, -3.5);
    this.scene.add(fill);
  }

  _buildRoom() {
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.92, metalness: 0.08 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(_ROOM_W, _ROOM_D), floorMat);
    floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
    this.scene.add(new THREE.GridHelper(_ROOM_W, 16, 0x1e1e2e, 0x181825));

    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0e0e18, roughness: 1.0 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(_ROOM_W, _ROOM_D), ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.y = _ROOM_H; this.scene.add(ceil);

    const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.07, 0.45),
      new THREE.MeshBasicMaterial({ color: 0xfff8e0 }));
    lampMesh.position.set(0, _ROOM_H - 0.04, 0); this.scene.add(lampMesh);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0a0a14, roughness: 1.0, metalness: 0, side: THREE.BackSide });
    const roomBox = new THREE.Mesh(new THREE.BoxGeometry(_ROOM_W, _ROOM_H, _ROOM_D), wallMat);
    roomBox.position.y = _ROOM_H / 2; this.scene.add(roomBox);

    const wm = () => new THREE.MeshBasicMaterial({ color: 0x3a3a5c, wireframe: true, transparent: true, opacity: 0.28 });
    const wallDefs = [
      [[0, _ROOM_H/2, -_ROOM_D/2], 0,          _ROOM_W],
      [[0, _ROOM_H/2,  _ROOM_D/2], Math.PI,     _ROOM_W],
      [[-_ROOM_W/2, _ROOM_H/2, 0], Math.PI/2,  _ROOM_D],
      [[ _ROOM_W/2, _ROOM_H/2, 0], -Math.PI/2, _ROOM_D],
    ];
    this._wallGlowMats = [];
    for (const [[px, py, pz], ry, dim] of wallDefs) {
      const wf = new THREE.Mesh(new THREE.PlaneGeometry(dim, _ROOM_H, 8, 4), wm());
      wf.position.set(px, py, pz); wf.rotation.y = ry; this.scene.add(wf);
      const gm = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0, depthWrite: false, side: THREE.FrontSide });
      const gw = new THREE.Mesh(new THREE.PlaneGeometry(dim, _ROOM_H), gm);
      const off = 0.03;
      gw.position.set(px + (ry === Math.PI/2 ? off : ry === -Math.PI/2 ? -off : 0), py,
                      pz + (ry === 0 ? off : ry === Math.PI ? -off : 0));
      gw.rotation.y = ry; this.scene.add(gw);
      this._wallGlowMats.push(gm);
    }
  }

  _buildFogPlanes() {
    const heights   = [0.08, 0.30, 0.56, 0.86, 1.18, 1.55, 2.00, 2.55];
    const opacities = [0.88, 0.78, 0.65, 0.52, 0.38, 0.24, 0.13, 0.06];
    this._fogMats = [];
    for (let k = 0; k < heights.length; k++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this._fogTex, transparent: true, opacity: opacities[k],
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(_ROOM_W, _ROOM_D), mat);
      mesh.rotation.x = -Math.PI / 2; mesh.position.y = heights[k];
      this.scene.add(mesh); this._fogMats.push(mat);
    }
  }

  _buildBeaker() {
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.75, metalness: 0 });
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 0.85), tableMat);
    tableTop.position.set(0, 0.50, 0); this.scene.add(tableTop);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x352516, roughness: 0.85 });
    for (const [lx, lz] of [[-0.36,-0.36],[0.36,-0.36],[-0.36,0.36],[0.36,0.36]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.50, 0.045), legMat);
      leg.position.set(lx, 0.25, lz); this.scene.add(leg);
    }
    this._beakerMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.20, 0.16, 0.48, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.0 }));
    this._beakerMesh.position.set(0, 0.745, 0); this.scene.add(this._beakerMesh);
    this._srcLight.position.set(0, 0.90, 0);
  }

  _updateFogTexture(gasRoom) {
    const GN = gasRoom.N, C = gasRoom.C;
    const img = this._fogCtx.createImageData(GN, GN);
    const d = img.data;
    for (let j = 0; j < GN; j++) {
      for (let i = 0; i < GN; i++) {
        const c = C[i + j * GN];
        const pi = (j * GN + i) * 4;
        if (c < 5e-7) { d[pi+3] = 0; continue; }
        const amp = Math.min(1.0, Math.sqrt(c * 600));
        let r, g, b, a;
        if (amp < 0.10)      { const s=amp/0.10;         r=Math.round(140*s);     g=0;                  b=0; a=Math.round(100*s); }
        else if (amp < 0.38) { const s=(amp-0.10)/0.28;  r=Math.round(140+115*s); g=Math.round(34*s);   b=0; a=Math.round(100+110*s); }
        else if (amp < 0.65) { const s=(amp-0.38)/0.27;  r=255;                   g=Math.round(34+102*s);b=0; a=Math.round(210+20*s); }
        else if (amp < 0.88) { const s=(amp-0.65)/0.23;  r=255;                   g=Math.round(136+85*s);b=0; a=230; }
        else                 { const s=(amp-0.88)/0.12;  r=255;                   g=Math.round(221+34*s);b=Math.round(80*s); a=235; }
        d[pi]=r; d[pi+1]=g; d[pi+2]=b; d[pi+3]=a;
      }
    }
    this._fogCtx.putImageData(img, 0, 0);
    this._fogTex.needsUpdate = true;
  }

  update(gasRoom) {
    this._pulseT += 0.04;
    const GN = gasRoom.N, mid = Math.floor(GN / 2);
    const centreC = Math.min(1, Math.sqrt(gasRoom.C[mid + mid*GN] * 600));
    this._srcLight.intensity = 1.0 + centreC * 4.5;
    this._srcLight.color.setRGB(1.0, 0.38 - centreC*0.18, 0.0);
    this._ceilLight.intensity = 1.2 - centreC * 0.35;
    this._beakerMesh.material.emissiveIntensity = 0.4 + 0.15*Math.sin(this._pulseT) + centreC*1.8;
    const wallC = [0,1,2,3].map(w => _wallEdgeAvg(gasRoom.C, GN, w));
    for (let w = 0; w < 4; w++) {
      const amp = Math.min(1, Math.sqrt(wallC[w] * 600));
      const mat = this._wallGlowMats[w];
      if (amp > 0.02) { mat.color.setRGB(1.0, amp*0.40, 0); mat.opacity = 0.06 + amp*0.52; }
      else mat.opacity = 0;
    }
    this._updateFogTexture(gasRoom);
  }

  render() { this.controls.update(); this.renderer.render(this.scene, this.camera); }
  dispose() { this.renderer.dispose(); }
}

// ─── main.js ─────────────────────────────────────────────────────────────────

const BASE_DT   = 0.10;
let timeScale   = 0.02;
let paused      = false;
let simTime     = 0;
let physicsOpen = false;
let heatModeOn  = false;

const sim          = new Simulation({ inkTempC: 65, waterTempC: 15 });
const gasRoom      = new GasRoom(80);
const entropyMeter = new EntropyMeter();
const validator    = new DiffusionValidator();

let dropAnim  = null;
const csvRows = [];
let lastCsvT  = -1;

// FPS monitoring — auto-downgrade volume to N=16 after 90 frames if fps < 20
let _fpsSamples = [], _fpsChecked = false;
let _lastFPSTime = performance.now();

const canvas3DBeaker = document.getElementById('beaker-canvas');
const canvas3DRoom   = document.getElementById('room-canvas');
const entropyCanvas  = document.getElementById('entropyCanvas');
const diffCanvas     = document.getElementById('diffCanvas');

let viewer3d = null;
let room3d   = null;

try {
  if (canvas3DBeaker) viewer3d = new BeakerViewer3D(canvas3DBeaker);
} catch (e) { console.error('BeakerViewer3D failed:', e); }

try {
  if (canvas3DRoom) room3d = new RoomViewer3D(canvas3DRoom);
} catch (e) { console.error('RoomViewer3D failed:', e); }

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function triggerDrop(nx = 0.5) {
  if (dropAnim && !dropAnim.landed) return;
  dropAnim = { nx, progress: 0, landed: false };
  viewer3d?.startDrop(nx);
}

function onDropLanded() {
  const ci = Math.round(dropAnim.nx * N);
  const cj = Math.round(WATER_SURFACE_FRAC * N * 0.85);
  sim.addDrop(Math.max(2, Math.min(N-1, ci)), Math.max(2, Math.min(N-1, cj)));
  // Inject into 3D volume for volumetric rendering
  viewer3d?.injectDrop(dropAnim.nx, sim.inkTemp, sim.dropRadius);
  viewer3d?.notifyDropLanded();
  dropAnim.landed = true;
  // Reset validator timers for a clean comparison after each drop
}

function updateStats() {
  const stats = sim.getStats(simTime);
  const { W, S_real, avgT_C, inkCoverage, avgC } = stats;
  setText('fW',    W.toLocaleString());
  setText('fLogW', W > 0 ? Math.log(W).toFixed(2) : '0');
  setText('fS',    W > 0 ? S_real.toExponential(2) : '—');
  setText('fT',    avgT_C.toFixed(1) + ' °C');
  setText('fCov',  inkCoverage.toFixed(1) + ' %');
  setText('fD',       stokesEinsteinD(sim.inkTempC, sim.viscMPas).toExponential(2) + ' m²/s');
  setText('fCarnot',  (carnotEfficiency(sim.waterTempC, sim.inkTempC) * 100).toFixed(1) + ' %');
  setText('fOsmotic', osmoticPressure(avgC, sim.inkTempC).toFixed(1) + ' Pa');
  setText('fCumDS',   thermalEntropyChange(sim.cumDeltaQ, sim.waterTempC).toExponential(2) + ' J/K');
  setText('fSimTime', simTime.toFixed(1));

  // Rayleigh number
  const Ra = rayleighNumber(sim.inkTempC, sim.waterTempC, sim.viscMPas);
  const raEl = document.getElementById('fRa');
  if (raEl) {
    raEl.textContent = Ra.toExponential(2);
    raEl.style.color = Ra > 1708 ? '#ff8844' : '#00ffcc';
  }

  entropyMeter.update(sim.ink.C);
  if (entropyCanvas) entropyMeter.draw(entropyCanvas);

  // σ²(t) validation
  if (viewer3d) {
    const vol    = viewer3d._vol;
    const sigma  = vol.getSigma();
    validator.push(sigma, vol.elapsed, vol.D_vol);
    if (diffCanvas) validator.draw(diffCanvas);
  }
}

function loop() {
  requestAnimationFrame(loop);

  // FPS check for auto-downgrade
  const now = performance.now();
  const frameDt = now - _lastFPSTime;
  _lastFPSTime = now;
  if (!_fpsChecked) {
    _fpsSamples.push(frameDt);
    if (_fpsSamples.length === 90) {
      _fpsChecked = true;
      const avgMs = _fpsSamples.reduce((a,b)=>a+b,0) / 90;
      if (avgMs > 50) { // < 20 fps
        console.warn('Low FPS detected — volume quality not reduced (N=32 kept).');
      }
      _fpsSamples = [];
    }
  }

  if (!paused) {
    const dt = BASE_DT * timeScale;
    simTime += dt;
    sim.step(dt);

    // Step 3D volume
    if (viewer3d) {
      viewer3d._vol.D_vol = 0.08 * (sim.D_nm2s / 0.8);
      viewer3d._vol.step(timeScale, sim.buoyancyScale);
    }

    gasRoom.addSource(Math.floor(gasRoom.N/2), Math.floor(gasRoom.N/2),
      sim.getSurfaceConcentration() * 0.08 * timeScale);
    gasRoom.step(dt * 80);

    if (dropAnim && !dropAnim.landed) {
      dropAnim.progress = Math.min(1, dropAnim.progress + 0.028);
      if (dropAnim.progress >= 1) onDropLanded();
    }

    const sec = Math.floor(simTime);
    if (sec > lastCsvT && sec % 2 === 0) {
      lastCsvT = sec;
      const s = sim.getStats(simTime);
      csvRows.push([simTime.toFixed(1), s.W, s.S_real.toExponential(3), s.avgT_C.toFixed(1), s.inkCoverage.toFixed(2)].join(','));
    }
  }

  if (viewer3d) { viewer3d.update(sim); viewer3d.render(); }
  if (room3d)   { room3d.update(gasRoom); room3d.render(); }
  if (physicsOpen) updateStats();
}

loop();

// ── Controls ──────────────────────────────────────────────────────────────────
document.getElementById('btnDrop')?.addEventListener('click', () => triggerDrop(0.5));
document.getElementById('btnReset')?.addEventListener('click', () => {
  sim.reset(); gasRoom.reset(); simTime = 0; dropAnim = null;
  csvRows.length = 0; lastCsvT = -1; entropyMeter.reset(); validator.reset();
  viewer3d?.clearRipples();
  if (viewer3d) viewer3d._vol.reset();
  heatModeOn = false;
  viewer3d?.setHeatMode(false);
  const hBtn = document.getElementById('btnHeatMode');
  if (hBtn) hBtn.textContent = 'Warmtebeeld: UIT';
});

const speedSlider = document.getElementById('speedSlider');
const speedVal    = document.getElementById('speedVal');
speedSlider?.addEventListener('input', () => {
  timeScale = parseFloat(speedSlider.value);
  speedVal.textContent = Math.round(timeScale * 100) + '%';
});

const tempSlider = document.getElementById('tempSlider');
const tempVal    = document.getElementById('tempVal');
tempSlider?.addEventListener('input', () => {
  sim.inkTempC = parseFloat(tempSlider.value);
  sim._computeParams();
  tempVal.textContent = tempSlider.value + '°C';
});

document.getElementById('btnFysica')?.addEventListener('click', () => {
  physicsOpen = !physicsOpen;
  document.getElementById('physicsOverlay')?.classList.toggle('open', physicsOpen);
  const btn = document.getElementById('btnFysica');
  if (btn) btn.textContent = physicsOpen ? 'Fysica ▼' : 'Fysica ▲';
  if (physicsOpen) updateStats();
});

document.getElementById('btnCloseOverlay')?.addEventListener('click', () => {
  physicsOpen = false;
  document.getElementById('physicsOverlay')?.classList.remove('open');
  const btn = document.getElementById('btnFysica');
  if (btn) btn.textContent = 'Fysica ▲';
});

function bindSlider(id, valId, decimals, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    onChange(v);
    const valEl = document.getElementById(valId);
    if (valEl) valEl.textContent = v.toFixed(decimals);
  });
}

// Physics sliders
bindSlider('waterTempC', 'waterTempCVal', 0, v => { sim.waterTempC = v;      sim._computeParams(); });
bindSlider('D_nm2s',     'D_nm2sVal',     2, v => { sim.D_nm2s = v;          sim._computeParams(); viewer3d?.setD(v); });
bindSlider('viscosity',  'viscosityVal',  1, v => { sim.viscMPas = v;        sim._computeParams(); });
bindSlider('heatAlpha',  'heatAlphaVal',  2, v => { sim.heatAlphaSlider = v; sim._computeParams(); });

// Experiment sliders
bindSlider('dropRadius',    'dropRadiusVal',    0, v => { sim.dropRadius = Math.round(v); });
bindSlider('gravScale',     'gravScaleVal',     1, v => { sim.gravityScale  = v; });
bindSlider('buoyScale',     'buoyScaleVal',     1, v => { sim.buoyancyScale = v; });
bindSlider('glassOpacity',  'glassOpacityVal',  2, v => { viewer3d?.setGlassOpacity(v); });
bindSlider('waterTurbidity','waterTurbidityVal',2, v => { viewer3d?.setTurbidity(v); });

// Warmtebeeld toggle
document.getElementById('btnHeatMode')?.addEventListener('click', () => {
  heatModeOn = !heatModeOn;
  viewer3d?.setHeatMode(heatModeOn);
  const btn = document.getElementById('btnHeatMode');
  if (btn) btn.textContent = heatModeOn ? 'Warmtebeeld: AAN 🔥' : 'Warmtebeeld: UIT';
});

// Camera toggle
document.getElementById('btnCameraToggle')?.addEventListener('click', () => {
  const isAuto = viewer3d?.toggleAutoRotate();
  const btn = document.getElementById('btnCameraToggle');
  if (btn) btn.textContent = isAuto ? 'Camera: Auto ↻' : 'Camera: Vrij ✋';
});

document.getElementById('btnReverse')?.addEventListener('click', () => sim.reverseTime());

document.getElementById('btnExportCSV')?.addEventListener('click', () => {
  const blob = new Blob(['sim_time_s,W,S_JK,avgT_C,inkCoverage_pct\n' + csvRows.join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'entropy_' + Date.now() + '.csv' });
  a.click(); URL.revokeObjectURL(a.href);
});

canvas3DBeaker?.addEventListener('click', e => {
  const r = canvas3DBeaker.getBoundingClientRect();
  triggerDrop(Math.max(0.05, Math.min(0.95, (e.clientX - r.left) / r.width)));
});

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); paused = !paused; }
  if (e.code === 'KeyD')  triggerDrop(0.5);
  if (e.code === 'KeyR')  document.getElementById('btnReset')?.click();
  if (e.code === 'KeyH')  document.getElementById('btnHeatMode')?.click();
});
