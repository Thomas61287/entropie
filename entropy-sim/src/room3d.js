// 3D Room — cinematic gas diffusion scene
// Wireframe room + volumetric fog planes + infrared colour mapping + wall glow
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
    this.renderer.setSize(W, H, false);
    this.renderer.setClearColor(0x02020c, 1);

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
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  _lights() {
    this.scene.add(new THREE.AmbientLight(0x080812, 2.5));
    this.scene.add(new THREE.HemisphereLight(0x080820, 0x000000, 0.5));

    const corner = new THREE.PointLight(0x0022aa, 0.6, 12);
    corner.position.set(-3.5, 2.8, -3.5);
    this.scene.add(corner);

    this._srcLight = new THREE.PointLight(0x0044ff, 0.4, 5);
    this._srcLight.position.set(0, 0.5, 0);
    this.scene.add(this._srcLight);

    // Ceiling fill
    const ceil = new THREE.PointLight(0x111133, 0.3, 10);
    ceil.position.set(0, ROOM_H - 0.2, 0);
    this.scene.add(ceil);
  }

  _room() {
    const wireMat = () => new THREE.MeshBasicMaterial({
      color: 0x1a2a44, wireframe: true, transparent: true, opacity: 0.55 });

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
      // [pos, rotY]
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
    // Stacked horizontal planes — share one fog texture
    // Denser near floor, sparser near ceiling
    const heights  = [0.06, 0.38, 0.72, 1.08, 1.50, 2.05];
    const opacities = [0.24, 0.20, 0.16, 0.12, 0.08, 0.05];

    this._fogPlanes = [];
    for (let k = 0; k < heights.length; k++) {
      const mat = new THREE.MeshBasicMaterial({
        map:        this._fogTex,
        transparent: true,
        opacity:    opacities[k],
        depthWrite: false,
        blending:   THREE.AdditiveBlending,
        side:       THREE.DoubleSide,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = heights[k];
      this.scene.add(plane);
      this._fogPlanes.push(plane);
    }
  }

  _source() {
    // Glowing beaker / ink source in center
    const beakerMat = new THREE.MeshStandardMaterial({
      color: 0x0a1528, emissive: 0x001844, emissiveIntensity: 1.2,
      transparent: true, opacity: 0.80, roughness: 0.35, metalness: 0.2,
    });
    const beakerMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.15, 0.42, 20),
      beakerMat);
    beakerMesh.position.set(0, 0.21, 0);
    this.scene.add(beakerMesh);

    // Pulsing halo ring at base
    this._haloMat = new THREE.MeshBasicMaterial({
      color: 0x0066ff, transparent: true, opacity: 0.30, side: THREE.DoubleSide });
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.38, 40), this._haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.005;
    this.scene.add(halo);
    this._halo = halo;
    this._haloT = 0;
  }

  _updateFogTexture(gasRoom) {
    const N   = gasRoom.N;
    const C   = gasRoom.C;
    const ctx = this._fogCtx;
    const img = ctx.createImageData(N, N);
    const d   = img.data;

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c  = Math.min(1, C[i + j * N]);
        const pi = (j * N + i) * 4;

        if (c < 0.005) {
          d[pi+3] = 0;
          continue;
        }

        let r, g, b, a;
        if (c < 0.18) {
          const s = c / 0.18;
          r = Math.round(220 * s); g = Math.round(50 * s * s); b = 0;
          a = Math.round(210 * s);
        } else if (c < 0.55) {
          const s = (c - 0.18) / 0.37;
          r = 220; g = Math.round(50 + 170 * s); b = 0;
          a = Math.round(210 + 25 * s);
        } else {
          const s = (c - 0.55) / 0.45;
          r = 255; g = Math.round(220 + 35 * s); b = Math.round(80 * s);
          a = 235;
        }

        d[pi] = r; d[pi+1] = g; d[pi+2] = b; d[pi+3] = a;
      }
    }

    ctx.putImageData(img, 0, 0);
    this._fogTex.needsUpdate = true;
  }

  update(gasRoom) {
    this._haloT += 0.04;

    // Pulsing halo around source
    const pulse = 0.20 + 0.12 * Math.sin(this._haloT);
    this._haloMat.opacity = pulse;
    const haloScale = 1.0 + 0.08 * Math.sin(this._haloT * 1.3);
    this._halo.scale.setScalar(haloScale);

    // Source light intensity tracks centre concentration
    const N   = gasRoom.N;
    const mid = Math.floor(N / 2);
    const centreC = Math.min(1, gasRoom.C[mid + mid * N] * 3);
    this._srcLight.intensity = 0.3 + centreC * 1.8;
    this._srcLight.color.setRGB(0.0 + centreC * 0.4, 0.2 + centreC * 0.3, 1.0);

    // Wall glow based on edge concentration
    const wallC = [
      wallEdgeAvg(gasRoom.C, N, 0), // left
      wallEdgeAvg(gasRoom.C, N, 1), // right
      wallEdgeAvg(gasRoom.C, N, 2), // front
      wallEdgeAvg(gasRoom.C, N, 3), // back
    ];
    for (let w = 0; w < 4; w++) {
      const c  = Math.min(1, wallC[w] * 12);
      const mat = this._wallMeshes[w].material;
      if (c > 0.005) {
        mat.color.setRGB(c * 1.0, c * 0.3, 0);
        mat.opacity = c * 0.22;
      } else {
        mat.opacity = 0;
      }
    }

    // Update fog texture
    this._updateFogTexture(gasRoom);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() { this.renderer.dispose(); }
}
