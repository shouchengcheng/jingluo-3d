import { create } from 'zustand';
import type { MeridianCode } from '../types/atlas';

export interface AtlasState {
  selectedAcupointId: string | null;
  visibleMeridians: MeridianCode[];
  isQuizMode: boolean;
  auditMode: boolean;
  selectAcupoint: (id: string | null) => void;
  toggleMeridian: (code: MeridianCode) => void;
  setVisibleMeridians: (codes: MeridianCode[]) => void;
  setQuizMode: (enabled: boolean) => void;
  setAuditMode: (enabled: boolean) => void;
}

export const useAtlasStore = create<AtlasState>((set) => ({
  selectedAcupointId: null,
  visibleMeridians: ['LU'],
  isQuizMode: false,
  auditMode: false,
  selectAcupoint: (id) => set({ selectedAcupointId: id }),
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
  setQuizMode: (enabled) => set({ isQuizMode: enabled }),
  setAuditMode: (enabled) => set({ auditMode: enabled }),
}));
