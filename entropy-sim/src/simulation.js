// Wraps FluidSolver + HeatGrid + InkGrid into one simulation instance.
// Accepts physical units (°C, mPa·s, 10⁻⁹ m²/s) and maps them to sim params.
import { FluidSolver, N, idx } from './fluid.js';
import { HeatGrid } from './heat.js';
import { InkGrid } from './ink.js';

export const WATER_SURFACE_FRAC = 0.28;
const GRAVITY   = 12;
const BUOYANCY  = 3.5;
const DT        = 0.12;
const K_B       = 1.38e-23; // Boltzmann constant J/K

export class Simulation {
  constructor({ inkTempC = 65, waterTempC = 15, D_nm2s = 0.8, viscMPas = 1.0, heatAlpha = 1.5 } = {}) {
    this.fluid = new FluidSolver();
    this.heat  = new HeatGrid();
    this.ink   = new InkGrid();
    this.inkTempC   = inkTempC;
    this.waterTempC = waterTempC;
    this.D_nm2s     = D_nm2s;    // diffusion coeff ×10⁻⁹ m²/s
    this.viscMPas   = viscMPas;  // dynamic viscosity mPa·s
    this.heatAlphaSlider = heatAlpha;
    this._computeParams();
  }

  // Map physical units → dimensionless sim params
  _computeParams() {
    // inkTemp 0–1 from °C (10–95 °C range)
    this.inkTemp   = Math.max(0, Math.min(1, (this.inkTempC - 10) / 85));
    // waterTemp 0–1 (background heat level)
    this.waterTemp = Math.max(0, Math.min(1, this.waterTempC / 100));
    // Diffusion: Einstein-Stokes — D scales with (273+T)/η
    const tempFactor = (273.15 + this.waterTempC) / 288.15;
    const viscFactor = 1.0 / Math.max(0.1, this.viscMPas);
    this.diffRate  = this.D_nm2s * 1e-4 * tempFactor * viscFactor;
    this.viscosity = this.viscMPas * 5e-6;
    this.heatAlpha = this.heatAlphaSlider * 1e-4;
  }

  updatePhysics(params) {
    Object.assign(this, params);
    this._computeParams();
  }

  step() {
    const waterJ = Math.round(WATER_SURFACE_FRAC * N);
    for (let j = waterJ; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        const c = this.ink.C[idx(i,j)];
        const t = this.heat.T[idx(i,j)];
        if (c > 0.01) this.fluid.addVelocity(i, j, 0, c * GRAVITY * DT);
        if (t > this.waterTemp + 0.04) this.fluid.addVelocity(i, j, 0, -(t - this.waterTemp) * BUOYANCY * DT);
      }
    }
    this.fluid.step(this.viscosity, DT);
    this.heat.step(this.heatAlpha, DT, this.fluid.vx, this.fluid.vy);
    this.ink.step(this.diffRate, DT, this.fluid.vx, this.fluid.vy);
  }

  // Reverse time: negate velocity field (shows irreversibility — diffusion prevents true reversal)
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
        // Heat: ink temperature relative to water background
        const heatAmount = this.waterTemp + amount * (this.inkTemp - this.waterTemp);
        this.heat.addHeat(ni, nj, heatAmount);
        const mag = amount * 18;
        const angle = Math.atan2(dj, di);
        this.fluid.addVelocity(ni, nj, Math.cos(angle)*mag, Math.sin(angle)*mag + 5);
      }
    }
  }

  reset() {
    this.fluid.reset();
    this.heat.reset();
    this.ink.reset();
  }

  // Returns stats for CSV export and formula panel
  getStats(simTimeSec) {
    let W = 0;
    let sumT = 0;
    const total = (N+2)*(N+2);
    for (let i = 0; i < total; i++) {
      if (this.ink.C[i] > 0.005) W++;
      sumT += this.heat.T[i];
    }
    const S_norm = W > 0 ? Math.log(W) / Math.log(total) : 0;
    const S_real = W > 0 ? K_B * Math.log(W) : 0; // J/K
    const avgT   = sumT / total;
    const avgT_C = avgT * 100; // approx °C (normalized 0–1 ≈ 0–100°C)
    const inkCoverage = W / total * 100; // %
    return { W, S_norm, S_real, avgT, avgT_C, inkCoverage, simTime: simTimeSec };
  }
}
