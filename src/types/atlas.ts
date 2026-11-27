export type MeridianCode =
  | 'LU'
  | 'LI'
  | 'ST'
  | 'SP'
  | 'HT'
  | 'SI'
  | 'BL'
  | 'KI'
  | 'PC'
  | 'TE'
  | 'GB'
  | 'LR'
  | 'CV'
  | 'GV';

export type Vec3Tuple = [number, number, number];

export type AuditStatus = 'draft_imported' | 'gb_verified';

export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'reset';

/** Local anatomical region quick-jump presets (UI audit 4.3) */
export type RegionPreset =
  | 'head_face'
  | 'head_side'
  | 'neck_nape'
  | 'chest_abdomen'
  | 'back_lumbar'
  | 'arm_inner'
  | 'arm_outer'
  | 'hand_palm'
  | 'hand_back'
  | 'leg_front'
  | 'leg_back'
  | 'foot_dorsum'
  | 'foot_sole';

export type DisplaySide = 'right' | 'left' | 'both';

export type BodyTheme = 'jade' | 'skin' | 'bronze';

/** UI chrome theme: 墨色 (dark ink) vs 宣纸 (light classroom projection) */
export type UiTheme = 'ink' | 'paper';

/** Camera focus behaviour: full fly-to preset, pan-only when zoomed close, or auto (pan if close else full) */
export type FocusMode = 'full' | 'pan' | 'auto';

export type QuizKind = 'identify' | 'locate';
export type QuizScope = 'meridian' | 'visible' | 'core' | 'special' | 'wrong' | 'all';

export interface QuizAnswer {
  correct: boolean;
  chosen?: string;
  distanceCm?: number;
  clickPoint?: Vec3Tuple;
}

export interface QuizQuestion {
  code: string;
  side: 1 | -1;
  options: string[];
  answer: QuizAnswer | null;
}

export interface QuizStats {
  total: number;
  correct: number;
  streak: number;
  bestStreak: number;
}

export interface HoverInfo {
  code: string;
  side: 1 | -1;
  x: number;
  y: number;
}

export interface PickCandidate {
  code: string;
  side: 1 | -1;
}

export interface AmbiguousPick {
  candidates: PickCandidate[];
  x: number;
  y: number;
}

export interface AcupointEtymology {
  meaning: string;
  origin: string;
}

export interface AcupointClinical {
  functions: string;
  indications: string[];
  operation: string;
}

export interface Acupoint {
  code: string;
  standard: 'GB/T 12346-2021';
  name: string;
  pinyin: string;
  meridianCode: MeridianCode;
  textbookScope: 'undergraduate_core' | 'extended';
  specialCategory: string[];
  gbLocation: string;
  quickLocation: string;
  etymology: AcupointEtymology;
  clinical: AcupointClinical;
}

export interface CameraPreset {
  position: Vec3Tuple;
  target: Vec3Tuple;
}

export interface CoordinateAudit {
  status: AuditStatus;
  standard: 'GB/T 12346-2021';
  source: string;
  verifiedAt: string | null;
}

export interface AcupointCoordinate3D {
  position: Vec3Tuple;
  normal: Vec3Tuple;
  cameraPreset: CameraPreset;
  audit: CoordinateAudit;
}

export interface Coordinates3DFile {
  modelId: string;
  points: Record<string, AcupointCoordinate3D>;
}

export interface MeridianMeta {
  code: MeridianCode;
  name: string;
  shortName: string;
  englishName: string;
  color: string;
  acupointCount: number;
  bilateral: boolean;
  element: string;
  shichen: string;
  route: string;
}

export interface MeridianPathBranch {
  id: string;
  bilateral: boolean;
  points: Vec3Tuple[];
  normals: Vec3Tuple[];
}

export interface MeridianPathsFile {
  modelId: string;
  meridians: Record<MeridianCode, MeridianPathBranch[]>;
}

export interface Prescription {
  id: string;
  name: string;
  category: string;
  points: string[];
  indications: string;
  rationale: string;
  view: ViewPreset;
}

export interface AtlasBundle {
  meridians: MeridianMeta[];
  acupoints: Acupoint[];
  coordinates: Coordinates3DFile;
  meridianPaths: MeridianPathsFile;
  prescriptions: Prescription[];
}

export interface ProjectedLabel {
  code: string;
  name: string;
  meridianCode: MeridianCode;
  color: string;
  x: number;
  y: number;
  labelY: number;
  align: 'left' | 'right';
  isSelected: boolean;
  auditStatus: AuditStatus;
}
