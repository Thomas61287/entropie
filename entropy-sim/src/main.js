import { N } from './fluid.js';
import { EntropyMeter } from './entropy.js';
import { Simulation, WATER_SURFACE_FRAC } from './simulation.js';
import { Renderer } from './renderer.js';

// ── Simulations ────────────────────────────────────────────────────────────
const simA = new Simulation({ inkTempC: 65, waterTempC: 15 }); // warm ink
const simB = new Simulation({ inkTempC: 15, waterTempC: 15 }); // cold ink (split)
simB.inkTempC = 15; simB._computeParams();

const entropyA = new EntropyMeter();

// ── Renderers (three canvases) ─────────────────────────────────────────────
const canvasA      = document.getElementById('simCanvasA');      // single mode
const canvasSplitA = document.getElementById('simCanvasSplitA'); // split left
const canvasB      = document.getElementById('simCanvasB');      // split right
const entropyCanvas= document.getElementById('entropyCanvas');

const rendererA      = new Renderer(canvasA);
const rendererSplitA = new Renderer(canvasSplitA);
const rendererB      = new Renderer(canvasB);

// ── State ──────────────────────────────────────────────────────────────────
let viewMode   = 'combined';
let splitMode  = false;
let reversing  = false;
let reverseTimer = 0;
let simTime    = 0;
let waveOffset = 0;
let frameCount = 0;

const stateA = { ripples: [], dropAnim: null };
const stateB = { ripples: [], dropAnim: null };

// CSV buffer — sampled every N frames
const csvRows = [];
const CSV_INTERVAL = 3;

// ── Animation helpers ──────────────────────────────────────────────────────
function startDrop(state, sim, cx, cW, cH) {
  state.dropAnim = { x: cx, y: 20, targetY: WATER_SURFACE_FRAC * cH, speed: 4.5, radius: 6, sim, cW, cH };
}

function triggerDrop(state, sim, cx, cy, cW, cH) {
  if (cy < WATER_SURFACE_FRAC * cH) {
    startDrop(state, sim, cx, cW, cH);
  } else {
    state.ripples.push({ x: cx, y: WATER_SURFACE_FRAC * cH, r: 0, alpha: 0.85 });
    const gi = Math.max(1, Math.min(N, Math.round((cx/cW)*N)));
    const gj = Math.max(1, Math.min(N, Math.round((cy/cH)*N)));
    sim.addDrop(gi, gj);
  }
}

function advanceDrop(state) {
  const d = state.dropAnim;
  if (!d) return;
  d.y += d.speed;
  d.speed += 0.15;
  if (d.y >= d.targetY) {
    state.ripples.push({ x: d.x, y: d.targetY, r: 0,  alpha: 0.9 });
    state.ripples.push({ x: d.x, y: d.targetY, r: 12, alpha: 0.6 });
    const splashY = d.targetY + 20;
    const gi = Math.max(1, Math.min(N, Math.round((d.x/d.cW)*N)));
    const gj = Math.max(1, Math.min(N, Math.round((splashY/d.cH)*N)));
    d.sim.addDrop(gi, gj);
    state.dropAnim = null;
  }
}

function tickRipples(ripples) {
  for (let i = ripples.length - 1; i >= 0; i--) {
    ripples[i].r     += 1.8;
    ripples[i].alpha *= 0.96;
    if (ripples[i].alpha < 0.01) ripples.splice(i, 1);
  }
}

// ── Formula panel ──────────────────────────────────────────────────────────
function updateFormula(stats) {
  const { W, S_real, avgT_C, inkCoverage } = stats;
  setText('fW',    W.toLocaleString('nl-NL'));
  setText('fLogW', W > 0 ? Math.log(W).toFixed(3) : '0');
  setText('fS',    W > 0 ? `${(S_real/1e-20).toFixed(4)} × 10⁻²⁰ J/K` : '0');
  setText('fT',    `${avgT_C.toFixed(1)} °C`);
  setText('fCov',  `${inkCoverage.toFixed(3)} %`);
}
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

// ── CSV export ─────────────────────────────────────────────────────────────
function exportCSV() {
  if (!csvRows.length) { alert('Laat de simulatie eerst draaien om data te verzamelen.'); return; }
  const header = 'tijd_s,S_genormaliseerd,S_JK,gem_temp_norm,gem_temp_C,inktdekking_pct,W_microtoestanden\n';
  const body   = csvRows.map(r =>
    `${r.simTime.toFixed(2)},${r.S_norm.toFixed(6)},${r.S_real.toExponential(5)},${r.avgT.toFixed(6)},${r.avgT_C.toFixed(2)},${r.inkCoverage.toFixed(4)},${r.W}`
  ).join('\n');
  const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `entropie_data_${new Date().toISOString().slice(0,10)}.csv`,
  });
  a.click();
}

// ── Main loop ──────────────────────────────────────────────────────────────
function loop() {
  waveOffset += 0.03;
  frameCount++;

  // Physics
  simA.step();
  entropyA.update(simA.ink.C);
  if (splitMode) simB.step();

  simTime += 0.12;

  // Reverse countdown
  if (reversing) {
    reverseTimer--;
    if (reverseTimer <= 0) {
      reversing = false;
      document.getElementById('reverseNote').style.display = 'block';
    }
  }

  // CSV sampling
  if (frameCount % CSV_INTERVAL === 0) csvRows.push(simA.getStats(simTime));

  // Formula panel
  updateFormula(simA.getStats(simTime));

  // Drop animations
  advanceDrop(stateA);
  tickRipples(stateA.ripples);
  if (splitMode) { advanceDrop(stateB); tickRipples(stateB.ripples); }

  // Render
  if (splitMode) {
    const labelA = `WARM — ${simA.inkTempC}°C inkt / ${simA.waterTempC}°C water`;
    const labelB = `KOUD  — ${simB.inkTempC}°C inkt / ${simB.waterTempC}°C water`;
    rendererSplitA.draw(simA, viewMode, waveOffset, stateA.ripples, stateA.dropAnim, labelA);
    rendererB.draw(simB, viewMode, waveOffset, stateB.ripples, stateB.dropAnim, labelB);
  } else {
    rendererA.draw(simA, viewMode, waveOffset, stateA.ripples, stateA.dropAnim, null);
  }

  entropyA.draw(entropyCanvas);

  requestAnimationFrame(loop);
}

// ── Split mode toggle ──────────────────────────────────────────────────────
function setSplit(on) {
  splitMode = on;
  document.getElementById('singleContainer').style.display = on ? 'none'  : 'block';
  document.getElementById('splitContainer').style.display  = on ? 'flex'  : 'none';
  document.getElementById('btnSplit').textContent = on ? 'Vergelijking: AAN' : 'Vergelijking: UIT';
  if (on) {
    simB.reset();
    stateB.ripples = []; stateB.dropAnim = null;
    // Force cold ink on B
    simB.inkTempC = 15; simB._computeParams();
  }
}

// ── Controls wiring ────────────────────────────────────────────────────────
function sliderWire(id, fmt, onChange) {
  const el  = document.getElementById(id);
  const val = document.getElementById(id + 'Val');
  if (!el) return;
  const update = () => {
    const v = parseFloat(el.value);
    if (val) val.textContent = fmt(v);
    onChange(v);
  };
  el.addEventListener('input', update);
  update();
}

const f1 = v => v.toFixed(1);
sliderWire('inkTempC',   f1, v => { simA.inkTempC   = v; simA._computeParams(); });
sliderWire('waterTempC', f1, v => { simA.waterTempC = v; simA._computeParams(); });
sliderWire('D_nm2s',     f1, v => { simA.D_nm2s     = v; simA._computeParams(); });
sliderWire('viscosity',  f1, v => { simA.viscMPas   = v; simA._computeParams(); });
sliderWire('heatAlpha',  f1, v => { simA.heatAlphaSlider = v; simA._computeParams(); });

// Canvas clicks
function addCanvasClick(canvas, state, sim) {
  canvas.addEventListener('click', e => {
    const r  = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    triggerDrop(state, sim, (e.clientX-r.left)*sx, (e.clientY-r.top)*sy, canvas.width, canvas.height);
  });
}
addCanvasClick(canvasA,      stateA, simA);
addCanvasClick(canvasSplitA, stateA, simA);
addCanvasClick(canvasB,      stateB, simB);

document.addEventListener('keydown', e => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  const cW = canvasA.width, cH = canvasA.height;
  startDrop(stateA, simA, 80 + Math.random()*(cW-160), cW, cH);
  if (splitMode) startDrop(stateB, simB, 80 + Math.random()*(canvasB.width-160), canvasB.width, canvasB.height);
});

document.getElementById('btnDrop')?.addEventListener('click', () => {
  const cW = canvasA.width, cH = canvasA.height;
  startDrop(stateA, simA, cW*0.3 + Math.random()*cW*0.4, cW, cH);
});

document.getElementById('btnReset')?.addEventListener('click', () => {
  simA.reset(); simB.reset();
  entropyA.reset();
  stateA.ripples = []; stateA.dropAnim = null;
  stateB.ripples = []; stateB.dropAnim = null;
  csvRows.length = 0;
  simTime = 0; frameCount = 0;
  reversing = false;
  document.getElementById('reverseNote').style.display = 'none';
});

document.getElementById('btnToggleView')?.addEventListener('click', () => {
  const modes  = ['combined', 'heat', 'ink'];
  const labels = { combined: 'View: Combined', heat: 'View: Warmte', ink: 'View: Inkt' };
  viewMode = modes[(modes.indexOf(viewMode)+1) % modes.length];
  document.getElementById('btnToggleView').textContent = labels[viewMode];
});

document.getElementById('btnSplit')?.addEventListener('click', () => setSplit(!splitMode));

document.getElementById('btnExportCSV')?.addEventListener('click', exportCSV);

document.getElementById('btnReverse')?.addEventListener('click', () => {
  document.getElementById('reverseNote').style.display = 'none';
  simA.reverseTime();
  reversing = true;
  reverseTimer = 120;
});

// ── Boot ───────────────────────────────────────────────────────────────────
loop();
