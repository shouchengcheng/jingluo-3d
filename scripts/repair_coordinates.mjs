import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

/**
 * Loads `public/models/human-body.glb` skin primitive as a FrontSide mesh (plus mirrored bilateral
 * mesh for camera-line-of-sight occlusion verification).
 */
export function loadHumanSkinMesh(glbPath = path.join(rootDir, 'public', 'models', 'human-body.glb')) {
  const buf = fs.readFileSync(glbPath);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = buf.subarray(20 + jsonLen + 8);

  const posView = gltf.bufferViews[0];
  const normView = gltf.bufferViews[1];
  const skinIdxView = gltf.bufferViews[2];

  const posCount = gltf.accessors[0].count;
  const skinIdxCount = gltf.accessors[2].count;
  const idxCompType = gltf.accessors[2].componentType;

  const positions = new Float32Array(
    bin.buffer,
    bin.byteOffset + posView.byteOffset,
    posCount * 3,
  ).slice();
  const normals = new Float32Array(
    bin.buffer,
    bin.byteOffset + normView.byteOffset,
    posCount * 3,
  ).slice();
  const indices =
    idxCompType === 5125
      ? new Uint32Array(bin.buffer, bin.byteOffset + skinIdxView.byteOffset, skinIdxCount).slice()
      : new Uint16Array(bin.buffer, bin.byteOffset + skinIdxView.byteOffset, skinIdxCount).slice();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  // FrontSide ONLY: rays from outside never hit inner cavity walls or opposite-side backfaces!
  const frontMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
  );
  frontMesh.updateMatrixWorld(true);

  const doubleMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  doubleMesh.updateMatrixWorld(true);

  return { geometry, frontMesh, doubleMesh, positions, normals, indices };
}

function parseNum(code) {
  const m = code.match(/\d+$/);
  return m ? Number.parseInt(m[0], 10) : 0;
}

/**
 * Returns unit outward direction vector (pointing from skin into air) for a canonical (+X) acupoint
 * on the 1.75m MakeHuman relaxed A-pose mesh (thumb +Z/-X, palm -X/+Z, dorsum of hand +X/-Z).
 */
export function expectedOutwardDirection(code, targetPos) {
  const prefix = code.replace(/\d+$/, '');
  const n = parseNum(code);

  // Sole of foot
  if (code === 'KI1') return new THREE.Vector3(0.08, -0.98, 0.15).normalize();

  // Dorsum / toes of foot (cast from above +Y/+Z onto dorsal metatarsals)
  if (['LR2', 'LR3', 'ST41', 'ST44', 'GB40', 'GB41', 'BL67'].includes(code)) {
    return new THREE.Vector3(0.15, 0.94, 0.3).normalize();
  }

  // Lateral ankle
  if (['BL60', 'BL62'].includes(code)) {
    return new THREE.Vector3(0.92, -0.05, -0.38).normalize();
  }

  // Medial foot / ankle / tibia / knee (Three Foot-Yin meridians: SP, KI, LR)
  if (
    (prefix === 'SP' && n >= 3 && n <= 9) ||
    (prefix === 'KI' && n >= 2 && n <= 10) ||
    (prefix === 'LR' && n >= 4 && n <= 8)
  ) {
    const zBias = prefix === 'KI' ? -0.32 : 0.25;
    return new THREE.Vector3(-0.92, 0.08, zBias).normalize();
  }
  if (code === 'SP10') return new THREE.Vector3(-0.45, 0.12, 0.88).normalize();

  // Anterior midline & face
  if (prefix === 'CV') {
    if (code === 'CV24') return new THREE.Vector3(0, 0.08, 1).normalize();
    if (code === 'CV22') return new THREE.Vector3(0, 0.28, 0.96).normalize();
    return new THREE.Vector3(0, 0.06, 1).normalize();
  }
  if (prefix === 'GV') {
    if (code === 'GV20') return new THREE.Vector3(0, 0.98, -0.15).normalize();
    if (code === 'GV23' || code === 'GV24') return new THREE.Vector3(0, 0.62, 0.78).normalize();
    if (code === 'GV26') return new THREE.Vector3(0, 0.1, 0.99).normalize();
    return new THREE.Vector3(0, 0.12, -0.99).normalize();
  }

  // Head & neck
  if (['ST2', 'ST4', 'BL2', 'LI20'].includes(code)) {
    return new THREE.Vector3(0.24, 0.1, 0.96).normalize();
  }
  if (['ST6', 'ST7', 'SI19', 'TE21', 'TE23', 'GB1', 'GB2', 'GB14'].includes(code)) {
    const zBias = ['GB14', 'TE23'].includes(code) ? 0.85 : 0.42;
    return new THREE.Vector3(0.88, 0.08, zBias).normalize();
  }
  if (code === 'ST8') return new THREE.Vector3(0.55, 0.42, 0.72).normalize();
  if (['GB8', 'TE17'].includes(code)) return new THREE.Vector3(0.95, 0.05, -0.28).normalize();
  if (['GB20', 'BL10'].includes(code)) return new THREE.Vector3(0.42, -0.12, -0.9).normalize();
  if (code === 'GB21') return new THREE.Vector3(0.25, 0.92, -0.3).normalize();

  // Anterior / lateral torso
  if (['ST21', 'ST25', 'KI16', 'KI27', 'LU1', 'LU2', 'PC1', 'GB24', 'SP15'].includes(code)) {
    const xBias = ['SP15', 'PC1', 'LU1', 'LU2', 'GB24'].includes(code) ? 0.42 : 0.16;
    return new THREE.Vector3(xBias, 0.08, 0.9).normalize();
  }
  if (['SP21', 'LR13', 'LR14', 'GB26'].includes(code)) {
    const zBias = code === 'LR14' ? 0.78 : 0.35;
    return new THREE.Vector3(0.88, 0.05, zBias).normalize();
  }

  // Back & posterior lower limb (BL)
  if (prefix === 'BL') {
    return new THREE.Vector3(0.18, 0.04, -0.98).normalize();
  }
  if (code === 'GB30') return new THREE.Vector3(0.75, 0.05, -0.66).normalize();
  if (['GB31', 'GB34', 'GB37', 'GB39'].includes(code)) {
    return new THREE.Vector3(0.95, 0.05, 0.25).normalize();
  }
  if (prefix === 'ST' && n >= 32 && n <= 40) {
    return new THREE.Vector3(0.38, 0.05, 0.92).normalize();
  }

  // Relaxed A-pose Upper Limb & Hand:
  // Hand Yin meridians (LU, PC, HT): anterior-medial / palmar
  if (prefix === 'LU') {
    if (n >= 9) return new THREE.Vector3(-0.35, 0.02, 0.93).normalize();
    return new THREE.Vector3(-0.22, -0.1, 0.97).normalize();
  }
  if (prefix === 'PC') {
    if (n >= 7) return new THREE.Vector3(-0.66, -0.06, 0.75).normalize();
    return new THREE.Vector3(-0.32, -0.12, 0.94).normalize();
  }
  if (prefix === 'HT') {
    if (code === 'HT1') return new THREE.Vector3(-0.45, -0.55, 0.7).normalize();
    if (code === 'HT9') return new THREE.Vector3(-0.45, -0.45, 0.77).normalize();
    return new THREE.Vector3(-0.68, -0.12, 0.72).normalize();
  }

  // Hand Yang meridians (LI, TE, SI): radial-dorsal / posterior-lateral
  if (prefix === 'LI') {
    if (n <= 2) return new THREE.Vector3(0.58, -0.15, 0.8).normalize();
    if (n <= 5) return new THREE.Vector3(0.78, 0.1, 0.6).normalize();
    if (n === 6) return new THREE.Vector3(0.75, 0.1, 0.65).normalize();
    if (n <= 15) return new THREE.Vector3(0.78, 0.18, 0.6).normalize();
    if (code === 'LI16') return new THREE.Vector3(0.35, 0.88, -0.3).normalize();
  }
  if (prefix === 'TE') {
    if (n <= 14) return new THREE.Vector3(0.8, 0.12, -0.58).normalize();
  }
  if (prefix === 'SI') {
    if (n <= 8) return new THREE.Vector3(0.72, -0.12, -0.68).normalize();
    if (n <= 11) return new THREE.Vector3(0.35, 0.12, -0.93).normalize();
  }

  return new THREE.Vector3(targetPos.x > 0.18 ? 0.6 : 0, 0.08, targetPos.z >= 0 ? 1 : -1).normalize();
}

function roundVec(v, decimals = 5) {
  const f = 10 ** decimals;
  return [
    Math.round(v.x * f) / f,
    Math.round(v.y * f) / f,
    Math.round(v.z * f) / f,
  ];
}

function barycentricNormal(geometry, hit) {
  const posAttr = geometry.attributes.position;
  const normAttr = geometry.attributes.normal;
  const face = hit.face;
  if (!face) return new THREE.Vector3(0, 0, 1);

  const a = new THREE.Vector3().fromBufferAttribute(posAttr, face.a);
  const b = new THREE.Vector3().fromBufferAttribute(posAttr, face.b);
  const c = new THREE.Vector3().fromBufferAttribute(posAttr, face.c);
  const bary = new THREE.Vector3();
  THREE.Triangle.getBarycoord(hit.point, a, b, c, bary);

  const na = new THREE.Vector3().fromBufferAttribute(normAttr, face.a);
  const nb = new THREE.Vector3().fromBufferAttribute(normAttr, face.b);
  const nc = new THREE.Vector3().fromBufferAttribute(normAttr, face.c);

  const interp = new THREE.Vector3()
    .addScaledVector(na, bary.x)
    .addScaledVector(nb, bary.y)
    .addScaledVector(nc, bary.z);

  if (interp.lengthSq() < 1e-6) return face.normal.clone().normalize();
  interp.normalize();
  if (interp.dot(face.normal) < 0) interp.negate();
  return interp;
}

/**
 * Computes an unobstructed canonical cameraPreset for `surfacePoint` with outward `surfaceNormal`.
 * Checks against `doubleMesh` so medial-leg points never place the camera inside or behind the
 * opposite leg!
 */
export function computeUnobstructedCamera(doubleMesh, raycaster, code, surfacePoint, surfaceNormal) {
  const prefix = code.replace(/\d+$/, '');
  const isSmallRegion =
    code === 'KI1' ||
    surfacePoint.y > 1.48 ||
    surfacePoint.y < 0.22 ||
    surfacePoint.x > 0.3;
  const dist = code === 'KI1' ? 0.5 : isSmallRegion ? 0.54 : 0.64;

  // Candidate view directions from target toward camera
  const baseDir = surfaceNormal.clone();
  const candidates = [
    baseDir.clone().add(new THREE.Vector3(0, 0.06, 0)).normalize(),
    baseDir.clone().lerp(new THREE.Vector3(0, 0.18, 1), 0.55).normalize(),
    baseDir.clone().lerp(new THREE.Vector3(0, 0.18, -1), 0.55).normalize(),
    baseDir.clone().lerp(new THREE.Vector3(0.6, 0.2, 0.8), 0.6).normalize(),
    baseDir.clone().lerp(new THREE.Vector3(0.6, 0.2, -0.8), 0.6).normalize(),
  ];

  // For medial leg points (normal.x < -0.5), pure -X crosses the opposite (left, x < 0) leg!
  // Prefer an oblique anterior-medial or posterior-medial view that stays on x >= -0.04 or clear of left leg.
  const orderedCandidates =
    surfaceNormal.x < -0.55
      ? prefix === 'KI'
        ? [candidates[2], candidates[1], candidates[0], candidates[4], candidates[3]]
        : [candidates[1], candidates[2], candidates[0], candidates[3], candidates[4]]
      : candidates;

  for (const dir of orderedCandidates) {
    if (dir.dot(surfaceNormal) < 0.2) continue;
    const camPos = surfacePoint.clone().addScaledVector(dir, dist);
    // Check self-mesh occlusion from camPos -> surfacePoint
    const toTarget = surfacePoint.clone().sub(camPos);
    const len = toTarget.length();
    raycaster.set(camPos, toTarget.normalize());
    raycaster.far = len - 0.008;
    const hits = raycaster.intersectObject(doubleMesh, false);
    if (hits.length === 0) {
      return {
        position: roundVec(camPos, 4),
        target: roundVec(surfacePoint, 4),
      };
    }
  }

  const fallbackCam = surfacePoint.clone().addScaledVector(surfaceNormal, dist);
  fallbackCam.y += 0.025;
  return {
    position: roundVec(fallbackCam, 4),
    target: roundVec(surfacePoint, 4),
  };
}

/**
 * Projects `rawTarget` onto the outward FrontSide skin triangle nearest `rawTarget` along `outDir`.
 */
export function projectAnatomicalPoint({ geometry, frontMesh, doubleMesh, raycaster, code, rawTarget }) {
  const outDir = expectedOutwardDirection(code, rawTarget);
  const isMidline = code.startsWith('CV') || code.startsWith('GV');
  const target = new THREE.Vector3(isMidline ? 0 : Math.abs(rawTarget.x), rawTarget.y, rawTarget.z);

  // Cast a bundle of parallel rays around `target` from outside along `-outDir` onto FrontSide skin
  const upRef = Math.abs(outDir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tangentU = new THREE.Vector3().crossVectors(upRef, outDir).normalize();
  const tangentV = new THREE.Vector3().crossVectors(outDir, tangentU).normalize();

  const offsets = [[0, 0]];
  for (const r of [0.008, 0.018, 0.032, 0.05]) {
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4;
      offsets.push([Math.cos(ang) * r, Math.sin(ang) * r]);
    }
  }

  // For medial leg rays (`outDir.x < -0.5`), start ray inside the inter-leg air gap (`x = 0.002`) so we don't hit nothing
  const rayPullback = outDir.x < -0.55 ? Math.min(0.12, Math.max(0.03, target.x - 0.002)) : 0.45;

  let bestHit = null;
  let bestScore = Infinity;

  for (const [du, dv] of offsets) {
    const sampleTarget = target
      .clone()
      .addScaledVector(tangentU, du)
      .addScaledVector(tangentV, dv);
    if (isMidline) sampleTarget.x = 0;
    const origin = sampleTarget.clone().addScaledVector(outDir, rayPullback);
    raycaster.set(origin, outDir.clone().negate());
    raycaster.far = rayPullback + 0.35;

    const hits = raycaster.intersectObject(frontMesh, false);
    for (const h of hits) {
      if (!h.face) continue;
      const fn = h.face.normal.clone().normalize();
      if (fn.dot(outDir) < 0.05) continue;
      const d = h.point.distanceTo(target);
      // Strongly prefer hits close to target whose outward normal aligns with anatomical expectation
      const score = d - 0.008 * fn.dot(outDir);
      if (score < bestScore) {
        bestScore = score;
        bestHit = h;
      }
    }
    if (bestHit && du === 0 && dv === 0 && bestHit.point.distanceTo(target) < 0.035) {
      break;
    }
  }

  let surfacePoint;
  let surfaceNormal;

  if (bestHit) {
    surfacePoint = bestHit.point.clone();
    if (isMidline) surfacePoint.x = 0;
    surfaceNormal = barycentricNormal(geometry, bestHit);
    if (isMidline) surfaceNormal.x = 0;
    surfaceNormal.normalize();
  } else {
    // Fallback: closest triangle with outward normal matching `outDir` (`dot > 0`)
    const posAttr = geometry.attributes.position;
    const idxAttr = geometry.index;
    const tri = new THREE.Triangle();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const closest = new THREE.Vector3();
    const fn = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    let bestD = Infinity;
    let bestFace = { a: 0, b: 1, c: 2, normal: outDir.clone() };

    for (let i = 0; i < idxAttr.count; i += 3) {
      const ia = idxAttr.getX(i);
      const ib = idxAttr.getX(i + 1);
      const ic = idxAttr.getX(i + 2);
      a.fromBufferAttribute(posAttr, ia);
      b.fromBufferAttribute(posAttr, ib);
      c.fromBufferAttribute(posAttr, ic);
      fn.subVectors(b, a).cross(tmp.subVectors(c, a)).normalize();
      if (fn.dot(outDir) < 0.0) continue;
      tri.set(a, b, c);
      tri.closestPointToPoint(target, closest);
      const d = closest.distanceToSquared(target);
      if (d < bestD) {
        bestD = d;
        surfacePoint = closest.clone();
        bestFace = { a: ia, b: ib, c: ic, normal: fn.clone() };
      }
    }
    if (isMidline) surfacePoint.x = 0;
    surfaceNormal = barycentricNormal(geometry, { point: surfacePoint, face: bestFace });
    if (isMidline) surfaceNormal.x = 0;
    surfaceNormal.normalize();
  }

  const cameraPreset = computeUnobstructedCamera(
    doubleMesh,
    raycaster,
    code,
    surfacePoint,
    surfaceNormal,
  );

  return {
    position: roundVec(surfacePoint, 5),
    normal: roundVec(surfaceNormal, 5),
    cameraPreset,
  };
}

function loadUpstreamRawMap(upstreamDir) {
  const map = new Map();
  if (!upstreamDir) return map;
  const pointsPath = path.join(upstreamDir, 'src', 'data', 'points.js');
  const modelPath = path.join(upstreamDir, 'src', 'scene', 'human-model.js');
  if (!fs.existsSync(pointsPath) || !fs.existsSync(modelPath)) return map;

  const modelJs = fs.readFileSync(modelPath, 'utf8');
  const match = modelJs.match(/const\s+packed\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return map;
  const packed = JSON.parse(match[1]);
  const buf = Buffer.from(packed.positions, 'base64');
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < buf.byteLength / 2; i += 3) {
    const y = buf.readInt16LE(i * 2) / 1000;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const scale = 1.75 / (maxY - minY);

  const pointsJs = fs.readFileSync(pointsPath, 'utf8');
  const { initialPoints, extraPoints } = vm.runInNewContext(
    pointsJs.replace(/export\s+const\s+/g, 'const ') + '\n;({ initialPoints, extraPoints });',
    {},
  );
  for (const item of initialPoints) {
    map.set(
      item.code,
      new THREE.Vector3(item.pos[0] * scale, (item.pos[1] - minY) * scale, item.pos[2] * scale),
    );
  }
  for (const row of extraPoints) {
    const [code, , , , x, y, z] = row;
    map.set(code, new THREE.Vector3(x * scale, (y - minY) * scale, z * scale));
  }
  const lu3 = map.get('LU3');
  const lu5 = map.get('LU5');
  if (lu3 && lu5) {
    map.set('LU4', lu3.clone().lerp(lu5, 1 / 6));
  }
  return map;
}

function main() {
  const args = process.argv.slice(2);
  const upIdx = args.indexOf('--upstream-dir');
  const upstreamDir = upIdx >= 0 ? args[upIdx + 1] : null;
  const rawMap = loadUpstreamRawMap(upstreamDir);

  const coordPath = path.join(rootDir, 'data', 'coordinates-3d.json');
  const coordData = JSON.parse(fs.readFileSync(coordPath, 'utf8'));
  const { geometry, frontMesh, doubleMesh } = loadHumanSkinMesh();
  const raycaster = new THREE.Raycaster();

  let repaired = 0;
  let preserved = 0;

  for (const [code, entry] of Object.entries(coordData.points)) {
    if (entry.audit?.status === 'gb_verified') {
      preserved += 1;
      continue;
    }

    const rawTarget = rawMap.get(code) ?? new THREE.Vector3(...entry.position);
    const projected = projectAnatomicalPoint({
      geometry,
      frontMesh,
      doubleMesh,
      raycaster,
      code,
      rawTarget,
    });

    coordData.points[code] = {
      ...projected,
      audit: entry.audit,
    };
    repaired += 1;
  }

  fs.writeFileSync(coordPath, `${JSON.stringify(coordData, null, 2)}\n`, 'utf8');
  console.log(
    `[repair_coordinates] Updated ${repaired} draft coordinates (${preserved} gb_verified preserved).`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
