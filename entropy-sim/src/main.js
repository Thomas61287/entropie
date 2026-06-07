// Error overlay — shown on any uncaught JS error (helps debug GitHub Pages)
window.addEventListener('error', e => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:8px;left:8px;right:8px;background:#180010;color:#ff6688;'
    + 'padding:10px;font:11px monospace;z-index:9999;border:1px solid #ff4466;white-space:pre-wrap;';
  d.textContent = `JS Error: ${e.message}\n${e.filename?.split('/').pop()}:${e.lineno}`;
  document.body.appendChild(d);
});

// ── Static imports — NO Three.js dependency here ─────────────────────────────
// If these fail it's a local file issue, not a CDN race.
import { N }                     from './fluid.js';
import { EntropyMeter }          from './entropy.js';
import { Simulation, WATER_SURFACE_FRAC } from './simulation.js';
import { GasRoom }               from './gasroom.js';
import {
  stokesEinsteinD, carnotEfficiency,
  osmoticPressure, thermalEntropyChange,
} from './analytics.js';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_DT = 0.10;
let timeScale   = 0.02;
let paused      = false;
let simTime     = 0;
let physicsOpen = false;

// ── Physics ───────────────────────────────────────────────────────────────────
const sim      = new Simulation({ inkTempC: 65, waterTempC: 15 });
const gasRoom  = new GasRoom(80);
const entropyMeter = new EntropyMeter();

// ── Drop state ────────────────────────────────────────────────────────────────
let dropAnim = null;   // null | { nx, progress, landed }

// ── CSV ───────────────────────────────────────────────────────────────────────
const csvRows = [];
let lastCsvT  = -1;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas3DBeaker = document.getElementById('canvas3DBeaker');
const canvas3DRoom   = document.getElementById('canvas3DRoom');
const entropyCanvas  = document.getElementById('entropyCanvas');

// ── 3D viewers — loaded via DYNAMIC import so a CDN failure can't kill controls
let viewer3d = null;
let room3d   = null;

// Import viewer3d and room3d asynchronously.
// The loop already runs below; viewers simply start rendering once ready.
(async () => {
  try {
    const mod = await import('./viewer3d.js');
    if (canvas3DBeaker) viewer3d = new mod.BeakerViewer3D(canvas3DBeaker);
  } catch (e) {
    console.error('BeakerViewer3D load failed:', e.message);
  }
  try {
    const mod = await import('./room3d.js');
    if (canvas3DRoom) room3d = new mod.RoomViewer3D(canvas3DRoom);
  } catch (e) {
    console.error('RoomViewer3D load failed:', e.message);
  }
})();

// ── Helpers ───────────────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function triggerDrop(nx = 0.5) {
  if (dropAnim && !dropAnim.landed) return;
  dropAnim = { nx, progress: 0, landed: false };
  viewer3d?.startDrop(nx);
}

function onDropLanded() {
  const ci = Math.round(dropAnim.nx * N);
  const cj = Math.round(WATER_SURFACE_FRAC * N * 0.85);
  sim.addDrop(
    Math.max(2, Math.min(N - 1, ci)),
    Math.max(2, Math.min(N - 1, cj)),
  );
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

// ── Animation loop ────────────────────────────────────────────────────────────
function loop() {
  requestAnimationFrame(loop);

  if (!paused) {
    const dt = BASE_DT * timeScale;
    simTime += dt;

    sim.step(dt);

    // 0.08 instead of 0.004 — GasRoom concentrations were too small to visualise
    gasRoom.addSource(
      Math.floor(gasRoom.N / 2), Math.floor(gasRoom.N / 2),
      sim.getSurfaceConcentration() * 0.08 * timeScale,
    );
    gasRoom.step(dt * 80);

    if (dropAnim && !dropAnim.landed) {
      dropAnim.progress = Math.min(1, dropAnim.progress + 0.028);
      if (dropAnim.progress >= 1) onDropLanded();
    }

    // CSV row every 2 simulated seconds
    const sec = Math.floor(simTime);
    if (sec > lastCsvT && sec % 2 === 0) {
      lastCsvT = sec;
      const s = sim.getStats(simTime);
      csvRows.push([
        simTime.toFixed(1), s.W,
        s.S_real.toExponential(3),
        s.avgT_C.toFixed(1),
        s.inkCoverage.toFixed(2),
      ].join(','));
    }
  }

  // Render 3D — safe even while viewers are still loading (null check)
  if (viewer3d) { viewer3d.update(sim, dropAnim, timeScale); viewer3d.render(); }
  if (room3d)   { room3d.update(gasRoom); room3d.render(); }

  if (physicsOpen) updateStats();
}

loop();   // start immediately — viewers join once async import resolves

// ── Control bar ───────────────────────────────────────────────────────────────
document.getElementById('btnDrop')?.addEventListener('click', () => triggerDrop(0.5));

document.getElementById('btnReset')?.addEventListener('click', () => {
  sim.reset();
  gasRoom.reset();
  simTime = 0;
  dropAnim = null;
  csvRows.length = 0;
  lastCsvT = -1;
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

// ── Physics panel sliders ─────────────────────────────────────────────────────
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
  const blob = new Blob(
    ['sim_time_s,W,S_JK,avgT_C,inkCoverage_pct\n' + csvRows.join('\n')],
    { type: 'text/csv' },
  );
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `entropy_${Date.now()}.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
});

// Click on beaker canvas → drop at that X position
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
