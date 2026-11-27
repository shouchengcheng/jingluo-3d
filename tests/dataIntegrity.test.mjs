import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateAllData } from '../scripts/validate_data.mjs';

describe('TCM dataset schemas, 3D outward normals & meridian topology integrity', () => {
  it('passes all JSON Schema, 3D surface proximity, outward normal, path & prescription checks', () => {
    const result = validateAllData();
    assert.equal(
      result.ok,
      true,
      `Data validation failed:\n${result.errors.join('\n')}`,
    );
    assert.equal(result.summary.meridianCount, 14);
    assert.equal(result.summary.acupointCount, 151);
    assert.equal(result.summary.withCoordCount, 151);
  });
});
