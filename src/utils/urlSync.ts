import type { MeridianCode, UiTheme } from '../types/atlas';
import { MERIDIAN_FLOW_ORDER } from './acupointMeta';

const VALID_MERIDIANS = new Set<string>(MERIDIAN_FLOW_ORDER);

export interface UrlDeepLinkState {
  point?: string;
  meridians?: MeridianCode[];
  side?: 1 | -1;
  theme?: UiTheme;
  prescriptionId?: string;
  quiz?: boolean;
}

export function parseUrlDeepLink(search: string = window.location.search): UrlDeepLinkState {
  const params = new URLSearchParams(search);
  const out: UrlDeepLinkState = {};

  const p = params.get('p')?.trim().toUpperCase();
  if (p && /^(LU|LI|ST|SP|HT|SI|BL|KI|PC|TE|GB|LR|CV|GV)\d{1,2}$/.test(p)) {
    out.point = p;
  }

  const mRaw = params.get('m');
  if (mRaw) {
    const codes = mRaw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is MeridianCode => VALID_MERIDIANS.has(s));
    if (codes.length > 0) out.meridians = codes;
  }

  const side = params.get('side')?.toUpperCase();
  if (side === 'L') out.side = -1;
  else if (side === 'R') out.side = 1;

  const theme = params.get('theme');
  if (theme === 'ink' || theme === 'paper') out.theme = theme;

  const rx = params.get('rx')?.trim();
  if (rx) out.prescriptionId = rx;

  if (params.get('quiz') === '1') out.quiz = true;

  return out;
}

export function buildDeepLinkUrl(input: {
  selectedAcupointId: string | null;
  visibleMeridians: MeridianCode[];
  activeSide: 1 | -1;
  uiTheme: UiTheme;
  activePrescriptionId: string | null;
  isQuizMode: boolean;
}): string {
  const url = new URL(window.location.href);
  const params = new URLSearchParams();

  if (input.selectedAcupointId) params.set('p', input.selectedAcupointId);
  if (input.visibleMeridians.length > 0 && input.visibleMeridians.length < 14) {
    params.set('m', input.visibleMeridians.join(','));
  } else if (input.visibleMeridians.length === 14) {
    params.set('m', input.visibleMeridians.join(','));
  }
  if (input.activeSide === -1) params.set('side', 'L');
  if (input.uiTheme === 'paper') params.set('theme', 'paper');
  if (input.activePrescriptionId) params.set('rx', input.activePrescriptionId);
  if (input.isQuizMode) params.set('quiz', '1');

  url.search = params.toString();
  return url.toString();
}

export function syncUrlReplaceState(urlStr: string): void {
  try {
    if (typeof window === 'undefined' || window.location.protocol === 'file:') return;
    const next = new URL(urlStr);
    if (next.search === window.location.search) return;
    window.history.replaceState(null, '', `${next.pathname}${next.search}${next.hash}`);
  } catch {
    /* ignore history errors in sandboxed iframes */
  }
}
