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

export type DisplaySide = 'right' | 'left' | 'both';

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

export interface AtlasBundle {
  meridians: MeridianMeta[];
  acupoints: Acupoint[];
  coordinates: Coordinates3DFile;
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
