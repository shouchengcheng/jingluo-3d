import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { loadHumanSkinMesh, projectAnatomicalPoint } from './repair_coordinates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const UPSTREAM_RAW_BASE = 'https://raw.githubusercontent.com/aicuc/3d-acupoint-atlas/main';
const TARGET_HUMAN_HEIGHT_METERS = 1.75;
const STANDARD_14_CODE_RE = /^(LU|LI|ST|SP|HT|SI|BL|KI|PC|TE|GB|LR|CV|GV)\d{1,2}$/;

async function readUpstreamText(relativePath, localUpstreamDir) {
  if (localUpstreamDir) {
    const fullPath = path.resolve(localUpstreamDir, relativePath);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf8');
    }
  }
  const url = `${UPSTREAM_RAW_BASE}/${relativePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch upstream file ${url}: HTTP ${res.status}`);
  }
  return res.text();
}

function decodePackedBuffer(base64Text, signed) {
  const buf = Buffer.from(base64Text, 'base64');
  const count = buf.byteLength / 2;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = signed ? buf.readInt16LE(i * 2) / 1000 : buf.readUInt16LE(i * 2);
  }
  return out;
}

function extractPackedModel(humanModelJs) {
  const match = humanModelJs.match(/const\s+packed\s*=\s*(\{[\s\S]*?\});/);
  if (!match) {
    throw new Error('Could not locate `const packed = {...};` in upstream human-model.js');
  }
  return JSON.parse(match[1]);
}

function parseUpstreamPoints(pointsJs) {
  const transformed = pointsJs.replace(/export\s+const\s+/g, 'const ') + '\n;({ initialPoints, extraPoints });';
  return vm.runInNewContext(transformed, {});
}

function buildNormalizedGeometry(packed) {
  const rawPositions = decodePackedBuffer(packed.positions, true);
  const rawIndices = decodePackedBuffer(packed.indices, false);

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < rawPositions.length; i += 3) {
    const y = rawPositions[i];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const rawHeight = maxY - minY;
  const scale = TARGET_HUMAN_HEIGHT_METERS / rawHeight;

  const vertexCount = rawPositions.length / 3;
  const positions = new Float32Array(rawPositions.length);
  const posMin = [Infinity, Infinity, Infinity];
  const posMax = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < vertexCount; i++) {
    const x = rawPositions[i * 3] * scale;
    const y = (rawPositions[i * 3 + 1] - minY) * scale;
    const z = rawPositions[i * 3 + 2] * scale;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    if (x < posMin[0]) posMin[0] = x;
    if (y < posMin[1]) posMin[1] = y;
    if (z < posMin[2]) posMin[2] = z;
    if (x > posMax[0]) posMax[0] = x;
    if (y > posMax[1]) posMax[1] = y;
    if (z > posMax[2]) posMax[2] = z;
  }

  const useUint32 = vertexCount > 65535;
  const indices = useUint32 ? new Uint32Array(rawIndices) : new Uint16Array(rawIndices);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return {
    geometry,
    positions,
    normals: geometry.attributes.normal.array,
    indices,
    skinIndexCount: packed.skinIndexCount,
    posMin,
    posMax,
    minY,
    scale,
    useUint32,
  };
}

function padBuffer4(buf, padByte = 0x00) {
  const rem = buf.byteLength % 4;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rem, padByte)]);
}

function createHumanGLB({ positions, normals, indices, skinIndexCount, posMin, posMax, useUint32 }) {
  const skinIndices = indices.slice(0, skinIndexCount);
  const eyeIndices = indices.slice(skinIndexCount);

  const posBuf = padBuffer4(Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength));
  const normBuf = padBuffer4(Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength));
  const skinIdxRaw = Buffer.from(skinIndices.buffer, skinIndices.byteOffset, skinIndices.byteLength);
  const eyeIdxRaw = Buffer.from(eyeIndices.buffer, eyeIndices.byteOffset, eyeIndices.byteLength);
  const skinIdxBuf = padBuffer4(skinIdxRaw);
  const eyeIdxBuf = padBuffer4(eyeIdxRaw);

  const binChunkData = Buffer.concat([posBuf, normBuf, skinIdxBuf, eyeIdxBuf]);

  const posOffset = 0;
  const normOffset = posOffset + posBuf.byteLength;
  const skinIdxOffset = normOffset + normBuf.byteLength;
  const eyeIdxOffset = skinIdxOffset + skinIdxBuf.byteLength;

  const indexComponentType = useUint32 ? 5125 : 5123; // UNSIGNED_INT : UNSIGNED_SHORT
  const vertexCount = positions.length / 3;

  const gltfJson = {
    asset: {
      version: '2.0',
      generator: 'jingluo-3d scripts/import_upstream.mjs',
      copyright:
        'Adapted MakeHuman hm08 basemesh (CC0 1.0 Universal) packaged via aicuc/3d-acupoint-atlas (MIT License)',
    },
    scene: 0,
    scenes: [{ name: 'HumanAtlasScene', nodes: [0] }],
    nodes: [{ name: 'HumanBody', mesh: 0 }],
    materials: [
      {
        name: 'SkinMaterial',
        pbrMetallicRoughness: {
          baseColorFactor: [0.784, 0.576, 0.451, 1.0],
          metallicFactor: 0.02,
          roughnessFactor: 0.62,
        },
      },
      {
        name: 'EyeMaterial',
        pbrMetallicRoughness: {
          baseColorFactor: [0.922, 0.878, 0.835, 1.0],
          metallicFactor: 0.0,
          roughnessFactor: 0.28,
        },
      },
    ],
    meshes: [
      {
        name: 'HumanBodyMesh',
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            indices: 2,
            material: 0,
          },
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            indices: 3,
            material: 1,
          },
        ],
      },
    ],
    buffers: [{ byteLength: binChunkData.byteLength }],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: posOffset,
        byteLength: positions.byteLength,
        target: 34962, // ARRAY_BUFFER
      },
      {
        buffer: 0,
        byteOffset: normOffset,
        byteLength: normals.byteLength,
        target: 34962, // ARRAY_BUFFER
      },
      {
        buffer: 0,
        byteOffset: skinIdxOffset,
        byteLength: skinIdxRaw.byteLength,
        target: 34963, // ELEMENT_ARRAY_BUFFER
      },
      {
        buffer: 0,
        byteOffset: eyeIdxOffset,
        byteLength: eyeIdxRaw.byteLength,
        target: 34963, // ELEMENT_ARRAY_BUFFER
      },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: vertexCount,
        type: 'VEC3',
        min: posMin.map((n) => Number(n.toFixed(6))),
        max: posMax.map((n) => Number(n.toFixed(6))),
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: vertexCount,
        type: 'VEC3',
      },
      {
        bufferView: 2,
        byteOffset: 0,
        componentType: indexComponentType,
        count: skinIndices.length,
        type: 'SCALAR',
      },
      {
        bufferView: 3,
        byteOffset: 0,
        componentType: indexComponentType,
        count: eyeIndices.length,
        type: 'SCALAR',
      },
    ],
  };

  const jsonChunkData = padBuffer4(Buffer.from(JSON.stringify(gltfJson), 'utf8'), 0x20);

  const totalLength = 12 + 8 + jsonChunkData.byteLength + 8 + binChunkData.byteLength;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4); // version 2
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonChunkData.byteLength, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binChunkData.byteLength, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonChunkHeader, jsonChunkData, binChunkHeader, binChunkData]);
}

function nearestSurface(geometry, target) {
  const posAttr = geometry.attributes.position;
  const normAttr = geometry.attributes.normal;
  let bestDistSq = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < posAttr.count; i++) {
    const dx = posAttr.getX(i) - target.x;
    const dy = posAttr.getY(i) - target.y;
    const dz = posAttr.getZ(i) - target.z;
    const dSq = dx * dx + dy * dy + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = i;
    }
  }

  return {
    point: new THREE.Vector3().fromBufferAttribute(posAttr, bestIdx),
    normal: new THREE.Vector3().fromBufferAttribute(normAttr, bestIdx).normalize(),
  };
}

function roundVec3(vec, decimals = 5) {
  const factor = 10 ** decimals;
  return [
    Math.round(vec.x * factor) / factor,
    Math.round(vec.y * factor) / factor,
    Math.round(vec.z * factor) / factor,
  ];
}

function projectPointToMesh({ mesh, geometry, raycaster, rawPos, region, view, minY, scale }) {
  const pos = new THREE.Vector3(rawPos[0] * scale, (rawPos[1] - minY) * scale, rawPos[2] * scale);
  const normal = new THREE.Vector3(0, 0, pos.z < 0 ? -1 : 1);
  const origin = pos.clone();

  if (view === 'sole') {
    origin.y = -0.5;
    normal.set(0, -1, 0);
  } else if (Math.abs(rawPos[2]) < 0.08 && rawPos[0] > 0.2 && region !== '手部') {
    origin.x = 1.0;
    normal.set(1, 0, 0);
  } else {
    origin.z = normal.z * 1.0;
  }

  raycaster.set(origin, normal.clone().negate());
  const hits = raycaster
    .intersectObject(mesh, false)
    .sort((a, b) => a.point.distanceToSquared(pos) - b.point.distanceToSquared(pos));

  let surfacePoint;
  let surfaceNormal;

  if (hits.length > 0 && hits[0].face) {
    surfaceNormal = hits[0].face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
    // Ensure normal faces outward toward ray origin
    if (surfaceNormal.dot(origin.clone().sub(hits[0].point)) < 0) {
      surfaceNormal.negate();
    }
    surfacePoint = hits[0].point.clone();
  } else {
    const fallback = nearestSurface(geometry, pos);
    surfacePoint = fallback.point;
    surfaceNormal = fallback.normal;
  }

  const camDist = view === 'sole' ? 0.52 : region === '手部' || region === '足部' || region === '头颈' ? 0.55 : 0.65;
  const camPos = surfacePoint.clone().addScaledVector(surfaceNormal, camDist);
  camPos.y += 0.025;

  return {
    position: roundVec3(surfacePoint, 5),
    normal: roundVec3(surfaceNormal, 5),
    cameraPreset: {
      position: roundVec3(camPos, 4),
      target: roundVec3(surfacePoint, 4),
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dirFlagIdx = args.indexOf('--upstream-dir');
  const localUpstreamDir = dirFlagIdx >= 0 ? args[dirFlagIdx + 1] : null;

  console.log('[import_upstream] Reading upstream human-model.js and points.js...');
  const [humanModelJs, pointsJs] = await Promise.all([
    readUpstreamText('src/scene/human-model.js', localUpstreamDir),
    readUpstreamText('src/data/points.js', localUpstreamDir),
  ]);

  const packed = extractPackedModel(humanModelJs);
  const { initialPoints, extraPoints } = parseUpstreamPoints(pointsJs);

  const normMeshData = buildNormalizedGeometry(packed);
  const glbBuffer = createHumanGLB(normMeshData);

  const modelOutPath = path.join(rootDir, 'public', 'models', 'human-body.glb');
  fs.mkdirSync(path.dirname(modelOutPath), { recursive: true });
  fs.writeFileSync(modelOutPath, glbBuffer);
  console.log(
    `[import_upstream] Wrote ${path.relative(rootDir, modelOutPath)} (${(glbBuffer.byteLength / 1024).toFixed(1)} KB, height=${TARGET_HUMAN_HEIGHT_METERS}m)`,
  );

  const { geometry: skinOnlyGeometry, frontMesh, doubleMesh } = loadHumanSkinMesh(modelOutPath);
  const raycaster = new THREE.Raycaster();

  // Preserve any existing gb_verified coordinates (AGENTS.md Rule 3.3)
  const coordOutPath = path.join(rootDir, 'data', 'coordinates-3d.json');
  let existingPoints = {};
  if (fs.existsSync(coordOutPath)) {
    const existingData = JSON.parse(fs.readFileSync(coordOutPath, 'utf8'));
    existingPoints = existingData.points ?? {};
  }

  const upstreamEntries = [];
  for (const item of initialPoints) {
    upstreamEntries.push({
      code: item.code,
      rawPos: item.pos,
    });
  }
  for (const row of extraPoints) {
    const [code, , , , x, y, z] = row;
    upstreamEntries.push({
      code,
      rawPos: [x, y, z],
    });
  }

  const nextPoints = { ...existingPoints };
  let importedCount = 0;
  let preservedVerifiedCount = 0;

  for (const entry of upstreamEntries) {
    if (!STANDARD_14_CODE_RE.test(entry.code)) {
      continue;
    }

    if (existingPoints[entry.code]?.audit?.status === 'gb_verified') {
      preservedVerifiedCount += 1;
      continue;
    }

    const rawTarget = new THREE.Vector3(
      entry.rawPos[0] * normMeshData.scale,
      (entry.rawPos[1] - normMeshData.minY) * normMeshData.scale,
      entry.rawPos[2] * normMeshData.scale,
    );
    const projected = projectAnatomicalPoint({
      geometry: skinOnlyGeometry,
      frontMesh,
      doubleMesh,
      raycaster,
      code: entry.code,
      rawTarget,
    });

    nextPoints[entry.code] = {
      ...projected,
      audit: {
        status: 'draft_imported',
        standard: 'GB/T 12346-2021',
        source: 'aicuc/3d-acupoint-atlas',
        verifiedAt: null,
      },
    };
    importedCount += 1;
  }

  const lu3Raw = upstreamEntries.find((e) => e.code === 'LU3')?.rawPos;
  const lu5Raw = upstreamEntries.find((e) => e.code === 'LU5')?.rawPos;
  if (lu3Raw && lu5Raw && existingPoints.LU4?.audit?.status !== 'gb_verified') {
    const t = 1 / 6;
    const lu4Raw = new THREE.Vector3(
      (lu3Raw[0] + (lu5Raw[0] - lu3Raw[0]) * t) * normMeshData.scale,
      (lu3Raw[1] + (lu5Raw[1] - lu3Raw[1]) * t - normMeshData.minY) * normMeshData.scale,
      (lu3Raw[2] + (lu5Raw[2] - lu3Raw[2]) * t) * normMeshData.scale,
    );
    const projectedLu4 = projectAnatomicalPoint({
      geometry: skinOnlyGeometry,
      frontMesh,
      doubleMesh,
      raycaster,
      code: 'LU4',
      rawTarget: lu4Raw,
    });
    nextPoints.LU4 = {
      ...projectedLu4,
      audit: {
        status: 'draft_imported',
        standard: 'GB/T 12346-2021',
        source: 'aicuc/3d-acupoint-atlas (LU3-LU5 bone-proportional surface projection)',
        verifiedAt: null,
      },
    };
    importedCount += 1;
  }

  // Sort keys naturally by meridian order + point number
  const meridianOrder = ['LU', 'LI', 'ST', 'SP', 'HT', 'SI', 'BL', 'KI', 'PC', 'TE', 'GB', 'LR', 'CV', 'GV'];
  const sortedKeys = Object.keys(nextPoints).sort((a, b) => {
    const ma = a.match(/^[A-Z]+/)?.[0] ?? '';
    const mb = b.match(/^[A-Z]+/)?.[0] ?? '';
    const ia = meridianOrder.indexOf(ma);
    const ib = meridianOrder.indexOf(mb);
    if (ia !== ib) return ia - ib;
    const na = Number.parseInt(a.replace(/^[A-Z]+/, ''), 10);
    const nb = Number.parseInt(b.replace(/^[A-Z]+/, ''), 10);
    return na - nb;
  });

  const orderedPoints = {};
  for (const key of sortedKeys) {
    orderedPoints[key] = nextPoints[key];
  }

  const outputJson = {
    modelId: 'aicuc-3d-acupoint-atlas-v1',
    points: orderedPoints,
  };

  fs.writeFileSync(coordOutPath, `${JSON.stringify(outputJson, null, 2)}\n`, 'utf8');
  console.log(
    `[import_upstream] Wrote ${path.relative(rootDir, coordOutPath)}: ${importedCount} draft coordinates imported, ${preservedVerifiedCount} gb_verified coordinates preserved.`,
  );
}

main().catch((err) => {
  console.error('[import_upstream] Fatal error:', err);
  process.exit(1);
});
