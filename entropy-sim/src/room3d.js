// Room 3D — infrared gas diffusion — three@0.128.0, canvas dimensions set as HTML attributes
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/controls/OrbitControls.js';

const ROOM_W = 8.0;
const ROOM_H = 3.4;
const ROOM_D = 8.0;

function wallEdgeAvg(C, GN, wall) {
  let s = 0;
  if (wall === 0)      for (let j = 0; j < GN; j++) s += C[0       + j * GN];
  else if (wall === 1) for (let j = 0; j < GN; j++) s += C[(GN-1)  + j * GN];
  else if (wall === 2) for (let i = 0; i < GN; i++) s += C[i];
  else                 for (let i = 0; i < GN; i++) s += C[i + (GN-1) * GN];
  return s / GN;
}

export class RoomViewer3D {
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
    this.camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 80);
    this.camera.position.set(0, 3.2, 7.0);
    this.camera.lookAt(0, 1.0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.autoRotate      = true;
    this.controls.autoRotateSpeed = 0.28;
    this.controls.enableDamping   = true;
    this.controls.dampingFactor   = 0.06;
    this.controls.target.set(0, 1.0, 0);
    this.controls.minDistance     = 3;
    this.controls.maxDistance     = 14;
    this.controls.maxPolarAngle   = Math.PI * 0.58;
    this.controls.enablePan       = false;

    // 80×80 canvas texture — matches GasRoom grid
    this._fogCanvas        = document.createElement('canvas');
    this._fogCanvas.width  = 80;
    this._fogCanvas.height = 80;
    this._fogCtx = this._fogCanvas.getContext('2d');
    this._fogTex = new THREE.CanvasTexture(this._fogCanvas);

    this._pulseT = 0;

    this._buildLights();
    this._buildRoom();
    this._buildFogPlanes();
    this._buildBeaker();

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

  _buildLights() {
    // Dim ambient — just enough to show wireframe against black
    this.scene.add(new THREE.AmbientLight(0x111111, 1.0));

    // Warm orange source above beaker — driven by concentration
    this._srcLight = new THREE.PointLight(0xff6600, 1.2, 6.0);
    this._srcLight.position.set(0, 0.9, 0);
    this.scene.add(this._srcLight);

    // Cool corner fill for depth
    const fill = new THREE.PointLight(0x334466, 0.5, 16);
    fill.position.set(-3.5, 3.0, -3.5);
    this.scene.add(fill);
  }

  _buildRoom() {
    const wm = () => new THREE.MeshBasicMaterial({
      color: 0xffffff, wireframe: true, transparent: true, opacity: 0.38,
    });

    // Floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D, 16, 16), wm());
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Ceiling
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D, 6, 6), wm());
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = ROOM_H;
    this.scene.add(ceil);

    // Four walls + glow overlay per wall
    const wallDefs = [
      [[0, ROOM_H/2, -ROOM_D/2], 0,           ROOM_W],
      [[0, ROOM_H/2,  ROOM_D/2], Math.PI,      ROOM_W],
      [[-ROOM_W/2, ROOM_H/2, 0], Math.PI/2,   ROOM_D],
      [[ ROOM_W/2, ROOM_H/2, 0], -Math.PI/2,  ROOM_D],
    ];

    this._wallGlowMats = [];
    for (const [[px, py, pz], ry, dim] of wallDefs) {
      // Wireframe wall
      const wf = new THREE.Mesh(new THREE.PlaneGeometry(dim, ROOM_H, 10, 5), wm());
      wf.position.set(px, py, pz);
      wf.rotation.y = ry;
      this.scene.add(wf);

      // Glow overlay — colour driven by gas reaching that wall
      const gm = new THREE.MeshBasicMaterial({
        color: 0xff4400, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.FrontSide,
      });
      const gw = new THREE.Mesh(new THREE.PlaneGeometry(dim, ROOM_H), gm);
      // Offset slightly inward to prevent z-fighting with wireframe
      const off = 0.03;
      gw.position.set(
        px + (ry ===  Math.PI/2 ?  off : ry === -Math.PI/2 ? -off : 0),
        py,
        pz + (ry === 0          ?  off : ry ===  Math.PI   ? -off : 0),
      );
      gw.rotation.y = ry;
      this.scene.add(gw);
      this._wallGlowMats.push(gm);
    }
  }

  _buildFogPlanes() {
    // 8 horizontal planes — denser near floor where gas accumulates
    const heights   = [0.08, 0.30, 0.56, 0.86, 1.18, 1.55, 2.00, 2.55];
    const opacities = [0.85, 0.75, 0.62, 0.50, 0.36, 0.22, 0.12, 0.06];

    this._fogMats = [];
    for (let k = 0; k < heights.length; k++) {
      const mat = new THREE.MeshBasicMaterial({
        map:         this._fogTex,
        transparent: true,
        opacity:     opacities[k],
        depthWrite:  false,
        blending:    THREE.AdditiveBlending,
        side:        THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = heights[k];
      this.scene.add(mesh);
      this._fogMats.push(mat);
    }
  }

  _buildBeaker() {
    // Plain white emissive cylinder — NO ring/halo geometry (causes green artefacts)
    this._beakerMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.20, 0.16, 0.48, 24),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6,
        roughness: 0.3, metalness: 0.0,
      }),
    );
    this._beakerMesh.position.set(0, 0.24, 0);
    this.scene.add(this._beakerMesh);
  }

  // Maps GasRoom.C → infrared RGBA → CanvasTexture (called every frame)
  // amp = sqrt(c × 600): amplifies tiny concentration values (0.0001–0.01) → 0…1
  // Colour ramp: black → dark-red → red → orange → yellow → bright yellow
  _updateFogTexture(gasRoom) {
    const GN  = gasRoom.N;
    const C   = gasRoom.C;
    const ctx = this._fogCtx;
    const img = ctx.createImageData(GN, GN);
    const d   = img.data;

    for (let j = 0; j < GN; j++) {
      for (let i = 0; i < GN; i++) {
        const c  = C[i + j * GN];
        const pi = (j * GN + i) * 4;

        if (c < 5e-7) { d[pi+3] = 0; continue; }

        const amp = Math.min(1.0, Math.sqrt(c * 600));

        let r, g, b, a;
        if (amp < 0.10) {
          const s = amp / 0.10;
          r = Math.round(140 * s); g = 0; b = 0;
          a = Math.round(100 * s);
        } else if (amp < 0.38) {
          const s = (amp - 0.10) / 0.28;
          r = Math.round(140 + 115 * s); g = Math.round(34 * s); b = 0;
          a = Math.round(100 + 110 * s);
        } else if (amp < 0.65) {
          const s = (amp - 0.38) / 0.27;
          r = 255; g = Math.round(34 + 102 * s); b = 0;
          a = Math.round(210 + 20 * s);
        } else if (amp < 0.88) {
          const s = (amp - 0.65) / 0.23;
          r = 255; g = Math.round(136 + 85 * s); b = 0;
          a = 230;
        } else {
          const s = (amp - 0.88) / 0.12;
          r = 255; g = Math.round(221 + 34 * s); b = Math.round(80 * s);
          a = 235;
        }

        d[pi] = r; d[pi+1] = g; d[pi+2] = b; d[pi+3] = a;
      }
    }

    ctx.putImageData(img, 0, 0);
    this._fogTex.needsUpdate = true;
  }

  update(gasRoom) {
    this._pulseT += 0.04;

    const GN  = gasRoom.N;
    const mid = Math.floor(GN / 2);
    const centreC = Math.min(1, Math.sqrt(gasRoom.C[mid + mid * GN] * 600));

    // Source light intensifies and shifts orange→yellow as gas builds up
    this._srcLight.intensity = 0.8 + centreC * 4.0;
    this._srcLight.color.setRGB(1.0, 0.40 - centreC * 0.20, 0.0);

    // Beaker pulses white
    this._beakerMesh.material.emissiveIntensity =
      0.5 + 0.15 * Math.sin(this._pulseT) + centreC * 1.5;

    // Wall glow when gas reaches edges
    const wallC = [
      wallEdgeAvg(gasRoom.C, GN, 0),
      wallEdgeAvg(gasRoom.C, GN, 1),
      wallEdgeAvg(gasRoom.C, GN, 2),
      wallEdgeAvg(gasRoom.C, GN, 3),
    ];
    for (let w = 0; w < 4; w++) {
      const amp = Math.min(1, Math.sqrt(wallC[w] * 600));
      const mat = this._wallGlowMats[w];
      if (amp > 0.02) {
        mat.color.setRGB(1.0, amp * 0.40, 0);
        mat.opacity = 0.08 + amp * 0.50;
      } else {
        mat.opacity = 0;
      }
    }

    this._updateFogTexture(gasRoom);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() { this.renderer.dispose(); }
}
