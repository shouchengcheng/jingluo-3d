import { useMemo, useState } from 'react';
import { useAtlasStore } from '../store/useAtlasStore';

/**
 * DEV-Only 3D GB/T 12346-2021 Coordinate Audit & Surface Calibration Tool.
 * Strictly mounted inside `import.meta.env.DEV` (AGENTS.md Rule 1.4).
 */
export function AuditCalibration() {
  const auditMode = useAtlasStore((s) => s.auditMode);
  const surfacePickArmed = useAtlasStore((s) => s.surfacePickArmed);
  const selectedId = useAtlasStore((s) => s.selectedAcupointId);
  const coordinates = useAtlasStore((s) => s.coordinates);
  const acupoints = useAtlasStore((s) => s.acupoints);
  const dirtyCodes = useAtlasStore((s) => s.dirtyCoordinateCodes);

  const setAuditMode = useAtlasStore((s) => s.setAuditMode);
  const setSurfacePickArmed = useAtlasStore((s) => s.setSurfacePickArmed);
  const captureCurrentCamera = useAtlasStore((s) => s.captureCurrentCameraForSelected);
  const setCoordinateVerified = useAtlasStore((s) => s.setCoordinateVerified);
  const resetCoordinate = useAtlasStore((s) => s.resetCoordinate);
  const resetAllCoordinates = useAtlasStore((s) => s.resetAllCoordinates);

  const [toast, setToast] = useState<string | null>(null);

  const stats = useMemo(() => {
    if (!coordinates) return { total: 0, verified: 0, luVerified: 0, luTotal: 0 };
    let total = 0;
    let verified = 0;
    let luTotal = 0;
    let luVerified = 0;
    for (const [code, pt] of Object.entries(coordinates.points)) {
      total += 1;
      const isVer = pt.audit.status === 'gb_verified';
      if (isVer) verified += 1;
      if (code.startsWith('LU')) {
        luTotal += 1;
        if (isVer) luVerified += 1;
      }
    }
    return { total, verified, luVerified, luTotal };
  }, [coordinates]);

  const selectedAcupoint = useMemo(
    () => acupoints.find((a) => a.code === selectedId) ?? null,
    [acupoints, selectedId],
  );

  const selectedCoord = selectedId ? coordinates?.points[selectedId] : undefined;

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  };

  const handleExportJson = () => {
    if (!coordinates) return;
    const jsonText = `${JSON.stringify(coordinates, null, 2)}\n`;
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'coordinates-3d.json';
    a.click();
    URL.revokeObjectURL(url);
    notify('已下载更新后的 coordinates-3d.json');
  };

  const handleCopyJson = async () => {
    if (!coordinates) return;
    const jsonText = `${JSON.stringify(coordinates, null, 2)}\n`;
    await navigator.clipboard.writeText(jsonText);
    notify('完整 coordinates-3d.json 已复制到剪贴板');
  };

  if (!auditMode) {
    return (
      <button
        type="button"
        onClick={() => setAuditMode(true)}
        className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300 transition hover:bg-amber-500/25"
      >
        DEV 国标复核标定 ({stats.verified}/{stats.total})
      </button>
    );
  }

  const isVerified = selectedCoord?.audit.status === 'gb_verified';

  return (
    <div className="fixed right-4 bottom-12 z-40 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-amber-500/40 bg-slate-950/95 p-4 text-xs text-slate-200 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="font-semibold text-amber-300">DEV · 3D 国标坐标复核台</span>
        </div>
        <button
          type="button"
          onClick={() => setAuditMode(false)}
          className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          收起
        </button>
      </div>

      {/* Legend & Stats */}
      <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-full bg-amber-500" /> 初稿待核 (
          {stats.total - stats.verified})
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> 国标已核 (
          {stats.verified})
        </span>
        <span>
          肺经 {stats.luVerified}/{stats.luTotal}
        </span>
      </div>

      {/* Current Selected Point Calibration */}
      <div className="mt-3 space-y-2.5 rounded-lg border border-slate-800 bg-slate-900/80 p-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-white">
            当前选中：{selectedId ?? '未选择'}{' '}
            {selectedAcupoint ? `· ${selectedAcupoint.name}` : ''}
          </span>
          {selectedId && dirtyCodes.includes(selectedId) && (
            <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">
              已修改
            </span>
          )}
        </div>

        {selectedAcupoint && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-400">
            国标：{selectedAcupoint.gbLocation}
          </p>
        )}

        {selectedCoord && (
          <div className="grid grid-cols-2 gap-1.5 rounded bg-slate-950/90 p-2 font-mono text-[10px] text-slate-300">
            <div>pos: [{selectedCoord.position.map((n) => n.toFixed(3)).join(', ')}]</div>
            <div>nrm: [{selectedCoord.normal.map((n) => n.toFixed(2)).join(', ')}]</div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            disabled={!selectedId}
            onClick={() => setSurfacePickArmed(!surfacePickArmed)}
            className={`col-span-2 rounded-lg border px-3 py-2 font-medium transition ${
              surfacePickArmed
                ? 'border-rose-400 bg-rose-500/25 text-rose-200'
                : 'border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
            }`}
          >
            {surfacePickArmed
              ? '● 表面拾取已激活：请直接点击 3D 人体模型新位置'
              : '开启 3D 表面重打点（捕获坐标 + 法线）'}
          </button>

          <button
            type="button"
            disabled={!selectedId || !selectedCoord}
            onClick={() => {
              if (captureCurrentCamera()) {
                notify(`已更新 ${selectedId} 最佳相机视角`);
              }
            }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
          >
            保存当前视角
          </button>

          <button
            type="button"
            disabled={!selectedId || !selectedCoord}
            onClick={() => {
              if (!selectedId) return;
              setCoordinateVerified(selectedId, !isVerified);
              notify(
                !isVerified
                  ? `${selectedId} 已标记为 gb_verified`
                  : `${selectedId} 已恢复为 draft_imported`,
              );
            }}
            className={`rounded-lg border px-2.5 py-1.5 font-medium transition disabled:opacity-40 ${
              isVerified
                ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200'
                : 'border-slate-700 bg-slate-800 text-slate-200 hover:border-emerald-500/50'
            }`}
          >
            {isVerified ? '✓ 已核 (点击撤销)' : '标记为国标已核'}
          </button>
        </div>

        {selectedId && dirtyCodes.includes(selectedId) && (
          <button
            type="button"
            onClick={() => {
              resetCoordinate(selectedId);
              notify(`已还原 ${selectedId} 初始坐标`);
            }}
            className="w-full text-center text-[11px] text-slate-400 hover:text-slate-200"
          >
            还原此穴本次修改
          </button>
        )}
      </div>

      {/* Export Bar */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleExportJson}
          className="flex-1 rounded-lg bg-sky-500 px-3 py-1.5 font-semibold text-slate-950 hover:bg-sky-400"
        >
          导出 JSON ({dirtyCodes.length} 处改动)
        </button>
        <button
          type="button"
          onClick={() => void handleCopyJson()}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200 hover:bg-slate-800"
        >
          复制
        </button>
        {dirtyCodes.length > 0 && (
          <button
            type="button"
            onClick={() => {
              resetAllCoordinates();
              notify('已重置全部未导出改动');
            }}
            className="rounded-lg border border-slate-800 px-2 py-1.5 text-slate-400 hover:text-rose-300"
          >
            重置
          </button>
        )}
      </div>

      {toast && (
        <div className="mt-2 rounded bg-emerald-500/20 px-2.5 py-1 text-center text-[11px] text-emerald-300">
          {toast}
        </div>
      )}
    </div>
  );
}
