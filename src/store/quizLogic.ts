import type { Acupoint, Coordinates3DFile, MeridianCode, QuizScope } from '../types/atlas';
import { getPinyinInitials } from '../utils/searchMatch';
import { meridianOf, plainPinyin } from '../utils/acupointMeta';

/** Answer within this surface distance (cm) on the 1.75 m model counts as a correct "看名找穴" pick (~1 寸). */
export const LOCATE_TOLERANCE_CM = 3;

export interface QuizPoolContext {
  acupoints: Acupoint[];
  coordinates: Coordinates3DFile | null;
  visibleMeridians: MeridianCode[];
  selectedAcupointId: string | null;
  specialFilter: string | null;
  wrongCodes: string[];
}

export function buildQuizPool(ctx: QuizPoolContext, scope: QuizScope): Acupoint[] {
  const modeled = ctx.acupoints.filter((a) => Boolean(ctx.coordinates?.points[a.code]));
  let pool: Acupoint[] = modeled;
  if (scope === 'meridian') {
    const m: MeridianCode | undefined = ctx.selectedAcupointId
      ? meridianOf(ctx.selectedAcupointId)
      : ctx.visibleMeridians[0];
    pool = m ? modeled.filter((a) => a.meridianCode === m) : modeled;
  } else if (scope === 'visible') {
    const set = new Set(ctx.visibleMeridians);
    pool = modeled.filter((a) => set.has(a.meridianCode));
  } else if (scope === 'core') {
    pool = modeled.filter((a) => a.textbookScope === 'undergraduate_core');
  } else if (scope === 'special') {
    pool = ctx.specialFilter
      ? modeled.filter((a) => a.specialCategory.some((c) => c.includes(ctx.specialFilter as string)))
      : modeled.filter((a) => a.specialCategory.length > 0);
  } else if (scope === 'wrong') {
    const set = new Set(ctx.wrongCodes);
    pool = modeled.filter((a) => set.has(a.code));
  }
  return pool.length > 0 ? pool : modeled;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Four-option multiple choice: prefer same-meridian distractors (harder, more pedagogical). */
export function makeQuizOptions(target: Acupoint, all: Acupoint[], n = 4): string[] {
  const same = shuffle(all.filter((a) => a.meridianCode === target.meridianCode && a.code !== target.code));
  const others = shuffle(all.filter((a) => a.meridianCode !== target.meridianCode));
  const picks: string[] = [];
  for (const a of [...same.slice(0, 2), ...others]) {
    if (picks.length >= n - 1) break;
    if (!picks.includes(a.code)) picks.push(a.code);
  }
  for (const a of same.slice(2)) {
    if (picks.length >= n - 1) break;
    if (!picks.includes(a.code)) picks.push(a.code);
  }
  return shuffle([target.code, ...picks]);
}

export function checkTypedAnswer(target: Acupoint, input: string): boolean {
  const raw = input.trim();
  if (!raw) return false;
  const q = plainPinyin(raw);
  return (
    raw === target.name ||
    q === plainPinyin(target.pinyin) ||
    q === getPinyinInitials(target.pinyin) ||
    q === target.code.toLowerCase()
  );
}

export function pickNextQuizTarget(pool: Acupoint[], avoidCode: string | null): Acupoint | null {
  if (pool.length === 0) return null;
  const candidates = pool.length > 1 ? pool.filter((a) => a.code !== avoidCode) : pool;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0];
}
