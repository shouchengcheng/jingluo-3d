import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import * as THREE from 'three';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function validateCoordinateGeometry(coordData, glbPath = path.join(rootDir, 'public', 'models', 'human-body.glb')) {
  const errors = [];
  if (!fs.existsSync(glbPath)) return errors;

  const buf = fs.readFileSync(glbPath);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = buf.subarray(20 + jsonLen + 8);

  const posView = gltf.bufferViews[0];
  const normView = gltf.bufferViews[1];
  const idxView = gltf.bufferViews[2];
  const pos = new Float32Array(bin.buffer, bin.byteOffset + posView.byteOffset, gltf.accessors[0].count * 3);
  const nrm = new Float32Array(bin.buffer, bin.byteOffset + normView.byteOffset, gltf.accessors[1].count * 3);
  const idx =
    gltf.accessors[2].componentType === 5125
      ? new Uint32Array(bin.buffer, bin.byteOffset + idxView.byteOffset, gltf.accessors[2].count)
      : new Uint16Array(bin.buffer, bin.byteOffset + idxView.byteOffset, gltf.accessors[2].count);

  const tri = new THREE.Triangle();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const pt = new THREE.Vector3();
  const cn = new THREE.Vector3();
  const vn = new THREE.Vector3();

  for (const [code, data] of Object.entries(coordData.points ?? {})) {
    pt.set(...data.position);
    cn.set(...data.normal);
    const nLen = cn.length();
    if (Math.abs(nLen - 1) > 0.03) {
      errors.push(`Coordinate "${code}" normal length is ${nLen.toFixed(4)} (expected ~1.0)`);
    }

    let bestDistSq = Infinity;
    const bestVn = new THREE.Vector3();
    for (let i = 0; i < idx.length; i += 3) {
      const i0 = idx[i];
      const i1 = idx[i + 1];
      const i2 = idx[i + 2];
      a.fromArray(pos, i0 * 3);
      b.fromArray(pos, i1 * 3);
      c.fromArray(pos, i2 * 3);
      tri.set(a, b, c);
      tri.closestPointToPoint(pt, closest);
      const dSq = closest.distanceToSquared(pt);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestVn
          .set(
            nrm[i0 * 3] + nrm[i1 * 3] + nrm[i2 * 3],
            nrm[i0 * 3 + 1] + nrm[i1 * 3 + 1] + nrm[i2 * 3 + 1],
            nrm[i0 * 3 + 2] + nrm[i1 * 3 + 2] + nrm[i2 * 3 + 2],
          )
          .normalize();
      }
    }

    const distMeters = Math.sqrt(bestDistSq);
    if (distMeters > 0.008) {
      errors.push(
        `Coordinate "${code}" lies ${(distMeters * 1000).toFixed(1)}mm off the 3D skin surface (> 8mm limit)`,
      );
    }

    vn.copy(cn).normalize();
    const dot = vn.dot(bestVn);
    if (dot < 0.2) {
      errors.push(
        `Coordinate "${code}" normal points inward/sideways relative to outward skin normal (dot=${dot.toFixed(2)})`,
      );
    }
  }

  return errors;
}

export function validateAllData() {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);

  const acupointSchema = readJson(path.join(dataDir, 'schema', 'acupoint.schema.json'));
  const coord3dSchema = readJson(path.join(dataDir, 'schema', 'coord3d.schema.json'));

  const validateAcupointList = ajv.compile(acupointSchema);
  const validateCoord3d = ajv.compile(coord3dSchema);

  const errors = [];

  // 1. Validate meridians.json
  const meridiansPath = path.join(dataDir, 'meridians.json');
  const meridians = readJson(meridiansPath);
  const meridianCodes = new Set(meridians.map((m) => m.code));
  if (meridianCodes.size !== 14) {
    errors.push(`Expected 14 unique meridians in data/meridians.json, found ${meridianCodes.size}`);
  }

  // 2. Validate coordinates-3d.json schema + 3D mesh geometry
  const coordPath = path.join(dataDir, 'coordinates-3d.json');
  const coordData = readJson(coordPath);
  if (!validateCoord3d(coordData)) {
    errors.push(
      `Schema validation failed for data/coordinates-3d.json:\n  ${ajv.errorsText(validateCoord3d.errors, { separator: '\n  ' })}`,
    );
  } else {
    errors.push(...validateCoordinateGeometry(coordData));
  }

  // 3. Validate meridian-paths.json if present
  const pathsFile = path.join(dataDir, 'meridian-paths.json');
  if (fs.existsSync(pathsFile)) {
    const pathsData = readJson(pathsFile);
    for (const m of meridians) {
      const branches = pathsData.meridians?.[m.code];
      if (!Array.isArray(branches) || branches.length === 0) {
        errors.push(`data/meridian-paths.json missing branches for meridian "${m.code}"`);
        continue;
      }
      for (const br of branches) {
        if (!Array.isArray(br.points) || br.points.length < 2) {
          errors.push(`Meridian path branch "${br.id}" in "${m.code}" must have >= 2 3D points`);
        }
      }
    }
  }

  // 4. Validate prescriptions.json if present
  const prescFile = path.join(dataDir, 'prescriptions.json');
  const allDefinedCodes = new Set();

  // 5. Validate acupoint datasets under data/acupoints/*.json
  const acupointsDir = path.join(dataDir, 'acupoints');
  const seenAcupointCodes = new Set();
  const perMeridianCounts = {};
  const acupointFiles = fs
    .readdirSync(acupointsDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  let withCoordCount = 0;
  for (const file of acupointFiles) {
    const filePath = path.join(acupointsDir, file);
    let items;
    try {
      items = readJson(filePath);
    } catch (err) {
      errors.push(`Invalid JSON syntax in data/acupoints/${file}: ${err.message}`);
      continue;
    }

    const valid = validateAcupointList(items);
    if (!valid) {
      errors.push(
        `Schema validation failed for data/acupoints/${file}:\n  ${ajv.errorsText(validateAcupointList.errors, { separator: '\n  ' })}`,
      );
      continue;
    }

    const expectedMeridian = path.basename(file, '.json');
    perMeridianCounts[expectedMeridian] = items.length;

    for (const item of items) {
      allDefinedCodes.add(item.code);
      if (item.meridianCode !== expectedMeridian) {
        errors.push(
          `${item.code} in ${file} has meridianCode="${item.meridianCode}" (expected "${expectedMeridian}")`,
        );
      }
      if (!item.code.startsWith(expectedMeridian)) {
        errors.push(`${item.code} in ${file} does not start with meridian prefix "${expectedMeridian}"`);
      }
      if (seenAcupointCodes.has(item.code)) {
        errors.push(`Duplicate GB/T 12346-2021 acupoint code: ${item.code}`);
      }
      seenAcupointCodes.add(item.code);

      if (coordData.points?.[item.code]) {
        withCoordCount += 1;
      }
    }
  }

  if (fs.existsSync(prescFile)) {
    const prescList = readJson(prescFile);
    if (!Array.isArray(prescList) || prescList.length === 0) {
      errors.push('data/prescriptions.json must be a non-empty array');
    } else {
      for (const p of prescList) {
        if (!p.id || !p.name || !Array.isArray(p.points) || p.points.length < 2) {
          errors.push(`Invalid prescription entry "${p?.id ?? 'unknown'}"`);
          continue;
        }
        for (const code of p.points) {
          if (!allDefinedCodes.has(code)) {
            errors.push(`Prescription "${p.id}" references unknown acupoint "${code}"`);
          }
        }
      }
    }
  }

  let draftCount = 0;
  let verifiedCount = 0;
  for (const [code, point] of Object.entries(coordData.points ?? {})) {
    if (point.audit.status === 'gb_verified') {
      verifiedCount += 1;
      if (!point.audit.verifiedAt) {
        errors.push(`Coordinate "${code}" is marked gb_verified but verifiedAt is null`);
      }
    } else {
      draftCount += 1;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      meridianCount: meridianCodes.size,
      fileCount: acupointFiles.length,
      perMeridianCounts,
      acupointCount: seenAcupointCodes.size,
      withCoordCount,
      draftCount,
      verifiedCount,
    },
  };
}

function main() {
  const result = validateAllData();
  if (!result.ok) {
    for (const e of result.errors) {
      console.error(`[ERROR] ${e}`);
    }
    process.exit(1);
  }

  const { summary } = result;
  const meridianSummary = Object.entries(summary.perMeridianCounts)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');

  console.log(
    `[OK] Data & 3D geometry validation passed: ${summary.meridianCount} meridians (${summary.fileCount} files: ${meridianSummary}), ${summary.acupointCount} acupoints (${summary.withCoordCount} with valid outward 3D coords), ${
      summary.draftCount + summary.verifiedCount
    } total 3D coordinates (gb_verified: ${summary.verifiedCount}, draft_imported: ${summary.draftCount}).`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
