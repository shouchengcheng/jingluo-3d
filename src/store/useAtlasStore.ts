import { create } from 'zustand';
import type {
  Acupoint,
  AcupointCoordinate3D,
  CameraPreset,
  Coordinates3DFile,
  DisplaySide,
  MeridianCode,
  MeridianMeta,
  Vec3Tuple,
  ViewPreset,
} from '../types/atlas';

export interface SurfaceCalibrationPayload {
  position: Vec3Tuple;
  normal: Vec3Tuple;
  cameraPreset: CameraPreset;
}

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
  searchQuery: string;
  specialFilter: string | null;

  isQuizMode: boolean;
  quizRevealedIds: Record<string, boolean>;

  displaySide: DisplaySide;
  bodyOpacity: number;
  wireframeOverlay: boolean;
  flowAnimation: boolean;
  showLabels: boolean;

  viewRequest: { preset: ViewPreset; nonce: number } | null;
  focusNonce: number;

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
  selectAcupoint: (id: string | null, options?: { focus?: boolean; side?: 1 | -1 }) => void;
  toggleMeridian: (code: MeridianCode) => void;
  setVisibleMeridians: (codes: MeridianCode[]) => void;
  setSearchQuery: (query: string) => void;
  setSpecialFilter: (category: string | null) => void;
  setQuizMode: (enabled: boolean) => void;
  revealQuizAnswer: (code: string) => void;
  setDisplaySide: (side: DisplaySide) => void;
  setBodyOpacity: (opacity: number) => void;
  setWireframeOverlay: (enabled: boolean) => void;
  setFlowAnimation: (enabled: boolean) => void;
  setShowLabels: (enabled: boolean) => void;
  requestViewPreset: (preset: ViewPreset) => void;
  requestFocusSelected: () => void;

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
  searchQuery: '',
  specialFilter: null,

  isQuizMode: false,
  quizRevealedIds: {},

  displaySide: 'both',
  bodyOpacity: 0.96,
  wireframeOverlay: false,
  flowAnimation: true,
  showLabels: true,

  viewRequest: null,
  focusNonce: 0,

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
      const nextVisible = [...state.visibleMeridians];
      if (id) {
        const found = state.acupoints.find((a) => a.code === id);
        if (found && !nextVisible.includes(found.meridianCode)) {
          nextVisible.push(found.meridianCode);
        }
      }
      return {
        selectedAcupointId: id,
        activeSide: nextSide,
        visibleMeridians: nextVisible,
        focusNonce: options?.focus ? state.focusNonce + 1 : state.focusNonce,
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
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSpecialFilter: (specialFilter) => set({ specialFilter }),

  setQuizMode: (enabled) =>
    set({
      isQuizMode: enabled,
      quizRevealedIds: {},
    }),

  revealQuizAnswer: (code) =>
    set((state) => ({
      quizRevealedIds: { ...state.quizRevealedIds, [code]: true },
    })),

  setDisplaySide: (displaySide) =>
    set((state) => ({
      displaySide,
      activeSide: displaySide === 'left' ? -1 : displaySide === 'right' ? 1 : state.activeSide,
    })),

  setBodyOpacity: (bodyOpacity) => set({ bodyOpacity }),
  setWireframeOverlay: (wireframeOverlay) => set({ wireframeOverlay }),
  setFlowAnimation: (flowAnimation) => set({ flowAnimation }),
  setShowLabels: (showLabels) => set({ showLabels }),

  requestViewPreset: (preset) =>
    set((state) => ({
      viewRequest: { preset, nonce: (state.viewRequest?.nonce ?? 0) + 1 },
    })),

  requestFocusSelected: () =>
    set((state) => ({
      focusNonce: state.focusNonce + 1,
    })),

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
