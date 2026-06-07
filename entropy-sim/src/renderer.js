// Renders a Simulation instance to a canvas element.
import { N, idx } from './fluid.js';
import { tempToRGB } from './heat.js';
import { WATER_SURFACE_FRAC } from './simulation.js';

const INK_COLOR = [30, 10, 80];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.W      = canvas.width;
    this.H      = canvas.height;
    this.imageData = this.ctx.createImageData(this.W, this.H);
    this.pixels    = this.imageData.data;
  }

  draw(sim, viewMode, waveOffset, ripples, dropAnim, label) {
    const { ctx, W, H, pixels, imageData } = this;
    const waterJ = Math.round(WATER_SURFACE_FRAC * N);

    for (let j = 0; j <= N+1; j++) {
      for (let i = 0; i <= N+1; i++) {
        const px = Math.round((i / (N+2)) * W);
        const py = Math.round((j / (N+2)) * H);
        const pw = Math.max(1, Math.round(((i+1)/(N+2))*W) - px);
        const ph = Math.max(1, Math.round(((j+1)/(N+2))*H) - py);

        const t = sim.heat.T[idx(i,j)];
        const c = sim.ink.C[idx(i,j)];
        const inWater = j >= waterJ;

        let r, g, b;

        if (!inWater) {
          r = 10; g = 10; b = 18;
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
          const alpha = Math.min(1, c * 1.2);
          r = r*(1-alpha) + INK_COLOR[0]*alpha;
          g = g*(1-alpha) + INK_COLOR[1]*alpha;
          b = b*(1-alpha) + INK_COLOR[2]*alpha;
        }

        for (let dy = 0; dy < ph; dy++) {
          for (let dx = 0; dx < pw; dx++) {
            const pi = ((py+dy)*W + (px+dx)) * 4;
            if (pi + 3 >= pixels.length) continue;
            pixels[pi]   = r;
            pixels[pi+1] = g;
            pixels[pi+2] = b;
            pixels[pi+3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Water surface wave
    const surfaceY = WATER_SURFACE_FRAC * H;
    ctx.save();
    ctx.strokeStyle = 'rgba(100,200,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(100,200,255,0.5)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const y = surfaceY
        + Math.sin(x*0.03 + waveOffset)*2.5
        + Math.sin(x*0.07 + waveOffset*1.3)*1.2;
      x === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.stroke();

    // Subtle grid
    ctx.strokeStyle = 'rgba(0,255,204,0.04)';
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    const gs = W / 16;
    for (let x = 0; x <= W; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y <= H; y += gs) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // Ripples
    for (const rp of ripples) {
      ctx.strokeStyle = `rgba(100,200,255,${rp.alpha.toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.3, 0, 0, Math.PI*2);
      ctx.stroke();
    }

    // Falling drop
    if (dropAnim) {
      ctx.fillStyle = `rgba(${INK_COLOR[0]},${INK_COLOR[1]},${INK_COLOR[2]},0.9)`;
      ctx.shadowColor = 'rgba(80,40,180,0.7)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(dropAnim.x, dropAnim.y, dropAnim.radius, 0, Math.PI*2);
      ctx.fill();
    }

    // Split mode label overlay
    if (label) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,10,0.55)';
      ctx.fillRect(0, 0, W, 22);
      ctx.fillStyle = '#00ffcc';
      ctx.font = '11px "Space Mono", monospace';
      ctx.fillText(label, 8, 15);
    }

    ctx.restore();
  }
}
