// Gas diffusion in a 2D room — top-down view
// Fick's second law: ∂C/∂t = D·∇²C   (explicit FTCS scheme)
// D_gas ≈ 1e-5 m²/s (10 000× faster than liquid diffusion)

export class GasRoom {
  constructor(N = 80) {
    this.N     = N;
    this.C     = new Float32Array(N * N);
    this.C0    = new Float32Array(N * N);
    this.walls = new Uint8Array(N * N);
    this.D     = 2.0;   // sim units (represents ~1e-5 m²/s)
    this.dx    = 1.0;
    // Door: opening in the right wall (middle 20%)
    this.doorJ0 = Math.floor(N * 0.40);
    this.doorJ1 = Math.floor(N * 0.60);
    this._initWalls();
  }

  _initWalls() {
    const { N, walls } = this;
    for (let i = 0; i < N; i++) {
      walls[i]                 = 1; // top
      walls[i + (N-1)*N]      = 1; // bottom
      walls[i * N]             = 1; // left
      walls[i * N + (N-1)]    = 1; // right
    }
    // Door opening in right wall
    for (let j = this.doorJ0; j <= this.doorJ1; j++) {
      walls[j * N + (N-1)] = 0;
    }
  }

  addSource(ci, cj, amount) {
    const i = Math.max(1, Math.min(this.N-2, Math.floor(ci)));
    const j = Math.max(1, Math.min(this.N-2, Math.floor(cj)));
    this.C[i + j * this.N] = Math.min(1, this.C[i + j * this.N] + amount);
  }

  step(dt) {
    const { N, C, C0, walls, D, dx } = this;
    // Clamp for numerical stability: a = D·dt/dx² < 0.25
    const a = Math.min(0.24, D * dt / (dx * dx));
    C0.set(C);

    for (let j = 1; j < N-1; j++) {
      for (let i = 1; i < N-1; i++) {
        const id = i + j * N;
        if (walls[id]) { C[id] = 0; continue; }
        const cn = walls[id-N]  ? C0[id] : C0[id-N];
        const cs = walls[id+N]  ? C0[id] : C0[id+N];
        const cw = walls[id-1]  ? C0[id] : C0[id-1];
        const ce = walls[id+1]  ? C0[id] : C0[id+1];
        C[id] = Math.max(0, C0[id] + a * (cn + cs + cw + ce - 4 * C0[id]));
      }
    }
    // Gas escapes through door (absorbing boundary)
    for (let j = this.doorJ0; j <= this.doorJ1; j++) {
      const id = j * N + (N-2);
      C[id] *= 0.97;
    }
  }

  // Average concentration near a grid point (source coupling)
  avgConcentration(ci, cj, r = 3) {
    let sum = 0, count = 0;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const i = Math.max(1, Math.min(this.N-2, Math.floor(ci)+di));
        const j = Math.max(1, Math.min(this.N-2, Math.floor(cj)+dj));
        sum += this.C[i + j * this.N];
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  reset() { this.C.fill(0); this.C0.fill(0); }
}
