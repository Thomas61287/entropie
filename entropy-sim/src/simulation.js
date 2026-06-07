// Wraps FluidSolver + HeatGrid + InkGrid into one simulation instance.
// Accepts physical units (°C, mPa·s, 10⁻⁹ m²/s) and maps them to sim params.
import { FluidSolver, N, idx } from './fluid.js';
import { HeatGrid } from './heat.js';
import { InkGrid } from './ink.js';

export const WATER_SURFACE_FRAC = 0.28;
const GRAVITY  = 12;
const BUOYANCY = 3.5;
export const K_B = 1.38e-23;

export class Simulation {
  constructor({ inkTempC = 65, waterTempC = 15, D_nm2s = 0.8, viscMPas = 1.0, heatAlpha = 1.5 } = {}) {
    this.fluid = new FluidSolver();
    this.heat  = new HeatGrid();
    this.ink   = new InkGrid();

    this.inkTempC        = inkTempC;
    this.waterTempC      = waterTempC;
    this.D_nm2s          = D_nm2s;
    this.viscMPas        = viscMPas;
    this.heatAlphaSlider = heatAlpha;

    // Thermal entropy tracking
    this.prevHeat   = new Float32Array((N+2)*(N+2));
    this.cumDeltaQ  = 0; // cumulative heat transferred to water (sim units)

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

  // Variable-dt step — called from main loop with dt = BASE_DT * timeScale
  step(dt = 0.12) {
    const waterJ = Math.round(WATER_SURFACE_FRAC * N);

    // Track heat before step for thermal entropy calculation
    this.prevHeat.set(this.heat.T);

    for (let j = waterJ; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        const c = this.ink.C[idx(i,j)];
        const t = this.heat.T[idx(i,j)];
        if (c > 0.01) this.fluid.addVelocity(i, j, 0, c * GRAVITY * dt);
        if (t > this.waterTemp + 0.04) this.fluid.addVelocity(i, j, 0, -(t - this.waterTemp) * BUOYANCY * dt);
      }
    }

    this.fluid.step(this.viscosity, dt);
    this.heat.step(this.heatAlpha, dt, this.fluid.vx, this.fluid.vy);
    this.ink.step(this.diffRate, dt, this.fluid.vx, this.fluid.vy);

    // Accumulate heat loss (cells that cooled = heat transferred to water)
    let dQ = 0;
    for (let i = 0; i < this.prevHeat.length; i++) {
      dQ += Math.max(0, this.prevHeat[i] - this.heat.T[i]);
    }
    this.cumDeltaQ += dQ;
  }

  reverseTime() {
    for (let i = 0; i < this.fluid.vx.length; i++) {
      this.fluid.vx[i] *= -1;
      this.fluid.vy[i] *= -1;
    }
  }

  addDrop(ci, cj) {
    const radius = 4;
    for (let dj = -radius; dj <= radius; dj++) {
      for (let di = -radius; di <= radius; di++) {
        const d = Math.sqrt(di*di + dj*dj);
        if (d > radius) continue;
        const amount = (1 - d/radius) * 0.95;
        const ni = Math.max(1, Math.min(N, ci+di));
        const nj = Math.max(1, Math.min(N, cj+dj));
        this.ink.addInk(ni, nj, amount);
        const heatAmt = this.waterTemp + amount * (this.inkTemp - this.waterTemp);
        this.heat.addHeat(ni, nj, heatAmt);
        const mag   = amount * 18;
        const angle = Math.atan2(dj, di);
        this.fluid.addVelocity(ni, nj, Math.cos(angle)*mag, Math.sin(angle)*mag + 5);
      }
    }
  }

  reset() {
    this.fluid.reset();
    this.heat.reset();
    this.ink.reset();
    this.prevHeat.fill(0);
    this.cumDeltaQ = 0;
  }

  getStats(simTimeSec) {
    let W = 0, sumT = 0, sumC = 0, maxC = 0;
    const total = (N+2)*(N+2);
    for (let i = 0; i < total; i++) {
      if (this.ink.C[i] > 0.005) W++;
      sumT += this.heat.T[i];
      sumC += this.ink.C[i];
      if (this.ink.C[i] > maxC) maxC = this.ink.C[i];
    }
    const S_norm    = W > 0 ? Math.log(W) / Math.log(total) : 0;
    const S_real    = W > 0 ? K_B * Math.log(W) : 0;
    const avgT      = sumT / total;
    const avgT_C    = avgT * 100;
    const inkCoverage = W / total * 100;
    const avgC      = sumC / total;
    return { W, S_norm, S_real, avgT, avgT_C, inkCoverage, avgC, maxC, simTime: simTimeSec };
  }

  // Average ink concentration at water surface row (used to feed gas room)
  getSurfaceConcentration() {
    const waterJ = Math.round(WATER_SURFACE_FRAC * N);
    let sum = 0;
    for (let i = 1; i <= N; i++) sum += this.ink.C[idx(i, waterJ)];
    return sum / N;
  }
}
