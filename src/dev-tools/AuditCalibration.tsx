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
  const verifyAndAdvanceNext = useAtlasStore((s) => s.verifyAndAdvanceNext);
  const markCoordinatesSaved = useAtlasStore((s) => s.markCoordinatesSaved);
  const resetCoordinate = useAtlasStore((s) => s.resetCoordinate);
  const resetAllCoordinates = useAtlasStore((s) => s.resetAllCoordinates);

  const [toast, setToast] = useState<{ msg: string; isError?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

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

  const notify = (msg: string, isError = false) => {
    setToast({ msg, isError });
    window.setTimeout(() => setToast(null), 2800);
  };

  const handleSaveToRepo = async () => {
    if (!coordinates || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/__dev/save-coordinates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coordinates),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        verified?: number;
        total?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        notify(data.error ?? `保存失败 (HTTP ${res.status})`, true);
        return;
      }
      markCoordinatesSaved();
      notify(`已写入 data/coordinates-3d.json（已核 ${data.verified}/${data.total}）`);
    } catch (err) {
      notify(`请求失败: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setSaving(false);
    }
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
    notify('已下载 coordinates-3d.json');
  };

  const handleCopyJson = async () => {
    if (!coordinates) return;
    await navigator.clipboard.writeText(`${JSON.stringify(coordinates, null, 2)}\n`);
    notify('已复制完整 JSON 至剪贴板');
  };

  if (!auditMode) {
    return (
      <button
        type="button"
        onClick={() => setAuditMode(true)}
        className="rounded-lg border border-gold/45 bg-gold/15 px-2.5 py-1 text-xs font-medium text-gold-fg transition hover:bg-gold/25"
      >
        复核 ({stats.verified}/{stats.total})
      </button>
    );
  }

  const isVerified = selectedCoord?.audit.status === 'gb_verified';

  return (
    <div className="glass fixed top-14 right-4 z-40 w-[356px] max-w-[calc(100vw-2rem)] rounded-xl p-4 text-xs text-fg">
      <div className="flex items-center justify-between border-b border-line pb-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-gold" />
          <span className="font-semibold text-gold-fg">DEV · 3D 国标坐标复核台</span>
        </div>
        <button
          type="button"
          onClick={() => setAuditMode(false)}
          className="rounded px-1.5 py-0.5 text-fg-subtle hover:bg-surface-2 hover:text-fg"
        >
          收起
        </button>
      </div>

      {/* Legend & Stats */}
      <div className="mt-2.5 flex items-center justify-between text-[11px] text-fg-muted">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-full bg-warn" /> 初稿待核 (
          {stats.total - stats.verified})
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-full bg-ok" /> 国标已核 ({stats.verified})
        </span>
        <span>
          肺经 {stats.luVerified}/{stats.luTotal}
        </span>
      </div>

      {/* Current Selected Point Calibration */}
      <div className="mt-3 space-y-2.5 rounded-lg border border-line bg-surface-2/75 p-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-fg">
            当前：{selectedId ?? '未选择'}{' '}
            {selectedAcupoint ? `· ${selectedAcupoint.name}` : ''}
          </span>
          {selectedId && dirtyCodes.includes(selectedId) && (
            <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent-fg">
              未保存
            </span>
          )}
        </div>

        {selectedAcupoint && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-fg-muted">
            国标：{selectedAcupoint.gbLocation}
          </p>
        )}

        {selectedCoord && (
          <div className="grid grid-cols-2 gap-1.5 rounded bg-surface p-2 font-mono text-[10px] text-fg-muted">
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
                ? 'border-danger bg-danger/20 text-danger-fg'
                : 'border-gold/55 bg-gold/15 text-gold-fg hover:bg-gold/25'
            }`}
          >
            {surfacePickArmed
              ? '● 表面拾取中：直接点击人体模型标准解剖位置'
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
            className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-fg hover:bg-surface-3 disabled:opacity-40"
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
                ? 'border-ok/60 bg-ok/20 text-ok-fg'
                : 'border-line-strong bg-surface text-fg hover:border-ok/60'
            }`}
          >
            {isVerified ? '✓ 已核 (点击撤销)' : '标记为国标已核'}
          </button>

          <button
            type="button"
            disabled={!selectedId || !selectedCoord}
            onClick={() => {
              const prev = selectedId;
              const next = verifyAndAdvanceNext();
              notify(next ? `${prev} 已核，已跳至下一待核穴 ${next}` : `${prev} 已核，全部复核完成！`);
            }}
            className="col-span-2 rounded-lg border border-azure/55 bg-azure/18 px-3 py-1.5 font-semibold text-azure-fg hover:bg-azure/28 disabled:opacity-40"
          >
            ✓ 核准此穴并跳至下一待核穴 →
          </button>
        </div>

        {selectedId && dirtyCodes.includes(selectedId) && (
          <button
            type="button"
            onClick={() => {
              resetCoordinate(selectedId);
              notify(`已还原 ${selectedId} 初始坐标`);
            }}
            className="w-full text-center text-[11px] text-fg-subtle hover:text-fg"
          >
            还原此穴未落盘改动
          </button>
        )}
      </div>

      {/* Persistence & Export Bar */}
      <div className="mt-3 space-y-1.5">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSaveToRepo()}
          className="w-full rounded-lg bg-accent px-3 py-2 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {saving
            ? '正在校验并写入仓库...'
            : `写入仓库并校验 (${dirtyCodes.length} 处未保存改动)`}
        </button>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleExportJson}
            className="flex-1 rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1 text-fg-muted hover:text-fg"
          >
            下载 JSON
          </button>
          <button
            type="button"
            onClick={() => void handleCopyJson()}
            className="rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1 text-fg-muted hover:text-fg"
          >
            复制
          </button>
          {dirtyCodes.length > 0 && (
            <button
              type="button"
              onClick={() => {
                resetAllCoordinates();
                notify('已重置全部未落盘改动');
              }}
              className="rounded-lg border border-line px-2 py-1 text-fg-subtle hover:text-danger-fg"
            >
              重置
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div
          className={`mt-2 rounded-lg px-2.5 py-1.5 text-center text-[11px] font-medium ${
            toast.isError ? 'bg-danger/20 text-danger-fg' : 'bg-ok/20 text-ok-fg'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
