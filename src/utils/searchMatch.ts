import type { Acupoint } from '../types/atlas';

const PINYIN_FINALS = [
  'iang', 'iong', 'uang',
  'ang', 'eng', 'ing', 'ong', 'iao', 'ian', 'uan', 'uai',
  'ai', 'ei', 'ui', 'ao', 'ou', 'iu', 'ie', 'ue', 've', 'er', 'an', 'en', 'in', 'un', 'vn', 'ia', 'ua', 'uo',
  'a', 'o', 'e', 'i', 'u', 'v',
];

const PINYIN_INITIALS = [
  'zh', 'ch', 'sh',
  'b', 'p', 'm', 'f', 'd', 't', 'n', 'l',
  'g', 'k', 'h', 'j', 'q', 'x',
  'r', 'z', 'c', 's', 'y', 'w',
];

const VALID_SYLLABLES: Set<string> = (() => {
  const set = new Set<string>(PINYIN_FINALS);
  for (const init of PINYIN_INITIALS) {
    for (const fin of PINYIN_FINALS) {
      set.add(init + fin);
    }
  }
  return set;
})();

const ACUPOINT_ALIASES: Record<string, string[]> = {
  GV26: ['人中', 'renzhong', 'rz'],
  ST35: ['外膝眼', 'waixiyan', 'wxy'],
  LI4: ['虎口', 'hukou'],
  CV8: ['肚脐', '脐中', 'duqi'],
  GV14: ['百劳'],
  PC6: ['内关'],
  GB39: ['绝骨', 'juegu', 'jg'],
  KI3: ['吕细'],
  BL40: ['血郄', '腘中'],
};

const pinyinInitialsCache = new Map<string, string>();

/**
 * Extracts Hanyu Pinyin syllable initials from concatenated Pinyin (e.g. "Zusanli" -> "zsl", "Taiyuan" -> "ty").
 */
export function getPinyinInitials(pinyin: string): string {
  const cached = pinyinInitialsCache.get(pinyin);
  if (cached !== undefined) return cached;

  const clean = pinyin
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z']/g, '');

  const parts = clean.split("'").filter(Boolean);
  const syllables: string[] = [];

  for (const part of parts) {
    let idx = 0;
    while (idx < part.length) {
      let matched = '';
      const maxLen = Math.min(6, part.length - idx);
      for (let len = maxLen; len >= 1; len--) {
        const sub = part.slice(idx, idx + len);
        if (VALID_SYLLABLES.has(sub)) {
          // Avoid consuming a trailing consonant ('n' or 'g') that actually starts the next valid vowel syllable
          const rem = part.slice(idx + len);
          if (
            (sub.endsWith('n') || sub.endsWith('g')) &&
            len > 2 &&
            rem.length > 0 &&
            /^[aeiou]/.test(rem) &&
            VALID_SYLLABLES.has(sub.slice(0, -1))
          ) {
            continue;
          }
          matched = sub;
          break;
        }
      }
      if (matched) {
        syllables.push(matched);
        idx += matched.length;
      } else {
        syllables.push(part[idx]);
        idx += 1;
      }
    }
  }

  const initials = syllables.map((s) => s[0]).join('');
  pinyinInitialsCache.set(pinyin, initials);
  return initials;
}

/**
 * Normalizes user query, mapping common TCM legacy meridian prefixes (SJ->TE, RN/REN->CV, DU->GV).
 */
export function normalizeAcupointQuery(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^sj(?=\d)/, 'te')
    .replace(/^(?:rn|ren)(?=\d)/, 'cv')
    .replace(/^du(?=\d)/, 'gv');
}

export function matchesAcupointQuery(
  acupoint: Acupoint | undefined,
  code: string,
  rawQuery: string,
  specialFilter: string | null,
): boolean {
  if (specialFilter) {
    if (!acupoint) return false;
    const hitSpecial = acupoint.specialCategory.some((cat) => cat.includes(specialFilter));
    if (!hitSpecial) return false;
  }

  const q = normalizeAcupointQuery(rawQuery);
  if (!q) return true;

  if (!acupoint) {
    return code.toLowerCase().includes(q);
  }

  const initials = getPinyinInitials(acupoint.pinyin);
  const aliases = ACUPOINT_ALIASES[acupoint.code] ?? [];

  const haystack = [
    acupoint.code.toLowerCase(),
    acupoint.name.toLowerCase(),
    acupoint.pinyin.toLowerCase().replace(/'/g, ''),
    initials,
    ...aliases.map((a) => a.toLowerCase()),
    ...acupoint.specialCategory.map((c) => c.toLowerCase()),
    ...acupoint.clinical.indications.map((i) => i.toLowerCase()),
    acupoint.clinical.functions.toLowerCase(),
  ];

  return haystack.some((field) => field.includes(q));
}
