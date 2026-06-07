// Beaker 3D — three@0.128.0, canvas dimensions set as HTML attributes
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/controls/OrbitControls.js';
import { N, idx } from './fluid.js';
import { WATER_SURFACE_FRAC } from './simulation.js';

const PC     = 3000;
const BR     = 1.20;
const BH     = 3.20;
const Y_SURF = BH * (0.5 - WATER_SURFACE_FRAC);
const Y_BOT  = -BH * 0.45;
const J_WATER = Math.floor(WATER_SURFACE_FRAC * N);

function w2g(wx, wy) {
  const i = Math.round((wx / (2 * BR * 0.80) + 0.5) * N);
  const j = J_WATER + Math.round((Y_SURF - wy) / Math.max(0.001, Y_SURF - Y_BOT) * (N - J_WATER));
  return [Math.max(1, Math.min(N, i)), Math.max(1, Math.min(N, j))];
}

// Infrared: cold=white, cool=yellow, warm=orange, hot=red
function tempColor(T) {
  if (T < 0.25) {
    const s = T / 0.25;
    return [1, 1, 1 - s];
  } else if (T < 0.65) {
    const s = (T - 0.25) / 0.40;
    return [1, 1 - s * 0.60, 0];
  } else {
    const s = (T - 0.65) / 0.35;
    return [1, 0.40 - s * 0.40, 0];
  }
}

export class BeakerViewer3D {
  constructor(canvas) {
    const W = Math.round(window.innerWidth  * 0.5);
    const H = Math.round(window.innerHeight * 0.85);

    // ── Critical: set HTML attributes BEFORE creating renderer ──────────────
    canvas.width  = W;
    canvas.height = H;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setSize(W, H, false);   // false = don't override CSS

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(44, W / H, 0.1, 100);
    this.camera.position.set(0, 1.0, 5.2);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.autoRotate      = true;
    this.controls.autoRotateSpeed = 0.50;
    this.controls.enableDamping   = true;
    this.controls.dampingFactor   = 0.05;
    this.controls.minDistance     = 3.0;
    this.controls.maxDistance     = 9.0;
    this.controls.enablePan       = false;

    this._waveT    = 0;
    this._ripples  = [];
    this._dropState = null;

    this._build();
    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    const W = Math.round(window.innerWidth  * 0.5);
    const H = Math.round(window.innerHeight * 0.85);
    this.renderer.domElement.width  = W;
    this.renderer.domElement.height = H;
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  _build() {
    // Lights — neutral warm white, no colour tints that could create green
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.40));

    const key = new THREE.PointLight(0xfff0e0, 2.4, 22);
    key.position.set(3, 3, 3);
    this.scene.add(key);

    const back = new THREE.PointLight(0x6688aa, 0.7, 14);
    back.position.set(-2, -1, -2);
    this.scene.add(back);

    this._inkLight = new THREE.PointLight(0xff4400, 0, 5);
    this._inkLight.position.set(0, Y_SURF - 0.3, 0);
    this.scene.add(this._inkLight);

    // ── Beaker glass ─────────────────────────────────────────────────────────
    // Transparent body — MeshStandardMaterial, NO transmission (causes green artefacts)
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xaaddff, transparent: true, opacity: 0.12,
      roughness: 0.0, metalness: 0.0, side: THREE.DoubleSide, depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(
      new THREE.CylinderGeometry(BR * 1.05, BR, BH, 48, 1, true), glassMat));

    const bot = new THREE.Mesh(new THREE.CircleGeometry(BR, 48), glassMat);
    bot.rotation.x = -Math.PI / 2;
    bot.position.y = -BH / 2;
    this.scene.add(bot);

    // Bright cyan wireframe overlay
    this.scene.add(new THREE.Mesh(
      new THREE.CylinderGeometry(BR * 1.05, BR, BH, 12, 3, true),
      new THREE.MeshBasicMaterial({ color: 0x00ffcc, wireframe: true, transparent: true, opacity: 0.80 })));

    // Horizontal tick rings
    for (let k = 1; k <= 4; k++) {
      const ty  = Y_BOT + (k / 4.8) * (Y_SURF - Y_BOT);
      const pts = [];
      for (let a = 0; a <= 64; a++) {
        const ang = a / 64 * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(ang) * BR * 1.06, ty, Math.sin(ang) * BR * 1.06));
      }
      const ringMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.65 });
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
      this.scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(BR * 1.06, ty, 0),
          new THREE.Vector3(BR * 1.22, ty, 0),
        ]),
        new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.75 })));
    }

    // Water body — bright deep blue
    const waterH = BH * (1 - WATER_SURFACE_FRAC) - 0.06;
    this.waterMat = new THREE.MeshStandardMaterial({
      color: 0x001a4d, transparent: true, opacity: 0.88, roughness: 0.3, metalness: 0,
    });
    const wb = new THREE.Mesh(
      new THREE.CylinderGeometry(BR * 0.96, BR * 0.94, waterH, 48), this.waterMat);
    wb.position.y = Y_SURF - waterH / 2;
    this.scene.add(wb);

    // Animated surface
    this.surfGeo = new THREE.PlaneGeometry(BR * 2 * 0.95, BR * 2 * 0.95, 24, 24);
    this.surfMat = new THREE.MeshStandardMaterial({
      color: 0x0033aa, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.10,
    });
    this.surfMesh = new THREE.Mesh(this.surfGeo, this.surfMat);
    this.surfMesh.rotation.x = -Math.PI / 2;
    this.surfMesh.position.y = Y_SURF;
    this.scene.add(this.surfMesh);

    // ── 3000 particles ────────────────────────────────────────────────────────
    const pos = new Float32Array(PC * 3);
    const col = new Float32Array(PC * 3);
    for (let p = 0; p < PC; p++) {
      const ang = Math.random() * Math.PI * 2;
      const r   = Math.sqrt(Math.random()) * BR * 0.87;
      const y   = Y_BOT + Math.random() * (Y_SURF - Y_BOT);
      pos[p*3]   = Math.cos(ang) * r;
      pos[p*3+1] = y;
      pos[p*3+2] = Math.sin(ang) * r;
      // Start white-dim so they're visible immediately
      col[p*3] = 0.65; col[p*3+1] = 0.65; col[p*3+2] = 0.65;
    }
    this.pPos = pos;
    this.pVel = new Float32Array(PC * 3);

    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute('color',    new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.PointsMaterial({
      size: 0.07, vertexColors: true,
      transparent: true, opacity: 1.0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.scene.add(new THREE.Points(this.pGeo, this.pMat));

    // ── Drop sphere ───────────────────────────────────────────────────────────
    this.dropMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.10, 16, 10),
      new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff1100, emissiveIntensity: 1.5 }));
    this.dropMesh.visible = false;
    this.scene.add(this.dropMesh);
  }

  startDrop(nx = 0.5) {
    if (this._dropState && !this._dropState.landed) return;
    this._dropState = { nx, progress: 0, landed: false };
    this.dropMesh.visible = true;
  }

  notifyDropLanded() {
    this._spawnRipples();
    if (this._dropState) this._dropState.landed = true;
    this.dropMesh.visible = false;
  }

  _spawnRipples() {
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.01, 0.04, 36),
        new THREE.MeshBasicMaterial({
          color: 0xff6600, transparent: true, opacity: 0.80,
          side: THREE.DoubleSide, depthWrite: false,
        }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = Y_SURF + 0.012;
      if (this._dropState) m.position.x = (this._dropState.nx - 0.5) * 2 * BR * 0.80;
      this.scene.add(m);
      this._ripples.push({ mesh: m, scale: 0.1, delay: i * 7 });
    }
  }

  update(sim, dropAnim) {
    this._waveT += 0.018;

    // Water surface animation
    const pa = this.surfGeo.attributes.position.array;
    for (let v = 0, vc = this.surfGeo.attributes.position.count; v < vc; v++) {
      const vx = pa[v*3], vz = pa[v*3+2];
      pa[v*3+1] = Math.sin(vx*2.4 + this._waveT)*0.011 + Math.sin(vz*3.2 + this._waveT*1.3)*0.007;
    }
    this.surfGeo.attributes.position.needsUpdate = true;

    // Water shifts red as ink fills
    const stats   = sim.getStats(0);
    const inkFrac = Math.min(1, stats.inkCoverage / 25);
    this.waterMat.color.setRGB(0, 0.10 + inkFrac * 0.04, 0.30 - inkFrac * 0.12);
    this._inkLight.intensity = inkFrac * 1.6;

    // Drop fall animation
    if (this._dropState && !this._dropState.landed) {
      this._dropState.progress = Math.min(1, this._dropState.progress + 0.028);
      this.dropMesh.position.set(
        (this._dropState.nx - 0.5) * 2 * BR * 0.80,
        Y_SURF + (1 - this._dropState.progress) * BH * 0.45,
        0);
    }

    // Ripple expand + fade
    this._ripples = this._ripples.filter(r => {
      if (r.delay-- > 0) return true;
      r.scale += 0.045;
      r.mesh.scale.setScalar(r.scale);
      r.mesh.material.opacity = Math.max(0, 0.80 - r.scale * 0.46);
      if (r.mesh.material.opacity <= 0) { this.scene.remove(r.mesh); return false; }
      return true;
    });

    // Particle physics + colour
    const vxA = sim.fluid.vx, vyA = sim.fluid.vy;
    const inkA = sim.ink.C,   tmpA = sim.heat.T;
    const P = this.pPos, V = this.pVel;
    const col = this.pGeo.attributes.color.array;

    for (let p = 0; p < PC; p++) {
      const [si, sj] = w2g(P[p*3], P[p*3+1]);
      const gid = idx(si, sj);
      const c   = inkA[gid] || 0;
      const T   = tmpA[gid] || 0;
      const br  = 0.003 + T * 0.004;

      V[p*3]   = V[p*3]   * 0.88 + (vxA[gid] || 0) * 0.18 + (Math.random()-0.5)*br;
      V[p*3+1] = V[p*3+1] * 0.88 - (vyA[gid] || 0) * 0.18 + (Math.random()-0.5)*br;
      V[p*3+2] = V[p*3+2] * 0.88                            + (Math.random()-0.5)*br;
      P[p*3]   += V[p*3];
      P[p*3+1] += V[p*3+1];
      P[p*3+2] += V[p*3+2];

      const r2d = Math.hypot(P[p*3], P[p*3+2]);
      if (r2d > BR * 0.90) { const s = BR * 0.90 / r2d; P[p*3] *= s; P[p*3+2] *= s; V[p*3] *= -0.2; V[p*3+2] *= -0.2; }
      if (P[p*3+1] > Y_SURF)        { P[p*3+1] = Y_SURF;        V[p*3+1] =  Math.abs(V[p*3+1]) * 0.15; }
      if (P[p*3+1] < Y_BOT + 0.02)  { P[p*3+1] = Y_BOT + 0.02;  V[p*3+1] =  Math.abs(V[p*3+1]) * 0.15; }

      const [r, g, b] = tempColor(T);
      const bright = 0.25 + T * 0.55 + c * 0.20;
      col[p*3]   = Math.min(1, r * bright);
      col[p*3+1] = Math.min(1, g * bright);
      col[p*3+2] = Math.min(1, b * bright);
    }

    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate    = true;
    this.pGeo.setDrawRange(0, PC);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() { this.renderer.dispose(); }
}
