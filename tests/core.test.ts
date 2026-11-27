import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  getPinyinInitials,
  matchesAcupointQuery,
  normalizeAcupointQuery,
} from '../src/utils/searchMatch';
import { extractSafetyNotice } from '../src/utils/safety';
import {
  categoryBase,
  isBilateralCode,
  meridianFlowIndex,
  plainPinyin,
  specialBadges,
} from '../src/utils/acupointMeta';
import {
  buildQuizPool,
  checkTypedAnswer,
  makeQuizOptions,
} from '../src/store/quizLogic';
import { buildDeepLinkUrl, parseUrlDeepLink } from '../src/utils/urlSync';
import type { Acupoint, Coordinates3DFile } from '../src/types/atlas';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function loadAllAcupoints(): Acupoint[] {
  const dir = path.join(rootDir, 'data', 'acupoints');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Acupoint[]);
}

const allAcupoints = loadAllAcupoints();
const coordFile = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'data', 'coordinates-3d.json'), 'utf8'),
) as Coordinates3DFile;

describe('searchMatch — multi-dimensional TCM search', () => {
  it('extracts accurate Pinyin syllable initials', () => {
    assert.equal(getPinyinInitials('Zusanli'), 'zsl');
    assert.equal(getPinyinInitials('Taiyuan'), 'ty');
    assert.equal(getPinyinInitials('Baihui'), 'bh');
    assert.equal(getPinyinInitials("Tian'tu"), 'tt');
  });

  it('normalizes legacy meridian prefixes (SJ->TE, RN/REN->CV, DU->GV)', () => {
    assert.equal(normalizeAcupointQuery('SJ5'), 'te5');
    assert.equal(normalizeAcupointQuery('RN 12'), 'cv12');
    assert.equal(normalizeAcupointQuery('ren4'), 'cv4');
    assert.equal(normalizeAcupointQuery('DU20'), 'gv20');
  });

  it('matches by Pinyin initials, clinical alias, indication, and special category', () => {
    const st36 = allAcupoints.find((a) => a.code === 'ST36');
    const gv26 = allAcupoints.find((a) => a.code === 'GV26');
    const lu9 = allAcupoints.find((a) => a.code === 'LU9');
    assert.ok(st36 && gv26 && lu9);

    assert.equal(matchesAcupointQuery(st36, 'ST36', 'zsl', null), true);
    assert.equal(matchesAcupointQuery(st36, 'ST36', '胃痛', null), true);
    assert.equal(matchesAcupointQuery(gv26, 'GV26', '人中', null), true);
    assert.equal(matchesAcupointQuery(gv26, 'GV26', 'du26', null), true);
    assert.equal(matchesAcupointQuery(lu9, 'LU9', '', '八会穴'), true);
    assert.equal(matchesAcupointQuery(lu9, 'LU9', '', '背俞穴'), false);
  });
});

describe('safety — clinical contraindication extraction', () => {
  it('flags pneumothorax, forbidden needling, and medulla oblongata risks as danger', () => {
    const lu1 = allAcupoints.find((a) => a.code === 'LU1');
    const cv8 = allAcupoints.find((a) => a.code === 'CV8');
    const gv16 = allAcupoints.find((a) => a.code === 'GV16');
    assert.equal(extractSafetyNotice(lu1?.clinical.operation)?.level, 'danger');
    assert.equal(extractSafetyNotice(cv8?.clinical.operation)?.level, 'danger');
    assert.equal(extractSafetyNotice(gv16?.clinical.operation)?.level, 'danger');
  });

  it('flags radial artery / pregnancy precautions as caution', () => {
    const lu9 = allAcupoints.find((a) => a.code === 'LU9');
    const li4 = allAcupoints.find((a) => a.code === 'LI4');
    assert.equal(extractSafetyNotice(lu9?.clinical.operation)?.level, 'caution');
    assert.equal(extractSafetyNotice(li4?.clinical.operation)?.level, 'caution');
  });
});

describe('acupointMeta & quizLogic', () => {
  it('orders 14 meridians by Qi circulation sequence and extracts concise badges', () => {
    assert.equal(meridianFlowIndex('LU'), 0);
    assert.equal(meridianFlowIndex('LR'), 11);
    assert.equal(meridianFlowIndex('CV'), 12);
    assert.equal(meridianFlowIndex('GV'), 13);
    assert.equal(isBilateralCode('LU9'), true);
    assert.equal(isBilateralCode('CV12'), false);
    assert.equal(categoryBase('募穴-肺募'), '募穴');
    assert.deepEqual(specialBadges(['五输穴-输穴', '原穴', '八会穴-脉会']), ['输', '原', '会']);
    assert.equal(plainPinyin('Zúsānlǐ'), 'zusanli');
  });

  it('builds scoped quiz pools, 4 unique options, and validates typed recall', () => {
    const lu9 = allAcupoints.find((a) => a.code === 'LU9')!;
    const opts = makeQuizOptions(lu9, allAcupoints);
    assert.equal(opts.length, 4);
    assert.equal(new Set(opts).size, 4);
    assert.equal(opts.includes('LU9'), true);

    assert.equal(checkTypedAnswer(lu9, '太渊'), true);
    assert.equal(checkTypedAnswer(lu9, 'taiyuan'), true);
    assert.equal(checkTypedAnswer(lu9, 'ty'), true);
    assert.equal(checkTypedAnswer(lu9, 'lu9'), true);
    assert.equal(checkTypedAnswer(lu9, '列缺'), false);

    const luPool = buildQuizPool(
      {
        acupoints: allAcupoints,
        coordinates: coordFile,
        visibleMeridians: ['LU'],
        selectedAcupointId: 'LU9',
        specialFilter: null,
        wrongCodes: ['ST36'],
      },
      'meridian',
    );
    assert.equal(luPool.length, 11);

    const wrongPool = buildQuizPool(
      {
        acupoints: allAcupoints,
        coordinates: coordFile,
        visibleMeridians: ['LU'],
        selectedAcupointId: 'LU9',
        specialFilter: null,
        wrongCodes: ['ST36', 'LI4'],
      },
      'wrong',
    );
    assert.equal(wrongPool.length, 2);
  });
});

describe('urlSync — classroom deep-link round-trip', () => {
  it('parses and reconstructs deep-link query parameters', () => {
    const parsed = parseUrlDeepLink('?p=lu9&m=lu,li&side=L&theme=paper&rx=siguan&quiz=1');
    assert.equal(parsed.point, 'LU9');
    assert.deepEqual(parsed.meridians, ['LU', 'LI']);
    assert.equal(parsed.side, -1);
    assert.equal(parsed.theme, 'paper');
    assert.equal(parsed.prescriptionId, 'siguan');
    assert.equal(parsed.quiz, true);

    // Simulate window.location for buildDeepLinkUrl
    const prevWin = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      location: { href: 'https://example.edu/jingluo-3d/' },
    };
    try {
      const built = buildDeepLinkUrl({
        selectedAcupointId: 'LU9',
        visibleMeridians: ['LU', 'LI'],
        activeSide: -1,
        uiTheme: 'paper',
        activePrescriptionId: 'siguan',
        isQuizMode: false,
      });
      assert.equal(
        built,
        'https://example.edu/jingluo-3d/?p=LU9&m=LU%2CLI&side=L&theme=paper&rx=siguan',
      );
    } finally {
      (globalThis as { window?: unknown }).window = prevWin;
    }
  });
});
