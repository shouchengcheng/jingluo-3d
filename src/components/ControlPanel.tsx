import { useMemo } from 'react';
import { useAtlasStore } from '../store/useAtlasStore';
import { matchesAcupointQuery } from '../utils/searchMatch';
import type { Acupoint, BodyTheme, DisplaySide, MeridianCode } from '../types/atlas';

const SPECIAL_CATEGORIES = [
  '五输穴',
  '原穴',
  '络穴',
  '背俞穴',
  '募穴',
  '郄穴',
  '下合穴',
  '八会穴',
  '八脉交会穴',
  '四总穴',
];

function parseOrder(code: string): number {
  const m = code.match(/\d+$/);
  return m ? Number.parseInt(m[0], 10) : 0;
}

export interface ControlPanelProps {
  onSelectAcupointDone?: () => void;
}

export function ControlPanel({ onSelectAcupointDone }: ControlPanelProps) {
  const meridians = useAtlasStore((s) => s.meridians);
  const acupoints = useAtlasStore((s) => s.acupoints);
  const coordinates = useAtlasStore((s) => s.coordinates);
  const visibleMeridians = useAtlasStore((s) => s.visibleMeridians);
  const selectedAcupointId = useAtlasStore((s) => s.selectedAcupointId);
  const searchQuery = useAtlasStore((s) => s.searchQuery);
  const specialFilter = useAtlasStore((s) => s.specialFilter);
  const isQuizMode = useAtlasStore((s) => s.isQuizMode);
  const displaySide = useAtlasStore((s) => s.displaySide);
  const bodyTheme = useAtlasStore((s) => s.bodyTheme);
  const bodyOpacity = useAtlasStore((s) => s.bodyOpacity);
  const wireframeOverlay = useAtlasStore((s) => s.wireframeOverlay);
  const flowAnimation = useAtlasStore((s) => s.flowAnimation);
  const showLabels = useAtlasStore((s) => s.showLabels);

  const toggleMeridian = useAtlasStore((s) => s.toggleMeridian);
  const setVisibleMeridians = useAtlasStore((s) => s.setVisibleMeridians);
  const setSearchQuery = useAtlasStore((s) => s.setSearchQuery);
  const setSpecialFilter = useAtlasStore((s) => s.setSpecialFilter);
  const setQuizMode = useAtlasStore((s) => s.setQuizMode);
  const pickRandomQuizAcupoint = useAtlasStore((s) => s.pickRandomQuizAcupoint);
  const setDisplaySide = useAtlasStore((s) => s.setDisplaySide);
  const setBodyTheme = useAtlasStore((s) => s.setBodyTheme);
  const setBodyOpacity = useAtlasStore((s) => s.setBodyOpacity);
  const setWireframeOverlay = useAtlasStore((s) => s.setWireframeOverlay);
  const setFlowAnimation = useAtlasStore((s) => s.setFlowAnimation);
  const setShowLabels = useAtlasStore((s) => s.setShowLabels);
  const selectAcupoint = useAtlasStore((s) => s.selectAcupoint);

  const coordCountByMeridian = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!coordinates) return counts;
    for (const code of Object.keys(coordinates.points)) {
      const prefix = code.replace(/\d+$/, '');
      counts[prefix] = (counts[prefix] ?? 0) + 1;
    }
    return counts;
  }, [coordinates]);

  const textCountByMeridian = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of acupoints) {
      counts[a.meridianCode] = (counts[a.meridianCode] ?? 0) + 1;
    }
    return counts;
  }, [acupoints]);

  const filteredAcupoints = useMemo(() => {
    const visibleSet = new Set(visibleMeridians);
    const hasSearch = searchQuery.trim().length > 0;

    return acupoints
      .filter((a: Acupoint) => {
        if (!hasSearch && !specialFilter && !visibleSet.has(a.meridianCode)) {
          return false;
        }
        return matchesAcupointQuery(a, a.code, searchQuery, specialFilter);
      })
      .sort((a, b) => {
        if (a.meridianCode !== b.meridianCode) {
          return a.meridianCode.localeCompare(b.meridianCode);
        }
        return parseOrder(a.code) - parseOrder(b.code);
      });
  }, [acupoints, visibleMeridians, searchQuery, specialFilter]);

  const allCodes = useMemo(() => meridians.map((m) => m.code), [meridians]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm">
      {/* Search Box */}
      <section className="shrink-0 space-y-2">
        <label className="block text-xs font-medium tracking-wider text-slate-400 uppercase">
          多维检索（穴名 / 首字母 / 国标码 / 主治）
        </label>
        <div className="relative">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="如：足三里 / zsl / ST36 / 胃痛..."
            className="w-full rounded-lg border border-slate-700/80 bg-slate-900/90 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-400 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
            >
              清空
            </button>
          )}
        </div>
      </section>

      {/* Teaching Blind-Test Mode Toggle */}
      <section className="shrink-0 space-y-2.5 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium text-slate-100">教学盲测模式</div>
            <div className="text-xs text-slate-400">
              隐藏 3D 穴名标签，点击或随机抽考自测
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isQuizMode}
            onClick={() => setQuizMode(!isQuizMode)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              isQuizMode ? 'bg-emerald-500' : 'bg-slate-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                isQuizMode ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {isQuizMode && (
          <button
            type="button"
            onClick={() => {
              pickRandomQuizAcupoint();
              onSelectAcupointDone?.();
            }}
            className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
          >
            随机抽考一穴（聚焦三维穴位）
          </button>
        )}
      </section>

      {/* Special Acupoint Category Filter */}
      <section className="shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium tracking-wider text-slate-400 uppercase">
            特定穴筛选
          </span>
          {specialFilter && (
            <button
              type="button"
              onClick={() => setSpecialFilter(null)}
              className="text-xs text-sky-400 hover:underline"
            >
              清除筛选
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SPECIAL_CATEGORIES.map((cat) => {
            const active = specialFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSpecialFilter(active ? null : cat)}
                className={`rounded-md border px-2 py-1 text-xs transition ${
                  active
                    ? 'border-amber-400/70 bg-amber-500/20 font-medium text-amber-200'
                    : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </section>

      {/* 14 Meridians Management */}
      <section className="shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium tracking-wider text-slate-400 uppercase">
            十四经脉循行开关
          </span>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setVisibleMeridians(['LU'])}
              className="text-sky-400 hover:underline"
            >
              仅肺经
            </button>
            <span className="text-slate-700">|</span>
            <button
              type="button"
              onClick={() => setVisibleMeridians(allCodes)}
              className="text-slate-300 hover:text-white"
            >
              全选
            </button>
            <span className="text-slate-700">|</span>
            <button
              type="button"
              onClick={() => setVisibleMeridians([])}
              className="text-slate-400 hover:text-white"
            >
              清空
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {meridians.map((m) => {
            const checked = visibleMeridians.includes(m.code as MeridianCode);
            const textCount = textCountByMeridian[m.code] ?? 0;
            const coordCount = coordCountByMeridian[m.code] ?? 0;
            return (
              <button
                key={m.code}
                type="button"
                onClick={() => toggleMeridian(m.code)}
                title={`${m.name} (${m.route})`}
                className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${
                  checked
                    ? 'border-sky-500/50 bg-slate-800/90 text-slate-100 shadow-sm'
                    : 'border-slate-800/80 bg-slate-900/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <span className="flex items-center gap-1.5 truncate">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: m.color, opacity: checked ? 1 : 0.45 }}
                  />
                  <span className="truncate font-medium">{m.shortName}</span>
                </span>
                <span className="ml-1 shrink-0 font-mono text-[10px] text-slate-400">
                  {textCount > 0 ? `${textCount}/${m.acupointCount}` : `${coordCount}点`}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Filtered Acupoint Directory */}
      <section className="shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium tracking-wider text-slate-400 uppercase">
            教学穴位列表 ({filteredAcupoints.length})
          </span>
          <span className="text-[11px] text-slate-500">GB/T 12346-2021</span>
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {filteredAcupoints.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
              当前筛选条件下暂无匹配穴位（请勾选经脉或调整检索词）。
            </div>
          ) : (
            filteredAcupoints.map((item) => {
              const isSelected = item.code === selectedAcupointId;
              const coord = coordinates?.points[item.code];
              const isVerified = coord?.audit.status === 'gb_verified';
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => {
                    selectAcupoint(item.code, { focus: true });
                    onSelectAcupointDone?.();
                  }}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
                    isSelected
                      ? 'border-sky-400/70 bg-sky-500/15 text-white'
                      : 'border-slate-800/70 bg-slate-900/50 text-slate-200 hover:border-slate-700 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {isQuizMode ? '？？？ (盲测穴位)' : item.name}
                      </span>
                      {!isQuizMode && item.textbookScope === 'undergraduate_core' && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                          重点
                        </span>
                      )}
                    </div>
                    {!isQuizMode && (
                      <div className="truncate text-[11px] text-slate-400">
                        {item.pinyin}
                        {item.specialCategory.length > 0
                          ? ` · ${item.specialCategory[0]}`
                          : ''}
                      </div>
                    )}
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-1.5">
                    <span
                      title={isVerified ? '国标已复核' : '初稿坐标待复核'}
                      className={`h-1.5 w-1.5 rounded-full ${
                        isVerified ? 'bg-emerald-400' : 'bg-amber-400/80'
                      }`}
                    />
                    <span className="font-mono text-xs text-slate-300">
                      {isQuizMode ? `${item.meridianCode}?` : item.code}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* 3D Model Display & Auxiliary Controls */}
      <section className="shrink-0 space-y-2.5 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs">
        <div className="font-medium text-slate-300">3D 模型材质与辅助显示</div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400">人体材质主题</span>
          <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5">
            {(
              [
                ['jade', '青玉'],
                ['skin', '肤色'],
                ['bronze', '铜人'],
              ] as [BodyTheme, string][]
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setBodyTheme(val)}
                className={`rounded px-2 py-0.5 text-[11px] transition ${
                  bodyTheme === val
                    ? 'bg-sky-500/25 font-medium text-sky-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400">双侧经穴显示</span>
          <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5">
            {(
              [
                ['both', '双侧'],
                ['right', '右侧'],
                ['left', '左侧'],
              ] as [DisplaySide, string][]
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setDisplaySide(val)}
                className={`rounded px-2 py-0.5 text-[11px] transition ${
                  displaySide === val
                    ? 'bg-sky-500/25 font-medium text-sky-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-slate-400">
            <span>人体材质透明度</span>
            <span className="font-mono">{Math.round(bodyOpacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.25}
            max={1}
            step={0.05}
            value={bodyOpacity}
            onChange={(e) => setBodyOpacity(Number(e.target.value))}
            className="w-full accent-sky-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <label className="flex cursor-pointer items-center gap-1.5 text-slate-300">
            <input
              type="checkbox"
              checked={flowAnimation}
              onChange={(e) => setFlowAnimation(e.target.checked)}
              className="accent-sky-400"
            />
            经气流动动画
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-slate-300">
            <input
              type="checkbox"
              checked={wireframeOverlay}
              onChange={(e) => setWireframeOverlay(e.target.checked)}
              className="accent-sky-400"
            />
            解剖网格线框
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-slate-300">
            <input
              type="checkbox"
              checked={showLabels}
              disabled={isQuizMode}
              onChange={(e) => setShowLabels(e.target.checked)}
              className="accent-sky-400"
            />
            悬浮穴名
          </label>
        </div>
      </section>
    </div>
  );
}
