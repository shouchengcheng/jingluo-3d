import { useEffect, useMemo, useRef, useState } from 'react';
import { REGION_PRESETS } from '../engine/MeridianScene';
import { useAtlasStore } from '../store/useAtlasStore';
import { isBilateralCode, parseOrder } from '../utils/acupointMeta';
import type {
  AmbiguousPick,
  BodyTheme,
  DisplaySide,
  HoverInfo,
  RegionPreset,
  ViewPreset,
} from '../types/atlas';

const VIEW_PRESETS: { key: ViewPreset; label: string; shortKey: string }[] = [
  { key: 'front', label: '正面', shortKey: '1' },
  { key: 'back', label: '背面', shortKey: '2' },
  { key: 'right', label: '右侧', shortKey: '3' },
  { key: 'left', label: '左侧', shortKey: '4' },
  { key: 'reset', label: '复位', shortKey: 'R' },
];

const REGION_ENTRIES = Object.entries(REGION_PRESETS) as [
  RegionPreset,
  { label: string; target: [number, number, number]; camera: [number, number, number] },
][];

export interface ViewportHudProps {
  hoverInfo: HoverInfo | null;
  ambiguousPick: AmbiguousPick | null;
  onDismissAmbiguous: () => void;
  azimuthDeg: number;
  isInteracting: boolean;
  onOpenShortcuts: () => void;
  onOpenCunReference: () => void;
  onAfterMobilePick?: () => void;
}

function azimuthLabel(deg: number): { label: string; preset: ViewPreset } {
  const norm = ((deg % 360) + 360) % 360;
  if (norm >= 315 || norm < 45) return { label: '正面', preset: 'front' };
  if (norm >= 45 && norm < 135) return { label: '右侧', preset: 'right' };
  if (norm >= 135 && norm < 225) return { label: '背面', preset: 'back' };
  return { label: '左侧', preset: 'left' };
}

export function ViewportHud({
  hoverInfo,
  ambiguousPick,
  onDismissAmbiguous,
  azimuthDeg,
  isInteracting,
  onOpenShortcuts,
  onOpenCunReference,
  onAfterMobilePick,
}: ViewportHudProps) {
  const [regionOpen, setRegionOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [mobileCamExpanded, setMobileCamExpanded] = useState(false);
  const [delayedHover, setDelayedHover] = useState<HoverInfo | null>(null);

  const regionRef = useRef<HTMLDivElement | null>(null);
  const displayRef = useRef<HTMLDivElement | null>(null);

  const meridians = useAtlasStore((s) => s.meridians);
  const acupoints = useAtlasStore((s) => s.acupoints);
  const visibleMeridians = useAtlasStore((s) => s.visibleMeridians);
  const isQuizMode = useAtlasStore((s) => s.isQuizMode);
  const quizKind = useAtlasStore((s) => s.quizKind);
  const quizTeacher = useAtlasStore((s) => s.quizTeacher);
  const quizQuestion = useAtlasStore((s) => s.quizQuestion);
  const bodyTheme = useAtlasStore((s) => s.bodyTheme);
  const displaySide = useAtlasStore((s) => s.displaySide);
  const bodyOpacity = useAtlasStore((s) => s.bodyOpacity);
  const wireframeOverlay = useAtlasStore((s) => s.wireframeOverlay);
  const flowAnimation = useAtlasStore((s) => s.flowAnimation);
  const showLabels = useAtlasStore((s) => s.showLabels);
  const showLandmarks = useAtlasStore((s) => s.showLandmarks);
  const viewportBottomInset = useAtlasStore((s) => s.viewportBottomInset);

  const requestViewPreset = useAtlasStore((s) => s.requestViewPreset);
  const requestRegionPreset = useAtlasStore((s) => s.requestRegionPreset);
  const setBodyTheme = useAtlasStore((s) => s.setBodyTheme);
  const setDisplaySide = useAtlasStore((s) => s.setDisplaySide);
  const setBodyOpacity = useAtlasStore((s) => s.setBodyOpacity);
  const setWireframeOverlay = useAtlasStore((s) => s.setWireframeOverlay);
  const setFlowAnimation = useAtlasStore((s) => s.setFlowAnimation);
  const setShowLabels = useAtlasStore((s) => s.setShowLabels);
  const setShowLandmarks = useAtlasStore((s) => s.setShowLandmarks);
  const selectAcupoint = useAtlasStore((s) => s.selectAcupoint);
  const revealQuizAnswer = useAtlasStore((s) => s.revealQuizAnswer);
  const nextQuizQuestion = useAtlasStore((s) => s.nextQuizQuestion);

  // 80ms hover delay so passing across markers never flickers (UI audit 4.1)
  useEffect(() => {
    if (!hoverInfo) {
      setDelayedHover(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setDelayedHover(hoverInfo);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [hoverInfo?.code, hoverInfo?.side]);

  // Keep live pointer coordinates crisp once tooltip is visible
  const activeTooltip = delayedHover && hoverInfo && delayedHover.code === hoverInfo.code ? hoverInfo : null;

  useEffect(() => {
    const onDocDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (regionRef.current && !regionRef.current.contains(target)) setRegionOpen(false);
      if (displayRef.current && !displayRef.current.contains(target)) setDisplayOpen(false);
    };
    document.addEventListener('pointerdown', onDocDown);
    return () => document.removeEventListener('pointerdown', onDocDown);
  }, []);

  const acupointByCode = useMemo(() => {
    const map = new Map(acupoints.map((a) => [a.code, a]));
    return map;
  }, [acupoints]);

  const meridianByCode = useMemo(() => {
    const map = new Map(meridians.map((m) => [m.code, m]));
    return map;
  }, [meridians]);

  // Single-meridian circulation banner (UI audit 4.4)
  const singleMeridianBanner = useMemo(() => {
    if (isQuizMode || visibleMeridians.length !== 1) return null;
    const code = visibleMeridians[0];
    const meta = meridianByCode.get(code);
    if (!meta) return null;
    const pts = acupoints
      .filter((a) => a.meridianCode === code)
      .sort((a, b) => parseOrder(a.code) - parseOrder(b.code));
    const first = pts[0];
    const last = pts[pts.length - 1];
    return { meta, first, last };
  }, [isQuizMode, visibleMeridians, meridianByCode, acupoints]);

  const az = azimuthLabel(azimuthDeg);
  const bottomDockOffset = Math.max(12, viewportBottomInset + 12);

  // Teacher classroom overlay banner (UI audit 7.5)
  const teacherQuestionTarget =
    isQuizMode && quizTeacher && quizQuestion ? acupointByCode.get(quizQuestion.code) : null;

  return (
    <>
      {/* Top Camera & Region Preset Bar (Desktop always visible; Mobile compact button per 8.4) */}
      <div
        className={`pointer-events-auto absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 transition-opacity duration-200 ${
          isInteracting ? 'opacity-45 lg:opacity-90' : 'opacity-100'
        }`}
      >
        {/* Desktop & expanded mobile bar */}
        <div
          className={`${
            mobileCamExpanded ? 'flex' : 'hidden sm:flex'
          } glass items-center gap-0.5 rounded-xl p-1 text-xs whitespace-nowrap`}
        >
          {VIEW_PRESETS.map((v) => (
            <button
              key={v.key}
              type="button"
              title={`${v.label}视角 (快捷键 ${v.shortKey})`}
              onClick={() => {
                requestViewPreset(v.key);
                setMobileCamExpanded(false);
              }}
              className="tap rounded-lg px-2.5 py-1 font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg"
            >
              {v.label}
            </button>
          ))}

          <span className="mx-0.5 h-4 w-px bg-line" />

          {/* Anatomical Region Dropdown (UI audit 4.3) */}
          <div ref={regionRef} className="relative">
            <button
              type="button"
              onClick={() => setRegionOpen((o) => !o)}
              className={`tap flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium transition ${
                regionOpen
                  ? 'bg-accent/18 text-accent-fg'
                  : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
              }`}
            >
              <span>局部部位</span>
              <span className="text-[10px] opacity-75">▾</span>
            </button>

            {regionOpen && (
              <div className="glass animate-fade-in-up absolute top-full right-0 mt-1.5 grid w-64 grid-cols-2 gap-1 rounded-xl p-2 text-xs">
                {REGION_ENTRIES.map(([key, def]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      requestRegionPreset(key);
                      setRegionOpen(false);
                      setMobileCamExpanded(false);
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-left text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                  >
                    {def.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMobileCamExpanded(false)}
            className="ml-0.5 rounded-lg px-2 py-1 text-fg-subtle sm:hidden"
            aria-label="收起视角栏"
          >
            ✕
          </button>
        </div>

        {/* Compact mobile trigger button when collapsed (UI audit 8.4) */}
        {!mobileCamExpanded && (
          <button
            type="button"
            onClick={() => setMobileCamExpanded(true)}
            className="glass tap flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-fg sm:hidden"
          >
            <span>视角 · {az.label}</span>
            <span className="text-[10px] text-fg-subtle">▾</span>
          </button>
        )}
      </div>

      {/* Single-Meridian Circulation Direction Banner (UI audit 4.4) */}
      {singleMeridianBanner && (
        <div className="glass pointer-events-none absolute top-14 left-1/2 z-10 hidden max-w-[94%] -translate-x-1/2 items-center gap-2 rounded-lg px-3 py-1 text-xs whitespace-nowrap text-fg-muted md:flex">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: singleMeridianBanner.meta.color }}
          />
          <span className="shrink-0 font-semibold text-fg">{singleMeridianBanner.meta.name}</span>
          <span className="text-fg-subtle">·</span>
          <span className="truncate">{singleMeridianBanner.meta.route}</span>
          {singleMeridianBanner.first && singleMeridianBanner.last && (
            <>
              <span className="text-fg-subtle">·</span>
              <span className="shrink-0 font-mono text-[11px] text-gold-fg">
                起 {singleMeridianBanner.first.name}({singleMeridianBanner.first.code}) → 止{' '}
                {singleMeridianBanner.last.name}({singleMeridianBanner.last.code})
              </span>
            </>
          )}
        </div>
      )}

      {/* Classroom Teacher Projection Prompt Overlay (UI audit 7.5) */}
      {isQuizMode && quizTeacher && quizQuestion && (
        <div className="glass pointer-events-auto absolute top-14 left-1/2 z-20 flex max-w-[92%] -translate-x-1/2 flex-col items-center gap-1.5 rounded-xl px-5 py-3 text-center">
          <div className="text-[11px] font-medium tracking-wider text-gold-fg uppercase">
            课堂提问 · 按空格揭示答案
          </div>
          {quizKind === 'locate' && teacherQuestionTarget ? (
            <div className="font-serif text-2xl font-bold text-fg">
              请指出「{teacherQuestionTarget.name}」({teacherQuestionTarget.code}) 的体表位置
            </div>
          ) : quizQuestion.answer && teacherQuestionTarget ? (
            <div className="font-serif text-2xl font-bold text-ok-fg">
              {teacherQuestionTarget.name}{' '}
              <span className="font-mono text-base">{teacherQuestionTarget.code}</span> ·{' '}
              <span className="font-sans text-sm font-normal text-fg-muted">
                {teacherQuestionTarget.gbLocation}
              </span>
            </div>
          ) : (
            <div className="font-serif text-xl font-bold text-fg">
              请说出图中朱砂靶环所指穴位的名称与定位
            </div>
          )}
          <div className="mt-1 flex items-center gap-2">
            {!quizQuestion.answer ? (
              <button
                type="button"
                onClick={revealQuizAnswer}
                className="rounded-lg bg-accent px-3.5 py-1 text-xs font-semibold text-white transition hover:opacity-90"
              >
                揭示答案 (Space)
              </button>
            ) : (
              <button
                type="button"
                onClick={nextQuizQuestion}
                className="rounded-lg bg-azure px-3.5 py-1 text-xs font-semibold text-white transition hover:opacity-90"
              >
                下一题 →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quiz "看名找穴" Floating Instruction Banner */}
      {isQuizMode && !quizTeacher && quizKind === 'locate' && quizQuestion && !quizQuestion.answer && (
        <div className="glass pointer-events-none absolute top-14 left-1/2 z-20 -translate-x-1/2 rounded-xl px-4 py-2 text-center text-xs">
          <span className="text-fg-muted">看名找穴：请在 3D 人体上点击 </span>
          <strong className="font-serif text-base text-accent-fg">
            {acupointByCode.get(quizQuestion.code)?.name ?? quizQuestion.code}
          </strong>
          <span className="ml-1 font-mono text-fg-subtle">({quizQuestion.code})</span>
        </div>
      )}

      {/* Bottom-Left Orientation Compass Gizmo (UI audit 4.6) */}
      <div
        style={{ bottom: `${bottomDockOffset}px` }}
        className="pointer-events-auto absolute left-3 z-20 flex items-center gap-1.5"
      >
        <div className="glass flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-surface-2/80">
            <svg
              viewBox="0 0 32 32"
              className="h-6 w-6 text-fg-muted transition-transform duration-150"
              style={{ transform: `rotate(${-azimuthDeg}deg)` }}
            >
              <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeOpacity="0.25" />
              <path d="M16 4 L19.5 14 L16 11.5 L12.5 14 Z" fill="var(--c-accent)" />
              <circle cx="16" cy="16" r="2" fill="currentColor" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-[10px] text-fg-subtle">当前方位</div>
            <div className="font-medium text-fg">{az.label}</div>
          </div>
          <div className="ml-1 hidden items-center gap-0.5 border-l border-line pl-2 sm:flex">
            {(
              [
                ['front', '正'],
                ['right', '右'],
                ['back', '背'],
                ['left', '左'],
              ] as [ViewPreset, string][]
            ).map(([preset, ch]) => (
              <button
                key={preset}
                type="button"
                title={`切至${ch}面`}
                onClick={() => requestViewPreset(preset)}
                className={`h-6 w-6 rounded-md text-[11px] font-medium transition ${
                  az.preset === preset
                    ? 'bg-accent/20 text-accent-fg'
                    : 'text-fg-subtle hover:bg-surface-2 hover:text-fg'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom-Right Floating Display Settings, Cun Reference & Shortcut Help Dock */}
      <div
        ref={displayRef}
        style={{ bottom: `${bottomDockOffset}px` }}
        className="pointer-events-auto absolute right-3 z-20 flex items-center gap-1.5"
      >
        <button
          type="button"
          onClick={onOpenCunReference}
          title="查看 GB/T 12346-2021 骨度分寸折量表与体表骨性标志"
          className="glass tap hidden items-center rounded-xl px-2.5 py-2 text-xs font-medium text-fg-muted transition hover:text-fg sm:inline-flex"
        >
          骨度分寸
        </button>

        <button
          type="button"
          onClick={onOpenShortcuts}
          title="键盘快捷键 (?)"
          className="glass tap hidden h-9 w-9 items-center justify-center rounded-xl font-mono text-xs font-semibold text-fg-muted transition hover:text-fg sm:inline-flex"
        >
          ?
        </button>

        <button
          type="button"
          onClick={() => setDisplayOpen((o) => !o)}
          className={`glass tap flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
            displayOpen ? 'border-accent text-accent-fg' : 'text-fg hover:bg-surface-2'
          }`}
        >
          <span>视图与材质</span>
          <span className="text-[10px] text-fg-subtle">{displayOpen ? '▾' : '▴'}</span>
        </button>

        {displayOpen && (
          <div className="glass animate-fade-in-up absolute right-0 bottom-full mb-2 w-72 space-y-3 rounded-xl p-3.5 text-xs">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="font-semibold text-fg">3D 视图与材质设置</span>
              <button
                type="button"
                onClick={() => setDisplayOpen(false)}
                className="text-fg-subtle hover:text-fg"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-muted">人体材质</span>
              <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
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
                    className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                      bodyTheme === val
                        ? 'bg-accent text-white font-medium'
                        : 'text-fg-muted hover:text-fg'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-muted">经穴侧别</span>
              <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
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
                    className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                      displaySide === val
                        ? 'bg-azure text-white font-medium'
                        : 'text-fg-muted hover:text-fg'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-fg-muted">
                <span>模型不透明度</span>
                <span className="font-mono text-fg">{Math.round(bodyOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.25}
                max={1}
                step={0.05}
                value={bodyOpacity}
                onChange={(e) => setBodyOpacity(Number(e.target.value))}
                className="w-full accent-[var(--c-accent)]"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              {(
                [
                  [flowAnimation, setFlowAnimation, '经气流向', false],
                  [showLabels, setShowLabels, '穴名引线', isQuizMode],
                  [wireframeOverlay, setWireframeOverlay, '解剖线框', false],
                  [showLandmarks, setShowLandmarks, '骨性标志', false],
                ] as [boolean, (v: boolean) => void, string, boolean][]
              ).map(([checked, setter, label, disabled]) => (
                <button
                  key={label}
                  type="button"
                  disabled={disabled}
                  onClick={() => setter(!checked)}
                  className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-40 ${
                    checked
                      ? 'border-azure bg-azure/15 text-azure-fg'
                      : 'border-line bg-surface-2/60 text-fg-muted hover:text-fg'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Lightweight 80ms Hover Tooltip (UI audit 4.1) */}
      {activeTooltip && (
        <div
          style={{
            transform: `translate(${Math.round(activeTooltip.x + 14)}px, ${Math.round(activeTooltip.y - 14)}px) translate(0, -100%)`,
          }}
          className="glass pointer-events-none absolute top-0 left-0 z-30 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs whitespace-nowrap"
        >
          {isQuizMode ? (
            <span className="font-medium text-gold-fg">？ 盲测待辨识穴位</span>
          ) : (
            (() => {
              const pt = acupointByCode.get(activeTooltip.code);
              const m = pt ? meridianByCode.get(pt.meridianCode) : undefined;
              const sideTxt = isBilateralCode(activeTooltip.code)
                ? activeTooltip.side === 1
                  ? '右侧'
                  : '左侧'
                : '正中';
              return (
                <>
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: m?.color ?? 'var(--c-accent)' }}
                  />
                  <span className="font-semibold text-fg">{pt?.name ?? activeTooltip.code}</span>
                  <span className="font-mono text-[11px] text-fg-muted">{activeTooltip.code}</span>
                  <span className="text-[10px] text-fg-subtle">· {sideTxt} · 双击聚焦</span>
                </>
              );
            })()
          )}
        </div>
      )}

      {/* Touch Ambiguity Disambiguation Popover (UI audit 8.3) */}
      {ambiguousPick && (
        <div
          style={{
            left: `${Math.min(Math.max(ambiguousPick.x, 80), window.innerWidth - 180)}px`,
            top: `${Math.max(ambiguousPick.y - 12, 64)}px`,
          }}
          className="glass animate-fade-in-up pointer-events-auto absolute z-30 w-48 -translate-x-1/2 -translate-y-full rounded-xl p-2 text-xs"
        >
          <div className="mb-1 flex items-center justify-between px-1 text-[11px] text-fg-subtle">
            <span>请选择目标穴位</span>
            <button type="button" onClick={onDismissAmbiguous} className="px-1 text-fg-muted">
              ✕
            </button>
          </div>
          <div className="space-y-1">
            {ambiguousPick.candidates.map((c) => {
              const pt = acupointByCode.get(c.code);
              const m = pt ? meridianByCode.get(pt.meridianCode) : undefined;
              return (
                <button
                  key={`${c.code}-${c.side}`}
                  type="button"
                  onClick={() => {
                    selectAcupoint(c.code, { focus: 'pan', side: c.side });
                    onDismissAmbiguous();
                    onAfterMobilePick?.();
                  }}
                  className="tap flex w-full items-center justify-between rounded-lg bg-surface-2/80 px-2.5 py-1.5 text-left hover:bg-surface-3"
                >
                  <span className="flex items-center gap-1.5 font-medium text-fg">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: m?.color ?? 'var(--c-accent)' }}
                    />
                    {isQuizMode ? '？？？' : (pt?.name ?? c.code)}
                  </span>
                  <span className="font-mono text-[11px] text-fg-muted">
                    {isQuizMode ? '' : c.code}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
