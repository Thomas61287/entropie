// 3D Beaker — cinematic Three.js scene
// Glass cylinder + wireframe overlay + 3000 temperature-coloured particles + ripple rings
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { N, idx } from './fluid.js';
import { WATER_SURFACE_FRAC } from './simulation.js';

const PC    = 3000;
const BR    = 1.18;   // beaker radius (world units)
const BH    = 3.4;    // beaker height
const Y_SURF = BH * (0.5 - WATER_SURFACE_FRAC);
const Y_BOT  = -BH * 0.46;
const J_WATER = Math.floor(WATER_SURFACE_FRAC * N);

function g2w(si, sj) {
  const x = (si / N - 0.5) * 2 * BR * 0.82;
  const y = Y_SURF - (sj - J_WATER) / Math.max(1, N - J_WATER) * (Y_SURF - Y_BOT);
  return [x, y];
}
function w2g(wx, wy) {
  const i = Math.round((wx / (2 * BR * 0.82) + 0.5) * N);
  const j = J_WATER + Math.round((Y_SURF - wy) / Math.max(0.001, Y_SURF - Y_BOT) * (N - J_WATER));
  return [Math.max(1, Math.min(N, i)), Math.max(1, Math.min(N, j))];
}

// T_norm 0-1 → [r,g,b] (cool=#0044ff → mid=#ffdd00 → warm=#ff8800 → hot=#ff2200)
function tempColor(T) {
  if (T < 0.4) {
    const s = T / 0.4;
    return [s, 0.267 + s * 0.600, 1.0 - s];
  } else if (T < 0.7) {
    const s = (T - 0.4) / 0.3;
    return [1.0, 0.867 - s * 0.334, 0];
  } else {
    const s = (T - 0.7) / 0.3;
    return [1.0, 0.533 - s * 0.400, 0];
  }
}

export class BeakerViewer3D {
  constructor(canvas) {
    const W = Math.round(window.innerWidth * 0.5);
    const H = Math.round(window.innerHeight * 0.85);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(W, H, false);
    this.renderer.setClearColor(0x03030f, 1);
    this.renderer.shadowMap.enabled = false;

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(44, W / H, 0.1, 80);
    this.camera.position.set(0, 0.9, 4.8);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.autoRotate      = true;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.enableDamping   = true;
    this.controls.dampingFactor   = 0.06;
    this.controls.minDistance     = 2.8;
    this.controls.maxDistance     = 9;
    this.controls.enablePan       = false;

    this._ripples   = [];
    this._waveT     = 0;
    this._dropState = null; // { progress, nx, landed }
    this._wasActive = false;

    this._lights();
    this._beaker();
    this._particles();
    this._dropSphere();

    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const W = Math.round(window.innerWidth * 0.5);
    const H = Math.round(window.innerHeight * 0.85);
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  _lights() {
    this.scene.add(new THREE.AmbientLight(0x10182a, 2.0));
    this.scene.add(new THREE.HemisphereLight(0x001144, 0x000000, 0.7));

    const p1 = new THREE.PointLight(0x00eedd, 2.6, 22);
    p1.position.set(2.4, 2.2, 2.2);
    this.scene.add(p1);

    const p2 = new THREE.PointLight(0x2233ff, 1.2, 16);
    p2.position.set(-2.2, -1.2, -2.2);
    this.scene.add(p2);

    this._innerLight = new THREE.PointLight(0x0055ff, 0.5, 4);
    this._innerLight.position.set(0, 0, 0);
    this.scene.add(this._innerLight);
  }

  _beaker() {
    // Glass shell — very transparent
    const glassMat = new THREE.MeshPhysicalMaterial({
      color:        0xaaccff,
      transparent:  true,
      opacity:      0.14,
      roughness:    0.04,
      metalness:    0.05,
      transmission: 0.88,
      side:         THREE.DoubleSide,
      depthWrite:   false,
    });
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(BR * 1.06, BR, BH, 48, 1, true),
      glassMat);
    this.scene.add(shell);

    // Bottom
    const bot = new THREE.Mesh(new THREE.CircleGeometry(BR, 48), glassMat);
    bot.rotation.x = -Math.PI / 2;
    bot.position.y = -BH / 2;
    this.scene.add(bot);

    // Top rim torus
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(BR * 1.06, 0.03, 8, 48),
      new THREE.MeshStandardMaterial({ color: 0x88ccee, roughness: 0.18, metalness: 0.45 }));
    rim.position.y = BH / 2;
    this.scene.add(rim);

    // Wireframe overlay (cyan edges, sparse)
    const wireGeo = new THREE.CylinderGeometry(BR * 1.06, BR, BH, 14, 3, true);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00ffcc, wireframe: true, transparent: true, opacity: 0.10 });
    this.scene.add(new THREE.Mesh(wireGeo, wireMat));

    // Horizontal edge rings (tick marks)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.22 });
    for (let k = 1; k <= 4; k++) {
      const ty = Y_BOT + (k / 4.8) * (Y_SURF - Y_BOT);
      const pts = [];
      for (let a = 0; a <= 64; a++) {
        const ang = (a / 64) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(ang) * BR * 1.065, ty, Math.sin(ang) * BR * 1.065));
      }
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));

      // short tick mark
      const tkMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.30 });
      const tkPts = [
        new THREE.Vector3(BR * 1.065, ty, 0),
        new THREE.Vector3(BR * 1.22,  ty, 0),
      ];
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(tkPts), tkMat));
    }

    // Water body
    const waterH = BH * (1 - WATER_SURFACE_FRAC) - 0.06;
    this.waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x041218, transparent: true, opacity: 0.70, roughness: 0.25 });
    const waterBody = new THREE.Mesh(
      new THREE.CylinderGeometry(BR * 0.97, BR * 0.95, waterH, 48),
      this.waterMat);
    waterBody.position.y = Y_SURF - waterH / 2;
    this.scene.add(waterBody);

    // Animated water surface
    this.surfGeo = new THREE.PlaneGeometry(BR * 2 * 0.96, BR * 2 * 0.96, 28, 28);
    this.surfMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a4466, transparent: true, opacity: 0.42,
      roughness: 0.12, metalness: 0.22 });
    this.surfMesh = new THREE.Mesh(this.surfGeo, this.surfMat);
    this.surfMesh.rotation.x = -Math.PI / 2;
    this.surfMesh.position.y = Y_SURF;
    this.scene.add(this.surfMesh);

    // Gloss highlight
    const glossMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 });
    const glossPts = [
      new THREE.Vector3(-BR * 0.90, BH * 0.44, BR * 0.24),
      new THREE.Vector3(-BR * 0.86, -BH * 0.38, BR * 0.20),
    ];
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(glossPts), glossMat));
  }

  _particles() {
    const pos = new Float32Array(PC * 3);
    const col = new Float32Array(PC * 3);

    // Scatter particles randomly inside the beaker (below surface)
    for (let p = 0; p < PC; p++) {
      const angle = Math.random() * Math.PI * 2;
      const r     = Math.sqrt(Math.random()) * BR * 0.88;
      const yy    = Y_BOT + Math.random() * (Y_SURF - Y_BOT);
      pos[p*3]   = Math.cos(angle) * r;
      pos[p*3+1] = yy;
      pos[p*3+2] = Math.sin(angle) * r;
      col[p*3] = 0.04; col[p*3+1] = 0.05; col[p*3+2] = 0.18;
    }

    this.pPos = pos;
    this.pVel = new Float32Array(PC * 3);

    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute('position',
      new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute('color',
      new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));

    this.pMat = new THREE.PointsMaterial({
      size: 0.058, vertexColors: true,
      transparent: true, opacity: 0.88,
      depthWrite: false, blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.pMesh = new THREE.Points(this.pGeo, this.pMat);
    this.scene.add(this.pMesh);
  }

  _dropSphere() {
    this.dropMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.10, 16, 12),
      new THREE.MeshPhysicalMaterial({
        color: 0x180636, emissive: 0x2a0050, emissiveIntensity: 0.7,
        transparent: true, opacity: 0.94 }));
    this.dropMesh.visible = false;
    this.scene.add(this.dropMesh);
  }

  // Called by main.js when a drop should start falling
  startDrop(nx = 0.5) {
    if (this._dropState && !this._dropState.landed) return;
    this._dropState = { nx, progress: 0, landed: false };
    this.dropMesh.visible = true;
  }

  // Called by main.js when the drop has been committed to the simulation
  notifyDropLanded() {
    this._spawnRipples();
    if (this._dropState) this._dropState.landed = true;
    this.dropMesh.visible = false;
  }

  _spawnRipples() {
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x44aaff, transparent: true, opacity: 0.75,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.01, 0.035, 40), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = Y_SURF + 0.012;
      if (this._dropState) {
        mesh.position.x = (this._dropState.nx - 0.5) * 2 * BR * 0.82;
      }
      this.scene.add(mesh);
      this._ripples.push({ mesh, scale: 0.1, delay: i * 7 });
    }
  }

  update(sim, dropAnim, timeScale) {
    this._waveT += 0.018;

    // Water surface wave animation
    const posArr = this.surfGeo.attributes.position.array;
    const vCount = this.surfGeo.attributes.position.count;
    for (let v = 0; v < vCount; v++) {
      const vx = posArr[v*3], vz = posArr[v*3+2];
      posArr[v*3+1] = Math.sin(vx*2.4 + this._waveT) * 0.011
                    + Math.sin(vz*3.2 + this._waveT * 1.35) * 0.007;
    }
    this.surfGeo.attributes.position.needsUpdate = true;

    // Water colour tints toward ink
    const stats = sim.getStats(0);
    const inkAmt = Math.min(1, stats.inkCoverage / 18);
    this.waterMat.color.setRGB(
      0.04 + inkAmt * 0.07,
      0.07 + inkAmt * 0.02,
      0.12 + inkAmt * 0.04);
    this._innerLight.intensity = 0.3 + inkAmt * 0.9;

    // Drop sphere animation
    if (this._dropState && !this._dropState.landed) {
      this._dropState.progress = Math.min(1, this._dropState.progress + 0.028);
      const wx = (this._dropState.nx - 0.5) * 2 * BR * 0.82;
      const wy = Y_SURF + (1 - this._dropState.progress) * BH * 0.48;
      this.dropMesh.position.set(wx, wy, 0);
    }

    // Ripple animation
    this._ripples = this._ripples.filter(r => {
      if (r.delay > 0) { r.delay--; return true; }
      r.scale += 0.045;
      r.mesh.scale.setScalar(r.scale);
      r.mesh.material.opacity = Math.max(0, 0.75 - r.scale * 0.46);
      if (r.mesh.material.opacity <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        return false;
      }
      return true;
    });

    // Particle update — temperature colour + fluid velocity
    const vxArr  = sim.fluid.vx;
    const vyArr  = sim.fluid.vy;
    const inkArr = sim.ink.C;
    const tmpArr = sim.heat.T;
    const P = this.pPos;
    const V = this.pVel;
    const col = this.pGeo.attributes.color.array;

    for (let p = 0; p < PC; p++) {
      const [si, sj] = w2g(P[p*3], P[p*3+1]);
      const gid = idx(si, sj);

      const c  = inkArr[gid] || 0;
      const T  = tmpArr[gid] || 0;
      const fvx = (vxArr[gid] || 0) * 0.18;
      const fvy = (vyArr[gid] || 0) * 0.18;

      // Velocity: fluid drag + Brownian noise
      const br = 0.003 + T * 0.004;
      V[p*3]   = V[p*3]   * 0.88 + fvx + (Math.random()-0.5)*br;
      V[p*3+1] = V[p*3+1] * 0.88 - fvy + (Math.random()-0.5)*br;
      V[p*3+2] = V[p*3+2] * 0.88       + (Math.random()-0.5)*br;

      P[p*3]   += V[p*3];
      P[p*3+1] += V[p*3+1];
      P[p*3+2] += V[p*3+2];

      // Keep inside cylinder
      const r2d = Math.hypot(P[p*3], P[p*3+2]);
      if (r2d > BR * 0.91) {
        const s = (BR * 0.91) / r2d;
        P[p*3] *= s; P[p*3+2] *= s;
        V[p*3] *= -0.22; V[p*3+2] *= -0.22;
      }
      if (P[p*3+1] > Y_SURF)      { P[p*3+1] = Y_SURF;      V[p*3+1] =  Math.abs(V[p*3+1]) * 0.18; }
      if (P[p*3+1] < Y_BOT + 0.02) { P[p*3+1] = Y_BOT + 0.02; V[p*3+1] = Math.abs(V[p*3+1]) * 0.18; }

      // Temperature colour × concentration brightness
      const [r, g, b] = tempColor(T);
      const bright = 0.06 + c * 0.94;
      col[p*3]   = r * bright;
      col[p*3+1] = g * bright;
      col[p*3+2] = b * bright;
    }

    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate    = true;
    this.pGeo.setDrawRange(0, PC);
  }

  // Spawn particles at a splash point (world x, y)
  spawnAt(wx, wy, count = 300) {
    let n = 0;
    for (let p = 0; p < PC && n < count; p++) {
      // Pick parked or buried particles (below beaker floor)
      if (this.pPos[p*3+1] > Y_SURF + 0.5) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.16;
        this.pPos[p*3]   = wx + Math.cos(a) * r;
        this.pPos[p*3+1] = wy - Math.random() * 0.10;
        this.pPos[p*3+2] = Math.sin(a) * r;
        this.pVel[p*3]   = (Math.random()-0.5) * 0.08;
        this.pVel[p*3+1] = -0.03 - Math.random() * 0.08;
        this.pVel[p*3+2] = (Math.random()-0.5) * 0.08;
        n++;
      }
    }
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() { this.renderer.dispose(); }
}
