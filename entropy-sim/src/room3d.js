// 3D Room — cinematic gas diffusion scene
// Wireframe room + volumetric fog planes + infrared colour mapping + wall glow
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const ROOM_W = 8.0;
const ROOM_H = 3.4;
const ROOM_D = 8.0;

// GasRoom grid (i,j) → world (x, z)
function g2room(i, j, N) {
  return [
    (i / N - 0.5) * ROOM_W,
    (j / N - 0.5) * ROOM_D,
  ];
}

// Average concentration along a wall edge
function wallEdgeAvg(C, N, wall) {
  let s = 0;
  if (wall === 0)      for (let j = 0; j < N; j++) s += C[0       + j * N];
  else if (wall === 1) for (let j = 0; j < N; j++) s += C[(N - 1) + j * N];
  else if (wall === 2) for (let i = 0; i < N; i++) s += C[i       + 0 * N];
  else                 for (let i = 0; i < N; i++) s += C[i       + (N - 1) * N];
  return s / N;
}

export class RoomViewer3D {
  constructor(canvas) {
    const W = Math.round(window.innerWidth * 0.5);
    const H = Math.round(window.innerHeight * 0.85);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(W, H);
    this.renderer.setClearColor(0x000000, 1);

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 80);
    this.camera.position.set(0, 3.0, 6.8);
    this.camera.lookAt(0, 1.2, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.autoRotate      = true;
    this.controls.autoRotateSpeed = 0.30;
    this.controls.enableDamping   = true;
    this.controls.dampingFactor   = 0.06;
    this.controls.minDistance     = 3;
    this.controls.maxDistance     = 14;
    this.controls.maxPolarAngle   = Math.PI * 0.58;
    this.controls.enablePan       = false;
    this.controls.target.set(0, 1.2, 0);

    // Fog canvas texture (updated each frame)
    this._fogCanvas = document.createElement('canvas');
    this._fogCanvas.width  = 80;
    this._fogCanvas.height = 80;
    this._fogCtx = this._fogCanvas.getContext('2d');
    this._fogTex = new THREE.CanvasTexture(this._fogCanvas);
    this._fogTex.flipY = false; // match gasroom grid orientation

    this._lights();
    this._room();
    this._fogPlanes();
    this._source();

    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const W = Math.round(window.innerWidth * 0.5);
    const H = Math.round(window.innerHeight * 0.85);
    this.renderer.setSize(W, H);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  _lights() {
    // Very dark ambient so infrared glow stands out
    this.scene.add(new THREE.AmbientLight(0x06060a, 2.0));

    // Warm source light at centre — colour updated each frame in update()
    this._srcLight = new THREE.PointLight(0xff4400, 0.6, 7);
    this._srcLight.position.set(0, 0.6, 0);
    this.scene.add(this._srcLight);

    // Dim cool fill from one corner so wireframe is readable
    const fill = new THREE.PointLight(0x0a1830, 0.4, 14);
    fill.position.set(-3.5, 2.8, -3.5);
    this.scene.add(fill);
  }

  _room() {
    // White wireframe at 40% opacity so room shape is clearly visible on black bg
    const wireMat = () => new THREE.MeshBasicMaterial({
      color: 0xffffff, wireframe: true, transparent: true, opacity: 0.40 });

    // Floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D, 16, 16), wireMat());
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    this.scene.add(floor);

    // Ceiling
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D, 6, 6), wireMat());
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = ROOM_H;
    this.scene.add(ceiling);

    // 4 Walls
    const wallDefs = [
      [[0, ROOM_H/2, -ROOM_D/2],  0],
      [[0, ROOM_H/2,  ROOM_D/2],  Math.PI],
      [[-ROOM_W/2, ROOM_H/2, 0],  Math.PI/2],
      [[ ROOM_W/2, ROOM_H/2, 0], -Math.PI/2],
    ];

    this._wallMeshes = [];
    for (const [pos, rotY] of wallDefs) {
      // Wireframe structural wall
      const wm = wireMat();
      const wireWall = new THREE.Mesh(
        new THREE.PlaneGeometry(pos[2] !== 0 ? ROOM_W : ROOM_D, ROOM_H, 10, 6), wm);
      wireWall.position.set(...pos);
      wireWall.rotation.y = rotY;
      this.scene.add(wireWall);

      // Solid glow layer (changes colour on gas contact)
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.FrontSide,
      });
      const glowWall = new THREE.Mesh(
        new THREE.PlaneGeometry(pos[2] !== 0 ? ROOM_W : ROOM_D, ROOM_H), glowMat);
      glowWall.position.set(...pos);
      glowWall.position.x += (rotY === Math.PI/2 ? 0.02 : rotY === -Math.PI/2 ? -0.02 : 0);
      glowWall.position.z += (rotY === 0 ? 0.02 : rotY === Math.PI ? -0.02 : 0);
      glowWall.rotation.y = rotY;
      this.scene.add(glowWall);
      this._wallMeshes.push(glowWall);
    }
  }

  _fogPlanes() {
    // Stacked horizontal planes — shared warm fog texture
    // More planes, higher opacity so heat is clearly visible
    const heights   = [0.04, 0.28, 0.55, 0.85, 1.20, 1.62, 2.10];
    const opacities = [0.75, 0.65, 0.55, 0.42, 0.28, 0.16, 0.08];

    this._fogPlaneMats = [];
    for (let k = 0; k < heights.length; k++) {
      const mat = new THREE.MeshBasicMaterial({
        map:         this._fogTex,
        transparent: true,
        opacity:     opacities[k],
        depthWrite:  false,
        blending:    THREE.AdditiveBlending,
        side:        THREE.DoubleSide,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = heights[k];
      this.scene.add(plane);
      this._fogPlaneMats.push(mat);
    }
  }

  _source() {
    // Glowing beaker — warm dark orange when idle, brightens as gas fills room
    this._beakerMat = new THREE.MeshStandardMaterial({
      color: 0x1a0800, emissive: 0x881400, emissiveIntensity: 1.0,
      transparent: true, opacity: 0.85, roughness: 0.30, metalness: 0.15,
    });
    const beakerMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.15, 0.42, 20),
      this._beakerMat);
    beakerMesh.position.set(0, 0.21, 0);
    this.scene.add(beakerMesh);

    // Pulsing halo — warm orange
    this._haloMat = new THREE.MeshBasicMaterial({
      color: 0xff4400, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.42, 48), this._haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.005;
    this.scene.add(halo);
    this._halo = halo;
    this._haloT = 0;
  }

  _updateFogTexture(gasRoom) {
    const GN  = gasRoom.N;
    const C   = gasRoom.C;
    const ctx = this._fogCtx;
    const img = ctx.createImageData(GN, GN);
    const d   = img.data;

    // Amplify: sqrt(c * 400) maps tiny GasRoom values to visible 0-1 range.
    // After 20x source fix: c≈0.001 near center → amp≈0.63 (clearly visible orange).
    // Color thresholds applied to amplified value:
    //   amp > 0.7  → #ff4400 bright red-orange, opacity 0.8
    //   amp 0.35-0.7 → #ff8800 orange
    //   amp 0.1-0.35 → #ffaa00 yellow-orange
    //   amp < 0.1  → fade to invisible

    for (let j = 0; j < GN; j++) {
      for (let i = 0; i < GN; i++) {
        const c  = C[i + j * GN];
        const pi = (j * GN + i) * 4;

        if (c < 1e-6) { d[pi + 3] = 0; continue; }

        const amp = Math.min(1, Math.sqrt(c * 400));

        let r, g, b, a;
        if (amp < 0.08) {
          // Barely a trace — very dim dark red
          const s = amp / 0.08;
          r = Math.round(120 * s); g = 0; b = 0;
          a = Math.round(60 * s);
        } else if (amp < 0.35) {
          // Dark red → #ffaa00 yellow-orange
          const s = (amp - 0.08) / 0.27;
          r = 255; g = Math.round(80 + 90 * s); b = 0;
          a = Math.round(140 + 80 * s);
        } else if (amp < 0.70) {
          // #ffaa00 → #ff8800 orange (fully opaque)
          const s = (amp - 0.35) / 0.35;
          r = 255; g = Math.round(170 - 34 * s); b = 0;
          a = Math.round(220 + 10 * s);
        } else {
          // #ff8800 → #ff4400 bright red-orange at core
          const s = (amp - 0.70) / 0.30;
          r = 255; g = Math.round(136 - 68 * s); b = 0;
          a = 230;
        }

        d[pi] = r; d[pi + 1] = g; d[pi + 2] = b; d[pi + 3] = a;
      }
    }

    ctx.putImageData(img, 0, 0);
    this._fogTex.needsUpdate = true;
  }

  update(gasRoom) {
    this._haloT += 0.04;

    const GN  = gasRoom.N;
    const mid = Math.floor(GN / 2);

    // Centre concentration — amplify same way as fog texture
    const centreC = Math.min(1, Math.sqrt(gasRoom.C[mid + mid * GN] * 400));

    // Total gas in room (normalised) — drives ambient warming
    let totalC = 0;
    const len = GN * GN;
    for (let k = 0; k < len; k++) totalC += gasRoom.C[k];
    const roomFill = Math.min(1, Math.sqrt(totalC * 20)); // 0→1 as room fills

    // Pulsing warm halo
    const pulse = 0.25 + 0.18 * Math.sin(this._haloT);
    this._haloMat.opacity = Math.max(0.05, centreC * 0.6 + pulse * 0.25);
    this._halo.scale.setScalar(1.0 + 0.10 * Math.sin(this._haloT * 1.2) + centreC * 0.4);

    // Source light: always warm, brightens with concentration
    // idle = dim orange, hot = bright red-orange
    this._srcLight.intensity = 0.6 + centreC * 3.5;
    this._srcLight.color.setRGB(
      1.0,
      0.35 - centreC * 0.20,   // less green at high concentration → more red
      centreC < 0.1 ? 0.05 : 0,
    );

    // Beaker emissive brightens when gas is flowing
    if (this._beakerMat) {
      this._beakerMat.emissiveIntensity = 0.8 + centreC * 2.5;
    }

    // Background stays pure black — colours pop against it

    // Wall glow — amplify tiny edge concentrations (same 400x boost)
    const wallC = [
      wallEdgeAvg(gasRoom.C, GN, 0),
      wallEdgeAvg(gasRoom.C, GN, 1),
      wallEdgeAvg(gasRoom.C, GN, 2),
      wallEdgeAvg(gasRoom.C, GN, 3),
    ];
    for (let w = 0; w < 4; w++) {
      const amp = Math.min(1, Math.sqrt(wallC[w] * 400));
      const mat  = this._wallMeshes[w].material;
      if (amp > 0.02) {
        mat.color.setRGB(1.0, amp * 0.45, 0);   // orange-red, never pure dark
        mat.opacity = 0.10 + amp * 0.55;
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
