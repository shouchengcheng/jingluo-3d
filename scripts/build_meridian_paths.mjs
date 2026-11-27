import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { loadHumanSkinMesh } from './repair_coordinates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function round3(v, d = 4) {
  const f = 10 ** d;
  return [
    Math.round(v.x * f) / f,
    Math.round(v.y * f) / f,
    Math.round(v.z * f) / f,
  ];
}

/**
 * Projects an intermediate guide waypoint onto the nearest FrontSide skin triangle whose outward
 * normal agrees with `hintNormal`.
 */
function snapGuideToSkin(geometry, frontMesh, raycaster, pos, hintNormal, midline = false) {
  const target = pos.clone();
  if (midline) target.x = 0;
  const dir = hintNormal.clone().normalize();
  const pullback = dir.x < -0.55 ? Math.min(0.11, Math.max(0.025, Math.abs(target.x) - 0.002)) : 0.35;

  raycaster.set(target.clone().addScaledVector(dir, pullback), dir.clone().negate());
  raycaster.far = pullback + 0.3;
  const hits = raycaster.intersectObject(frontMesh, false);
  const valid = hits
    .filter((h) => h.face && h.face.normal.dot(dir) > 0.0)
    .sort((a, b) => a.point.distanceToSquared(target) - b.point.distanceToSquared(target))[0];

  if (valid && valid.point.distanceTo(target) < 0.09) {
    const p = valid.point.clone();
    const n = valid.face.normal.clone().normalize();
    if (midline) {
      p.x = 0;
      n.x = 0;
      n.normalize();
    }
    return { pos: p, normal: n };
  }

  // Fallback: closest triangle with aligned normal
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
  let bestP = target.clone();
  let bestN = dir.clone();

  for (let i = 0; i < idxAttr.count; i += 3) {
    a.fromBufferAttribute(posAttr, idxAttr.getX(i));
    b.fromBufferAttribute(posAttr, idxAttr.getX(i + 1));
    c.fromBufferAttribute(posAttr, idxAttr.getX(i + 2));
    fn.subVectors(b, a).cross(tmp.subVectors(c, a)).normalize();
    if (fn.dot(dir) < -0.05) continue;
    tri.set(a, b, c);
    tri.closestPointToPoint(target, closest);
    const d = closest.distanceToSquared(target);
    if (d < bestD) {
      bestD = d;
      bestP = closest.clone();
      bestN = fn.clone();
    }
  }
  if (midline) {
    bestP.x = 0;
    bestN.x = 0;
    bestN.normalize();
  }
  return { pos: bestP, normal: bestN };
}

/**
 * Densifies consecutive control nodes `[a, b]` along the 3D skin surface at ~2.5cm steps so
 * `CatmullRomCurve3` hugs convex anatomical contours without ever cutting inside flesh.
 */
function densifyBranchOnSkin(geometry, frontMesh, raycaster, rawNodes, midline = false) {
  const out = [];

  for (let i = 0; i < rawNodes.length; i++) {
    const curr = rawNodes[i];
    if (i === 0) {
      out.push(curr);
      continue;
    }
    const prev = out[out.length - 1];
    const dist = prev.pos.distanceTo(curr.pos);
    const steps = Math.max(1, Math.min(14, Math.ceil(dist / 0.026)));

    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const lerpedPos = prev.pos.clone().lerp(curr.pos, t);
      let lerpedNrm = prev.normal.clone().lerp(curr.normal, t);
      if (lerpedNrm.lengthSq() < 1e-4) {
        lerpedNrm.set(0, 1, 0);
      }
      lerpedNrm.normalize();
      const snapped = snapGuideToSkin(geometry, frontMesh, raycaster, lerpedPos, lerpedNrm, midline);
      if (snapped.pos.distanceTo(out[out.length - 1].pos) > 0.004) {
        out.push(snapped);
      }
    }

    if (curr.pos.distanceTo(out[out.length - 1].pos) > 0.003) {
      out.push(curr);
    } else {
      out[out.length - 1] = curr;
    }
  }

  return out;
}

/**
 * Authoritative 14-meridian topology specification (GB/T 12346-2021 + undergraduate《针灸学》).
 * Each node is either an acupoint code string or a `[x, y, z, nx, ny, nz]` anatomical guide tuple
 * on the canonical (+X) side that bridges non-modeled intermediate segments cleanly over the skin.
 */
const TOPOLOGY_SPEC = {
  LU: [
    {
      id: 'LU-main',
      bilateral: true,
      nodes: ['LU1', 'LU2', 'LU3', 'LU4', 'LU5', 'LU6', 'LU7', 'LU8', 'LU9', 'LU10', 'LU11'],
    },
  ],
  LI: [
    {
      id: 'LI-limb-head',
      bilateral: true,
      nodes: [
        'LI1',
        'LI2',
        'LI3',
        'LI4',
        'LI5',
        'LI6',
        [0.355, 1.09, 0.015, 0.65, 0.1, 0.75],
        'LI10',
        'LI11',
        'LI14',
        'LI15',
        'LI16',
        [0.09, 1.47, 0.03, 0.35, 0.45, 0.82],
        [0.055, 1.54, 0.065, 0.45, 0.15, 0.88],
        [0.035, 1.585, 0.1, 0.3, 0.05, 0.95],
        'GV26',
      ],
    },
    {
      // Crosses philtrum (`GV26`) to the CONTRALATERAL `LI20` (迎香)!
      id: 'LI-cross-nose',
      bilateral: true,
      crossFromIndex: 0,
      nodes: ['GV26', 'LI20'],
    },
  ],
  ST: [
    {
      id: 'ST-head',
      bilateral: true,
      nodes: ['ST2', 'ST4', 'ST6', 'ST7', 'ST8'],
    },
    {
      id: 'ST-trunk-leg',
      bilateral: true,
      nodes: [
        'ST6',
        [0.048, 1.5, 0.055, 0.35, 0.1, 0.93],
        [0.085, 1.44, 0.065, 0.25, 0.4, 0.88],
        [0.095, 1.33, 0.115, 0.25, 0.15, 0.95],
        'ST21',
        'ST25',
        [0.075, 0.96, 0.125, 0.2, 0.05, 0.97],
        'ST32',
        'ST34',
        'ST35',
        'ST36',
        'ST37',
        'ST39',
        'ST41',
        'ST44',
      ],
    },
    {
      id: 'ST-luo-st40',
      bilateral: true,
      nodes: ['ST37', 'ST40', 'ST41'],
    },
  ],
  SP: [
    {
      id: 'SP-main',
      bilateral: true,
      nodes: [
        'SP3',
        'SP4',
        'SP5',
        'SP6',
        'SP8',
        'SP9',
        'SP10',
        [0.082, 0.86, 0.1, -0.25, 0.05, 0.96],
        [0.095, 0.98, 0.125, 0.2, 0.05, 0.97],
        'SP15',
        [0.135, 1.28, 0.1, 0.55, 0.08, 0.83],
        [0.155, 1.38, 0.06, 0.72, 0.1, 0.68],
        'SP21',
      ],
    },
  ],
  HT: [
    {
      id: 'HT-main',
      bilateral: true,
      nodes: ['HT1', 'HT3', 'HT5', 'HT7', 'HT8', 'HT9'],
    },
  ],
  SI: [
    {
      id: 'SI-main',
      bilateral: true,
      nodes: [
        'SI1',
        'SI3',
        'SI4',
        'SI6',
        'SI8',
        'SI9',
        'SI11',
        [0.11, 1.44, -0.04, 0.35, 0.55, -0.75],
        [0.068, 1.53, 0.01, 0.85, 0.1, 0.5],
        [0.078, 1.59, 0.045, 0.8, 0.08, 0.59],
        'SI19',
      ],
    },
  ],
  BL: [
    {
      // Inner 1.5-cun back Shu line from medial canthus over vertex to popliteal fossa
      id: 'BL-inner',
      bilateral: true,
      nodes: [
        'BL2',
        [0.024, 1.71, 0.075, 0.18, 0.65, 0.74],
        [0.032, 1.748, -0.005, 0.15, 0.98, -0.1],
        [0.035, 1.65, -0.085, 0.2, 0.25, -0.95],
        'BL10',
        'BL11',
        'BL12',
        'BL13',
        'BL15',
        'BL17',
        'BL18',
        'BL20',
        'BL21',
        'BL23',
        'BL25',
        'BL28',
        'BL32',
        'BL36',
        'BL37',
        'BL40',
      ],
    },
    {
      // Outer 3-cun parallel back line (BL41 -> BL54) converging into BL40 (委中)
      id: 'BL-outer',
      bilateral: true,
      nodes: [
        'BL11',
        [0.105, 1.41, -0.052, 0.28, 0.15, -0.95],
        [0.108, 1.34, -0.062, 0.3, 0.05, -0.95],
        [0.106, 1.22, -0.052, 0.32, 0.05, -0.94],
        [0.104, 1.13, -0.038, 0.32, 0.1, -0.94],
        [0.112, 1.01, -0.08, 0.3, 0.15, -0.94],
        [0.115, 0.92, -0.088, 0.28, -0.2, -0.94],
        [0.108, 0.78, -0.052, 0.2, -0.1, -0.97],
        'BL40',
      ],
    },
    {
      id: 'BL-lower-leg',
      bilateral: true,
      nodes: [
        'BL40',
        'BL57',
        'BL60',
        'BL62',
        [0.135, 0.042, 0.06, 0.85, 0.25, 0.45],
        'BL67',
      ],
    },
  ],
  KI: [
    {
      id: 'KI-main',
      bilateral: true,
      nodes: [
        'KI1',
        [0.082, 0.035, 0.06, -0.85, -0.35, 0.35],
        'KI2',
        'KI3',
        'KI6',
        'KI7',
        [0.072, 0.44, -0.015, -0.92, 0.05, -0.35],
        'KI10',
        [0.065, 0.82, 0.06, -0.55, 0.05, 0.83],
        [0.024, 0.98, 0.125, 0.1, 0.05, 0.99],
        'KI16',
        [0.03, 1.24, 0.135, 0.12, 0.08, 0.99],
        [0.042, 1.38, 0.095, 0.15, 0.25, 0.95],
        'KI27',
      ],
    },
  ],
  PC: [
    {
      id: 'PC-main',
      bilateral: true,
      nodes: [
        'PC1',
        [0.215, 1.35, 0.065, 0.25, 0.15, 0.95],
        'PC3',
        'PC4',
        'PC5',
        'PC6',
        'PC7',
        'PC8',
        'PC9',
      ],
    },
  ],
  TE: [
    {
      id: 'TE-main',
      bilateral: true,
      nodes: [
        'TE3',
        'TE4',
        'TE5',
        'TE6',
        'TE10',
        'TE14',
        [0.15, 1.45, -0.04, 0.35, 0.75, -0.55],
        [0.07, 1.52, -0.025, 0.85, 0.1, -0.5],
        'TE17',
        [0.082, 1.615, -0.008, 0.95, 0.1, 0.2],
        'TE21',
        'TE23',
      ],
    },
  ],
  GB: [
    {
      id: 'GB-main',
      bilateral: true,
      nodes: [
        'GB1',
        'GB2',
        'GB8',
        'GB14',
        [0.068, 1.695, 0.015, 0.75, 0.55, 0.35],
        [0.062, 1.63, -0.065, 0.65, 0.2, -0.73],
        'GB20',
        'GB21',
        [0.155, 1.36, 0.055, 0.65, 0.15, 0.74],
        'GB24',
        'GB26',
        'GB30',
        'GB31',
        'GB34',
        'GB37',
        'GB39',
        'GB40',
        'GB41',
      ],
    },
  ],
  LR: [
    {
      id: 'LR-main',
      bilateral: true,
      nodes: [
        'LR2',
        'LR3',
        [0.088, 0.095, 0.052, -0.55, 0.35, 0.75],
        'LR5',
        'LR8',
        [0.068, 0.82, 0.075, -0.45, 0.05, 0.89],
        [0.088, 0.98, 0.125, 0.25, 0.05, 0.96],
        'LR13',
        'LR14',
      ],
    },
  ],
  CV: [
    {
      id: 'CV-main',
      bilateral: false,
      midline: true,
      nodes: [
        'CV3',
        'CV4',
        'CV6',
        'CV8',
        'CV9',
        'CV10',
        'CV12',
        'CV13',
        'CV14',
        'CV17',
        'CV22',
        [0, 1.515, 0.058, 0, 0.05, 1],
        'CV24',
      ],
    },
  ],
  GV: [
    {
      id: 'GV-main',
      bilateral: false,
      midline: true,
      nodes: [
        'GV3',
        'GV4',
        'GV9',
        'GV12',
        'GV14',
        'GV16',
        [0, 1.63, -0.092, 0, 0.22, -0.97],
        [0, 1.72, -0.062, 0, 0.75, -0.66],
        'GV20',
        [0, 1.738, 0.045, 0, 0.82, 0.57],
        'GV23',
        'GV24',
        [0, 1.64, 0.112, 0, 0.2, 0.98],
        'GV26',
      ],
    },
  ],
};

function main() {
  const coordData = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'coordinates-3d.json'), 'utf8'),
  );
  const points = coordData.points;
  const { geometry, frontMesh } = loadHumanSkinMesh();
  const raycaster = new THREE.Raycaster();

  const outputMeridians = {};
  let totalBranches = 0;
  let totalVertices = 0;

  for (const [mCode, branches] of Object.entries(TOPOLOGY_SPEC)) {
    outputMeridians[mCode] = [];

    for (const br of branches) {
      const resolvedNodes = br.nodes.map((node, idx) => {
        if (typeof node === 'string') {
          const c = points[node];
          if (!c) throw new Error(`Missing coordinate for ${node} in branch ${br.id}`);
          // For contralateral nose crossing (`LI-cross-nose`), flip X of destination (`LI20`)!
          const xSign = br.crossFromIndex !== undefined && idx > br.crossFromIndex ? -1 : 1;
          return {
            pos: new THREE.Vector3(c.position[0] * xSign, c.position[1], c.position[2]),
            normal: new THREE.Vector3(c.normal[0] * xSign, c.normal[1], c.normal[2]).normalize(),
          };
        }
        const [x, y, z, nx, ny, nz] = node;
        return snapGuideToSkin(
          geometry,
          frontMesh,
          raycaster,
          new THREE.Vector3(x, y, z),
          new THREE.Vector3(nx, ny, nz),
          Boolean(br.midline),
        );
      });

      const dense = densifyBranchOnSkin(
        geometry,
        frontMesh,
        raycaster,
        resolvedNodes,
        Boolean(br.midline),
      );

      outputMeridians[mCode].push({
        id: br.id,
        bilateral: br.bilateral,
        points: dense.map((d) => round3(d.pos, 4)),
        normals: dense.map((d) => round3(d.normal, 3)),
      });

      totalBranches += 1;
      totalVertices += dense.length;
    }
  }

  const outPath = path.join(rootDir, 'data', 'meridian-paths.json');
  fs.writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        modelId: coordData.modelId,
        meridians: outputMeridians,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(
    `[build_meridian_paths] Wrote data/meridian-paths.json: 14 meridians, ${totalBranches} branches, ${totalVertices} skin-hugging path vertices.`,
  );
}

main();
