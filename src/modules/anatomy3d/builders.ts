import * as THREE from 'three';
import { getAnatomyModel, type AnatomyModelId } from './modelsData.ts';

export interface BuiltPartHandle {
  id: string;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  basePos: THREE.Vector3;
  explodeVec: THREE.Vector3;
  originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
}

export interface BuiltAnatomyModel {
  root: THREE.Group;
  parts: Map<string, BuiltPartHandle>;
  pickables: THREE.Mesh[];
  disposables: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; textures: THREE.Texture[] };
}

interface TextureSet {
  boneMap: THREE.CanvasTexture;
  muscleMap: THREE.CanvasTexture;
  cortexMap: THREE.CanvasTexture;
  membraneMap: THREE.CanvasTexture;
}

function createProceduralTexture(
  kind: 'bone' | 'muscle' | 'cortex' | 'membrane',
  maxAnisotropy: number
): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  if (kind === 'bone') {
    ctx.fillStyle = '#ebe3d3';
    ctx.fillRect(0, 0, size, size);
    // Subtle osteon/trabecular mottling
    for (let i = 0; i < 420; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const y = (Math.sin(i * 78.233) * 43758.5453) % 1;
      const px = Math.abs(x) * size;
      const py = Math.abs(y) * size;
      const r = 2 + (i % 7);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(182, 166, 140, 0.14)' : 'rgba(255, 250, 240, 0.22)';
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(165, 148, 122, 0.12)';
    ctx.lineWidth = 1;
    for (let y = 0; y < size; y += 9) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.33, y + 3, size * 0.66, y - 3, size, y);
      ctx.stroke();
    }
  } else if (kind === 'muscle') {
    ctx.fillStyle = '#a82834';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 3) {
      const shade = 135 + Math.round(Math.sin(y * 0.35) * 26);
      ctx.strokeStyle = `rgba(${shade}, 30, 42, 0.42)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + Math.sin(y * 0.1) * 4, size * 0.7, y - Math.cos(y * 0.1) * 4, size, y);
      ctx.stroke();
    }
    // Delicate subepicardial micro-vessels
    ctx.strokeStyle = 'rgba(225, 110, 125, 0.22)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 14; i++) {
      const sx = (i * 43) % size;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.quadraticCurveTo(sx + 18, size * 0.5, sx - 12, size);
      ctx.stroke();
    }
  } else if (kind === 'cortex') {
    ctx.fillStyle = '#dca59e';
    ctx.fillRect(0, 0, size, size);
    // Sulci & gyri folds
    for (let i = 0; i < 28; i++) {
      const y = (i / 28) * size;
      ctx.strokeStyle = 'rgba(128, 66, 68, 0.38)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 24) {
        ctx.lineTo(x, y + Math.sin(x * 0.08 + i * 1.1) * 9);
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(246, 206, 198, 0.35)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, y - 2.5);
      for (let x = 0; x <= size; x += 24) {
        ctx.lineTo(x, y - 2.5 + Math.sin(x * 0.08 + i * 1.1) * 9);
      }
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 180; i++) {
      const px = Math.abs((Math.sin(i * 19.3) * 9999) % 1) * size;
      const py = Math.abs((Math.cos(i * 41.7) * 9999) % 1) * size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(14,116,144,0.22)';
      ctx.beginPath();
      ctx.arc(px, py, 3 + (i % 5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.max(1, maxAnisotropy);
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(2, 6, 23, 0.55)');
  grad.addColorStop(0.55, 'rgba(2, 6, 23, 0.22)');
  grad.addColorStop(1, 'rgba(2, 6, 23, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePartBuilder(modelId: AnatomyModelId) {
  const spec = getAnatomyModel(modelId);
  const root = new THREE.Group();
  const parts = new Map<string, BuiltPartHandle>();
  const pickables: THREE.Mesh[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  const ensurePart = (partId: string): BuiltPartHandle => {
    const existing = parts.get(partId);
    if (existing) return existing;
    const partSpec = spec.parts.find((p) => p.id === partId);
    const grp = new THREE.Group();
    grp.name = `part_${partId}`;
    grp.userData.partId = partId;
    root.add(grp);
    const handle: BuiltPartHandle = {
      id: partId,
      group: grp,
      meshes: [],
      basePos: new THREE.Vector3(),
      explodeVec: new THREE.Vector3(...(partSpec?.explodeVec || [0, 0, 0])),
      originalMaterials: new Map(),
    };
    parts.set(partId, handle);
    return handle;
  };

  const addMesh = (
    partId: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    opts?: {
      pos?: [number, number, number];
      rot?: [number, number, number];
      scale?: [number, number, number];
      castShadow?: boolean;
      receiveShadow?: boolean;
      renderOrder?: number;
    }
  ): THREE.Mesh => {
    trackGeo(geometry);
    if (!materials.includes(material)) trackMat(material);
    const handle = ensurePart(partId);
    const mesh = new THREE.Mesh(geometry, material);
    if (opts?.pos) mesh.position.set(...opts.pos);
    if (opts?.rot) mesh.rotation.set(...opts.rot);
    if (opts?.scale) mesh.scale.set(...opts.scale);
    mesh.castShadow = opts?.castShadow ?? true;
    mesh.receiveShadow = opts?.receiveShadow ?? true;
    if (typeof opts?.renderOrder === 'number') mesh.renderOrder = opts.renderOrder;
    mesh.userData.partId = partId;
    // Enable layer 1 for high-performance raycasting
    mesh.layers.enable(1);
    handle.group.add(mesh);
    handle.meshes.push(mesh);
    handle.originalMaterials.set(mesh, material);
    pickables.push(mesh);
    return mesh;
  };

  return {
    root,
    parts,
    pickables,
    trackGeo,
    trackMat,
    trackTex,
    addMesh,
    finalize(): BuiltAnatomyModel {
      parts.forEach((h) => h.basePos.copy(h.group.position));
      return {
        root,
        parts,
        pickables,
        disposables: { geometries, materials, textures },
      };
    },
  };
}

function sculptGyri(geo: THREE.BufferGeometry, amp = 0.055, freq = 6.5): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    const wave =
      Math.sin(v.x * freq + Math.cos(v.z * freq * 0.9)) *
      Math.cos(v.y * freq * 1.15 + Math.sin(v.x * freq * 0.7));
    v.addScaledVector(n, wave * amp);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildCellModel(tex: TextureSet, isSoftwareGl: boolean): BuiltAnatomyModel {
  const b = makePartBuilder('cell');

  // 1. Plasma Membrane — translucent cutaway dome + lipid bilayer rim
  const membraneShellMat = new THREE.MeshPhysicalMaterial({
    color: 0x38bdf8,
    map: tex.membraneMap,
    roughness: 0.22,
    metalness: 0.02,
    clearcoat: 0.85,
    clearcoatRoughness: 0.18,
    transparent: true,
    opacity: isSoftwareGl ? 0.24 : 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Cutaway back hemisphere (phiStart, phiLength) so organelles inside are crisp & immediately visible
  const outerDome = new THREE.SphereGeometry(1.82, 44, 32, Math.PI * 0.15, Math.PI * 1.7, 0.15, Math.PI * 0.88);
  b.addMesh('membrane', outerDome, membraneShellMat, {
    rot: [0.15, Math.PI * 0.65, 0],
    castShadow: false,
    receiveShadow: false,
    renderOrder: 5,
  });

  // Cytoplasmic rim ring (phospholipid bilayer cross-section edge)
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    roughness: 0.38,
    metalness: 0.12,
  });
  b.addMesh('membrane', new THREE.TorusGeometry(1.81, 0.055, 16, 64), rimMat, {
    rot: [Math.PI / 2, 0.18, 0],
    pos: [0, -0.08, 0],
  });

  // 2. Nucleus + Nuclear Pores + Nucleolus (cutaway)
  const nucEnvMat = new THREE.MeshPhysicalMaterial({
    color: 0x6366f1,
    roughness: 0.34,
    metalness: 0.05,
    clearcoat: 0.5,
  });
  const nucGeo = new THREE.SphereGeometry(0.68, 36, 28, Math.PI * 0.22, Math.PI * 1.56);
  b.addMesh('nucleus', nucGeo, nucEnvMat, { pos: [0, 0.12, -0.1], rot: [0.1, 0.4, 0] });

  const nucleolusMat = new THREE.MeshStandardMaterial({
    color: 0xc084fc,
    roughness: 0.55,
    metalness: 0.05,
    emissive: 0x3b0764,
    emissiveIntensity: 0.25,
  });
  b.addMesh('nucleus', new THREE.SphereGeometry(0.27, 24, 20), nucleolusMat, { pos: [0.02, 0.14, -0.02] });

  // Chromatin ring accent
  const poreMat = new THREE.MeshStandardMaterial({ color: 0xa5b4fc, roughness: 0.6 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 1.4 + 0.8;
    const phi = 0.7 + (i % 3) * 0.45;
    b.addMesh('nucleus', new THREE.TorusGeometry(0.055, 0.018, 8, 16), poreMat, {
      pos: [
        Math.sin(phi) * Math.cos(a) * 0.69,
        0.12 + Math.cos(phi) * 0.69,
        -0.1 + Math.sin(phi) * Math.sin(a) * 0.69,
      ],
      rot: [phi, a, 0],
    });
  }

  // 3. Mitochondria (2 detailed bean-shaped organelles with inner cristae)
  const mitoOuterMat = new THREE.MeshPhysicalMaterial({
    color: 0xea580c,
    roughness: 0.35,
    metalness: 0.04,
    clearcoat: 0.55,
  });
  const mitoCristaeMat = new THREE.MeshStandardMaterial({
    color: 0xfdba74,
    roughness: 0.65,
  });
  const addMito = (pos: [number, number, number], rot: [number, number, number], sc = 1) => {
    const outer = new THREE.CapsuleGeometry(0.22 * sc, 0.48 * sc, 12, 24);
    b.addMesh('mitochondrion', outer, mitoOuterMat, { pos, rot, scale: [1, 1, 0.72] });
    // Inner zigzag cristae tube
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 7; k++) {
      const t = (k / 6 - 0.5) * 0.54 * sc;
      pts.push(new THREE.Vector3((k % 2 === 0 ? 0.11 : -0.11) * sc, t, 0.15 * sc));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 32, 0.032 * sc, 8, false);
    b.addMesh('mitochondrion', tube, mitoCristaeMat, { pos, rot });
  };
  addMito([1.0, -0.25, 0.35], [0.25, -0.4, 0.65], 1.0);
  addMito([0.72, 0.72, 0.45], [-0.4, 0.5, -0.7], 0.78);

  // 4. Rough Endoplasmic Reticulum (concentric curved cisternae + studded ribosomes)
  const erMat = new THREE.MeshStandardMaterial({
    color: 0x0d9488,
    roughness: 0.52,
    metalness: 0.05,
  });
  const riboMat = new THREE.MeshStandardMaterial({
    color: 0x99f6e4,
    roughness: 0.25,
    metalness: 0.1,
  });
  for (let layer = 0; layer < 3; layer++) {
    const r = 0.88 + layer * 0.17;
    const arcGeo = new THREE.TorusGeometry(r, 0.055, 14, 36, Math.PI * 0.82);
    b.addMesh('er', arcGeo, erMat, {
      pos: [-0.08, 0.12, -0.05],
      rot: [0.35 + layer * 0.12, 0.2, Math.PI * 0.62],
      scale: [1, 1, 1.55],
    });
  }
  for (let rIdx = 0; rIdx < 10; rIdx++) {
    const ang = Math.PI * 0.75 + (rIdx / 10) * Math.PI * 0.72;
    const rad = 0.92 + (rIdx % 3) * 0.17;
    b.addMesh('er', new THREE.SphereGeometry(0.032, 10, 8), riboMat, {
      pos: [-0.08 + Math.cos(ang) * rad, 0.12 + Math.sin(ang) * rad * 0.82, 0.22 + (rIdx % 2) * 0.14],
    });
  }

  // 5. Golgi Apparatus (stacked crescent cisternae + budding secretory vesicles)
  const golgiMat = new THREE.MeshPhysicalMaterial({
    color: 0xf59e0b,
    roughness: 0.36,
    metalness: 0.04,
    clearcoat: 0.45,
  });
  for (let s = 0; s < 5; s++) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.44 + s * 0.03, -0.78 - s * 0.1, 0.42 + s * 0.06),
      new THREE.Vector3(0.05, -0.68 - s * 0.1, 0.62 + s * 0.07),
      new THREE.Vector3(0.5 - s * 0.03, -0.82 - s * 0.1, 0.4 + s * 0.05),
    ]);
    b.addMesh('golgi', new THREE.TubeGeometry(curve, 24, 0.044, 12, false), golgiMat);
  }
  // Secretory vesicles near trans face
  const vesPositions: [number, number, number][] = [
    [0.58, -0.96, 0.62],
    [0.42, -1.16, 0.78],
    [-0.48, -0.95, 0.66],
  ];
  vesPositions.forEach((p) => {
    b.addMesh('golgi', new THREE.SphereGeometry(0.075, 16, 12), golgiMat, { pos: p });
  });

  // 6. Lysosomes (acidic vesicles with dark rim)
  const lysoMat = new THREE.MeshPhysicalMaterial({
    color: 0xe11d48,
    roughness: 0.28,
    clearcoat: 0.65,
  });
  b.addMesh('lysosome', new THREE.SphereGeometry(0.24, 24, 20), lysoMat, { pos: [-0.95, -0.68, 0.45] });
  b.addMesh('lysosome', new THREE.SphereGeometry(0.16, 20, 16), lysoMat, { pos: [-0.62, -0.92, 0.65] });

  // 7. Peroxisomes (crystalline core inside sphere)
  const peroxMat = new THREE.MeshPhysicalMaterial({
    color: 0x10b981,
    roughness: 0.3,
    clearcoat: 0.55,
  });
  const peroxCoreMat = new THREE.MeshStandardMaterial({ color: 0xa7f3d0, roughness: 0.7 });
  b.addMesh('peroxisome', new THREE.SphereGeometry(0.19, 20, 16), peroxMat, { pos: [0.95, 0.52, -0.18] });
  b.addMesh('peroxisome', new THREE.OctahedronGeometry(0.11, 0), peroxCoreMat, { pos: [0.95, 0.52, -0.18] });
  b.addMesh('peroxisome', new THREE.SphereGeometry(0.14, 18, 14), peroxMat, { pos: [1.18, 0.2, 0.05] });

  // 8. Centrosome (orthogonal pair of 9-triplet barrel centrioles)
  const centMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    roughness: 0.42,
    metalness: 0.2,
  });
  b.addMesh('centrosome', new THREE.CylinderGeometry(0.085, 0.085, 0.34, 9, 1, true), centMat, {
    pos: [-0.32, 0.86, 0.64],
    rot: [0.2, 0.3, 0.35],
  });
  b.addMesh('centrosome', new THREE.CylinderGeometry(0.085, 0.085, 0.34, 9, 1, true), centMat, {
    pos: [-0.14, 0.78, 0.76],
    rot: [1.45, 0.2, -0.45],
  });

  return b.finalize();
}

function buildHeartModel(tex: TextureSet): BuiltAnatomyModel {
  const b = makePartBuilder('heart');

  const myocardiumMat = new THREE.MeshPhysicalMaterial({
    color: 0xb91c1c,
    map: tex.muscleMap,
    roughness: 0.38,
    metalness: 0.02,
    clearcoat: 0.55,
    clearcoatRoughness: 0.28,
  });
  const rightMyoMat = new THREE.MeshPhysicalMaterial({
    color: 0x991b1b,
    map: tex.muscleMap,
    roughness: 0.42,
    metalness: 0.02,
    clearcoat: 0.45,
  });
  const atriumLeftMat = new THREE.MeshPhysicalMaterial({
    color: 0xdc2626,
    roughness: 0.46,
    clearcoat: 0.35,
  });
  const atriumRightMat = new THREE.MeshPhysicalMaterial({
    color: 0x7f1d1d,
    roughness: 0.5,
    clearcoat: 0.3,
  });
  const aortaMat = new THREE.MeshPhysicalMaterial({
    color: 0xef4444,
    roughness: 0.34,
    clearcoat: 0.55,
  });
  const pulmMat = new THREE.MeshPhysicalMaterial({
    color: 0x4f46e5,
    roughness: 0.42,
    clearcoat: 0.4,
  });
  const venaMat = new THREE.MeshPhysicalMaterial({
    color: 0x2563eb,
    roughness: 0.48,
    clearcoat: 0.35,
  });
  const coronaryMat = new THREE.MeshStandardMaterial({
    color: 0xf87171,
    roughness: 0.28,
    metalness: 0.05,
    emissive: 0x7f1d1d,
    emissiveIntensity: 0.22,
  });

  // 1. Left Ventricle (thick muscular cone forming apex cordis)
  const lvPts = [
    new THREE.Vector2(0.01, -1.35),
    new THREE.Vector2(0.28, -1.1),
    new THREE.Vector2(0.58, -0.55),
    new THREE.Vector2(0.72, 0.05),
    new THREE.Vector2(0.56, 0.52),
    new THREE.Vector2(0.15, 0.65),
  ];
  const lvGeo = new THREE.LatheGeometry(lvPts, 32);
  b.addMesh('left_ventricle', lvGeo, myocardiumMat, {
    pos: [0.28, -0.15, -0.05],
    rot: [0.1, 0, -0.26],
    scale: [1.02, 1.05, 0.92],
  });

  // 2. Right Ventricle (anterior crescent wrapping left ventricle)
  const rvPts = [
    new THREE.Vector2(0.01, -0.95),
    new THREE.Vector2(0.32, -0.7),
    new THREE.Vector2(0.58, -0.15),
    new THREE.Vector2(0.56, 0.38),
    new THREE.Vector2(0.22, 0.58),
  ];
  const rvGeo = new THREE.LatheGeometry(rvPts, 30);
  b.addMesh('right_ventricle', rvGeo, rightMyoMat, {
    pos: [-0.34, -0.22, 0.22],
    rot: [0.14, 0.18, 0.16],
    scale: [0.95, 1.0, 0.78],
  });

  // 3. Right Atrium + Right Auricle
  b.addMesh('right_atrium', new THREE.SphereGeometry(0.52, 28, 22), atriumRightMat, {
    pos: [-0.72, 0.52, 0.05],
    scale: [0.92, 1.05, 0.85],
  });
  b.addMesh('right_atrium', new THREE.ConeGeometry(0.26, 0.52, 18), atriumRightMat, {
    pos: [-0.46, 0.66, 0.42],
    rot: [0.65, 0.2, -1.05],
  });

  // 4. Left Atrium + Pulmonary Veins
  b.addMesh('left_atrium', new THREE.SphereGeometry(0.48, 28, 22), atriumLeftMat, {
    pos: [0.46, 0.62, -0.42],
    scale: [1.05, 0.88, 0.85],
  });
  // Left & Right pulmonary veins stubs
  for (const [x, y] of [[0.92, 0.72], [0.92, 0.48], [-0.02, 0.7], [-0.02, 0.46]]) {
    b.addMesh('left_atrium', new THREE.CylinderGeometry(0.085, 0.095, 0.45, 14), atriumLeftMat, {
      pos: [x, y, -0.52],
      rot: [0, 0, Math.PI / 2],
    });
  }

  // 5. Aortic Arch + 3 Great Branches (Brachiocephalic, Left Common Carotid, Left Subclavian)
  const aortaCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.05, 0.42, 0.05),
    new THREE.Vector3(-0.18, 1.08, 0.12),
    new THREE.Vector3(0.08, 1.56, -0.05),
    new THREE.Vector3(0.46, 1.38, -0.45),
    new THREE.Vector3(0.35, 0.35, -0.78),
    new THREE.Vector3(0.25, -0.95, -0.72),
  ]);
  b.addMesh('aorta', new THREE.TubeGeometry(aortaCurve, 48, 0.21, 18, false), aortaMat);
  // 3 superior arch branches
  b.addMesh('aorta', new THREE.CylinderGeometry(0.085, 0.1, 0.58, 14), aortaMat, {
    pos: [-0.14, 1.78, 0.06],
    rot: [0, 0, 0.22],
  });
  b.addMesh('aorta', new THREE.CylinderGeometry(0.068, 0.08, 0.56, 14), aortaMat, {
    pos: [0.1, 1.84, -0.08],
    rot: [0, 0, 0.04],
  });
  b.addMesh('aorta', new THREE.CylinderGeometry(0.072, 0.082, 0.52, 14), aortaMat, {
    pos: [0.34, 1.76, -0.24],
    rot: [0.1, 0, -0.18],
  });

  // 6. Pulmonary Trunk + Bifurcation
  const pulmCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.22, 0.22, 0.42),
    new THREE.Vector3(0.02, 0.85, 0.36),
    new THREE.Vector3(0.18, 1.08, 0.04),
  ]);
  b.addMesh('pulmonary_trunk', new THREE.TubeGeometry(pulmCurve, 28, 0.18, 16, false), pulmMat);
  // Left & Right pulmonary arteries
  const lpa = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.16, 1.08, 0.04),
    new THREE.Vector3(0.75, 1.06, -0.18),
    new THREE.Vector3(1.12, 0.96, -0.35),
  ]);
  b.addMesh('pulmonary_trunk', new THREE.TubeGeometry(lpa, 18, 0.13, 14, false), pulmMat);
  const rpa = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.14, 1.06, 0.02),
    new THREE.Vector3(-0.48, 0.98, -0.26),
    new THREE.Vector3(-0.98, 0.9, -0.32),
  ]);
  b.addMesh('pulmonary_trunk', new THREE.TubeGeometry(rpa, 18, 0.13, 14, false), pulmMat);

  // 7. Superior & Inferior Vena Cava
  b.addMesh('vena_cava', new THREE.CylinderGeometry(0.19, 0.21, 1.05, 18), venaMat, {
    pos: [-0.76, 1.32, -0.1],
    rot: [0.05, 0, 0.08],
  });
  b.addMesh('vena_cava', new THREE.CylinderGeometry(0.21, 0.22, 0.72, 18), venaMat, {
    pos: [-0.72, -0.58, -0.35],
    rot: [-0.1, 0, -0.04],
  });

  // 8. Left Anterior Descending (LAD) Coronary Artery + Diagonal branch
  const ladCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.14, 0.45, 0.46),
    new THREE.Vector3(0.08, 0.08, 0.72),
    new THREE.Vector3(0.16, -0.45, 0.68),
    new THREE.Vector3(0.38, -1.02, 0.36),
  ]);
  b.addMesh('coronary_lad', new THREE.TubeGeometry(ladCurve, 32, 0.046, 10, false), coronaryMat);
  const diagCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.1, -0.05, 0.72),
    new THREE.Vector3(0.48, -0.28, 0.66),
    new THREE.Vector3(0.74, -0.55, 0.44),
  ]);
  b.addMesh('coronary_lad', new THREE.TubeGeometry(diagCurve, 18, 0.032, 8, false), coronaryMat);

  return b.finalize();
}

function buildBrainModel(tex: TextureSet): BuiltAnatomyModel {
  const b = makePartBuilder('brain');

  const makeLobeMat = (hex: number, rough = 0.52) =>
    new THREE.MeshPhysicalMaterial({
      color: hex,
      map: tex.cortexMap,
      roughness: rough,
      metalness: 0.02,
      clearcoat: 0.28,
      clearcoatRoughness: 0.45,
    });

  // Build paired hemispheres for each cortical lobe with sculpted gyri
  const addPairedLobe = (
    partId: string,
    mat: THREE.Material,
    radius: number,
    posRight: [number, number, number],
    scale: [number, number, number],
    rot: [number, number, number] = [0, 0, 0]
  ) => {
    for (const sign of [-1, 1]) {
      const geo = sculptGyri(new THREE.IcosahedronGeometry(radius, 4), 0.045, 7.2);
      b.addMesh(partId, geo, mat, {
        pos: [posRight[0] * sign, posRight[1], posRight[2]],
        scale,
        rot: [rot[0], rot[1] * sign, rot[2] * sign],
      });
    }
  };

  // 1. Frontal Lobes
  addPairedLobe('frontal', makeLobeMat(0xf4a89f, 0.48), 0.78, [0.46, 0.38, 0.72], [0.76, 0.92, 1.18], [0.1, -0.1, 0]);

  // 2. Parietal Lobes
  addPairedLobe('parietal', makeLobeMat(0xefc0a5, 0.54), 0.76, [0.49, 0.68, -0.22], [0.8, 0.85, 1.02], [-0.12, 0.06, 0]);

  // 3. Occipital Lobes
  addPairedLobe('occipital', makeLobeMat(0xdca2b6, 0.56), 0.62, [0.4, 0.18, -1.04], [0.78, 0.88, 0.95], [0.15, 0.14, 0]);

  // 4. Temporal Lobes
  addPairedLobe('temporal', makeLobeMat(0xd9b69a, 0.5), 0.58, [0.88, -0.18, 0.04], [0.62, 0.72, 1.48], [0.14, 0.12, -0.15]);

  // 5. Cerebellum (foliated dual hemispheres + vermis)
  const cerebMat = new THREE.MeshStandardMaterial({
    color: 0xc28a7e,
    map: tex.cortexMap,
    roughness: 0.72,
    metalness: 0.02,
  });
  for (const sign of [-1, 1]) {
    const cGeo = sculptGyri(new THREE.SphereGeometry(0.46, 28, 22), 0.032, 14.0);
    b.addMesh('cerebellum', cGeo, cerebMat, {
      pos: [0.44 * sign, -0.62, -0.78],
      scale: [1.05, 0.78, 0.88],
    });
  }
  b.addMesh('cerebellum', new THREE.SphereGeometry(0.28, 20, 16), cerebMat, {
    pos: [0, -0.6, -0.72],
    scale: [0.7, 0.9, 1.0],
  });

  // 6. Pons
  const stemMat = new THREE.MeshStandardMaterial({
    color: 0xf1dfd1,
    roughness: 0.42,
    metalness: 0.02,
  });
  b.addMesh('pons', new THREE.SphereGeometry(0.36, 24, 20), stemMat, {
    pos: [0, -0.62, 0.05],
    scale: [1.12, 0.92, 0.95],
  });

  // 7. Medulla Oblongata
  const medMat = new THREE.MeshStandardMaterial({
    color: 0xe6d3c3,
    roughness: 0.55,
  });
  b.addMesh('medulla', new THREE.CylinderGeometry(0.24, 0.16, 0.85, 20), medMat, {
    pos: [0, -1.18, -0.1],
    rot: [0.22, 0, 0],
  });

  // 8. Corpus Callosum (central white-matter arch visible between hemispheres / in X-ray or Exploded view!)
  const ccMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    roughness: 0.32,
    metalness: 0.06,
  });
  const ccCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.1, 0.62),
    new THREE.Vector3(0, 0.45, 0.35),
    new THREE.Vector3(0, 0.5, -0.18),
    new THREE.Vector3(0, 0.25, -0.64),
  ]);
  b.addMesh('corpus_callosum', new THREE.TubeGeometry(ccCurve, 28, 0.15, 14, false), ccMat, {
    scale: [1.45, 0.85, 1.0],
  });

  return b.finalize();
}

function buildSkullModel(tex: TextureSet): BuiltAnatomyModel {
  const b = makePartBuilder('skull');

  const boneMat = (hex: number, rough = 0.66) =>
    new THREE.MeshStandardMaterial({
      color: hex,
      map: tex.boneMap,
      roughness: rough,
      metalness: 0.03,
    });

  // 1. Frontal Bone + Supraorbital Ridge
  const fMat = boneMat(0xf5efe2, 0.62);
  b.addMesh('frontal_bone', new THREE.SphereGeometry(0.95, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.54), fMat, {
    pos: [0, 0.38, 0.22],
    rot: [0.58, 0, 0],
    scale: [0.92, 0.94, 0.98],
  });
  b.addMesh('frontal_bone', new THREE.TorusGeometry(0.32, 0.075, 12, 24, Math.PI), fMat, {
    pos: [-0.34, 0.18, 0.84],
    rot: [0, 0.15, 0],
  });
  b.addMesh('frontal_bone', new THREE.TorusGeometry(0.32, 0.075, 12, 24, Math.PI), fMat, {
    pos: [0.34, 0.18, 0.84],
    rot: [0, -0.15, 0],
  });

  // 2. Parietal Bones (left & right cranial vault)
  const pMat = boneMat(0xebe3d3, 0.68);
  for (const sign of [-1, 1]) {
    b.addMesh('parietal_bone', new THREE.SphereGeometry(0.92, 28, 22), pMat, {
      pos: [0.28 * sign, 0.58, -0.18],
      scale: [0.8, 0.92, 1.05],
    });
  }

  // 3. Occipital Bone
  const oMat = boneMat(0xe2d9c8, 0.72);
  b.addMesh('occipital_bone', new THREE.SphereGeometry(0.84, 28, 22), oMat, {
    pos: [0, 0.08, -0.68],
    scale: [0.92, 0.9, 0.84],
  });

  // 4. Temporal Bones (squamous + mastoid process)
  const tMat = boneMat(0xe5dac6, 0.65);
  for (const sign of [-1, 1]) {
    b.addMesh('temporal_bone', new THREE.SphereGeometry(0.48, 22, 18), tMat, {
      pos: [0.84 * sign, -0.02, -0.22],
      scale: [0.46, 0.9, 1.15],
    });
    // Mastoid process
    b.addMesh('temporal_bone', new THREE.ConeGeometry(0.14, 0.36, 14), tMat, {
      pos: [0.78 * sign, -0.42, -0.35],
      rot: [Math.PI, 0, 0.15 * sign],
    });
  }

  // 5. Sphenoid Bone (greater wings at temple + body)
  const sMat = boneMat(0xdcd0b8, 0.58);
  b.addMesh('sphenoid_bone', new THREE.BoxGeometry(1.56, 0.34, 0.42), sMat, {
    pos: [0, 0.08, 0.32],
  });
  for (const sign of [-1, 1]) {
    b.addMesh('sphenoid_bone', new THREE.SphereGeometry(0.28, 18, 14), sMat, {
      pos: [0.74 * sign, 0.12, 0.34],
      scale: [0.55, 1.1, 0.95],
    });
  }

  // 6. Zygomatic Bones + Zygomatic Arch
  const zMat = boneMat(0xf2e9d8, 0.6);
  for (const sign of [-1, 1]) {
    b.addMesh('zygomatic_bone', new THREE.SphereGeometry(0.24, 18, 14), zMat, {
      pos: [0.64 * sign, -0.14, 0.72],
      scale: [0.95, 1.05, 0.8],
    });
    const archCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.68 * sign, -0.15, 0.68),
      new THREE.Vector3(0.92 * sign, -0.16, 0.25),
      new THREE.Vector3(0.84 * sign, -0.14, -0.2),
    ]);
    b.addMesh('zygomatic_bone', new THREE.TubeGeometry(archCurve, 16, 0.065, 10, false), zMat);
  }

  // 7. Maxilla + Upper Dental Arch + Nasal Bridge
  const mxMat = boneMat(0xf4ecdd, 0.62);
  b.addMesh('maxilla', new THREE.CylinderGeometry(0.46, 0.42, 0.52, 22), mxMat, {
    pos: [0, -0.36, 0.66],
    scale: [1.05, 1.0, 0.78],
  });
  // Nasal bridge
  b.addMesh('maxilla', new THREE.ConeGeometry(0.14, 0.34, 4), mxMat, {
    pos: [0, -0.02, 0.96],
    rot: [0.35, Math.PI / 4, 0],
  });
  // Dark orbital sockets & piriform aperture (visual contrast accents on maxilla/frontal)
  const cavityMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.92 });
  for (const sign of [-1, 1]) {
    b.addMesh('maxilla', new THREE.SphereGeometry(0.23, 18, 14), cavityMat, {
      pos: [0.33 * sign, 0.06, 0.78],
      scale: [1.08, 0.9, 0.55],
    });
  }
  b.addMesh('maxilla', new THREE.ConeGeometry(0.13, 0.28, 12), cavityMat, {
    pos: [0, -0.22, 0.95],
    rot: [0.15, 0, 0],
  });
  // Upper teeth strip (enamel gloss)
  const enamelMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.14, clearcoat: 0.85 });
  b.addMesh('maxilla', new THREE.TorusGeometry(0.36, 0.06, 10, 22, Math.PI), enamelMat, {
    pos: [0, -0.64, 0.62],
    rot: [Math.PI / 2, 0, 0],
  });

  // 8. Mandible (U-shaped body + bilateral ascending rami + lower teeth)
  const mdMat = boneMat(0xece2ce, 0.64);
  const jawCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.68, -0.18, 0.06),
    new THREE.Vector3(-0.64, -0.82, 0.16),
    new THREE.Vector3(-0.36, -0.98, 0.72),
    new THREE.Vector3(0, -1.04, 0.92),
    new THREE.Vector3(0.36, -0.98, 0.72),
    new THREE.Vector3(0.64, -0.82, 0.16),
    new THREE.Vector3(0.68, -0.18, 0.06),
  ]);
  b.addMesh('mandible', new THREE.TubeGeometry(jawCurve, 40, 0.13, 14, false), mdMat);
  b.addMesh('mandible', new THREE.TorusGeometry(0.34, 0.055, 10, 22, Math.PI), enamelMat, {
    pos: [0, -0.8, 0.62],
    rot: [Math.PI / 2, 0, 0],
  });

  return b.finalize();
}

function buildFemurModel(tex: TextureSet): BuiltAnatomyModel {
  const b = makePartBuilder('femur');

  const corticalMat = new THREE.MeshStandardMaterial({
    color: 0xefe7d7,
    map: tex.boneMap,
    roughness: 0.58,
    metalness: 0.03,
  });
  const cartilageMat = new THREE.MeshPhysicalMaterial({
    color: 0xdbeafe,
    roughness: 0.18,
    metalness: 0.02,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
  });
  const trochanterMat = new THREE.MeshStandardMaterial({
    color: 0xe3d8c3,
    map: tex.boneMap,
    roughness: 0.72,
    metalness: 0.02,
  });

  // 1. Caput Femoris (articular cartilage-coated femoral head)
  b.addMesh('caput_femoris', new THREE.SphereGeometry(0.36, 30, 24), cartilageMat, {
    pos: [-0.74, 1.82, 0.05],
  });

  // 2. Collum Femoris (angled ~125° femoral neck)
  b.addMesh('collum_femoris', new THREE.CylinderGeometry(0.18, 0.22, 0.68, 20), corticalMat, {
    pos: [-0.36, 1.54, 0.03],
    rot: [0, 0, -0.95],
  });

  // 3. Trochanter Major (lateral prominence)
  b.addMesh('trochanter_major', new THREE.SphereGeometry(0.28, 22, 18), trochanterMat, {
    pos: [0.16, 1.58, -0.02],
    scale: [0.95, 1.32, 0.95],
  });

  // 4. Trochanter Minor (posteromedial conical prominence)
  b.addMesh('trochanter_minor', new THREE.ConeGeometry(0.14, 0.28, 16), trochanterMat, {
    pos: [-0.22, 1.12, -0.18],
    rot: [-0.4, 0, 1.05],
  });

  // 5. Corpus Femoris (slightly bowed diaphysis via TubeGeometry)
  const shaftCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.06, 1.38, 0),
    new THREE.Vector3(0.02, 0.45, 0.09),
    new THREE.Vector3(0, -0.45, 0.08),
    new THREE.Vector3(0, -1.32, 0),
  ]);
  b.addMesh('corpus_femoris', new THREE.TubeGeometry(shaftCurve, 36, 0.175, 18, false), corticalMat);

  // 6. Distal Femoral Condyles (medial & lateral with articular surface)
  b.addMesh('condyles', new THREE.SphereGeometry(0.3, 24, 18), cartilageMat, {
    pos: [-0.26, -1.58, -0.04],
    scale: [0.9, 1.05, 1.28],
  });
  b.addMesh('condyles', new THREE.SphereGeometry(0.28, 24, 18), cartilageMat, {
    pos: [0.26, -1.54, -0.04],
    scale: [0.88, 1.0, 1.24],
  });
  // Flare metaphysis connecting shaft to condyles
  b.addMesh('condyles', new THREE.CylinderGeometry(0.19, 0.36, 0.42, 20), corticalMat, {
    pos: [0, -1.36, -0.02],
    scale: [1.15, 1, 0.85],
  });

  // 7. Patella (shield-shaped sesamoid bone anterior to trochlear groove)
  const patellaShape = new THREE.Shape();
  patellaShape.moveTo(0, 0.24);
  patellaShape.quadraticCurveTo(0.24, 0.22, 0.22, 0);
  patellaShape.quadraticCurveTo(0.16, -0.22, 0, -0.28);
  patellaShape.quadraticCurveTo(-0.16, -0.22, -0.22, 0);
  patellaShape.quadraticCurveTo(-0.24, 0.22, 0, 0.24);
  const patGeo = new THREE.ExtrudeGeometry(patellaShape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.045,
    bevelSegments: 4,
  });
  patGeo.center();
  b.addMesh('patella', patGeo, trochanterMat, {
    pos: [0, -1.48, 0.46],
    rot: [0.12, 0, 0],
  });

  return b.finalize();
}

function buildThoraxModel(tex: TextureSet): BuiltAnatomyModel {
  const b = makePartBuilder('thorax');

  const boneMat = new THREE.MeshStandardMaterial({
    color: 0xefe6d6,
    map: tex.boneMap,
    roughness: 0.62,
    metalness: 0.03,
  });
  const spineMat = new THREE.MeshStandardMaterial({
    color: 0xe3d8c3,
    map: tex.boneMap,
    roughness: 0.7,
    metalness: 0.02,
  });
  const cartMat = new THREE.MeshPhysicalMaterial({
    color: 0xbae6fd,
    roughness: 0.22,
    metalness: 0.04,
    clearcoat: 0.85,
  });
  const discMat = new THREE.MeshStandardMaterial({
    color: 0x60a5fa,
    roughness: 0.42,
    metalness: 0.05,
  });

  // 1. Manubrium sterni
  const manShape = new THREE.Shape();
  manShape.moveTo(-0.34, 0.24);
  manShape.quadraticCurveTo(0, 0.14, 0.34, 0.24);
  manShape.lineTo(0.22, -0.22);
  manShape.lineTo(-0.22, -0.22);
  manShape.closePath();
  const manGeo = new THREE.ExtrudeGeometry(manShape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 3 });
  manGeo.center();
  b.addMesh('manubrium', manGeo, boneMat, { pos: [0, 1.15, 0.78], rot: [-0.18, 0, 0] });

  // 2. Corpus sterni
  b.addMesh('corpus_sterni', new THREE.BoxGeometry(0.32, 1.18, 0.09), boneMat, {
    pos: [0, 0.34, 0.9],
    rot: [-0.04, 0, 0],
  });

  // 3. Processus xiphoideus
  b.addMesh('xiphoid', new THREE.ConeGeometry(0.1, 0.32, 4), cartMat, {
    pos: [0, -0.4, 0.9],
    rot: [Math.PI, Math.PI / 4, 0],
    scale: [1.1, 1, 0.45],
  });

  // 4 & 5 & 6. Ribs (1–7 True Ribs, 8–10 False Ribs) + Costal Cartilages
  const ribCount = 10;
  for (let r = 0; r < ribCount; r++) {
    const t = r / (ribCount - 1);
    const yBack = 1.48 - t * 2.55;
    const yFront = 1.24 - t * 2.25;
    const width = 0.82 + Math.sin(t * Math.PI * 0.88 + 0.22) * 0.68;
    const depthFront = 0.78 + Math.sin(t * Math.PI * 0.8) * 0.18;
    const isTrue = r < 7;
    const partId = isTrue ? 'true_ribs' : 'false_ribs';

    for (const sign of [-1, 1]) {
      const ribPts = [
        new THREE.Vector3(0.18 * sign, yBack, -0.74),
        new THREE.Vector3(width * 0.88 * sign, yBack - 0.12, -0.58),
        new THREE.Vector3(width * sign, (yBack + yFront) * 0.5 - 0.08, 0.08),
        new THREE.Vector3(width * 0.72 * sign, yFront, depthFront * 0.88),
      ];
      const ribCurve = new THREE.CatmullRomCurve3(ribPts);
      b.addMesh(partId, new THREE.TubeGeometry(ribCurve, 22, 0.048, 8, false), boneMat);

      // Costal cartilage connecting anterior rib end to sternum (or costal arch for ribs 8-10)
      const sternalTargetY = isTrue ? Math.max(-0.22, yFront + 0.08) : -0.26;
      const sternalTargetX = isTrue ? 0.17 * sign : (0.28 + (r - 6) * 0.12) * sign;
      const cartCurve = new THREE.CatmullRomCurve3([
        ribPts[3],
        new THREE.Vector3((ribPts[3].x + sternalTargetX) * 0.5, (yFront + sternalTargetY) * 0.5 - 0.05, depthFront * 0.98),
        new THREE.Vector3(sternalTargetX, sternalTargetY, 0.88),
      ]);
      b.addMesh('costal_cartilage', new THREE.TubeGeometry(cartCurve, 12, 0.042, 8, false), cartMat);
    }
  }

  // 7. Thoracic Spine (11 vertebrae + intervertebral discs + spinous processes)
  for (let v = 0; v < 11; v++) {
    const y = 1.54 - v * 0.28;
    const zCurve = -0.78 - Math.sin((v / 10) * Math.PI) * 0.14;
    // Vertebral body
    b.addMesh('thoracic_spine', new THREE.CylinderGeometry(0.22, 0.23, 0.2, 16), spineMat, {
      pos: [0, y, zCurve],
    });
    // Spinous process (downward-sloping)
    b.addMesh('thoracic_spine', new THREE.BoxGeometry(0.07, 0.22, 0.28), spineMat, {
      pos: [0, y - 0.06, zCurve - 0.24],
      rot: [0.55, 0, 0],
    });
    // Intervertebral disc
    if (v < 10) {
      b.addMesh('thoracic_spine', new THREE.CylinderGeometry(0.215, 0.215, 0.065, 16), discMat, {
        pos: [0, y - 0.14, zCurve],
      });
    }
  }

  return b.finalize();
}

export function buildAnatomyModel(
  modelId: AnatomyModelId,
  maxAnisotropy: number,
  isSoftwareGl: boolean
): BuiltAnatomyModel {
  const tex: TextureSet = {
    boneMap: createProceduralTexture('bone', maxAnisotropy),
    muscleMap: createProceduralTexture('muscle', maxAnisotropy),
    cortexMap: createProceduralTexture('cortex', maxAnisotropy),
    membraneMap: createProceduralTexture('membrane', maxAnisotropy),
  };

  let built: BuiltAnatomyModel;
  switch (modelId) {
    case 'cell':
      built = buildCellModel(tex, isSoftwareGl);
      break;
    case 'heart':
      built = buildHeartModel(tex);
      break;
    case 'brain':
      built = buildBrainModel(tex);
      break;
    case 'skull':
      built = buildSkullModel(tex);
      break;
    case 'femur':
      built = buildFemurModel(tex);
      break;
    case 'thorax':
      built = buildThoraxModel(tex);
      break;
  }

  built.disposables.textures.push(tex.boneMap, tex.muscleMap, tex.cortexMap, tex.membraneMap);
  return built;
}
