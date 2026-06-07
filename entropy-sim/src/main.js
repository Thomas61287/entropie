// Cinematic main — drives two 3D scenes, minimal UI, physics panel overlay
window.addEventListener('error', e => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:8px;left:8px;right:8px;background:#180010;color:#ff6688;'
    + 'padding:10px;font:11px monospace;z-index:9999;border:1px solid #ff4466;';
  d.textContent = `Error: ${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`;
  document.body.appendChild(d);
});

import { N } from './fluid.js';
import { EntropyMeter } from './entropy.js';
import { Simulation, WATER_SURFACE_FRAC } from './simulation.js';
import { GasRoom } from './gasroom.js';
import { BeakerViewer3D } from './viewer3d.js';
import { RoomViewer3D } from './room3d.js';
import {
  stokesEinsteinD, carnotEfficiency, osmoticPressure,
  thermalEntropyChange
} from './analytics.js';

// ── Config ──────────────────────────────────────────────────────────────────
const BASE_DT   = 0.10;
let timeScale   = 0.02;   // 2% realtime default
let paused      = false;
let simTime     = 0;
let physicsOpen = false;

// ── Physics state ────────────────────────────────────────────────────────────
const sim     = new Simulation({ inkTempC: 65, waterTempC: 15 });
const gasRoom = new GasRoom(80);

// ── Drop animation state ─────────────────────────────────────────────────────
// progress: 0 → 1.0 (above beaker → water surface)
let dropAnim = null;   // null | { nx, progress, landed }

// ── CSV accumulation ─────────────────────────────────────────────────────────
const csvRows = [];
let lastCsvT  = -1;

// ── Canvases ─────────────────────────────────────────────────────────────────
const canvas3DBeaker = document.getElementById('canvas3DBeaker');
const canvas3DRoom   = document.getElementById('canvas3DRoom');
const entropyCanvas  = document.getElementById('entropyCanvas');

// ── Entropy meter (renders to physics panel canvas) ──────────────────────────
const entropyMeter = new EntropyMeter();

// ── 3D Viewers ───────────────────────────────────────────────────────────────
let viewer3d = null;
let room3d   = null;

if (canvas3DBeaker) {
  try { viewer3d = new BeakerViewer3D(canvas3DBeaker); }
  catch(e) { console.error('BeakerViewer3D failed:', e); }
}
if (canvas3DRoom) {
  try { room3d = new RoomViewer3D(canvas3DRoom); }
  catch(e) { console.error('RoomViewer3D failed:', e); }
}

// ── Drop trigger ─────────────────────────────────────────────────────────────
function triggerDrop(nx = 0.5) {
  if (dropAnim && !dropAnim.landed) return; // already falling
  dropAnim = { nx, progress: 0, landed: false };
  viewer3d?.startDrop(nx);
}

function onDropLanded() {
  const ci = Math.round(dropAnim.nx * N);
  const cj = Math.round(WATER_SURFACE_FRAC * N * 0.85); // slightly below surface
  sim.addDrop(
    Math.max(2, Math.min(N - 1, ci)),
    Math.max(2, Math.min(N - 1, cj))
  );
  viewer3d?.notifyDropLanded();
  dropAnim.landed = true;
}

// ── Stats display ────────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function updateStats() {
  const stats = sim.getStats(simTime);
  const { W, S_real, avgT_C, inkCoverage } = stats;

  setText('fW',     W.toLocaleString());
  setText('fLogW',  W > 0 ? Math.log(W).toFixed(2) : '0');
  setText('fS',     W > 0 ? S_real.toExponential(2) : '—');
  setText('fT',     avgT_C.toFixed(1) + ' °C');
  setText('fCov',   inkCoverage.toFixed(1) + ' %');

  const D_eff  = stokesEinsteinD(sim.inkTempC, sim.viscMPas);
  const carnot = carnotEfficiency(sim.waterTempC, sim.inkTempC);
  const osmo   = osmoticPressure(stats.avgC, sim.inkTempC);
  const cumDS  = thermalEntropyChange(sim.cumDeltaQ, sim.waterTempC);
  setText('fD',      D_eff.toExponential(2) + ' m²/s');
  setText('fCarnot', (carnot * 100).toFixed(1) + ' %');
  setText('fOsmotic', osmo.toFixed(1) + ' Pa');
  setText('fCumDS',  cumDS.toExponential(2) + ' J/K');

  setText('fSimTime', simTime.toFixed(1));

  entropyMeter.update(sim.ink.C);
  if (entropyCanvas) entropyMeter.draw(entropyCanvas);
}

// ── Animation loop ───────────────────────────────────────────────────────────
function loop() {
  requestAnimationFrame(loop);

  if (!paused) {
    const dt = BASE_DT * timeScale;
    simTime += dt;

    sim.step(dt);

    // Feed gas room from ink at beaker surface
    const surfC = sim.getSurfaceConcentration();
    gasRoom.addSource(
      Math.floor(gasRoom.N / 2),
      Math.floor(gasRoom.N / 2),
      surfC * 0.004 * timeScale
    );
    gasRoom.step(dt * 80);

    // Drop fall animation
    if (dropAnim && !dropAnim.landed) {
      dropAnim.progress = Math.min(1.0, dropAnim.progress + 0.028);
      if (dropAnim.progress >= 1.0) onDropLanded();
    }

    // CSV: one row per simulated second
    const sec = Math.floor(simTime);
    if (sec > lastCsvT && sec % 2 === 0) {
      lastCsvT = sec;
      const s = sim.getStats(simTime);
      csvRows.push([simTime.toFixed(1), s.W, s.S_real.toExponential(3),
        s.avgT_C.toFixed(1), s.inkCoverage.toFixed(2)].join(','));
    }
  }

  // Render 3D scenes every frame
  if (viewer3d) {
    viewer3d.update(sim, dropAnim, timeScale);
    viewer3d.render();
  }
  if (room3d) {
    room3d.update(gasRoom);
    room3d.render();
  }

  // Physics panel update (only when visible)
  if (physicsOpen) updateStats();
}

loop();

// ── Control bar wiring ───────────────────────────────────────────────────────
document.getElementById('btnDrop')?.addEventListener('click', () => triggerDrop(0.5));
document.getElementById('btnReset')?.addEventListener('click', () => {
  sim.reset(); gasRoom.reset();
  simTime = 0; dropAnim = null; csvRows.length = 0; lastCsvT = -1;
  entropyMeter.history = [];
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
  document.getElementById('btnFysica').textContent = physicsOpen ? 'Fysica ▼' : 'Fysica ▲';
  if (physicsOpen) updateStats();
});

document.getElementById('btnCloseOverlay')?.addEventListener('click', () => {
  physicsOpen = false;
  document.getElementById('physicsOverlay')?.classList.remove('open');
  document.getElementById('btnFysica').textContent = 'Fysica ▲';
});

// Physics panel sliders
function bindOverlaySlider(id, valId, onChange) {
  const el  = document.getElementById(id);
  const val = document.getElementById(valId);
  if (!el) return;
  el.addEventListener('input', () => {
    onChange(parseFloat(el.value));
    if (val) val.textContent = parseFloat(el.value).toFixed(el.step?.includes('.') ? 2 : 0);
  });
}

bindOverlaySlider('waterTempC', 'waterTempCVal', v => {
  sim.waterTempC = v; sim._computeParams();
});
bindOverlaySlider('D_nm2s', 'D_nm2sVal', v => {
  sim.D_nm2s = v; sim._computeParams();
});
bindOverlaySlider('viscosity', 'viscosityVal', v => {
  sim.viscMPas = v; sim._computeParams();
});
bindOverlaySlider('heatAlpha', 'heatAlphaVal', v => {
  sim.heatAlphaSlider = v; sim._computeParams();
});

document.getElementById('btnReverse')?.addEventListener('click', () => sim.reverseTime());

document.getElementById('btnExportCSV')?.addEventListener('click', () => {
  const header = 'sim_time_s,W,S_JK,avgT_C,inkCoverage_pct';
  const blob = new Blob([header + '\n' + csvRows.join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `entropy_${Date.now()}.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
});

// Click on beaker canvas → drop at click x position
canvas3DBeaker?.addEventListener('click', e => {
  const r  = canvas3DBeaker.getBoundingClientRect();
  const nx = (e.clientX - r.left) / r.width;
  triggerDrop(Math.max(0.05, Math.min(0.95, nx)));
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); paused = !paused; }
  if (e.code === 'KeyD')  triggerDrop(0.5);
  if (e.code === 'KeyR')  document.getElementById('btnReset')?.click();
});
