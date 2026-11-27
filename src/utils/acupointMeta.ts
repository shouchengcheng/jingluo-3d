import type { Acupoint, MeridianCode } from '../types/atlas';

/** Twelve-meridian circulation order (流注次序) followed by Ren / Du (UI audit 5.3). */
export const MERIDIAN_FLOW_ORDER: MeridianCode[] = [
  'LU',
  'LI',
  'ST',
  'SP',
  'HT',
  'SI',
  'BL',
  'KI',
  'PC',
  'TE',
  'GB',
  'LR',
  'CV',
  'GV',
];

export function meridianFlowIndex(code: string): number {
  const idx = MERIDIAN_FLOW_ORDER.indexOf(code as MeridianCode);
  return idx < 0 ? 99 : idx;
}

export function parseOrder(code: string): number {
  const m = code.match(/\d+$/);
  return m ? Number.parseInt(m[0], 10) : 0;
}

export function meridianOf(code: string): MeridianCode {
  return code.replace(/\d+$/, '') as MeridianCode;
}

export function isBilateralCode(code: string): boolean {
  const prefix = meridianOf(code);
  return prefix !== 'CV' && prefix !== 'GV';
}

/** Special-point filter groups shown as horizontal chips (UI audit 3.3). */
export const SPECIAL_CATEGORIES = [
  '五输穴',
  '原穴',
  '络穴',
  '背俞穴',
  '募穴',
  '郄穴',
  '下合穴',
  '八会穴',
  '八脉交会穴',
  '交会穴',
  '四总穴',
];

/** One-character mini badges for list rows (UI audit 5.4). */
export function specialBadges(categories: string[]): string[] {
  const out: string[] = [];
  for (const cat of categories) {
    let b: string | null = null;
    if (cat.startsWith('五输穴-')) {
      const sub = cat.slice(4);
      b = sub.replace('穴', '');
    } else if (cat.startsWith('原穴')) b = '原';
    else if (cat.startsWith('络穴') || cat.includes('大络')) b = '络';
    else if (cat.startsWith('募穴')) b = '募';
    else if (cat.startsWith('背俞穴')) b = '俞';
    else if (cat.startsWith('郄穴')) b = '郄';
    else if (cat.startsWith('下合穴')) b = '下合';
    else if (cat.startsWith('八会穴')) b = '会';
    else if (cat.startsWith('八脉交会穴')) b = '八脉';
    if (b && !out.includes(b)) out.push(b);
  }
  return out.slice(0, 3);
}

/** Base category used for cross-meridian tag filtering (e.g. "募穴-肺募" -> "募穴"). */
export function categoryBase(cat: string): string {
  const idx = cat.indexOf('-');
  return idx > 0 ? cat.slice(0, idx) : cat;
}

export function sortByFlow(a: Acupoint, b: Acupoint): number {
  const ma = meridianFlowIndex(a.meridianCode);
  const mb = meridianFlowIndex(b.meridianCode);
  if (ma !== mb) return ma - mb;
  return parseOrder(a.code) - parseOrder(b.code);
}

/** Strip tone marks / apostrophes / spaces for pinyin answer matching. */
export function plainPinyin(pinyin: string): string {
  return pinyin
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ü/g, 'v')
    .replace(/['’\s-]/g, '')
    .toLowerCase();
}
