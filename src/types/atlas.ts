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
  englishName: string;
  color: string;
  acupointCount: number;
}
