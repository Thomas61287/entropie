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
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,255,204,0.3)';
    ctx.lineWidth = 1;
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
    ctx.beginPath();
    ctx.moveTo(0, h);
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
    ctx.fillStyle = '#00ffcc';
    ctx.font = '10px "Space Mono", monospace';
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
        if (c > 0.01) this.fluid.addVelocity(i, j, 0, c * _GRAVITY * dt);
        if (t > this.waterTemp + 0.04) this.fluid.addVelocity(i, j, 0, -(t - this.waterTemp) * _BUOYANCY * dt);
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
    const radius = 4;
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
    return {
      W, S_real,
      avgT_C: sumT / total * 100,
      inkCoverage: W / total * 100,
      avgC: sumC / total, maxC,
      simTime: simTimeSec,
    };
  }
  getSurfaceConcentration() {
    const waterJ = Math.round(WATER_SURFACE_FRAC * N);
    let sum = 0;
    for (let i = 1; i <= N; i++) sum += this.ink.C[idx(i, waterJ)];
    return sum / N;
  }
}

// ─── viewer3d.js (BeakerViewer3D) ────────────────────────────────────────────

const _PC     = 3500;
const _BR     = 1.20;
const _BH     = 3.20;
const _Y_SURF = _BH * (0.5 - WATER_SURFACE_FRAC);
const _Y_BOT  = -_BH * 0.45;
const _J_WATER = Math.floor(WATER_SURFACE_FRAC * N);

function _w2g(wx, wy) {
  const i = Math.round((wx / (2 * _BR * 0.80) + 0.5) * N);
  const j = _J_WATER + Math.round((_Y_SURF - wy) / Math.max(0.001, _Y_SURF - _Y_BOT) * (N - _J_WATER));
  return [Math.max(1, Math.min(N, i)), Math.max(1, Math.min(N, j))];
}

// Round soft-glow sprite for particles
function _makeParticleTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0,    'rgba(255,255,255,1.0)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.90)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.40)');
  g.addColorStop(1.0,  'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Water molecules = soft blue. Ink = deep blue/indigo. Heat = orange.
function _particleColor(c, T) {
  const ci = Math.min(1, c * 4);
  const ti = Math.min(1, T * 1.8);

  let r = 0.18 + ti * 0.82;
  let g = 0.28 - ci * 0.18 + ti * 0.22;
  let b = 0.78 - ci * 0.38 - ti * 0.70;

  const bright = 0.55 + ci * 0.50 + ti * 0.40;
  return [
    Math.min(1, Math.max(0, r * bright)),
    Math.min(1, Math.max(0, g * bright)),
    Math.min(1, Math.max(0, b * bright)),
  ];
}

class BeakerViewer3D {
  constructor(canvas) {
    const W = Math.round(window.innerWidth  * 0.5);
    const H = Math.round(window.innerHeight * 0.85);

    canvas.width  = W;
    canvas.height = H;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.domElement.style.width  = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(44, W / H, 0.1, 100);
    this.camera.position.set(0, 1.0, 5.2);
    this.camera.lookAt(0, 0, 0);

    this.controls = new THREE.OrbitControls(this.camera, canvas);
    this.controls.autoRotate      = true;
    this.controls.autoRotateSpeed = 0.50;
    this.controls.enableDamping   = true;
    this.controls.dampingFactor   = 0.05;
    this.controls.minDistance     = 3.0;
    this.controls.maxDistance     = 9.0;
    this.controls.enablePan       = false;

    this._waveT     = 0;
    this._ripples   = [];
    this._dropState = null;

    // Ink concentration canvas texture (shows diffusion inside water)
    this._inkCanvas        = document.createElement('canvas');
    this._inkCanvas.width  = 128;
    this._inkCanvas.height = 128;
    this._inkCtx           = this._inkCanvas.getContext('2d');
    this._inkTex           = new THREE.CanvasTexture(this._inkCanvas);

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
    // Lights
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.PointLight(0xfff0e0, 2.2, 22); key.position.set(3, 3, 3);
    this.scene.add(key);
    const back = new THREE.PointLight(0x6688aa, 0.7, 14); back.position.set(-2, -1, -2);
    this.scene.add(back);
    this._inkLight = new THREE.PointLight(0xff4400, 0, 5);
    this._inkLight.position.set(0, _Y_SURF - 0.3, 0);
    this.scene.add(this._inkLight);

    // Beaker glass — slightly more opaque for realism
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xaaddff, transparent: true, opacity: 0.15,
      roughness: 0, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    this.scene.add(new THREE.Mesh(new THREE.CylinderGeometry(_BR*1.05, _BR, _BH, 48, 1, true), glassMat));
    const bot = new THREE.Mesh(new THREE.CircleGeometry(_BR, 48), glassMat);
    bot.rotation.x = -Math.PI/2; bot.position.y = -_BH/2;
    this.scene.add(bot);

    // Cyan wireframe outline
    this.scene.add(new THREE.Mesh(
      new THREE.CylinderGeometry(_BR*1.05, _BR, _BH, 12, 3, true),
      new THREE.MeshBasicMaterial({ color: 0x00ffcc, wireframe: true, transparent: true, opacity: 0.70 })));

    // Tick rings
    for (let k = 1; k <= 4; k++) {
      const ty = _Y_BOT + (k / 4.8) * (_Y_SURF - _Y_BOT);
      const pts = [];
      for (let a = 0; a <= 64; a++) { const ang = a/64*Math.PI*2; pts.push(new THREE.Vector3(Math.cos(ang)*_BR*1.06, ty, Math.sin(ang)*_BR*1.06)); }
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.55 })));
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(_BR*1.06, ty, 0), new THREE.Vector3(_BR*1.22, ty, 0)]),
        new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.65 })));
    }

    // Water body — more transparent so ink inside is visible
    const waterH = _BH * (1 - WATER_SURFACE_FRAC) - 0.06;
    this.waterMat = new THREE.MeshStandardMaterial({
      color: 0x002266, transparent: true, opacity: 0.40, roughness: 0.3, metalness: 0 });
    const wb = new THREE.Mesh(new THREE.CylinderGeometry(_BR*0.96, _BR*0.94, waterH, 48), this.waterMat);
    wb.position.y = _Y_SURF - waterH/2;
    this.scene.add(wb);

    // ── Ink visualization: 3 cross-section planes inside the water ───────────
    // Shows the actual diffusion field as swirling blue/indigo wisps
    const inkMat = new THREE.MeshBasicMaterial({
      map: this._inkTex, transparent: true, opacity: 1.0,
      depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this._inkPlanes = [];
    for (let k = 0; k < 3; k++) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(_BR * 1.88, waterH), inkMat);
      plane.rotation.y = k * Math.PI / 3;
      plane.position.y = _Y_SURF - waterH / 2;
      this.scene.add(plane);
      this._inkPlanes.push(plane);
    }

    // Water surface (animated)
    this.surfGeo = new THREE.PlaneGeometry(_BR*2*0.95, _BR*2*0.95, 24, 24);
    this.surfMat = new THREE.MeshStandardMaterial({
      color: 0x0044cc, transparent: true, opacity: 0.60, roughness: 0.10, metalness: 0.15 });
    this.surfMesh = new THREE.Mesh(this.surfGeo, this.surfMat);
    this.surfMesh.rotation.x = -Math.PI/2; this.surfMesh.position.y = _Y_SURF;
    this.scene.add(this.surfMesh);

    // ── Particles: round soft sprites ────────────────────────────────────────
    const pTex = _makeParticleTex();
    const pos = new Float32Array(_PC*3), col = new Float32Array(_PC*3);
    for (let p = 0; p < _PC; p++) {
      const ang = Math.random()*Math.PI*2, r = Math.sqrt(Math.random())*_BR*0.87;
      pos[p*3]   = Math.cos(ang)*r;
      pos[p*3+1] = _Y_BOT + Math.random()*(_Y_SURF-_Y_BOT);
      pos[p*3+2] = Math.sin(ang)*r;
      // Initial: soft blue (water color)
      col[p*3] = 0.10; col[p*3+1] = 0.18; col[p*3+2] = 0.42;
    }
    this.pPos = pos; this.pVel = new Float32Array(_PC*3);
    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute('color',    new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.PointsMaterial({
      size: 0.11, map: pTex,
      vertexColors: true, transparent: true, opacity: 0.92,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
      alphaTest: 0.01,
    });
    this.scene.add(new THREE.Points(this.pGeo, this.pMat));

    // Drop sphere
    this.dropMesh = new THREE.Mesh(new THREE.SphereGeometry(0.10, 16, 10),
      new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff1100, emissiveIntensity: 1.5 }));
    this.dropMesh.visible = false;
    this.scene.add(this.dropMesh);
  }

  // Maps sim ink+heat grid onto 128×128 canvas showing actual diffusion pattern
  _updateInkTexture(sim) {
    const W = 128, H = 128;
    const img = this._inkCtx.createImageData(W, H);
    const d   = img.data;
    const jRange = N - _J_WATER;

    for (let ty = 0; ty < H; ty++) {
      // ty=0 = water surface (_J_WATER), ty=H-1 = bottom (N)
      const sj = _J_WATER + Math.round(ty / (H - 1) * (jRange - 1));
      for (let tx = 0; tx < W; tx++) {
        const si  = 1 + Math.round(tx / (W - 1) * (N - 1));
        const gid = idx(Math.min(N, Math.max(1, si)), Math.min(N, Math.max(1, sj)));
        const c   = sim.ink.C[gid]  || 0;
        const T   = sim.heat.T[gid] || 0;
        const pi  = (ty * W + tx) * 4;

        if (c < 0.003) { d[pi + 3] = 0; continue; }

        const ci = Math.min(1, c * 3.5);
        const ti = Math.min(1, T * 2.5);

        // Deep blue for ink, shifts orange-red for heat
        const r = Math.round(Math.min(255, 8  + ti * 230));
        const g = Math.round(Math.min(255, 12 + ci * 20 + ti * 80));
        const b = Math.round(Math.max(0,   210 - ci * 110 - ti * 190));
        const a = Math.round(Math.min(255, 40  + ci * 210));

        d[pi] = r; d[pi+1] = g; d[pi+2] = b; d[pi+3] = a;
      }
    }

    this._inkCtx.putImageData(img, 0, 0);
    this._inkTex.needsUpdate = true;
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
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.01, 0.04, 36),
        new THREE.MeshBasicMaterial({ color: 0x0066ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI/2; m.position.y = _Y_SURF + 0.012;
      if (this._dropState) m.position.x = (this._dropState.nx - 0.5) * 2 * _BR * 0.80;
      this.scene.add(m);
      this._ripples.push({ mesh: m, scale: 0.1, delay: i * 7 });
    }
  }

  update(sim) {
    this._waveT += 0.018;

    // Ink texture — shows actual diffusion field every frame
    this._updateInkTexture(sim);

    // Animated water surface
    const pa = this.surfGeo.attributes.position.array;
    for (let v = 0, vc = this.surfGeo.attributes.position.count; v < vc; v++) {
      const vx = pa[v*3], vz = pa[v*3+2];
      pa[v*3+1] = Math.sin(vx*2.4 + this._waveT)*0.011 + Math.sin(vz*3.2 + this._waveT*1.3)*0.007;
    }
    this.surfGeo.attributes.position.needsUpdate = true;

    // Water shifts bluer/darker as ink fills
    const stats   = sim.getStats(0);
    const inkFrac = Math.min(1, stats.inkCoverage / 25);
    this.waterMat.color.setRGB(0, 0.08 + inkFrac*0.04, 0.26 - inkFrac*0.10);
    this._inkLight.intensity = inkFrac * 2.0;

    // Drop fall
    if (this._dropState && !this._dropState.landed) {
      this._dropState.progress = Math.min(1, this._dropState.progress + 0.028);
      this.dropMesh.position.set((this._dropState.nx-0.5)*2*_BR*0.80, _Y_SURF + (1-this._dropState.progress)*_BH*0.45, 0);
    }

    // Ripple expand + fade
    this._ripples = this._ripples.filter(r => {
      if (r.delay-- > 0) return true;
      r.scale += 0.045; r.mesh.scale.setScalar(r.scale);
      r.mesh.material.opacity = Math.max(0, 0.85 - r.scale*0.50);
      if (r.mesh.material.opacity <= 0) { this.scene.remove(r.mesh); return false; }
      return true;
    });

    // Particle physics + color
    const vxA = sim.fluid.vx, vyA = sim.fluid.vy, inkA = sim.ink.C, tmpA = sim.heat.T;
    const P = this.pPos, V = this.pVel, col = this.pGeo.attributes.color.array;
    for (let p = 0; p < _PC; p++) {
      const [si, sj] = _w2g(P[p*3], P[p*3+1]);
      const gid = idx(si, sj);
      const c = inkA[gid] || 0, T = tmpA[gid] || 0;
      const br = 0.002 + T * 0.005 + c * 0.003;

      V[p*3]   = V[p*3]  *0.88 + (vxA[gid]||0)*0.18 + (Math.random()-0.5)*br;
      V[p*3+1] = V[p*3+1]*0.88 - (vyA[gid]||0)*0.18 + (Math.random()-0.5)*br;
      V[p*3+2] = V[p*3+2]*0.88                       + (Math.random()-0.5)*br;
      P[p*3]   += V[p*3]; P[p*3+1] += V[p*3+1]; P[p*3+2] += V[p*3+2];

      const r2d = Math.hypot(P[p*3], P[p*3+2]);
      if (r2d > _BR*0.90) { const s = _BR*0.90/r2d; P[p*3] *= s; P[p*3+2] *= s; V[p*3] *= -0.2; V[p*3+2] *= -0.2; }
      if (P[p*3+1] > _Y_SURF)        { P[p*3+1] = _Y_SURF;        V[p*3+1] = Math.abs(V[p*3+1])*0.15; }
      if (P[p*3+1] < _Y_BOT + 0.02)  { P[p*3+1] = _Y_BOT + 0.02;  V[p*3+1] = Math.abs(V[p*3+1])*0.15; }

      const [pr, pg, pb] = _particleColor(c, T);
      col[p*3] = pr; col[p*3+1] = pg; col[p*3+2] = pb;
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate    = true;
    this.pGeo.setDrawRange(0, _PC);
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
    // Cool dim ambient — only just enough to see the room shape
    this.scene.add(new THREE.AmbientLight(0x0d1020, 1.0));

    // Ceiling lamp — warm white overhead light
    this._ceilLight = new THREE.PointLight(0xfff5e0, 1.2, 14);
    this._ceilLight.position.set(0, _ROOM_H - 0.15, 0);
    this.scene.add(this._ceilLight);

    // Warm orange source above beaker — driven by concentration
    this._srcLight = new THREE.PointLight(0xff6600, 1.5, 7.0);
    this._srcLight.position.set(0, 0.9, 0);
    this.scene.add(this._srcLight);

    // Cool corner fill for depth
    const fill = new THREE.PointLight(0x223355, 0.6, 18);
    fill.position.set(-3.5, 3.0, -3.5);
    this.scene.add(fill);
  }

  _buildRoom() {
    // ── Solid floor ───────────────────────────────────────────────────────────
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x111118, roughness: 0.92, metalness: 0.08 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(_ROOM_W, _ROOM_D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Floor grid overlay
    const grid = new THREE.GridHelper(_ROOM_W, 16, 0x1e1e2e, 0x181825);
    this.scene.add(grid);

    // ── Solid ceiling ─────────────────────────────────────────────────────────
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0e0e18, roughness: 1.0 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(_ROOM_W, _ROOM_D), ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.y = _ROOM_H;
    this.scene.add(ceil);

    // Ceiling lamp fixture
    const lampMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.07, 0.45),
      new THREE.MeshBasicMaterial({ color: 0xfff8e0 }));
    lampMesh.position.set(0, _ROOM_H - 0.04, 0);
    this.scene.add(lampMesh);

    // ── Room walls — solid dark box (BackSide) ────────────────────────────────
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a14, roughness: 1.0, metalness: 0, side: THREE.BackSide });
    const roomBox = new THREE.Mesh(
      new THREE.BoxGeometry(_ROOM_W, _ROOM_H, _ROOM_D), wallMat);
    roomBox.position.y = _ROOM_H / 2;
    this.scene.add(roomBox);

    // ── Wireframe overlay on walls (subtle blue-grey) ─────────────────────────
    const wm = () => new THREE.MeshBasicMaterial({
      color: 0x3a3a5c, wireframe: true, transparent: true, opacity: 0.28 });

    const wallDefs = [
      [[0, _ROOM_H/2, -_ROOM_D/2], 0,            _ROOM_W],
      [[0, _ROOM_H/2,  _ROOM_D/2], Math.PI,       _ROOM_W],
      [[-_ROOM_W/2, _ROOM_H/2, 0], Math.PI/2,    _ROOM_D],
      [[ _ROOM_W/2, _ROOM_H/2, 0], -Math.PI/2,   _ROOM_D],
    ];
    this._wallGlowMats = [];
    for (const [[px, py, pz], ry, dim] of wallDefs) {
      const wf = new THREE.Mesh(new THREE.PlaneGeometry(dim, _ROOM_H, 8, 4), wm());
      wf.position.set(px, py, pz); wf.rotation.y = ry; this.scene.add(wf);

      const gm = new THREE.MeshBasicMaterial({
        color: 0xff4400, transparent: true, opacity: 0, depthWrite: false, side: THREE.FrontSide });
      const gw = new THREE.Mesh(new THREE.PlaneGeometry(dim, _ROOM_H), gm);
      const off = 0.03;
      gw.position.set(
        px + (ry ===  Math.PI/2 ?  off : ry === -Math.PI/2 ? -off : 0),
        py,
        pz + (ry === 0          ?  off : ry ===  Math.PI   ? -off : 0));
      gw.rotation.y = ry; this.scene.add(gw);
      this._wallGlowMats.push(gm);
    }

    // ── Baseboard trim ────────────────────────────────────────────────────────
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x1a1a28, roughness: 0.8 });
    const trimH = 0.08;
    const trimDefs = [
      [0, -_ROOM_D/2, 0,      _ROOM_W, trimH, 0.06],
      [0,  _ROOM_D/2, 0,      _ROOM_W, trimH, 0.06],
      [-_ROOM_W/2, 0, 0,      0.06, trimH, _ROOM_D],
      [ _ROOM_W/2, 0, 0,      0.06, trimH, _ROOM_D],
    ];
    for (const [tx, tz, ty, sw, sh, sd] of trimDefs) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), trimMat);
      trim.position.set(tx, trimH / 2, tz); this.scene.add(trim);
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
      mesh.rotation.x = -Math.PI/2; mesh.position.y = heights[k];
      this.scene.add(mesh); this._fogMats.push(mat);
    }
  }

  _buildBeaker() {
    // Wooden table
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.75, metalness: 0 });
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 0.85), tableMat);
    tableTop.position.set(0, 0.50, 0);
    this.scene.add(tableTop);

    const legMat = new THREE.MeshStandardMaterial({ color: 0x352516, roughness: 0.85 });
    for (const [lx, lz] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.50, 0.045), legMat);
      leg.position.set(lx, 0.25, lz); this.scene.add(leg);
    }

    // Beaker sits on table
    this._beakerMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.20, 0.16, 0.48, 24),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5,
        roughness: 0.3, metalness: 0.0 }));
    this._beakerMesh.position.set(0, 0.745, 0);
    this.scene.add(this._beakerMesh);

    // Update source light to beaker height
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
        if (amp < 0.10)       { const s = amp/0.10;         r = Math.round(140*s);       g = 0;                  b = 0; a = Math.round(100*s); }
        else if (amp < 0.38)  { const s = (amp-0.10)/0.28;  r = Math.round(140+115*s);   g = Math.round(34*s);   b = 0; a = Math.round(100+110*s); }
        else if (amp < 0.65)  { const s = (amp-0.38)/0.27;  r = 255;                     g = Math.round(34+102*s); b = 0; a = Math.round(210+20*s); }
        else if (amp < 0.88)  { const s = (amp-0.65)/0.23;  r = 255;                     g = Math.round(136+85*s); b = 0; a = 230; }
        else                  { const s = (amp-0.88)/0.12;  r = 255;                     g = Math.round(221+34*s); b = Math.round(80*s); a = 235; }
        d[pi] = r; d[pi+1] = g; d[pi+2] = b; d[pi+3] = a;
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

    // Ceiling lamp dims slightly as gas fills room (atmospheric effect)
    this._ceilLight.intensity = 1.2 - centreC * 0.35;

    this._beakerMesh.material.emissiveIntensity =
      0.4 + 0.15*Math.sin(this._pulseT) + centreC*1.8;

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

const sim          = new Simulation({ inkTempC: 65, waterTempC: 15 });
const gasRoom      = new GasRoom(80);
const entropyMeter = new EntropyMeter();

let dropAnim = null;
const csvRows = [];
let lastCsvT  = -1;

const canvas3DBeaker = document.getElementById('beaker-canvas');
const canvas3DRoom   = document.getElementById('room-canvas');
const entropyCanvas  = document.getElementById('entropyCanvas');

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
  viewer3d?.notifyDropLanded();
  dropAnim.landed = true;
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
  entropyMeter.update(sim.ink.C);
  if (entropyCanvas) entropyMeter.draw(entropyCanvas);
}

function loop() {
  requestAnimationFrame(loop);
  if (!paused) {
    const dt = BASE_DT * timeScale;
    simTime += dt;
    sim.step(dt);
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

// Controls
document.getElementById('btnDrop')?.addEventListener('click', () => triggerDrop(0.5));
document.getElementById('btnReset')?.addEventListener('click', () => {
  sim.reset(); gasRoom.reset(); simTime = 0; dropAnim = null;
  csvRows.length = 0; lastCsvT = -1; entropyMeter.reset();
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

bindSlider('waterTempC', 'waterTempCVal', 0, v => { sim.waterTempC = v;      sim._computeParams(); });
bindSlider('D_nm2s',     'D_nm2sVal',     2, v => { sim.D_nm2s = v;          sim._computeParams(); });
bindSlider('viscosity',  'viscosityVal',  1, v => { sim.viscMPas = v;        sim._computeParams(); });
bindSlider('heatAlpha',  'heatAlphaVal',  2, v => { sim.heatAlphaSlider = v; sim._computeParams(); });

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
});
