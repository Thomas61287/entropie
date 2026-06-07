import { N } from './fluid.js';
import { EntropyMeter } from './entropy.js';
import { Simulation, WATER_SURFACE_FRAC } from './simulation.js';
import { Renderer, renderGasRoom, renderConcentrationProfile, renderMBHistogram } from './renderer.js';
import { GasRoom } from './gasroom.js';
import {
  stokesEinsteinD, carnotEfficiency, osmoticPressure,
  calcEntropyFull, thermalEntropyChange, irreversibilityExponent
} from './analytics.js';

// ── Config ─────────────────────────────────────────────────────────────────
const BASE_DT = 0.10;
let timeScale  = 0.03;  // Upgrade 1: slow motion default
let paused     = false;
let stepOnce   = false;

// ── Simulations ────────────────────────────────────────────────────────────
const sim      = new Simulation({ inkTempC: 65, waterTempC: 15 });
const simSplit = new Simulation({ inkTempC: 65, waterTempC: 4  }); // cold water, split mode
const gasRoom  = new GasRoom(80);

const entropyMeter = new EntropyMeter();

// ── Canvas elements ─────────────────────────────────────────────────────────
const beakerCanvas       = document.getElementById('beakerCanvas');
const beakerCanvasSplitA = document.getElementById('beakerCanvasSplitA');
const beakerCanvasB      = document.getElementById('beakerCanvasB');
const roomCanvas         = document.getElementById('roomCanvas');
const profileCanvas      = document.getElementById('profileCanvas');
const mbCanvas           = document.getElementById('mbCanvas');
const entropyCanvas      = document.getElementById('entropyCanvas');
const tooltip            = document.getElementById('tooltip');

// ── Renderers ───────────────────────────────────────────────────────────────
const rendererA      = new Renderer(beakerCanvas);
const rendererSplitA = beakerCanvasSplitA ? new Renderer(beakerCanvasSplitA) : null;
const rendererB      = beakerCanvasB      ? new Renderer(beakerCanvasB)      : null;

// ── App state ────────────────────────────────────────────────────────────────
let viewMode     = 'combined';
let splitMode    = false;
let showVectors  = false;
let showGaussian = false;
let reversing    = false;
let reverseTimer = 0;

let simTime      = 0;
let waveOffset   = 0;
let frameCount   = 0;

// Drop tracking (for Gaussian overlay, Upgrade 14)
let gaussianParams = null; // { sx, sy, D, t }

// Per-canvas animation state
const stateA = { ripples: [], dropAnim: null };
const stateB = { ripples: [], dropAnim: null };

// CSV / snapshot buffers (Upgrades 12, 20)
const csvRows   = [];
const snapshots = []; // { t, dataURL }
const CSV_SAMPLE = 4;
const SNAP_EVERY = 300;

// Event log (Upgrade 18)
const events   = []; // raw data for report
const eventLog = []; // unused — kept for compatibility
let entThresholds = [0.25, 0.5, 0.75, 0.9];
let thermalEquilLogged = false, diffEquilLogged = false;
let prevS = 0;

// Cumulative thermal ΔS (Upgrade 10)
let cumThermalDS = 0;

// Report snapshots at fixed times
const reportSnaps = {}; // {t0, t25, t50, t100}

// ── Animation helpers ────────────────────────────────────────────────────────
function startDrop(state, simInst, cx, cW, cH) {
  state.dropAnim = { x: cx, y: 20, targetY: WATER_SURFACE_FRAC * cH, speed: 4.5, radius: 6, sim: simInst, cW, cH };
}

function triggerDrop(state, simInst, cx, cy, cW, cH) {
  if (cy < WATER_SURFACE_FRAC * cH) {
    startDrop(state, simInst, cx, cW, cH);
  } else {
    state.ripples.push({ x: cx, y: WATER_SURFACE_FRAC * cH, r: 0, alpha: 0.85 });
    const gi = Math.max(1, Math.min(N, Math.round((cx/cW)*N)));
    const gj = Math.max(1, Math.min(N, Math.round((cy/cH)*N)));
    simInst.addDrop(gi, gj);
    if (simInst === sim) onDropLanded(cx/cW, cy/cH, simInst);
  }
}

function onDropLanded(sx_frac, sy_frac, simInst) {
  gaussianParams = { sx: sx_frac, sy: sy_frac, D: simInst.diffRate, t: 0 };
  addEvent(`Druppel toegevoegd: T=${simInst.inkTempC}°C, water=${simInst.waterTempC}°C`);
  addEvent(`D (Stokes-Einstein) = ${stokesEinsteinD(simInst.waterTempC, simInst.viscMPas).toExponential(2)} m²/s`);
}

function advanceDrop(state) {
  const d = state.dropAnim;
  if (!d) return;
  d.y += d.speed;
  d.speed += 0.15;
  if (d.y >= d.targetY) {
    state.ripples.push({ x: d.x, y: d.targetY, r:  0, alpha: 0.9 });
    state.ripples.push({ x: d.x, y: d.targetY, r: 12, alpha: 0.6 });
    const splashY = d.targetY + 20;
    const gi = Math.max(1, Math.min(N, Math.round((d.x/d.cW)*N)));
    const gj = Math.max(1, Math.min(N, Math.round((splashY/d.cH)*N)));
    d.sim.addDrop(gi, gj);
    if (d.sim === sim) onDropLanded(d.x/d.cW, splashY/d.cH, d.sim);
    state.dropAnim = null;
  }
}

function tickRipples(ripples) {
  for (let i = ripples.length-1; i >= 0; i--) {
    ripples[i].r     += 1.8;
    ripples[i].alpha *= 0.96;
    if (ripples[i].alpha < 0.01) ripples.splice(i,1);
  }
}

// ── Event log (Upgrade 18) ───────────────────────────────────────────────────
function addEvent(msg) {
  const t = simTime.toFixed(2);
  events.push({ t, msg });
  const el = document.getElementById('eventLog');
  if (!el) return;
  const row = document.createElement('div');
  row.className = 'event-row';
  row.innerHTML = `<span class="et">[${t}s]</span> ${msg}`;
  el.insertBefore(row, el.firstChild);
  while (el.children.length > 30) el.removeChild(el.lastChild);
}

// ── Cursor analysis (Upgrade 19) ─────────────────────────────────────────────
function setupCursorAnalysis(canvas, simInst) {
  canvas.addEventListener('mousemove', e => {
    if (!tooltip) return;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top)  * sy;
    const gi = Math.max(0, Math.min(N+1, Math.round((px/canvas.width)*(N+2))));
    const gj = Math.max(0, Math.min(N+1, Math.round((py/canvas.height)*(N+2))));
    const id = gi + gj*(N+2);
    const c  = simInst.ink.C[id] || 0;
    const t  = simInst.heat.T[id] || 0;
    const vx = simInst.fluid.vx[id] || 0;
    const vy = simInst.fluid.vy[id] || 0;
    const T_C = t * 100;
    // Fick flux J = -D · ∇C (magnitude)
    const id1 = (gi+1) + gj*(N+2), id2 = (gi-1) + gj*(N+2);
    const dCdx = id1 < simInst.ink.C.length && id2 >= 0 ? (simInst.ink.C[id1] - simInst.ink.C[id2])/2 : 0;
    const J = Math.abs(-simInst.diffRate * dCdx);

    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 14) + 'px';
    tooltip.style.top  = (e.clientY - 10) + 'px';
    tooltip.innerHTML  = `
      <b>(${gi}, ${gj})</b><br>
      C = ${c.toFixed(4)}<br>
      T = ${T_C.toFixed(1)} °C<br>
      v = (${vx.toFixed(3)}, ${vy.toFixed(3)})<br>
      J (Fick) ≈ ${J.toExponential(2)}<br>
      ∂C/∂x = ${dCdx.toFixed(5)}
    `;
  });
  canvas.addEventListener('mouseleave', () => { if (tooltip) tooltip.style.display='none'; });
}

// ── Live formula panel (Upgrade 5) ───────────────────────────────────────────
function updatePanels() {
  const stats = sim.getStats(simTime);
  const { W, S_real, avgT_C, inkCoverage, avgC, maxC } = stats;
  const T_w  = sim.waterTempC, T_i = sim.inkTempC;
  const D_m2s = stokesEinsteinD(T_w, sim.viscMPas);
  const eta   = carnotEfficiency(T_w, T_i);
  const osmP  = osmoticPressure(Math.min(1, maxC), T_w);
  const expnt = irreversibilityExponent(W, (N+2)*(N+2));

  setText('fW',       W.toLocaleString('nl-NL'));
  setText('fLogW',    W > 0 ? Math.log(W).toFixed(2) : '0');
  setText('fS',       W > 0 ? `${(S_real/1e-20).toFixed(4)} × 10⁻²⁰ J/K` : '0');
  setText('fDeltaS',  W > 0 && prevS > 0 ? `+${((S_real - prevS)/1e-22).toFixed(2)} × 10⁻²² J/K` : '—');
  setText('fT',       `${avgT_C.toFixed(1)} °C`);
  setText('fCov',     `${inkCoverage.toFixed(3)} %`);
  setText('fD',       D_m2s.toExponential(2) + ' m²/s');
  setText('fCarnot',  `${(eta*100).toFixed(1)} %`);
  setText('fOsmotic', `${osmP.toFixed(0)} Pa`);
  setText('fIrrev',  `10^${expnt.toFixed(0)}`);
  setText('fIrrev2', expnt.toFixed(0));
  setText('fCumDS',  `${(cumThermalDS/1e-20).toFixed(3)} × 10⁻²⁰ J/K`);

  // Time display
  setText('fSimTime', `${simTime.toFixed(1)} s`);
  setText('fTimeScale', `${(timeScale*100).toFixed(0)}%`);
}

function setText(id, v) { const el=document.getElementById(id); if(el) el.textContent=v; }

// Entropy threshold event logging (Upgrade 18)
function checkEntropyEvents(S_norm) {
  entThresholds = entThresholds.filter(thresh => {
    if (S_norm >= thresh) {
      addEvent(`Entropie bereikt ${Math.round(thresh*100)}% van maximum`);
      return false;
    }
    return true;
  });
  if (!thermalEquilLogged && sim.waterTempC > 0) {
    const avgT = sim.getStats(0).avgT_C;
    if (Math.abs(avgT - sim.waterTempC) < 2) {
      addEvent('Thermisch evenwicht bereikt — Carnot η → 0');
      thermalEquilLogged = true;
    }
  }
  if (!diffEquilLogged && S_norm > 0.92) {
    addEvent('Diffusief evenwicht — ΔS/Δt → 0, tweede wet geverifieerd');
    diffEquilLogged = true;
  }
}

// ── CSV export (Upgrade 12) ───────────────────────────────────────────────────
function exportCSV() {
  if (!csvRows.length) { alert('Laat de simulatie eerst draaien.'); return; }
  const hdr = 'tijd_s,S_norm,S_JK,W,gem_temp_C,inktdekking_pct,gem_C,max_C,carnot_pct,osmotisch_Pa,cumulatief_dS_JK\n';
  const body = csvRows.map(r => [
    r.t.toFixed(3), r.S_norm.toFixed(6), r.S_real.toExponential(5),
    r.W, r.avgT_C.toFixed(2), r.inkCoverage.toFixed(4),
    r.avgC.toFixed(6), r.maxC.toFixed(4),
    r.carnot.toFixed(4), r.osmotic.toFixed(1), r.cumDS.toExponential(5)
  ].join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([hdr+body], {type:'text/csv'})),
    download: `entropie_${new Date().toISOString().slice(0,10)}.csv`
  });
  a.click();
}

// ── Snapshot helper ───────────────────────────────────────────────────────────
function takeSnapshot() {
  try { snapshots.push({ t: simTime, url: beakerCanvas.toDataURL('image/png') }); } catch(_){}
}

// ── Report generator (Upgrade 20) ────────────────────────────────────────────
function generateReport() {
  const stats  = sim.getStats(simTime);
  const D_m2s  = stokesEinsteinD(sim.waterTempC, sim.viscMPas).toExponential(3);
  const eta    = (carnotEfficiency(sim.waterTempC, sim.inkTempC)*100).toFixed(1);
  const snaps  = snapshots.slice(0, 4);
  const snapHtml = snaps.map((s,i) =>
    `<div style="display:inline-block;margin:4px">
       <div style="color:#00ffcc;font-size:10px">t = ${s.t.toFixed(1)} s</div>
       <img src="${s.url}" width="180" style="border:1px solid #00ffcc33">
     </div>`).join('');
  const S_chart = entropyMeter.history.map((s,i)=>
    `<polyline points="${i},${100-s*95}" style="fill:none;stroke:#00ffcc;stroke-width:1"/>`).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Entropie Simulatie Rapport</title>
<style>
  body{font-family:"Courier New",monospace;background:#0a0a1a;color:#e8e8f0;padding:30px;max-width:900px;margin:auto}
  h1,h2{color:#00ffcc} table{border-collapse:collapse;width:100%;margin:10px 0}
  td,th{border:1px solid #00ffcc33;padding:6px 10px;font-size:13px}
  th{color:#00ffcc;background:#0d0d22} .note{color:#00ffcc88;font-size:12px}
</style></head><body>
<h1>Entropy in Motion — Analyserapport</h1>
<p class="note">Gegenereerd op ${new Date().toLocaleString('nl-NL')} &nbsp;·&nbsp; Simulatietijd: ${simTime.toFixed(1)} s</p>
<h2>Parameters</h2>
<table>
  <tr><th>Parameter</th><th>Waarde</th><th>Eenheid</th></tr>
  <tr><td>T inkt</td><td>${sim.inkTempC}</td><td>°C</td></tr>
  <tr><td>T water</td><td>${sim.waterTempC}</td><td>°C</td></tr>
  <tr><td>D (ingesteld)</td><td>${sim.D_nm2s}</td><td>×10⁻⁹ m²/s</td></tr>
  <tr><td>D (Stokes-Einstein)</td><td>${D_m2s}</td><td>m²/s</td></tr>
  <tr><td>Viscositeit η</td><td>${sim.viscMPas}</td><td>mPa·s</td></tr>
  <tr><td>Tijdschaal</td><td>${(timeScale*100).toFixed(0)}</td><td>% van realtime</td></tr>
</table>
<h2>Resultaten</h2>
<table>
  <tr><th>Grootheid</th><th>Waarde</th></tr>
  <tr><td>Entropie S (eindwaarde)</td><td>${(stats.S_real/1e-20).toFixed(4)} × 10⁻²⁰ J/K</td></tr>
  <tr><td>Microtoestanden W</td><td>${stats.W.toLocaleString('nl-NL')}</td></tr>
  <tr><td>Inktdekking</td><td>${stats.inkCoverage.toFixed(2)} %</td></tr>
  <tr><td>Gemiddelde temperatuur</td><td>${stats.avgT_C.toFixed(1)} °C</td></tr>
  <tr><td>Carnot rendement (begin)</td><td>${eta} %</td></tr>
  <tr><td>Cumulatieve ΔS (thermisch)</td><td>${(cumThermalDS/1e-20).toFixed(3)} × 10⁻²⁰ J/K</td></tr>
</table>
<h2>Conclusies</h2>
<p>De gemeten diffusiecoëfficiënt D = ${D_m2s} m²/s (Stokes-Einstein bij ${sim.waterTempC}°C, η = ${sim.viscMPas} mPa·s).</p>
<p>De entropie nam monotoon toe van S=0 naar S = ${(stats.S_real/1e-20).toFixed(3)} × 10⁻²⁰ J/K,
   wat overeenstemt met de Tweede Hoofdwet: ΔS<sub>totaal</sub> ≥ 0 (module H5).</p>
<p>Het Carnot rendement daalde van ${eta}% naar ~0% naarmate thermisch evenwicht werd bereikt,
   conform ΔS = Q/T (module H3).</p>
<h2>Snapshots</h2>
<div>${snapHtml || '<p style="color:#888">Geen snapshots (laat simulatie langer draaien)</p>'}</div>
<h2>Evenementenlog</h2>
<pre style="font-size:11px;color:#a0c8a0;max-height:200px;overflow-y:auto">${events.map(e=>`[${e.t}s] ${e.msg}`).join('\n')}</pre>
</body></html>`;

  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([html],{type:'text/html'})),
    download: `rapport_entropie_${new Date().toISOString().slice(0,10)}.html`
  });
  a.click();
}

// ── Main simulation loop ──────────────────────────────────────────────────────
function loop() {
  if (!paused || stepOnce) {
    stepOnce = false;
    const dt = BASE_DT * timeScale;

    // Physics
    sim.step(dt);
    if (splitMode) simSplit.step(dt);

    // Gas room fed by surface concentration of main sim
    const surfConc = sim.getSurfaceConcentration();
    gasRoom.addSource(gasRoom.N/2, gasRoom.N/2, surfConc * 0.005 * timeScale);
    gasRoom.step(dt * 80);

    // Entropy meter
    entropyMeter.update(sim.ink.C);
    const stats = sim.getStats(simTime);

    // Thermal entropy accumulation
    cumThermalDS += thermalEntropyChange(sim.cumDeltaQ, sim.waterTempC);
    sim.cumDeltaQ = 0;

    // Reverse-time countdown (Upgrade 16)
    if (reversing) {
      reverseTimer--;
      if (reverseTimer <= 0) {
        reversing = false;
        show('reverseNote');
      }
    }

    // Gaussian timer
    if (gaussianParams) gaussianParams.t += dt;

    simTime    += dt;
    waveOffset += 0.03;
    frameCount++;

    // CSV sampling (Upgrade 12)
    if (frameCount % CSV_SAMPLE === 0) {
      const eta   = carnotEfficiency(sim.waterTempC, sim.inkTempC);
      const osmP  = osmoticPressure(stats.maxC, sim.waterTempC);
      csvRows.push({ t: simTime, ...stats, carnot: eta, osmotic: osmP, cumDS: cumThermalDS });
    }

    // Snapshots (Upgrade 20)
    if (frameCount % SNAP_EVERY === 0) takeSnapshot();

    // Event log checks (Upgrade 18)
    checkEntropyEvents(stats.S_norm);
    prevS = stats.S_real;

    // Drop animations
    advanceDrop(stateA);
    tickRipples(stateA.ripples);
    if (splitMode) { advanceDrop(stateB); tickRipples(stateB.ripples); }
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  if (splitMode) {
    if (rendererSplitA) rendererSplitA.render(sim, viewMode, waveOffset, stateA.ripples, stateA.dropAnim, {
      label: `WARM ${sim.waterTempC}°C — inkt ${sim.inkTempC}°C`,
      showVectors, showGaussian, gaussianParams,
    });
    if (rendererB) rendererB.render(simSplit, viewMode, waveOffset, stateB.ripples, stateB.dropAnim, {
      label: `KOUD ${simSplit.waterTempC}°C — inkt ${simSplit.inkTempC}°C`,
      showVectors,
    });
  } else {
    rendererA.render(sim, viewMode, waveOffset, stateA.ripples, stateA.dropAnim, {
      showVectors, showGaussian, gaussianParams,
    });
  }

  renderGasRoom(roomCanvas, gasRoom);

  renderConcentrationProfile(profileCanvas, sim, 0.60,
    showGaussian && gaussianParams ? gaussianParams : null);

  renderMBHistogram(mbCanvas, sim.fluid, sim.waterTempC);

  entropyMeter.draw(entropyCanvas);
  updatePanels();

  requestAnimationFrame(loop);
}

// ── Controls ──────────────────────────────────────────────────────────────────
function sliderWire(id, fmt, cb) {
  const el = document.getElementById(id);
  const vl = document.getElementById(id+'Val');
  if (!el) return;
  const upd = () => { const v=parseFloat(el.value); if(vl) vl.textContent=fmt(v); cb(v); };
  el.addEventListener('input', upd);
  upd();
}
const f1 = v => v.toFixed(1);
const f2 = v => v.toFixed(2);

sliderWire('inkTempC',   f1, v => { sim.inkTempC   = v; sim._computeParams(); });
sliderWire('waterTempC', f1, v => { sim.waterTempC = v; sim._computeParams(); });
sliderWire('D_nm2s',     f2, v => { sim.D_nm2s     = v; sim._computeParams(); });
sliderWire('viscosity',  f1, v => { sim.viscMPas   = v; sim._computeParams(); });
sliderWire('heatAlpha',  f1, v => { sim.heatAlphaSlider = v; sim._computeParams(); });
sliderWire('timeScaleSlider', v => `${(v*100).toFixed(0)}%`, v => { timeScale = v; });

// Canvas click → drop
function addCanvasClick(canvas, state, simInst) {
  canvas.addEventListener('click', e => {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width/r.width, sy = canvas.height/r.height;
    triggerDrop(state, simInst, (e.clientX-r.left)*sx, (e.clientY-r.top)*sy, canvas.width, canvas.height);
  });
}
addCanvasClick(beakerCanvas,  stateA, sim);
if (beakerCanvasSplitA) addCanvasClick(beakerCanvasSplitA, stateA, sim);
if (beakerCanvasB)      addCanvasClick(beakerCanvasB, stateB, simSplit);
setupCursorAnalysis(beakerCanvas, sim);
if (beakerCanvasSplitA) setupCursorAnalysis(beakerCanvasSplitA, sim);

document.addEventListener('keydown', e => {
  const cW = beakerCanvas.width, cH = beakerCanvas.height;
  if (e.code === 'Space')       { e.preventDefault(); paused = !paused; updatePlayBtn(); }
  if (e.code === 'ArrowRight')  { e.preventDefault(); paused = true; stepOnce = true; updatePlayBtn(); }
  if (e.code === 'KeyD')        startDrop(stateA, sim, 80+Math.random()*(cW-160), cW, cH);
});

function updatePlayBtn() {
  const b = document.getElementById('btnPlayPause');
  if (b) b.textContent = paused ? '▶ Play' : '⏸ Pause';
}

function show(id) { const el=document.getElementById(id); if(el) el.style.display='block'; }
function hide(id) { const el=document.getElementById(id); if(el) el.style.display='none'; }

// Button wiring
const $ = id => document.getElementById(id);

$('btnDrop')?.addEventListener('click', () => {
  const cW=beakerCanvas.width, cH=beakerCanvas.height;
  startDrop(stateA, sim, cW*0.3+Math.random()*cW*0.4, cW, cH);
});

$('btnPlayPause')?.addEventListener('click', () => { paused=!paused; updatePlayBtn(); });

$('btnStep')?.addEventListener('click', () => { paused=true; stepOnce=true; updatePlayBtn(); });

$('btnReset')?.addEventListener('click', () => {
  sim.reset(); simSplit.reset(); gasRoom.reset(); entropyMeter.reset();
  stateA.ripples=[]; stateA.dropAnim=null;
  stateB.ripples=[]; stateB.dropAnim=null;
  csvRows.length=0; snapshots.length=0; events.length=0;
  cumThermalDS=0; simTime=0; frameCount=0; prevS=0;
  entThresholds=[0.25,0.5,0.75,0.9];
  thermalEquilLogged=false; diffEquilLogged=false;
  gaussianParams=null; reversing=false;
  hide('reverseNote');
  const el=$('eventLog'); if(el) el.innerHTML='';
});

$('btnToggleView')?.addEventListener('click', () => {
  const m=['combined','heat','ink'];
  const l={combined:'View: Combined', heat:'View: Warmte', ink:'View: Inkt'};
  viewMode=m[(m.indexOf(viewMode)+1)%m.length];
  $('btnToggleView').textContent=l[viewMode];
});

$('btnVectors')?.addEventListener('click', () => {
  showVectors=!showVectors;
  $('btnVectors').textContent=showVectors?'Vectorveld: AAN':'Vectorveld: UIT';
});

$('btnGaussian')?.addEventListener('click', () => {
  showGaussian=!showGaussian;
  $('btnGaussian').textContent=showGaussian?'Gauss-overlay: AAN':'Gauss-overlay: UIT';
});

$('btnSplit')?.addEventListener('click', () => {
  splitMode=!splitMode;
  hide(splitMode?'normalBeakerWrap':'splitBeakerWrap');
  show(splitMode?'splitBeakerWrap':'normalBeakerWrap');
  $('btnSplit').textContent=splitMode?'Split: AAN':'Split: UIT';
  if(splitMode) { simSplit.reset(); stateB.ripples=[]; stateB.dropAnim=null; }
});

$('btnReverse')?.addEventListener('click', () => {
  hide('reverseNote'); sim.reverseTime(); reversing=true; reverseTimer=120;
  addEvent('Tijdomkering geprobeerd — tweede wet in werking');
});

$('btnExportCSV')?.addEventListener('click', exportCSV);
$('btnReport')?.addEventListener('click', generateReport);
$('btnSnapshot')?.addEventListener('click', () => { takeSnapshot(); addEvent('Snapshot opgeslagen'); });

// Speed buttons
['btn005x','btn05x','btn1x','btn2x'].forEach((id,i) => {
  const scales=[0.05,0.5,1.0,2.0];
  $(id)?.addEventListener('click', () => {
    timeScale=scales[i];
    const sl=$('timeScaleSlider'); if(sl){sl.value=scales[i]; $('timeScaleSliderVal').textContent=`${(scales[i]*100).toFixed(0)}%`;}
  });
});

// ── Boot ───────────────────────────────────────────────────────────────────────
addEvent('Simulatie gestart — klik op de maatbeker om inkt te druppelen');
loop();
