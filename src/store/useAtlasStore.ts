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
  MeridianPathsFile,
  Prescription,
  QuizKind,
  QuizQuestion,
  QuizScope,
  QuizStats,
  RegionPreset,
  UiTheme,
  Vec3Tuple,
  ViewPreset,
} from '../types/atlas';
import { isBilateralCode, meridianOf, parseOrder, sortByFlow } from '../utils/acupointMeta';
import { matchesAcupointQuery } from '../utils/searchMatch';
import { buildDeepLinkUrl, parseUrlDeepLink, syncUrlReplaceState } from '../utils/urlSync';
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
  meridianPaths: MeridianPathsFile | null;
  prescriptions: Prescription[];
  initialCoordinatesSnapshot: Coordinates3DFile | null;

  selectedAcupointId: string | null;
  activeSide: 1 | -1;
  visibleMeridians: MeridianCode[];
  preFilterMeridians: MeridianCode[] | null;
  activePrescriptionId: string | null;
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
  showLandmarks: boolean;
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
    meridianPaths: MeridianPathsFile;
    prescriptions: Prescription[];
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
  selectPrescription: (id: string | null) => void;
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
  setShowLandmarks: (enabled: boolean) => void;
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
  verifyAndAdvanceNext: () => string | null;
  markCoordinatesSaved: () => void;
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
  meridianPaths: null,
  prescriptions: [],
  initialCoordinatesSnapshot: null,

  selectedAcupointId: 'LU9',
  activeSide: 1,
  visibleMeridians: ['LU'],
  preFilterMeridians: null,
  activePrescriptionId: null,
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
  showLandmarks: false,
  viewportBottomInset: 0,

  viewRequest: null,
  regionRequest: null,
  focusRequest: { mode: 'full', nonce: 0 },

  auditMode: false,
  surfacePickArmed: false,
  dirtyCoordinateCodes: [],
  liveCameraGetter: null,

  setAtlasBundle: ({ meridians, acupoints, coordinates, meridianPaths, prescriptions }) => {
    const deep = typeof window !== 'undefined' ? parseUrlDeepLink() : {};
    const validCodes = new Set(acupoints.map((a) => a.code));
    const matchedRx = deep.prescriptionId
      ? prescriptions.find((p) => p.id === deep.prescriptionId) ?? null
      : null;

    let selectedId = acupoints.some((a) => a.code === 'LU9')
      ? 'LU9'
      : (acupoints[0]?.code ?? null);
    if (deep.point && validCodes.has(deep.point)) {
      selectedId = deep.point;
    } else if (matchedRx && matchedRx.points[0]) {
      selectedId = matchedRx.points[0];
    }

    let visibleMeridians: MeridianCode[] = deep.meridians ?? ['LU'];
    if (matchedRx) {
      visibleMeridians = [...new Set(matchedRx.points.map((c) => meridianOf(c)))];
    } else if (selectedId && !visibleMeridians.includes(meridianOf(selectedId))) {
      visibleMeridians = [...visibleMeridians, meridianOf(selectedId)];
    }

    set((state) => ({
      isLoading: false,
      loadError: null,
      meridians,
      acupoints,
      coordinates: structuredClone(coordinates),
      meridianPaths,
      prescriptions,
      initialCoordinatesSnapshot: structuredClone(coordinates),
      selectedAcupointId: selectedId,
      activeSide: deep.side ?? state.activeSide,
      uiTheme: deep.theme ?? state.uiTheme,
      visibleMeridians,
      activePrescriptionId: matchedRx?.id ?? null,
      focusRequest: deep.point
        ? { mode: 'full', nonce: state.focusRequest.nonce + 1 }
        : state.focusRequest,
      viewRequest: matchedRx && !deep.point
        ? { preset: matchedRx.view, nonce: (state.viewRequest?.nonce ?? 0) + 1 }
        : state.viewRequest,
    }));

    if (deep.quiz) {
      get().setQuizMode(true);
    }
  },

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
          preFilterMeridians: null,
          activePrescriptionId: null,
          visibleMeridians: exists
            ? state.visibleMeridians.filter((m) => m !== code)
            : [...state.visibleMeridians, code],
        };
      }
      const selectedStillVisible =
        state.selectedAcupointId && meridianOf(state.selectedAcupointId) === code;
      return {
        preFilterMeridians: null,
        activePrescriptionId: null,
        visibleMeridians: [code],
        selectedAcupointId: selectedStillVisible ? state.selectedAcupointId : null,
      };
    }),

  toggleMeridian: (code) =>
    set((state) => {
      const exists = state.visibleMeridians.includes(code);
      return {
        preFilterMeridians: null,
        activePrescriptionId: null,
        visibleMeridians: exists
          ? state.visibleMeridians.filter((m) => m !== code)
          : [...state.visibleMeridians, code],
      };
    }),

  setVisibleMeridians: (codes) =>
    set({ visibleMeridians: codes, preFilterMeridians: null, activePrescriptionId: null }),

  selectPrescription: (id) =>
    set((state) => {
      if (!id) {
        return {
          activePrescriptionId: null,
          visibleMeridians: state.preFilterMeridians ?? state.visibleMeridians,
          preFilterMeridians: null,
        };
      }
      const rx = state.prescriptions.find((p) => p.id === id);
      if (!rx) return state;
      const saved = state.preFilterMeridians ?? [...state.visibleMeridians];
      const rxMeridians = [...new Set(rx.points.map((c) => meridianOf(c)))];
      return {
        activePrescriptionId: rx.id,
        preFilterMeridians: saved,
        searchQuery: '',
        specialFilter: null,
        visibleMeridians: rxMeridians,
        selectedAcupointId: rx.points[0] ?? state.selectedAcupointId,
        viewRequest: { preset: rx.view, nonce: (state.viewRequest?.nonce ?? 0) + 1 },
      };
    }),
  setMultiCompare: (multiCompare) => set({ multiCompare }),
  setSearchQuery: (searchQuery) =>
    set((state) => {
      const emptyNow = searchQuery.trim().length === 0 && !state.specialFilter;
      if (emptyNow && state.preFilterMeridians) {
        return {
          searchQuery,
          visibleMeridians: state.preFilterMeridians,
          preFilterMeridians: null,
        };
      }
      return { searchQuery };
    }),
  setSpecialFilter: (specialFilter) =>
    set((state) => {
      if (!specialFilter) {
        if (!state.searchQuery.trim() && state.preFilterMeridians) {
          return {
            specialFilter: null,
            visibleMeridians: state.preFilterMeridians,
            preFilterMeridians: null,
          };
        }
        return { specialFilter: null };
      }
      const saved = state.preFilterMeridians ?? [...state.visibleMeridians];
      const hits = new Set<MeridianCode>();
      for (const a of state.acupoints) {
        if (a.specialCategory.some((c) => c.includes(specialFilter))) hits.add(a.meridianCode);
      }
      return {
        specialFilter,
        preFilterMeridians: saved,
        visibleMeridians: hits.size > 0 ? [...hits] : state.visibleMeridians,
      };
    }),

  applyTagFilter: ({ category, indication }) =>
    set((state) => {
      const q = indication ?? '';
      const special = category ?? null;
      if (!q.trim() && !special) {
        return {
          searchQuery: '',
          specialFilter: null,
          visibleMeridians: state.preFilterMeridians ?? state.visibleMeridians,
          preFilterMeridians: null,
        };
      }
      const saved = state.preFilterMeridians ?? [...state.visibleMeridians];
      const hits = new Set<MeridianCode>();
      for (const a of state.acupoints) {
        if (matchesAcupointQuery(a, a.code, q, special)) hits.add(a.meridianCode);
      }
      return {
        searchQuery: q,
        specialFilter: special,
        preFilterMeridians: saved,
        visibleMeridians: hits.size > 0 ? [...hits] : state.visibleMeridians,
      };
    }),

  clearFilters: () =>
    set((state) => ({
      searchQuery: '',
      specialFilter: null,
      visibleMeridians: state.preFilterMeridians ?? state.visibleMeridians,
      preFilterMeridians: null,
    })),
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
  setShowLandmarks: (showLandmarks) => set({ showLandmarks }),
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

  verifyAndAdvanceNext: () => {
    const state = get();
    const current = state.selectedAcupointId;
    if (!current || !state.coordinates) return null;
    state.setCoordinateVerified(current, true);

    const updated = get();
    const ordered = [...updated.acupoints].sort(sortByFlow);
    const curIdx = ordered.findIndex((a) => a.code === current);
    const rotated = curIdx >= 0 ? [...ordered.slice(curIdx + 1), ...ordered.slice(0, curIdx)] : ordered;
    const nextDraft = rotated.find(
      (a) => updated.coordinates?.points[a.code]?.audit.status !== 'gb_verified',
    );
    if (nextDraft) {
      updated.selectAcupoint(nextDraft.code, { focus: 'full' });
      return nextDraft.code;
    }
    return null;
  },

  markCoordinatesSaved: () =>
    set((state) => ({
      initialCoordinatesSnapshot: state.coordinates ? structuredClone(state.coordinates) : null,
      dirtyCoordinateCodes: [],
    })),

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

if (typeof window !== 'undefined') {
  useAtlasStore.subscribe((state, prev) => {
    if (state.isLoading) return;
    if (
      state.selectedAcupointId !== prev.selectedAcupointId ||
      state.visibleMeridians !== prev.visibleMeridians ||
      state.activeSide !== prev.activeSide ||
      state.uiTheme !== prev.uiTheme ||
      state.activePrescriptionId !== prev.activePrescriptionId ||
      state.isQuizMode !== prev.isQuizMode ||
      prev.isLoading
    ) {
      syncUrlReplaceState(
        buildDeepLinkUrl({
          selectedAcupointId: state.selectedAcupointId,
          visibleMeridians: state.visibleMeridians,
          activeSide: state.activeSide,
          uiTheme: state.uiTheme,
          activePrescriptionId: state.activePrescriptionId,
          isQuizMode: state.isQuizMode,
        }),
      );
    }
  });
}
