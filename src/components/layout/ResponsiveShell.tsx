import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAtlasStore } from '../../store/useAtlasStore';
import { isBilateralCode } from '../../utils/acupointMeta';
import { ShortcutsModal } from '../ShortcutsModal';
import { ViewportHud } from '../ViewportHud';
import type { AmbiguousPick, HoverInfo, ProjectedLabel } from '../../types/atlas';

type SheetSnap = 'collapsed' | 'half' | 'full';
type MobileTab = 'detail' | 'directory';

const COLLAPSED_PX = 56;

function snapTargetPx(snap: SheetSnap, vh: number): number {
  if (snap === 'collapsed') return COLLAPSED_PX;
  if (snap === 'half') return Math.round(vh * 0.45);
  return Math.round(vh * 0.84);
}

export interface ResponsiveShellProps {
  canvasSlot: ReactNode;
  controlPanel: (props: { onSelectAcupointDone?: () => void }) => ReactNode;
  acupointCard: ReactNode;
  devHeaderAction?: ReactNode;
  projectedLabels: ProjectedLabel[];
  hoverInfo: HoverInfo | null;
  ambiguousPick: AmbiguousPick | null;
  onDismissAmbiguous: () => void;
  azimuthDeg: number;
  isInteracting: boolean;
}

export function ResponsiveShell({
  canvasSlot,
  controlPanel,
  acupointCard,
  devHeaderAction,
  projectedLabels,
  hoverInfo,
  ambiguousPick,
  onDismissAmbiguous,
  azimuthDeg,
  isInteracting,
}: ResponsiveShellProps) {
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('half');
  const [dragHeightPx, setDragHeightPx] = useState<number | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('detail');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'desktop' | 'landscape' | 'portrait'>('desktop');

  const dragStateRef = useRef<{
    startY: number;
    startH: number;
    lastY: number;
    lastT: number;
    vy: number;
    moved: boolean;
  } | null>(null);

  const selectedId = useAtlasStore((s) => s.selectedAcupointId);
  const activeSide = useAtlasStore((s) => s.activeSide);
  const searchQuery = useAtlasStore((s) => s.searchQuery);
  const isQuizMode = useAtlasStore((s) => s.isQuizMode);
  const quizStats = useAtlasStore((s) => s.quizStats);
  const isLoading = useAtlasStore((s) => s.isLoading);
  const loadError = useAtlasStore((s) => s.loadError);
  const surfacePickArmed = useAtlasStore((s) => s.surfacePickArmed);
  const uiTheme = useAtlasStore((s) => s.uiTheme);
  const bigScreen = useAtlasStore((s) => s.bigScreen);
  const leftPanelWidth = useAtlasStore((s) => s.leftPanelWidth);
  const leftPanelCollapsed = useAtlasStore((s) => s.leftPanelCollapsed);

  const setSearchQuery = useAtlasStore((s) => s.setSearchQuery);
  const setQuizMode = useAtlasStore((s) => s.setQuizMode);
  const selectAcupoint = useAtlasStore((s) => s.selectAcupoint);
  const setUiTheme = useAtlasStore((s) => s.setUiTheme);
  const setBigScreen = useAtlasStore((s) => s.setBigScreen);
  const setLeftPanelWidth = useAtlasStore((s) => s.setLeftPanelWidth);
  const setLeftPanelCollapsed = useAtlasStore((s) => s.setLeftPanelCollapsed);
  const setViewportBottomInset = useAtlasStore((s) => s.setViewportBottomInset);

  // Sync theme & big-screen root attributes onto <html>
  useEffect(() => {
    document.documentElement.dataset.theme = uiTheme;
  }, [uiTheme]);

  useEffect(() => {
    document.documentElement.dataset.bigscreen = bigScreen ? 'true' : 'false';
  }, [bigScreen]);

  // Detect desktop (>=1024px) vs mobile landscape (<1024px & w>h) vs mobile portrait (UI audit 8.6)
  useEffect(() => {
    const updateMode = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w >= 1024) setLayoutMode('desktop');
      else if (w > h && h <= 600) setLayoutMode('landscape');
      else setLayoutMode('portrait');
    };
    updateMode();
    window.addEventListener('resize', updateMode);
    return () => window.removeEventListener('resize', updateMode);
  }, []);

  // Keep 3D camera vertical viewOffset synced with mobile portrait bottom sheet (UI audit 8.2)
  useEffect(() => {
    if (layoutMode !== 'portrait') {
      setViewportBottomInset(0);
      return;
    }
    const vh = window.innerHeight;
    const h = dragHeightPx ?? snapTargetPx(sheetSnap, vh);
    // For full sheet, keep half-height offset so canvas doesn't jump wildly behind the sheet
    const effective = Math.min(h, Math.round(vh * 0.5));
    setViewportBottomInset(effective <= COLLAPSED_PX + 8 ? 0 : effective);
  }, [layoutMode, sheetSnap, dragHeightPx, setViewportBottomInset]);

  const cycleSheetSnap = useCallback(() => {
    setSheetSnap((prev) =>
      prev === 'collapsed' ? 'half' : prev === 'half' ? 'full' : 'collapsed',
    );
  }, []);

  // Pointer-drag handlers for mobile Bottom Sheet grabber (UI audit 8.1)
  const onSheetHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const vh = window.innerHeight;
    const startH = dragHeightPx ?? snapTargetPx(sheetSnap, vh);
    dragStateRef.current = {
      startY: e.clientY,
      startH,
      lastY: e.clientY,
      lastT: performance.now(),
      vy: 0,
      moved: false,
    };
  };

  const onSheetHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st) return;
    const dy = st.startY - e.clientY;
    if (Math.abs(dy) > 4) st.moved = true;
    if (!st.moved) return;
    const now = performance.now();
    const dt = Math.max(1, now - st.lastT);
    st.vy = (st.lastY - e.clientY) / dt; // positive = dragging upward
    st.lastY = e.clientY;
    st.lastT = now;

    const vh = window.innerHeight;
    const clamped = Math.max(COLLAPSED_PX, Math.min(Math.round(vh * 0.88), st.startH + dy));
    setDragHeightPx(clamped);
  };

  const onSheetHandleUp = () => {
    const st = dragStateRef.current;
    dragStateRef.current = null;
    if (!st) return;
    if (!st.moved) {
      setDragHeightPx(null);
      cycleSheetSnap();
      return;
    }
    const vh = window.innerHeight;
    const finalH = dragHeightPx ?? st.startH;
    setDragHeightPx(null);

    // Flick gesture support
    if (st.vy > 0.55) {
      setSheetSnap((prev) => (prev === 'collapsed' ? 'half' : 'full'));
      return;
    }
    if (st.vy < -0.55) {
      setSheetSnap((prev) => (prev === 'full' ? 'half' : 'collapsed'));
      return;
    }

    const targets: [SheetSnap, number][] = [
      ['collapsed', snapTargetPx('collapsed', vh)],
      ['half', snapTargetPx('half', vh)],
      ['full', snapTargetPx('full', vh)],
    ];
    targets.sort((a, b) => Math.abs(a[1] - finalH) - Math.abs(b[1] - finalH));
    setSheetSnap(targets[0][0]);
  };

  // Desktop left-panel resize handle (UI audit 3.5)
  const startLeftResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftPanelWidth;
    const onMove = (ev: PointerEvent) => {
      setLeftPanelWidth(startW + (ev.clientX - startX));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const portraitSheetStyle =
    dragHeightPx !== null
      ? { height: `${dragHeightPx}px` }
      : {
          height:
            sheetSnap === 'collapsed'
              ? `${COLLAPSED_PX}px`
              : sheetSnap === 'half'
                ? '45dvh'
                : '84dvh',
        };

  return (
    <div className="safe-top relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-bg text-fg select-none">
      {/* Top Bar: Brand + Browse/Quiz Mode Switch + Projection Theme & Big-Screen Controls */}
      <header className="z-30 flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/92 px-3 py-2 backdrop-blur lg:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Desktop Sidebar Collapse Toggle (UI audit 3.5) */}
          <button
            type="button"
            onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
            title={leftPanelCollapsed ? '展开左侧目录栏 ([)' : '收起左侧目录栏以扩大投影画布 ([)'}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-xs text-fg-muted transition hover:text-fg lg:inline-flex"
          >
            {leftPanelCollapsed ? '▸' : '◂'}
          </button>

          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/45 bg-accent/15 font-serif text-sm font-bold text-accent-fg">
            经
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-serif text-sm font-bold tracking-wide whitespace-nowrap text-fg sm:text-base">
              观穴<span className="hidden sm:inline"> · 中医经络三维图谱</span>
            </h1>
            <p className="hidden truncate text-[11px] text-fg-subtle xl:block">
              国家标准 GB/T 12346-2021《经穴名称与定位》· 本科《针灸学》交互教学系统
            </p>
          </div>
        </div>

        {/* Center Top-Level Mode Segmented Control: 浏览图谱 vs 教学盲测 (UI audit 3.4) */}
        <div className="inline-flex shrink-0 items-center rounded-xl border border-line-strong bg-surface-2 p-0.5 text-xs whitespace-nowrap">
          <button
            type="button"
            onClick={() => setQuizMode(false)}
            className={`tap rounded-lg px-2.5 py-1 font-medium whitespace-nowrap transition sm:px-3.5 ${
              !isQuizMode
                ? 'bg-surface-3 font-semibold text-fg shadow-xs'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <span className="sm:hidden">浏览</span>
            <span className="hidden sm:inline">图谱浏览</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setQuizMode(true);
              if (layoutMode !== 'desktop') {
                setMobileTab('detail');
                if (sheetSnap === 'collapsed') setSheetSnap('half');
              }
            }}
            className={`tap flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium whitespace-nowrap transition sm:px-3.5 ${
              isQuizMode
                ? 'bg-accent font-semibold text-white shadow-xs'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <span className="sm:hidden">盲测</span>
            <span className="hidden sm:inline">教学盲测</span>
            {isQuizMode && quizStats.total > 0 && (
              <span className="rounded bg-black/25 px-1 font-mono text-[10px]">
                {quizStats.correct}/{quizStats.total}
              </span>
            )}
          </button>
        </div>

        {/* Right Controls: Mobile Collapsible Search + Theme (墨色/宣纸) + Big-Screen + DEV */}
        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          {/* Mobile Collapsible Search (UI audit 8.4) */}
          <div className="lg:hidden">
            {mobileSearchOpen && !isInteracting ? (
              <div className="flex items-center gap-1">
                <input
                  type="search"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setMobileTab('directory');
                    if (sheetSnap === 'collapsed') setSheetSnap('half');
                  }}
                  placeholder="穴名/首字母/主治..."
                  className="w-30 rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-fg placeholder-fg-subtle focus:border-accent focus:outline-none sm:w-44"
                />
                <button
                  type="button"
                  onClick={() => setMobileSearchOpen(false)}
                  className="tap rounded-lg px-1.5 py-1 text-xs text-fg-subtle"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setMobileSearchOpen(true)}
                aria-label="搜索穴位"
                className={`tap rounded-lg border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                  searchQuery
                    ? 'border-accent bg-accent/15 text-accent-fg'
                    : 'border-line bg-surface-2 text-fg-muted'
                }`}
              >
                {searchQuery ? `搜:${searchQuery.slice(0, 3)}` : '检索'}
              </button>
            )}
          </div>

          {/* Ink / Paper Classroom Projection Theme Switcher (UI audit 2.2) */}
          <button
            type="button"
            onClick={() => setUiTheme(uiTheme === 'ink' ? 'paper' : 'ink')}
            title="切换墨色暗底 / 宣纸课堂投影浅色主题"
            className="tap rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-fg transition hover:border-accent/60"
          >
            <span className="sm:hidden">{uiTheme === 'ink' ? '宣纸' : '墨色'}</span>
            <span className="hidden sm:inline">{uiTheme === 'ink' ? '宣纸投影' : '墨色暗底'}</span>
          </button>

          {/* Big-Screen Classroom Font Scale Toggle (UI audit 2.3) */}
          <button
            type="button"
            onClick={() => setBigScreen(!bigScreen)}
            title="教室大屏放大字号 (1.25×)"
            className={`hidden rounded-lg border px-2.5 py-1 text-xs font-medium transition md:inline-flex ${
              bigScreen
                ? 'border-gold bg-gold/20 text-gold-fg'
                : 'border-line bg-surface-2 text-fg-muted hover:text-fg'
            }`}
          >
            大屏字号
          </button>

          <div className="hidden sm:block">{devHeaderAction}</div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Desktop Resizable / Collapsible Left Panel (UI audit 3.5) */}
        {!leftPanelCollapsed && (
          <aside
            style={{ width: `${leftPanelWidth}px` }}
            className="relative hidden shrink-0 border-r border-line bg-surface/95 lg:block"
          >
            {controlPanel({})}
            <div
              onPointerDown={startLeftResize}
              title="拖动调整左栏宽度"
              className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize hover:bg-accent/35"
            />
          </aside>
        )}

        {/* Center 3D Viewport */}
        <main className="relative min-w-0 flex-1 overflow-hidden bg-canvas">
          {canvasSlot}

          <ViewportHud
            hoverInfo={hoverInfo}
            ambiguousPick={ambiguousPick}
            onDismissAmbiguous={onDismissAmbiguous}
            azimuthDeg={azimuthDeg}
            isInteracting={isInteracting}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onAfterMobilePick={() => {
              setMobileTab('detail');
              if (sheetSnap === 'collapsed') setSheetSnap('half');
            }}
          />

          {/* DEV Surface Calibration Banner */}
          {import.meta.env.DEV && surfacePickArmed && (
            <div className="glass pointer-events-none absolute top-14 left-1/2 z-20 -translate-x-1/2 rounded-full border-danger/60 px-3.5 py-1 text-xs font-medium text-danger-fg">
              表面重打点模式：请直接点击人体模型上 {selectedId} 的标准解剖位置
            </div>
          )}

          {/* 3D Projected Leader Labels Overlay (Single-click = Select, Double-click = Focus) */}
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
                    stroke={lbl.isSelected ? 'var(--c-accent)' : lbl.color}
                    strokeWidth={lbl.isSelected ? 1.4 : 0.95}
                    strokeOpacity={lbl.isSelected ? 0.9 : 0.5}
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
                  key={lbl.code}
                  type="button"
                  onClick={() => {
                    selectAcupoint(lbl.code, { focus: 'pan' });
                    setMobileTab('detail');
                    if (sheetSnap === 'collapsed') setSheetSnap('half');
                  }}
                  onDoubleClick={() => {
                    selectAcupoint(lbl.code, { focus: 'full' });
                  }}
                  style={{
                    transform: `translate(${offsetX}px, ${lbl.labelY}px) ${anchorTransform}`,
                  }}
                  className={`pointer-events-auto absolute top-0 left-0 flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] whitespace-nowrap transition ${
                    lbl.isSelected
                      ? 'border-accent bg-surface font-semibold text-fg shadow-md'
                      : 'border-line-strong/80 bg-surface/82 text-fg hover:border-accent/70'
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: lbl.color }}
                  />
                  <span>{lbl.name}</span>
                  <span className="font-mono text-[10px] text-fg-subtle">{lbl.code}</span>
                  {lbl.isSelected && isBilateralCode(lbl.code) && (
                    <span className="text-[10px] text-azure-fg">
                      {activeSide === 1 ? '右' : '左'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Loading / Error State Overlay */}
          {isLoading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/75 backdrop-blur-xs">
              <div className="glass rounded-xl px-5 py-4 text-sm text-fg">
                正在加载 3D 人体模型与国标经穴数据...
              </div>
            </div>
          )}

          {loadError && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/85 p-4">
              <div className="max-w-md rounded-xl border border-danger/50 bg-surface p-5 text-sm text-danger-fg">
                <div className="font-semibold">资产加载失败</div>
                <p className="mt-1 text-xs text-fg-muted">{loadError}</p>
              </div>
            </div>
          )}
        </main>

        {/* Desktop Right Detail Panel (>= 1024px) */}
        <aside className="hidden w-96 shrink-0 border-l border-line bg-surface/95 select-text lg:block xl:w-[416px]">
          {acupointCard}
        </aside>

        {/* Mobile Landscape Side Panel (< 1024px & landscape — UI audit 8.6) */}
        {layoutMode === 'landscape' && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface/95 select-text lg:hidden">
            <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1.5">
              <button
                type="button"
                onClick={() => setMobileTab('detail')}
                className={`flex-1 rounded-md py-1 text-xs font-medium ${
                  mobileTab === 'detail'
                    ? 'bg-accent/18 text-accent-fg'
                    : 'text-fg-muted hover:text-fg'
                }`}
              >
                {isQuizMode ? '盲测答题' : `详情 ${selectedId ?? ''}`}
              </button>
              <button
                type="button"
                onClick={() => setMobileTab('directory')}
                className={`flex-1 rounded-md py-1 text-xs font-medium ${
                  mobileTab === 'directory'
                    ? 'bg-accent/18 text-accent-fg'
                    : 'text-fg-muted hover:text-fg'
                }`}
              >
                {isQuizMode ? '测验设置' : '经络目录'}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {mobileTab === 'detail'
                ? acupointCard
                : controlPanel({
                    onSelectAcupointDone: () => setMobileTab('detail'),
                  })}
            </div>
          </aside>
        )}

        {/* Mobile Portrait Touch-Draggable 3-Snap Bottom Sheet (UI audit 8.1, 8.2, 8.5) */}
        {layoutMode === 'portrait' && (
          <div
            style={portraitSheetStyle}
            className={`safe-bottom glass absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t border-line-strong lg:hidden ${
              dragHeightPx === null ? 'transition-[height] duration-200 ease-out' : ''
            }`}
          >
            {/* Touch-Draggable Grabber Handle + Tab Bar */}
            <div
              onPointerDown={onSheetHandleDown}
              onPointerMove={onSheetHandleMove}
              onPointerUp={onSheetHandleUp}
              onPointerCancel={onSheetHandleUp}
              className="shrink-0 touch-none border-b border-line px-3.5 pt-1.5 pb-1.5"
            >
              <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-line-strong" />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileTab('detail');
                      if (sheetSnap === 'collapsed') setSheetSnap('half');
                    }}
                    className={`tap rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      mobileTab === 'detail'
                        ? 'bg-accent/18 font-semibold text-accent-fg'
                        : 'text-fg-muted hover:text-fg'
                    }`}
                  >
                    {isQuizMode
                      ? '盲测作答'
                      : `穴位详情${selectedId ? ` (${selectedId})` : ''}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileTab('directory');
                      if (sheetSnap === 'collapsed') setSheetSnap('half');
                    }}
                    className={`tap rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      mobileTab === 'directory'
                        ? 'bg-accent/18 font-semibold text-accent-fg'
                        : 'text-fg-muted hover:text-fg'
                    }`}
                  >
                    {isQuizMode ? '范围与计分' : '经络与检索'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={cycleSheetSnap}
                  className="tap rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-fg-muted"
                >
                  {sheetSnap === 'collapsed'
                    ? '半屏 ▲'
                    : sheetSnap === 'half'
                      ? '全屏 ▲'
                      : '收起 ▼'}
                </button>
              </div>
            </div>

            {(sheetSnap !== 'collapsed' || (dragHeightPx !== null && dragHeightPx > 80)) && (
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
        )}
      </div>

      {/* Compliance Attribution Footer (AGENTS.md Rule 2.1) */}
      <footer className="hidden shrink-0 items-center justify-between border-t border-line bg-surface px-5 py-1.5 text-[11px] text-fg-subtle lg:flex">
        <span>
          上游致谢：3D 人体模型与初稿坐标源自{' '}
          <a
            href="https://github.com/aicuc/3d-acupoint-atlas"
            target="_blank"
            rel="noreferrer"
            className="text-azure-fg underline-offset-2 hover:underline"
          >
            aicuc/3d-acupoint-atlas
          </a>{' '}
          (MIT License) · 基础网格源自 MakeHuman (CC0 1.0)
        </span>
        <span>
          开源双协议：源代码 MIT License · 校准数据与教学文档 CC BY-NC-SA 4.0 · 仅供中医教学演示
        </span>
      </footer>

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        onToggle={() => setShortcutsOpen((o) => !o)}
      />
    </div>
  );
}
