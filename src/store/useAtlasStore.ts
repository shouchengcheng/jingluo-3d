import { create } from 'zustand';
import type {
  Acupoint,
  AcupointCoordinate3D,
  BodyTheme,
  CameraPreset,
  Coordinates3DFile,
  DisplaySide,
  FocusMode,
  MeridianCode,
  MeridianMeta,
  QuizKind,
  QuizQuestion,
  QuizScope,
  QuizStats,
  RegionPreset,
  UiTheme,
  Vec3Tuple,
  ViewPreset,
} from '../types/atlas';
import { isBilateralCode, meridianOf, parseOrder } from '../utils/acupointMeta';
import { matchesAcupointQuery } from '../utils/searchMatch';
import {
  LOCATE_TOLERANCE_CM,
  buildQuizPool,
  checkTypedAnswer,
  makeQuizOptions,
  pickNextQuizTarget,
} from './quizLogic';

export interface SurfaceCalibrationPayload {
  position: Vec3Tuple;
  normal: Vec3Tuple;
  cameraPreset: CameraPreset;
}

export const QUIZ_REVEAL_TOKEN = '__reveal__';

const PREFS_KEY = 'jingluo3d.prefs.v1';

interface PersistedPrefs {
  uiTheme?: UiTheme;
  bigScreen?: boolean;
  bodyTheme?: BodyTheme;
  leftPanelWidth?: number;
  leftPanelCollapsed?: boolean;
}

function readPrefs(): PersistedPrefs {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as PersistedPrefs) : {};
  } catch {
    return {};
  }
}

function writePrefs(patch: PersistedPrefs): void {
  try {
    if (typeof window === 'undefined') return;
    const next = { ...readPrefs(), ...patch };
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode) — ignore */
  }
}

const initialPrefs = readPrefs();

export interface AtlasState {
  isLoading: boolean;
  loadError: string | null;
  meridians: MeridianMeta[];
  acupoints: Acupoint[];
  coordinates: Coordinates3DFile | null;
  initialCoordinatesSnapshot: Coordinates3DFile | null;

  selectedAcupointId: string | null;
  activeSide: 1 | -1;
  visibleMeridians: MeridianCode[];
  multiCompare: boolean;
  searchQuery: string;
  specialFilter: string | null;
  recentIds: string[];
  listHoverCode: string | null;

  // Quiz (blind-test) state — UI audit section 7
  isQuizMode: boolean;
  quizKind: QuizKind;
  quizScope: QuizScope;
  quizTeacher: boolean;
  quizQuestion: QuizQuestion | null;
  quizStats: QuizStats;
  quizWrongCodes: string[];

  // Viewport / chrome preferences
  uiTheme: UiTheme;
  bigScreen: boolean;
  leftPanelWidth: number;
  leftPanelCollapsed: boolean;
  displaySide: DisplaySide;
  bodyTheme: BodyTheme;
  bodyOpacity: number;
  wireframeOverlay: boolean;
  flowAnimation: boolean;
  showLabels: boolean;
  /** Pixels of the canvas covered by the mobile bottom sheet; engine shifts the view centre upward. */
  viewportBottomInset: number;

  viewRequest: { preset: ViewPreset; nonce: number } | null;
  regionRequest: { preset: RegionPreset; nonce: number } | null;
  focusRequest: { mode: FocusMode; nonce: number };

  // DEV-only calibration states
  auditMode: boolean;
  surfacePickArmed: boolean;
  dirtyCoordinateCodes: string[];
  liveCameraGetter: (() => CameraPreset | null) | null;

  // Actions
  setAtlasBundle: (payload: {
    meridians: MeridianMeta[];
    acupoints: Acupoint[];
    coordinates: Coordinates3DFile;
  }) => void;
  setLoadError: (err: string | null) => void;
  selectAcupoint: (
    id: string | null,
    options?: { focus?: FocusMode | false; side?: 1 | -1 },
  ) => void;
  stepSibling: (dir: 1 | -1) => void;
  flipActiveSide: () => void;
  selectMeridian: (code: MeridianCode, additive?: boolean) => void;
  toggleMeridian: (code: MeridianCode) => void;
  setVisibleMeridians: (codes: MeridianCode[]) => void;
  setMultiCompare: (enabled: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSpecialFilter: (category: string | null) => void;
  applyTagFilter: (tag: { category?: string; indication?: string }) => void;
  clearFilters: () => void;
  setListHoverCode: (code: string | null) => void;

  setQuizMode: (enabled: boolean) => void;
  setQuizKind: (kind: QuizKind) => void;
  setQuizScope: (scope: QuizScope) => void;
  setQuizTeacher: (enabled: boolean) => void;
  nextQuizQuestion: () => void;
  answerQuizChoice: (code: string) => void;
  answerQuizTyped: (input: string) => boolean;
  answerQuizLocate: (point: Vec3Tuple) => void;
  revealQuizAnswer: () => void;
  resetQuizStats: () => void;
  /** Legacy alias kept for callers: enter quiz mode and draw a question. */
  pickRandomQuizAcupoint: () => void;

  setUiTheme: (theme: UiTheme) => void;
  setBigScreen: (enabled: boolean) => void;
  setLeftPanelWidth: (px: number) => void;
  setLeftPanelCollapsed: (collapsed: boolean) => void;
  setDisplaySide: (side: DisplaySide) => void;
  setBodyTheme: (theme: BodyTheme) => void;
  setBodyOpacity: (opacity: number) => void;
  setWireframeOverlay: (enabled: boolean) => void;
  setFlowAnimation: (enabled: boolean) => void;
  setShowLabels: (enabled: boolean) => void;
  setViewportBottomInset: (px: number) => void;
  requestViewPreset: (preset: ViewPreset) => void;
  requestRegionPreset: (preset: RegionPreset) => void;
  requestFocusSelected: (mode?: FocusMode) => void;

  // DEV Audit Calibration Actions
  setAuditMode: (enabled: boolean) => void;
  setSurfacePickArmed: (armed: boolean) => void;
  registerLiveCameraGetter: (getter: (() => CameraPreset | null) | null) => void;
  applySurfaceCalibration: (code: string, payload: SurfaceCalibrationPayload) => void;
  captureCurrentCameraForSelected: () => boolean;
  setCoordinateVerified: (code: string, verified: boolean) => void;
  resetCoordinate: (code: string) => void;
  resetAllCoordinates: () => void;
}

const EMPTY_STATS: QuizStats = { total: 0, correct: 0, streak: 0, bestStreak: 0 };

function pushRecent(recent: string[], id: string): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, 5);
}

function scoreAnswer(
  stats: QuizStats,
  wrong: string[],
  code: string,
  correct: boolean,
): { quizStats: QuizStats; quizWrongCodes: string[] } {
  const streak = correct ? stats.streak + 1 : 0;
  return {
    quizStats: {
      total: stats.total + 1,
      correct: stats.correct + (correct ? 1 : 0),
      streak,
      bestStreak: Math.max(stats.bestStreak, streak),
    },
    quizWrongCodes: correct
      ? wrong.filter((c) => c !== code)
      : wrong.includes(code)
        ? wrong
        : [...wrong, code],
  };
}

export const useAtlasStore = create<AtlasState>((set, get) => ({
  isLoading: true,
  loadError: null,
  meridians: [],
  acupoints: [],
  coordinates: null,
  initialCoordinatesSnapshot: null,

  selectedAcupointId: 'LU9',
  activeSide: 1,
  visibleMeridians: ['LU'],
  multiCompare: false,
  searchQuery: '',
  specialFilter: null,
  recentIds: [],
  listHoverCode: null,

  isQuizMode: false,
  quizKind: 'identify',
  quizScope: 'visible',
  quizTeacher: false,
  quizQuestion: null,
  quizStats: EMPTY_STATS,
  quizWrongCodes: [],

  uiTheme: initialPrefs.uiTheme ?? 'ink',
  bigScreen: initialPrefs.bigScreen ?? false,
  leftPanelWidth: initialPrefs.leftPanelWidth ?? 320,
  leftPanelCollapsed: initialPrefs.leftPanelCollapsed ?? false,
  displaySide: 'both',
  bodyTheme: initialPrefs.bodyTheme ?? 'jade',
  bodyOpacity: 0.96,
  wireframeOverlay: false,
  flowAnimation: true,
  showLabels: true,
  viewportBottomInset: 0,

  viewRequest: null,
  regionRequest: null,
  focusRequest: { mode: 'full', nonce: 0 },

  auditMode: false,
  surfacePickArmed: false,
  dirtyCoordinateCodes: [],
  liveCameraGetter: null,

  setAtlasBundle: ({ meridians, acupoints, coordinates }) =>
    set({
      isLoading: false,
      loadError: null,
      meridians,
      acupoints,
      coordinates: structuredClone(coordinates),
      initialCoordinatesSnapshot: structuredClone(coordinates),
      selectedAcupointId: acupoints.some((a) => a.code === 'LU9')
        ? 'LU9'
        : (acupoints[0]?.code ?? null),
    }),

  setLoadError: (err) => set({ isLoading: false, loadError: err }),

  selectAcupoint: (id, options) =>
    set((state) => {
      const nextSide = options?.side ?? state.activeSide;
      let nextVisible = state.visibleMeridians;
      if (id) {
        const m = meridianOf(id);
        if (!nextVisible.includes(m)) nextVisible = [...nextVisible, m];
      }
      const focus = options?.focus;
      return {
        selectedAcupointId: id,
        activeSide: nextSide,
        visibleMeridians: nextVisible,
        recentIds: id && !state.isQuizMode ? pushRecent(state.recentIds, id) : state.recentIds,
        focusRequest: focus
          ? { mode: focus, nonce: state.focusRequest.nonce + 1 }
          : state.focusRequest,
      };
    }),

  stepSibling: (dir) => {
    const state = get();
    const current = state.selectedAcupointId;
    if (!current) return;
    const m = meridianOf(current);
    const siblings = state.acupoints
      .filter((a) => a.meridianCode === m)
      .sort((a, b) => parseOrder(a.code) - parseOrder(b.code));
    const idx = siblings.findIndex((s) => s.code === current);
    const next = siblings[idx + dir];
    if (next) state.selectAcupoint(next.code, { focus: 'auto' });
  },

  flipActiveSide: () =>
    set((state) => {
      const side: 1 | -1 = state.activeSide === 1 ? -1 : 1;
      return {
        activeSide: side,
        displaySide: state.displaySide === 'both' ? 'both' : side === 1 ? 'right' : 'left',
        focusRequest: { mode: 'auto', nonce: state.focusRequest.nonce + 1 },
      };
    }),

  selectMeridian: (code, additive) =>
    set((state) => {
      if (additive || state.multiCompare) {
        const exists = state.visibleMeridians.includes(code);
        return {
          visibleMeridians: exists
            ? state.visibleMeridians.filter((m) => m !== code)
            : [...state.visibleMeridians, code],
        };
      }
      const selectedStillVisible =
        state.selectedAcupointId && meridianOf(state.selectedAcupointId) === code;
      return {
        visibleMeridians: [code],
        selectedAcupointId: selectedStillVisible ? state.selectedAcupointId : null,
      };
    }),

  toggleMeridian: (code) =>
    set((state) => {
      const exists = state.visibleMeridians.includes(code);
      return {
        visibleMeridians: exists
          ? state.visibleMeridians.filter((m) => m !== code)
          : [...state.visibleMeridians, code],
      };
    }),

  setVisibleMeridians: (codes) => set({ visibleMeridians: codes }),
  setMultiCompare: (multiCompare) => set({ multiCompare }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSpecialFilter: (specialFilter) =>
    set((state) => {
      if (!specialFilter) return { specialFilter };
      // Reveal every meridian that contains matches so 3D markers and list stay consistent
      const hits = new Set<MeridianCode>();
      for (const a of state.acupoints) {
        if (a.specialCategory.some((c) => c.includes(specialFilter))) hits.add(a.meridianCode);
      }
      return {
        specialFilter,
        visibleMeridians: hits.size > 0 ? [...hits] : state.visibleMeridians,
      };
    }),

  applyTagFilter: ({ category, indication }) =>
    set((state) => {
      const q = indication ?? '';
      const special = category ?? null;
      const hits = new Set<MeridianCode>();
      for (const a of state.acupoints) {
        if (matchesAcupointQuery(a, a.code, q, special)) hits.add(a.meridianCode);
      }
      return {
        searchQuery: q,
        specialFilter: special,
        visibleMeridians: hits.size > 0 ? [...hits] : state.visibleMeridians,
      };
    }),

  clearFilters: () => set({ searchQuery: '', specialFilter: null }),
  setListHoverCode: (listHoverCode) => set({ listHoverCode }),

  // ---------------------------------------------------------------- Quiz
  setQuizMode: (enabled) => {
    if (enabled) {
      set({ isQuizMode: true, quizQuestion: null });
      get().nextQuizQuestion();
    } else {
      set((state) => ({
        isQuizMode: false,
        quizQuestion: null,
        selectedAcupointId: state.quizQuestion?.code ?? state.selectedAcupointId,
      }));
    }
  },

  setQuizKind: (quizKind) => {
    set({ quizKind });
    if (get().isQuizMode) get().nextQuizQuestion();
  },

  setQuizScope: (quizScope) => {
    set({ quizScope });
    if (get().isQuizMode) get().nextQuizQuestion();
  },

  setQuizTeacher: (quizTeacher) => set({ quizTeacher }),

  nextQuizQuestion: () =>
    set((state) => {
      if (!state.coordinates || state.acupoints.length === 0) return state;
      const pool = buildQuizPool(
        {
          acupoints: state.acupoints,
          coordinates: state.coordinates,
          visibleMeridians: state.visibleMeridians,
          selectedAcupointId: state.quizQuestion?.code ?? state.selectedAcupointId,
          specialFilter: state.specialFilter,
          wrongCodes: state.quizWrongCodes,
        },
        state.quizScope,
      );
      const target = pickNextQuizTarget(pool, state.quizQuestion?.code ?? null);
      if (!target) return state;
      const side: 1 | -1 = isBilateralCode(target.code)
        ? state.displaySide === 'left'
          ? -1
          : state.displaySide === 'right'
            ? 1
            : Math.random() < 0.5
              ? 1
              : -1
        : 1;
      const nextVisible = state.visibleMeridians.includes(target.meridianCode)
        ? state.visibleMeridians
        : [...state.visibleMeridians, target.meridianCode];
      const isLocate = state.quizKind === 'locate';
      return {
        isQuizMode: true,
        quizQuestion: {
          code: target.code,
          side,
          options: isLocate ? [] : makeQuizOptions(target, state.acupoints),
          answer: null,
        },
        selectedAcupointId: target.code,
        activeSide: side,
        visibleMeridians: nextVisible,
        // Identify: fly to highlighted point. Locate: keep camera so position is not given away.
        focusRequest: isLocate
          ? state.focusRequest
          : { mode: 'full', nonce: state.focusRequest.nonce + 1 },
      };
    }),

  answerQuizChoice: (code) =>
    set((state) => {
      const q = state.quizQuestion;
      if (!q || q.answer) return state;
      const correct = code === q.code;
      return {
        quizQuestion: { ...q, answer: { correct, chosen: code } },
        ...scoreAnswer(state.quizStats, state.quizWrongCodes, q.code, correct),
      };
    }),

  answerQuizTyped: (input) => {
    const state = get();
    const q = state.quizQuestion;
    if (!q || q.answer) return false;
    const target = state.acupoints.find((a) => a.code === q.code);
    if (!target) return false;
    const correct = checkTypedAnswer(target, input);
    set({
      quizQuestion: { ...q, answer: { correct, chosen: input.trim() } },
      ...scoreAnswer(state.quizStats, state.quizWrongCodes, q.code, correct),
    });
    return correct;
  },

  answerQuizLocate: (point) =>
    set((state) => {
      const q = state.quizQuestion;
      const coord = q ? state.coordinates?.points[q.code] : undefined;
      if (!q || q.answer || !coord) return state;
      const bilateral = isBilateralCode(q.code);
      const sides: (1 | -1)[] = bilateral ? [1, -1] : [1];
      let best = Number.POSITIVE_INFINITY;
      let bestSide: 1 | -1 = 1;
      for (const s of sides) {
        const dx = coord.position[0] * s - point[0];
        const dy = coord.position[1] - point[1];
        const dz = coord.position[2] - point[2];
        const d = Math.hypot(dx, dy, dz);
        if (d < best) {
          best = d;
          bestSide = s;
        }
      }
      const distanceCm = Math.round(best * 1000) / 10;
      const correct = distanceCm <= LOCATE_TOLERANCE_CM;
      return {
        quizQuestion: { ...q, side: bestSide, answer: { correct, distanceCm, clickPoint: point } },
        activeSide: bestSide,
        ...scoreAnswer(state.quizStats, state.quizWrongCodes, q.code, correct),
        focusRequest: { mode: 'auto', nonce: state.focusRequest.nonce + 1 },
      };
    }),

  revealQuizAnswer: () =>
    set((state) => {
      const q = state.quizQuestion;
      if (!q || q.answer) return state;
      // Teacher-mode reveal is not scored; student "看答案" counts as a miss.
      if (state.quizTeacher) {
        return {
          quizQuestion: { ...q, answer: { correct: true, chosen: QUIZ_REVEAL_TOKEN } },
          focusRequest:
            state.quizKind === 'locate'
              ? { mode: 'full', nonce: state.focusRequest.nonce + 1 }
              : state.focusRequest,
        };
      }
      return {
        quizQuestion: { ...q, answer: { correct: false, chosen: QUIZ_REVEAL_TOKEN } },
        ...scoreAnswer(state.quizStats, state.quizWrongCodes, q.code, false),
        focusRequest:
          state.quizKind === 'locate'
            ? { mode: 'full', nonce: state.focusRequest.nonce + 1 }
            : state.focusRequest,
      };
    }),

  resetQuizStats: () => set({ quizStats: EMPTY_STATS, quizWrongCodes: [] }),

  pickRandomQuizAcupoint: () => {
    if (!get().isQuizMode) set({ isQuizMode: true });
    get().nextQuizQuestion();
  },

  // ---------------------------------------------------------------- Viewport prefs
  setUiTheme: (uiTheme) => {
    writePrefs({ uiTheme });
    set({ uiTheme });
  },
  setBigScreen: (bigScreen) => {
    writePrefs({ bigScreen });
    set({ bigScreen });
  },
  setLeftPanelWidth: (px) => {
    const leftPanelWidth = Math.round(Math.min(480, Math.max(260, px)));
    writePrefs({ leftPanelWidth });
    set({ leftPanelWidth });
  },
  setLeftPanelCollapsed: (leftPanelCollapsed) => {
    writePrefs({ leftPanelCollapsed });
    set({ leftPanelCollapsed });
  },

  setDisplaySide: (displaySide) =>
    set((state) => ({
      displaySide,
      activeSide: displaySide === 'left' ? -1 : displaySide === 'right' ? 1 : state.activeSide,
    })),

  setBodyTheme: (bodyTheme) => {
    writePrefs({ bodyTheme });
    set({ bodyTheme });
  },
  setBodyOpacity: (bodyOpacity) => set({ bodyOpacity }),
  setWireframeOverlay: (wireframeOverlay) => set({ wireframeOverlay }),
  setFlowAnimation: (flowAnimation) => set({ flowAnimation }),
  setShowLabels: (showLabels) => set({ showLabels }),
  setViewportBottomInset: (px) =>
    set((state) =>
      Math.abs(state.viewportBottomInset - px) < 1 ? state : { viewportBottomInset: px },
    ),

  requestViewPreset: (preset) =>
    set((state) => ({
      viewRequest: { preset, nonce: (state.viewRequest?.nonce ?? 0) + 1 },
    })),

  requestRegionPreset: (preset) =>
    set((state) => ({
      regionRequest: { preset, nonce: (state.regionRequest?.nonce ?? 0) + 1 },
    })),

  requestFocusSelected: (mode = 'full') =>
    set((state) => ({
      focusRequest: { mode, nonce: state.focusRequest.nonce + 1 },
    })),

  // ---------------------------------------------------------------- DEV audit
  setAuditMode: (auditMode) =>
    set((state) => ({
      auditMode,
      surfacePickArmed: auditMode ? state.surfacePickArmed : false,
    })),

  setSurfacePickArmed: (surfacePickArmed) => set({ surfacePickArmed }),

  registerLiveCameraGetter: (liveCameraGetter) => set({ liveCameraGetter }),

  applySurfaceCalibration: (code, payload) =>
    set((state) => {
      if (!state.coordinates) return state;
      const prev: AcupointCoordinate3D | undefined = state.coordinates.points[code];
      const updatedPoint: AcupointCoordinate3D = {
        position: payload.position,
        normal: payload.normal,
        cameraPreset: payload.cameraPreset,
        audit: {
          status: prev?.audit.status ?? 'draft_imported',
          standard: 'GB/T 12346-2021',
          source: prev?.audit.source ?? 'AuditCalibration manual 3D surface pick',
          verifiedAt: prev?.audit.verifiedAt ?? null,
        },
      };
      const dirty = state.dirtyCoordinateCodes.includes(code)
        ? state.dirtyCoordinateCodes
        : [...state.dirtyCoordinateCodes, code];
      return {
        coordinates: {
          ...state.coordinates,
          points: {
            ...state.coordinates.points,
            [code]: updatedPoint,
          },
        },
        dirtyCoordinateCodes: dirty,
      };
    }),

  captureCurrentCameraForSelected: () => {
    const state = get();
    const code = state.selectedAcupointId;
    if (!code || !state.coordinates || !state.liveCameraGetter) return false;
    const existing = state.coordinates.points[code];
    if (!existing) return false;
    const preset = state.liveCameraGetter();
    if (!preset) return false;

    const dirty = state.dirtyCoordinateCodes.includes(code)
      ? state.dirtyCoordinateCodes
      : [...state.dirtyCoordinateCodes, code];

    set({
      coordinates: {
        ...state.coordinates,
        points: {
          ...state.coordinates.points,
          [code]: {
            ...existing,
            cameraPreset: preset,
          },
        },
      },
      dirtyCoordinateCodes: dirty,
    });
    return true;
  },

  setCoordinateVerified: (code, verified) =>
    set((state) => {
      if (!state.coordinates) return state;
      const existing = state.coordinates.points[code];
      if (!existing) return state;
      const dirty = state.dirtyCoordinateCodes.includes(code)
        ? state.dirtyCoordinateCodes
        : [...state.dirtyCoordinateCodes, code];
      return {
        coordinates: {
          ...state.coordinates,
          points: {
            ...state.coordinates.points,
            [code]: {
              ...existing,
              audit: {
                ...existing.audit,
                status: verified ? 'gb_verified' : 'draft_imported',
                verifiedAt: verified ? new Date().toISOString() : null,
              },
            },
          },
        },
        dirtyCoordinateCodes: dirty,
      };
    }),

  resetCoordinate: (code) =>
    set((state) => {
      if (!state.coordinates || !state.initialCoordinatesSnapshot) return state;
      const orig = state.initialCoordinatesSnapshot.points[code];
      const nextPoints = { ...state.coordinates.points };
      if (orig) {
        nextPoints[code] = structuredClone(orig);
      } else {
        delete nextPoints[code];
      }
      return {
        coordinates: {
          ...state.coordinates,
          points: nextPoints,
        },
        dirtyCoordinateCodes: state.dirtyCoordinateCodes.filter((c) => c !== code),
      };
    }),

  resetAllCoordinates: () =>
    set((state) => {
      if (!state.initialCoordinatesSnapshot) return state;
      return {
        coordinates: structuredClone(state.initialCoordinatesSnapshot),
        dirtyCoordinateCodes: [],
      };
    }),
}));
