// Entropy calculation + live graph renderer
import { N } from './fluid.js';

const HISTORY_MAX = 400;

export class EntropyMeter {
  constructor() {
    this.history = []; // S values over time
    this.currentS = 0;
  }

  // S ∝ ln(W) where W = number of cells with ink above threshold
  update(inkC, threshold = 0.005) {
    let W = 0;
    const total = (N + 2) * (N + 2);
    for (let i = 0; i < total; i++) {
      if (inkC[i] > threshold) W++;
    }
    this.currentS = W > 0 ? Math.log(W) / Math.log(total) : 0;
    this.history.push(this.currentS);
    if (this.history.length > HISTORY_MAX) this.history.shift();
  }

  draw(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, w, h);

    // Border
    ctx.strokeStyle = 'rgba(0,255,204,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w-1, h-1);

    // Grid lines
    ctx.strokeStyle = 'rgba(0,255,204,0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = Math.round(h * i / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let i = 1; i < 4; i++) {
      const x = Math.round(w * i / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    if (this.history.length < 2) return;

    // Gradient fill under curve
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0,255,204,0.35)');
    grad.addColorStop(1, 'rgba(0,255,204,0.02)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, h);
    const step = w / (HISTORY_MAX - 1);
    for (let i = 0; i < this.history.length; i++) {
      const x = i * step;
      const y = h - this.history[i] * (h - 4) - 2;
      if (i === 0) ctx.lineTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo((this.history.length - 1) * step, h);
    ctx.closePath();
    ctx.fill();

    // Line
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = 0; i < this.history.length; i++) {
      const x = i * step;
      const y = h - this.history[i] * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Current S label
    ctx.fillStyle = '#00ffcc';
    ctx.font = '10px "Space Mono", monospace';
    ctx.fillText(`S = ${this.currentS.toFixed(3)}`, 6, 14);
  }

  reset() { this.history = []; this.currentS = 0; }
}
