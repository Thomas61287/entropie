// Renders Simulation, GasRoom, and sub-graphs to canvas elements
import { N, idx } from './fluid.js';
import { tempToRGB } from './heat.js';
import { WATER_SURFACE_FRAC } from './simulation.js';
import { gaussianC, maxwellBoltzmann2D } from './analytics.js';

const INK  = [30, 10, 80];
const BG   = [10, 10, 18];

// Returns true if canvas pixel (px,py) is inside the glass beaker shape
function insideBeaker(px, py, W, H) {
  const top = H * 0.01, bot = H * 0.975;
  if (py < top || py > bot) return false;
  const t  = (py - top) / (bot - top);
  const lx = (0.185 - t * 0.07) * W;
  const rx = (0.815 + t * 0.07) * W;
  return px >= lx && px <= rx;
}

// ── Main fluid/beaker renderer ─────────────────────────────────────────────
export class Renderer {
  constructor(canvas) {
    this.canvas    = canvas;
    this.ctx       = canvas.getContext('2d');
    this.W         = canvas.width;
    this.H         = canvas.height;
    this.imageData = this.ctx.createImageData(canvas.width, canvas.height);
    this.pixels    = this.imageData.data;
  }

  // Draw the fluid simulation, optionally masked to beaker shape
  drawFluid(sim, viewMode, waveOffset, ripples, dropAnim, beakerMask) {
    const { W, H, pixels, imageData, ctx } = this;
    const waterJ = Math.round(WATER_SURFACE_FRAC * N);

    for (let j = 0; j <= N+1; j++) {
      for (let i = 0; i <= N+1; i++) {
        const px = Math.round((i/(N+2))*W);
        const py = Math.round((j/(N+2))*H);
        const pw = Math.max(1, Math.round(((i+1)/(N+2))*W) - px);
        const ph = Math.max(1, Math.round(((j+1)/(N+2))*H) - py);

        const t       = sim.heat.T[idx(i,j)];
        const c       = sim.ink.C[idx(i,j)];
        const inWater = j >= waterJ;

        let r, g, b;
        if (!inWater) {
          r = BG[0]; g = BG[1]; b = BG[2];
        } else if (viewMode === 'heat') {
          [r,g,b] = tempToRGB(t);
        } else if (viewMode === 'ink') {
          r = 10; g = 14; b = 40;
        } else {
          if (t > sim.waterTemp + 0.03) {
            [r,g,b] = tempToRGB(t);
          } else {
            r = Math.min(25, 10 + j*0.08);
            g = Math.min(35, 14 + j*0.12);
            b = Math.min(80, 40 + j*0.18);
          }
        }
        if (viewMode !== 'heat' && c > 0.005) {
          const a = Math.min(1, c * 1.2);
          r = r*(1-a) + INK[0]*a; g = g*(1-a) + INK[1]*a; b = b*(1-a) + INK[2]*a;
        }

        for (let dy = 0; dy < ph; dy++) {
          for (let dx = 0; dx < pw; dx++) {
            const ppx = px+dx, ppy = py+dy;
            const inside = !beakerMask || insideBeaker(ppx, ppy, W, H);
            const pi = (ppy*W + ppx)*4;
            if (pi+3 >= pixels.length) continue;
            pixels[pi]   = inside ? r   : BG[0];
            pixels[pi+1] = inside ? g   : BG[1];
            pixels[pi+2] = inside ? b   : BG[2];
            pixels[pi+3] = 255;
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // Draw animated water surface wave
  drawWave(waveOffset) {
    const { ctx, W, H } = this;
    const y0 = WATER_SURFACE_FRAC * H;
    ctx.save();
    ctx.strokeStyle = 'rgba(100,200,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(100,200,255,0.5)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const y = y0 + Math.sin(x*0.03+waveOffset)*2.5 + Math.sin(x*0.07+waveOffset*1.3)*1.2;
      x === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Draw the glass beaker outline on top of the fluid rendering
  drawBeakerGlass() {
    const { ctx, W, H } = this;
    ctx.save();

    // Outer mask: darken everything outside beaker
    ctx.fillStyle = 'rgba(10,10,18,0.92)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    // Cut out beaker shape (trapezoid + arc bottom)
    ctx.moveTo(W*0.115, H*0.01);
    ctx.lineTo(W*0.185, H*0.01);
    ctx.lineTo(W*0.115, H*0.975);
    ctx.arc(W*0.5, H*0.975, W*0.385, Math.PI, 0, true);
    ctx.lineTo(W*0.815, H*0.01);
    ctx.lineTo(W*0.885, H*0.01);
    ctx.lineTo(W*0.885, H*0.975);
    ctx.arc(W*0.5, H*0.975, W*0.385, 0, Math.PI);
    ctx.closePath();
    ctx.fill('evenodd');

    // Glass walls
    ctx.strokeStyle = 'rgba(140,210,255,0.55)';
    ctx.lineWidth = 2.5;
    // Left wall
    ctx.beginPath(); ctx.moveTo(W*0.185, H*0.01); ctx.lineTo(W*0.115, H*0.975); ctx.stroke();
    // Right wall
    ctx.beginPath(); ctx.moveTo(W*0.815, H*0.01); ctx.lineTo(W*0.885, H*0.975); ctx.stroke();
    // Bottom arc
    ctx.beginPath(); ctx.arc(W*0.5, H*0.975, W*0.385, 0, Math.PI); ctx.stroke();
    // Top rim
    ctx.beginPath(); ctx.moveTo(W*0.12, H*0.01); ctx.lineTo(W*0.88, H*0.01); ctx.stroke();

    // Glass gloss highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.11)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(W*0.205, H*0.03); ctx.lineTo(W*0.135, H*0.93); ctx.stroke();

    // ml markings on right
    ctx.strokeStyle = 'rgba(0,255,200,0.4)';
    ctx.lineWidth = 1;
    ctx.fillStyle  = 'rgba(0,255,200,0.45)';
    ctx.font = '9px "Space Mono", monospace';
    const levels = [100, 200, 300, 400, 500];
    levels.forEach((ml, i) => {
      const fy = 0.88 - i * 0.155;
      const y  = H * fy;
      ctx.beginPath(); ctx.moveTo(W*0.86, y); ctx.lineTo(W*0.90, y); ctx.stroke();
      ctx.fillText(`${ml}ml`, W*0.91, y+4);
    });

    ctx.restore();
  }

  // Draw Fick flux vector field: J = -D·∇C
  drawVectorField(sim) {
    const { ctx, W, H } = this;
    const step = 8;
    ctx.save();
    for (let j = step; j < N-step; j += step) {
      for (let i = step; i < N-step; i += step) {
        const dCdx = sim.ink.C[idx(i+1,j)] - sim.ink.C[idx(i-1,j)];
        const dCdy = sim.ink.C[idx(i,j+1)] - sim.ink.C[idx(i,j-1)];
        const mag  = Math.sqrt(dCdx*dCdx + dCdy*dCdy);
        if (mag < 0.003) continue;

        const x  = (i/(N+2)) * W;
        const y  = (j/(N+2)) * H;
        const sc = Math.min(12, mag * 90);
        const tx = x - (dCdx/mag)*sc;
        const ty = y - (dCdy/mag)*sc;
        const alpha = Math.min(0.7, mag * 4);

        ctx.strokeStyle = `rgba(0,255,200,${alpha.toFixed(2)})`;
        ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(tx,ty); ctx.stroke();

        // Arrowhead
        const angle = Math.atan2(ty-y, tx-x);
        ctx.fillStyle = `rgba(0,255,200,${alpha.toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - 4*Math.cos(angle-0.45), ty - 4*Math.sin(angle-0.45));
        ctx.lineTo(tx - 4*Math.cos(angle+0.45), ty - 4*Math.sin(angle+0.45));
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  // Draw analytical Gaussian C(r,t) overlay in orange
  drawGaussian(sx_frac, sy_frac, D_sim, t_sim) {
    const { ctx, W, H } = this;
    if (t_sim < 0.5 || D_sim < 0.00001) return;
    const sx = sx_frac * W, sy = sy_frac * H;
    const overlay = ctx.createImageData(W, H);
    const op = overlay.data;
    const waterTop = WATER_SURFACE_FRAC * H;

    for (let py = Math.floor(waterTop); py < H; py++) {
      for (let px = 0; px < W; px++) {
        if (!insideBeaker(px, py, W, H)) continue;
        const C = gaussianC(px-sx, py-sy, D_sim * 300, t_sim, 8000);
        const a = Math.min(210, C * 600);
        if (a < 2) continue;
        const pi = (py*W+px)*4;
        op[pi]=255; op[pi+1]=120; op[pi+2]=0; op[pi+3]=a;
      }
    }
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.putImageData(overlay, 0, 0);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Draw ripples
  drawRipples(ripples) {
    const { ctx } = this;
    ctx.save();
    for (const rp of ripples) {
      ctx.strokeStyle = `rgba(100,200,255,${rp.alpha.toFixed(3)})`;
      ctx.lineWidth = 1; ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.r, rp.r*0.3, 0, 0, Math.PI*2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Draw falling ink drop animation
  drawDrop(dropAnim) {
    if (!dropAnim) return;
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},0.92)`;
    ctx.shadowColor = 'rgba(80,40,180,0.7)';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(dropAnim.x, dropAnim.y, dropAnim.radius, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // Full beaker frame render
  render(sim, viewMode, waveOffset, ripples, dropAnim, opts = {}) {
    this.drawFluid(sim, viewMode, waveOffset, ripples, dropAnim, true);
    if (opts.showGaussian && opts.gaussianParams) {
      const { sx, sy, D, t } = opts.gaussianParams;
      this.drawGaussian(sx, sy, D, t);
    }
    this.drawWave(waveOffset);
    this.drawBeakerGlass();
    this.drawRipples(ripples);
    this.drawDrop(dropAnim);
    if (opts.showVectors) this.drawVectorField(sim);
    if (opts.label) {
      const { ctx, W } = this;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,10,0.6)';
      ctx.fillRect(0, 0, W, 22);
      ctx.fillStyle = '#00ffcc';
      ctx.font = '10px "Space Mono", monospace';
      ctx.fillText(opts.label, 8, 14);
      ctx.restore();
    }
  }
}

// ── Gas room renderer ──────────────────────────────────────────────────────
export function renderGasRoom(canvas, gasRoom) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const N = gasRoom.N;
  const cw = W / N, ch = H / N;

  const imageData = ctx.createImageData(W, H);
  const px = imageData.data;

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const id    = i + j * N;
      const wall  = gasRoom.walls[id];
      const c     = gasRoom.C[id];

      const bx = Math.round(i*cw), by = Math.round(j*ch);
      const bw = Math.max(1, Math.round((i+1)*cw) - bx);
      const bh = Math.max(1, Math.round((j+1)*ch) - by);

      let r, g, b;
      if (wall) {
        r = 20; g = 25; b = 50; // wall: dark blue-grey
      } else {
        // Concentration: 0=deep blue, 1=purple/indigo fog
        r = Math.min(255, 10 + c * 90);
        g = Math.min(255, 10 + c * 20);
        b = Math.min(255, 30 + c * 60);
      }

      for (let dy = 0; dy < bh; dy++) {
        for (let dx2 = 0; dx2 < bw; dx2++) {
          const pi = ((by+dy)*W + (bx+dx2))*4;
          if (pi+3 >= px.length) continue;
          px[pi]=r; px[pi+1]=g; px[pi+2]=b; px[pi+3]=255;
        }
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // Room decorations
  ctx.save();
  // Outer wall border
  ctx.strokeStyle = 'rgba(140,160,255,0.35)';
  ctx.lineWidth = 3;
  const m = Math.round(cw); // one cell margin
  ctx.strokeRect(m, m, W-2*m, H-2*m);

  // Door opening label
  const doorY0 = (gasRoom.doorJ0/N)*H;
  const doorY1 = (gasRoom.doorJ1/N)*H;
  ctx.strokeStyle = 'rgba(0,255,200,0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4,3]);
  ctx.beginPath(); ctx.moveTo(W-m, doorY0); ctx.lineTo(W-m, doorY1); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(0,255,200,0.5)';
  ctx.font = '9px "Space Mono", monospace';
  ctx.fillText('DEUR', W-m+2, (doorY0+doorY1)*0.5+3);

  // Ink source circle
  const sx = W*0.5, sy = H*0.5;
  ctx.strokeStyle = 'rgba(0,255,200,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI*2); ctx.stroke();
  ctx.fillStyle = 'rgba(0,255,200,0.35)';
  ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(0,255,200,0.55)';
  ctx.fillText('BEKER', sx-17, sy+18);

  // Floor grid
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  const gs = Math.round(W/12);
  for (let x = m; x <= W-m; x+=gs) { ctx.beginPath(); ctx.moveTo(x,m); ctx.lineTo(x,H-m); ctx.stroke(); }
  for (let y = m; y <= H-m; y+=gs) { ctx.beginPath(); ctx.moveTo(m,y); ctx.lineTo(W-m,y); ctx.stroke(); }

  ctx.restore();
}

// ── Concentration profile C(x) ─────────────────────────────────────────────
export function renderConcentrationProfile(canvas, sim, sliceY_frac, gaussianParams) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#050510'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle = 'rgba(0,255,204,0.18)'; ctx.lineWidth=1;
  ctx.strokeRect(0.5,0.5,W-1,H-1);

  const j = Math.max(1, Math.min(N, Math.floor(sliceY_frac * N)));
  const pad = 4;

  // Simulation curve
  ctx.strokeStyle = '#00ffcc'; ctx.lineWidth=1.5;
  ctx.shadowColor = '#00ffcc'; ctx.shadowBlur = 3;
  ctx.beginPath();
  for (let i = 0; i <= N+1; i++) {
    const C = sim.ink.C[idx(i,j)];
    const x = (i/(N+2))*W;
    const y = H-pad - C*(H-pad*2);
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Gaussian overlay (orange)
  if (gaussianParams && gaussianParams.t > 0.5) {
    const { sx, D, t } = gaussianParams;
    const srcI = Math.round(sx * (N+2));
    ctx.strokeStyle = 'rgba(255,140,0,0.7)'; ctx.lineWidth = 1;
    ctx.setLineDash([3,2]);
    ctx.beginPath();
    for (let i = 0; i <= N+1; i++) {
      const dx = i - srcI;
      const C  = gaussianC(dx, 0, D*300, t, 5000);
      const x  = (i/(N+2))*W;
      const y  = H-pad - Math.min(1,C)*(H-pad*2);
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle='rgba(0,255,204,0.5)'; ctx.font='8px "Space Mono",monospace';
  ctx.fillText('C(x)', 4, 11);
  if (gaussianParams) {
    ctx.fillStyle='rgba(255,140,0,0.6)';
    ctx.fillText('── Fick analytisch', 30, 11);
  }
}

// ── Maxwell-Boltzmann histogram ─────────────────────────────────────────────
export function renderMBHistogram(canvas, fluid, T_water_C) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#050510'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(0,255,204,0.18)'; ctx.lineWidth=1;
  ctx.strokeRect(0.5,0.5,W-1,H-1);

  const BINS = 30;
  const histogram = new Float32Array(BINS);
  let maxV = 0.001;

  // Collect speed magnitudes from velocity field
  const vx = fluid.vx, vy = fluid.vy;
  for (let i = 0; i < vx.length; i++) {
    const v = Math.sqrt(vx[i]*vx[i] + vy[i]*vy[i]);
    if (v > maxV) maxV = v;
  }
  for (let i = 0; i < vx.length; i++) {
    const v   = Math.sqrt(vx[i]*vx[i] + vy[i]*vy[i]);
    const bin = Math.min(BINS-1, Math.floor((v/maxV)*BINS));
    histogram[bin]++;
  }
  const maxH = Math.max(1, ...histogram);

  const pad = 4, bw = (W-pad*2)/BINS;

  // Histogram bars
  ctx.fillStyle = 'rgba(0,255,204,0.25)';
  for (let b = 0; b < BINS; b++) {
    const bh = (histogram[b]/maxH)*(H-pad*2);
    ctx.fillRect(pad+b*bw, H-pad-bh, bw-1, bh);
  }

  // Theoretical MB curve
  const mbCurve = maxwellBoltzmann2D(T_water_C + 273.15, 1e-24, BINS, maxV);
  ctx.strokeStyle = 'rgba(255,140,0,0.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let b = 0; b < BINS; b++) {
    const x = pad + (b+0.5)*bw;
    const y = H-pad - mbCurve[b]*(H-pad*2);
    b===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  }
  ctx.stroke();

  ctx.fillStyle='rgba(0,255,204,0.5)'; ctx.font='8px "Space Mono",monospace';
  ctx.fillText('Maxwell-Boltzmann', 4, 11);
}
