import { useState, type ReactNode } from 'react';
import { useAtlasStore } from '../../store/useAtlasStore';
import type { ProjectedLabel, ViewPreset } from '../../types/atlas';

type SheetSnap = 'collapsed' | 'half' | 'full';
type MobileTab = 'detail' | 'directory';

export interface ResponsiveShellProps {
  canvasSlot: ReactNode;
  controlPanel: (props: { onSelectAcupointDone?: () => void }) => ReactNode;
  acupointCard: ReactNode;
  devHeaderAction?: ReactNode;
  projectedLabels: ProjectedLabel[];
}

const VIEW_PRESETS: { key: ViewPreset; label: string }[] = [
  { key: 'front', label: '正面' },
  { key: 'back', label: '背面' },
  { key: 'right', label: '右侧' },
  { key: 'left', label: '左侧' },
  { key: 'reset', label: '复位' },
];

export function ResponsiveShell({
  canvasSlot,
  controlPanel,
  acupointCard,
  devHeaderAction,
  projectedLabels,
}: ResponsiveShellProps) {
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('half');
  const [mobileTab, setMobileTab] = useState<MobileTab>('detail');

  const selectedId = useAtlasStore((s) => s.selectedAcupointId);
  const searchQuery = useAtlasStore((s) => s.searchQuery);
  const isQuizMode = useAtlasStore((s) => s.isQuizMode);
  const isLoading = useAtlasStore((s) => s.isLoading);
  const loadError = useAtlasStore((s) => s.loadError);
  const surfacePickArmed = useAtlasStore((s) => s.surfacePickArmed);

  const setSearchQuery = useAtlasStore((s) => s.setSearchQuery);
  const selectAcupoint = useAtlasStore((s) => s.selectAcupoint);
  const requestViewPreset = useAtlasStore((s) => s.requestViewPreset);

  const cycleSheetSnap = () => {
    setSheetSnap((prev) =>
      prev === 'collapsed' ? 'half' : prev === 'half' ? 'full' : 'collapsed',
    );
  };

  const sheetHeightClass =
    sheetSnap === 'collapsed'
      ? 'h-14'
      : sheetSnap === 'half'
        ? 'h-[46dvh]'
        : 'h-[82dvh]';

  return (
    <div className="relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Top Bar (Desktop Header + Mobile Compact Bar) */}
      <header className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-slate-800/90 bg-slate-900/85 px-3 py-2.5 backdrop-blur lg:px-5">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/20 font-mono text-xs font-bold text-sky-300">
            经
          </span>
          <div className="shrink-0">
            <h1 className="text-sm font-bold tracking-wide whitespace-nowrap text-slate-100 sm:text-base">
              jingluo-3d
              <span className="hidden sm:inline"> · 中医经络穴位三维图谱</span>
            </h1>
            <p className="hidden text-[11px] text-slate-400 md:block">
              国家标准 GB/T 12346-2021《经穴名称与定位》· 本科《针灸学》交互教学系统
            </p>
          </div>
        </div>

        {/* Mobile Quick Search Input */}
        <div className="min-w-0 flex-1 px-1 lg:hidden">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setMobileTab('directory');
              if (sheetSnap === 'collapsed') setSheetSnap('half');
            }}
            placeholder="搜穴名 / 拼音 / 主治..."
            className="w-full rounded-lg border border-slate-700/80 bg-slate-950/90 px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-400 focus:outline-none"
          />
        </div>

        <div className="hidden items-center gap-2 sm:flex">
          {isQuizMode && (
            <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
              盲测模式中
            </span>
          )}
          {devHeaderAction}
        </div>
      </header>

      {/* Main Content Area: 3-Column on >=1024px, Immersive Fullscreen + Bottom Sheet on <1024px */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Left Sidebar (Desktop >= 1024px) */}
        <aside className="hidden w-80 shrink-0 border-r border-slate-800/90 bg-slate-950/95 lg:block xl:w-84">
          {controlPanel({})}
        </aside>

        {/* Center 3D Viewport */}
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {canvasSlot}

          {/* Floating Anatomical Camera Preset Bar */}
          <div className="pointer-events-auto absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-slate-700/80 bg-slate-900/85 p-1 whitespace-nowrap shadow-lg backdrop-blur">
            {VIEW_PRESETS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => requestViewPreset(v.key)}
                className="rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap text-slate-300 transition hover:bg-slate-800 hover:text-white"
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* DEV Surface Calibration Banner */}
          {import.meta.env.DEV && surfacePickArmed && (
            <div className="pointer-events-none absolute top-14 left-1/2 z-10 -translate-x-1/2 rounded-full border border-rose-400/60 bg-rose-950/90 px-3.5 py-1 text-xs font-medium text-rose-200 shadow-lg">
              表面重打点模式：请直接点击人体模型上 {selectedId} 的标准解剖位置
            </div>
          )}

          {/* 3D Projected Floating Labels Overlay (Automatically empty in Quiz Mode) */}
          <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
            <svg className="h-full w-full">
              {projectedLabels.map((lbl) => {
                const dir = lbl.align === 'left' ? 1 : -1;
                return (
                  <line
                    key={`line-${lbl.code}`}
                    x1={lbl.x + dir * 6}
                    y1={lbl.y}
                    x2={lbl.x + dir * 22}
                    y2={lbl.labelY}
                    stroke={lbl.isSelected ? '#fbbf24' : lbl.color}
                    strokeWidth={lbl.isSelected ? 1.25 : 0.9}
                    strokeOpacity={lbl.isSelected ? 0.85 : 0.45}
                  />
                );
              })}
            </svg>
            {projectedLabels.map((lbl) => {
              const offsetX = lbl.align === 'left' ? lbl.x + 24 : lbl.x - 24;
              const anchorTransform =
                lbl.align === 'left' ? 'translate(0, -50%)' : 'translate(-100%, -50%)';
              return (
                <button
                  key={`${lbl.code}`}
                  type="button"
                  onClick={() => {
                    selectAcupoint(lbl.code, { focus: true });
                    setMobileTab('detail');
                    if (sheetSnap === 'collapsed') setSheetSnap('half');
                  }}
                  style={{
                    transform: `translate(${offsetX}px, ${lbl.labelY}px) ${anchorTransform}`,
                  }}
                  className={`pointer-events-auto absolute top-0 left-0 flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] whitespace-nowrap shadow backdrop-blur transition ${
                    lbl.isSelected
                      ? 'border-amber-300/90 bg-slate-900/95 font-semibold text-amber-200'
                      : 'border-slate-700/80 bg-slate-950/75 text-slate-200 hover:border-sky-400'
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: lbl.color }}
                  />
                  <span>{lbl.name}</span>
                  <span className="font-mono text-[10px] text-slate-400">{lbl.code}</span>
                </button>
              );
            })}
          </div>

          {/* Loading / Error State Overlay */}
          {isLoading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm">
              <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 text-sm text-slate-300 shadow-xl">
                正在加载 3D 人体模型与国标经穴数据...
              </div>
            </div>
          )}

          {loadError && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/85 p-4">
              <div className="max-w-md rounded-xl border border-rose-500/40 bg-rose-950/50 p-5 text-sm text-rose-200">
                <div className="font-semibold">资产加载失败</div>
                <p className="mt-1 text-xs opacity-90">{loadError}</p>
              </div>
            </div>
          )}
        </main>

        {/* Right Detail Panel (Desktop >= 1024px) */}
        <aside className="hidden w-96 shrink-0 border-l border-slate-800/90 bg-slate-950/95 select-text lg:block xl:w-[410px]">
          {acupointCard}
        </aside>

        {/* Mobile Draggable/Snap 3-State Bottom Sheet (< 1024px) */}
        <div
          className={`absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t border-slate-700/90 bg-slate-950/95 shadow-2xl backdrop-blur transition-[height] duration-200 lg:hidden ${sheetHeightClass}`}
        >
          {/* Sheet Handle + Tab Switcher */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-800/80 px-4 py-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setMobileTab('detail');
                  if (sheetSnap === 'collapsed') setSheetSnap('half');
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  mobileTab === 'detail'
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                穴位详情 {selectedId ? `(${isQuizMode ? '盲测' : selectedId})` : ''}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileTab('directory');
                  if (sheetSnap === 'collapsed') setSheetSnap('half');
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  mobileTab === 'directory'
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                经络与检索
              </button>
            </div>

            <button
              type="button"
              onClick={cycleSheetSnap}
              className="rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300"
            >
              {sheetSnap === 'collapsed'
                ? '展开半屏 ▲'
                : sheetSnap === 'half'
                  ? '全屏 ▲'
                  : '收起 ▼'}
            </button>
          </div>

          {sheetSnap !== 'collapsed' && (
            <div className="min-h-0 flex-1 overflow-hidden select-text">
              {mobileTab === 'detail'
                ? acupointCard
                : controlPanel({
                    onSelectAcupointDone: () => {
                      setMobileTab('detail');
                      setSheetSnap('half');
                    },
                  })}
            </div>
          )}
        </div>
      </div>

      {/* Compliance Attribution Footer (AGENTS.md Rule 2.1) */}
      <footer className="hidden shrink-0 items-center justify-between border-t border-slate-800/90 bg-slate-900/90 px-5 py-1.5 text-[11px] text-slate-400 lg:flex">
        <span>
          上游致谢：3D 人体模型与初稿坐标源自{' '}
          <a
            href="https://github.com/aicuc/3d-acupoint-atlas"
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline-offset-2 hover:underline"
          >
            aicuc/3d-acupoint-atlas
          </a>{' '}
          (MIT License) · 基础网格源自 MakeHuman (CC0 1.0)
        </span>
        <span>
          开源双协议：源代码 MIT License · 校准数据与教学文档 CC BY-NC-SA 4.0 · 仅供中医教学演示
        </span>
      </footer>
    </div>
  );
}
