// Physics analytics — Stokes-Einstein, Carnot, Osmotic pressure, Fick flux, etc.

export const K_B   = 1.38e-23;  // J/K
export const R_GAS = 8.314;     // J/(mol·K)

// Stokes-Einstein: D = k_B·T / (6π·η·r)
// r ≈ 1e-9 m for a typical dye molecule (ink)
export function stokesEinsteinD(T_C, viscMPas, radius_nm = 1.0) {
  const T_K = T_C + 273.15;
  const eta  = viscMPas * 1e-3;   // mPa·s → Pa·s
  const r    = radius_nm * 1e-9;  // nm → m
  return (K_B * T_K) / (6 * Math.PI * eta * r); // m²/s
}

// Carnot: η_max = 1 - T_cold/T_hot (temperatures in °C, converted internally)
export function carnotEfficiency(T_cold_C, T_hot_C) {
  const Tc = T_cold_C + 273.15;
  const Th = T_hot_C  + 273.15;
  if (Th <= Tc) return 0;
  return Math.max(0, 1 - Tc / Th);
}

// Osmotic pressure: Π = M·R·T
// concentration_norm: 0-1 mapped to 0-100 mol/m³
export function osmoticPressure(concentration_norm, T_C) {
  const M   = concentration_norm * 100; // mol/m³
  const T_K = T_C + 273.15;
  return M * R_GAS * T_K; // Pa
}

// Entropy S = k_B · ln(W)
export function calcEntropyFull(inkC, gridSize, threshold = 0.005) {
  let W = 0;
  for (let i = 0; i < gridSize; i++) {
    if (inkC[i] > threshold) W++;
  }
  const S      = W > 1 ? K_B * Math.log(W) : 0;
  const S_norm = W > 0 ? Math.log(W) / Math.log(gridSize) : 0;
  const dS_max = K_B * Math.log(gridSize); // max possible entropy
  return { W, S, S_norm, dS_max };
}

// Irreversibility probability: P = (1/gridSize)^W
// Returns the exponent of 10 (log10 of probability)
export function irreversibilityExponent(W, gridSize) {
  if (W < 2) return 0;
  // P = (1/N)^W → log10(P) = -W * log10(N)
  return -W * Math.log10(gridSize);
}

// Thermal entropy change: ΔS = Q/T
// heatDelta: sum of (T_prev - T_current) over all cells (heat lost to water)
export function thermalEntropyChange(heatDelta, T_water_C, heatScale = 1e-18) {
  const Q   = heatDelta * heatScale; // J
  const T_K = T_water_C + 273.15;
  return Q / T_K; // J/K
}

// Analytical Fick solution: C(r,t) = M / (4πDt) · exp(−r²/(4Dt))
// dx, dy in pixels, D in sim units, t in sim time
export function gaussianC(dx, dy, D_sim, t_sim, M_sim = 1.0) {
  const fourDt = 4 * D_sim * t_sim + 1e-4;
  const r2     = dx * dx + dy * dy;
  return (M_sim / (Math.PI * fourDt)) * Math.exp(-r2 / fourDt);
}

// Maxwell-Boltzmann speed distribution f(v) — 2D version
// f(v) = (m/kT) · v · exp(−mv²/(2kT))
// Returns a normalized array of f values for speeds 0..vmax
export function maxwellBoltzmann2D(T_K, m_norm, bins, vmax) {
  const kT = K_B * T_K;
  const arr = new Float32Array(bins);
  let peak = 0;
  for (let i = 0; i < bins; i++) {
    const v  = (i + 0.5) * vmax / bins;
    const fv = (m_norm / kT) * v * Math.exp(-m_norm * v * v / (2 * kT));
    arr[i] = fv;
    if (fv > peak) peak = fv;
  }
  // Normalize
  if (peak > 0) for (let i = 0; i < bins; i++) arr[i] /= peak;
  return arr;
}
