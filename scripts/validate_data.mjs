import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);

  const acupointSchema = readJson(path.join(dataDir, 'schema', 'acupoint.schema.json'));
  const coord3dSchema = readJson(path.join(dataDir, 'schema', 'coord3d.schema.json'));

  const validateAcupointList = ajv.compile(acupointSchema);
  const validateCoord3d = ajv.compile(coord3dSchema);

  let hasErrors = false;

  // 1. Validate meridians.json
  const meridiansPath = path.join(dataDir, 'meridians.json');
  const meridians = readJson(meridiansPath);
  const meridianCodes = new Set(meridians.map((m) => m.code));
  if (meridianCodes.size !== 14) {
    console.error(`[ERROR] Expected 14 unique meridians in data/meridians.json, found ${meridianCodes.size}`);
    hasErrors = true;
  }

  // 2. Validate acupoint datasets under data/acupoints/*.json
  const acupointsDir = path.join(dataDir, 'acupoints');
  const seenAcupointCodes = new Set();
  const acupointFiles = fs
    .readdirSync(acupointsDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  for (const file of acupointFiles) {
    const filePath = path.join(acupointsDir, file);
    const items = readJson(filePath);
    const valid = validateAcupointList(items);
    if (!valid) {
      console.error(`[ERROR] Schema validation failed for data/acupoints/${file}:`);
      console.error(ajv.errorsText(validateAcupointList.errors, { separator: '\n  ' }));
      hasErrors = true;
      continue;
    }

    const expectedMeridian = path.basename(file, '.json');
    for (const item of items) {
      if (item.meridianCode !== expectedMeridian) {
        console.error(
          `[ERROR] ${item.code} in ${file} has meridianCode="${item.meridianCode}" (expected "${expectedMeridian}")`,
        );
        hasErrors = true;
      }
      if (seenAcupointCodes.has(item.code)) {
        console.error(`[ERROR] Duplicate GB/T 12346-2021 acupoint code: ${item.code}`);
        hasErrors = true;
      }
      seenAcupointCodes.add(item.code);
    }
  }

  // 3. Validate coordinates-3d.json
  const coordPath = path.join(dataDir, 'coordinates-3d.json');
  const coordData = readJson(coordPath);
  if (!validateCoord3d(coordData)) {
    console.error('[ERROR] Schema validation failed for data/coordinates-3d.json:');
    console.error(ajv.errorsText(validateCoord3d.errors, { separator: '\n  ' }));
    hasErrors = true;
  }

  let draftCount = 0;
  let verifiedCount = 0;
  for (const [code, point] of Object.entries(coordData.points ?? {})) {
    if (point.audit.status === 'gb_verified') {
      verifiedCount += 1;
      if (!point.audit.verifiedAt) {
        console.error(`[ERROR] Coordinate "${code}" is marked gb_verified but verifiedAt is null`);
        hasErrors = true;
      }
    } else {
      draftCount += 1;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  console.log(
    `[OK] Data validation passed: ${meridianCodes.size} meridians, ${seenAcupointCodes.size} acupoints, ${
      draftCount + verifiedCount
    } 3D coordinates (gb_verified: ${verifiedCount}, draft_imported: ${draftCount}).`,
  );
}

main();
