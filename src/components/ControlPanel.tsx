import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtlasStore } from '../store/useAtlasStore';
import {
  SPECIAL_CATEGORIES,
  meridianFlowIndex,
  parseOrder,
  sortByFlow,
  specialBadges,
} from '../utils/acupointMeta';
import { matchesAcupointQuery } from '../utils/searchMatch';
import { QuizPanel } from './QuizPanel';
import type { Acupoint, MeridianCode, MeridianMeta } from '../types/atlas';

export interface ControlPanelProps {
  onSelectAcupointDone?: () => void;
}

export function ControlPanel({ onSelectAcupointDone }: ControlPanelProps) {
  const isQuizMode = useAtlasStore((s) => s.isQuizMode);
  if (isQuizMode) {
    return <QuizPanel onSelectAcupointDone={onSelectAcupointDone} />;
  }
  return <DirectoryPanel onSelectAcupointDone={onSelectAcupointDone} />;
}

function DirectoryPanel({ onSelectAcupointDone }: ControlPanelProps) {
  const [meridianGridOpen, setMeridianGridOpen] = useState(true);
  const [rxDrawerOpen, setRxDrawerOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const meridians = useAtlasStore((s) => s.meridians);
  const acupoints = useAtlasStore((s) => s.acupoints);
  const coordinates = useAtlasStore((s) => s.coordinates);
  const prescriptions = useAtlasStore((s) => s.prescriptions);
  const activePrescriptionId = useAtlasStore((s) => s.activePrescriptionId);
  const visibleMeridians = useAtlasStore((s) => s.visibleMeridians);
  const multiCompare = useAtlasStore((s) => s.multiCompare);
  const selectedAcupointId = useAtlasStore((s) => s.selectedAcupointId);
  const searchQuery = useAtlasStore((s) => s.searchQuery);
  const specialFilter = useAtlasStore((s) => s.specialFilter);
  const recentIds = useAtlasStore((s) => s.recentIds);

  const selectMeridian = useAtlasStore((s) => s.selectMeridian);
  const setVisibleMeridians = useAtlasStore((s) => s.setVisibleMeridians);
  const selectPrescription = useAtlasStore((s) => s.selectPrescription);
  const setMultiCompare = useAtlasStore((s) => s.setMultiCompare);
  const setSearchQuery = useAtlasStore((s) => s.setSearchQuery);
  const setSpecialFilter = useAtlasStore((s) => s.setSpecialFilter);
  const clearFilters = useAtlasStore((s) => s.clearFilters);
  const selectAcupoint = useAtlasStore((s) => s.selectAcupoint);
  const setListHoverCode = useAtlasStore((s) => s.setListHoverCode);

  const activePrescription = useMemo(
    () => prescriptions.find((p) => p.id === activePrescriptionId) ?? null,
    [prescriptions, activePrescriptionId],
  );

  // Order meridians strictly by 12-meridian Qi circulation + CV + GV (UI audit 5.3)
  const orderedMeridians = useMemo(
    () => [...meridians].sort((a, b) => meridianFlowIndex(a.code) - meridianFlowIndex(b.code)),
    [meridians],
  );

  const meridianMap = useMemo(
    () => new Map<MeridianCode, MeridianMeta>(meridians.map((m) => [m.code, m])),
    [meridians],
  );

  const acupointMap = useMemo(
    () => new Map<string, Acupoint>(acupoints.map((a) => [a.code, a])),
    [acupoints],
  );

  const textCountByMeridian = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of acupoints) {
      counts[a.meridianCode] = (counts[a.meridianCode] ?? 0) + 1;
    }
    return counts;
  }, [acupoints]);

  const filteredAcupoints = useMemo(() => {
    if (activePrescription) {
      const rxSet = new Set(activePrescription.points);
      return acupoints.filter((a) => rxSet.has(a.code)).sort(sortByFlow);
    }
    const visibleSet = new Set(visibleMeridians);
    const hasSearch = searchQuery.trim().length > 0;
    return acupoints
      .filter((a) => {
        if (!hasSearch && !specialFilter && !visibleSet.has(a.meridianCode)) return false;
        return matchesAcupointQuery(a, a.code, searchQuery, specialFilter);
      })
      .sort(sortByFlow);
  }, [acupoints, activePrescription, visibleMeridians, searchQuery, specialFilter]);

  // Group acupoints by meridian in circulation order and sort LU1 -> LU11 inside each group (UI audit 5.2)
  const groupedAcupoints = useMemo(() => {
    const byM = new Map<MeridianCode, Acupoint[]>();
    for (const a of filteredAcupoints) {
      const arr = byM.get(a.meridianCode) ?? [];
      arr.push(a);
      byM.set(a.meridianCode, arr);
    }
    const out: { meta: MeridianMeta; items: Acupoint[] }[] = [];
    for (const m of orderedMeridians) {
      const items = byM.get(m.code);
      if (items && items.length > 0) {
        items.sort((x, y) => parseOrder(x.code) - parseOrder(y.code));
        out.push({ meta: m, items });
      }
    }
    return out;
  }, [filteredAcupoints, orderedMeridians]);

  const allCodes = useMemo(() => orderedMeridians.map((m) => m.code), [orderedMeridians]);

  // Auto-scroll list to selected acupoint when picked in 3D (UI audit 5.5)
  useEffect(() => {
    if (!selectedAcupointId) return;
    const mCode = selectedAcupointId.replace(/\d+$/, '');
    if (collapsedGroups[mCode]) {
      setCollapsedGroups((prev) => ({ ...prev, [mCode]: false }));
    }
    const timer = window.setTimeout(() => {
      const el = rowRefs.current[selectedAcupointId];
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [selectedAcupointId]);

  const toggleGroup = (code: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden text-[13px]">
      {/* Fixed Top Search + Active Filter Chips + Recent History (UI audit 3.1, 3.3, 6.6) */}
      <div className="shrink-0 space-y-2 border-b border-line bg-surface px-3.5 py-3">
        <div className="relative">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜穴名 / 拼音首字母 / 国标码 / 主治..."
            className="w-full rounded-lg border border-line-strong bg-surface-2/80 py-2 pr-14 pl-3 text-[13px] text-fg placeholder-fg-subtle focus:border-accent focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg"
            >
              清空
            </button>
          )}
        </div>

        {/* Single horizontal scrollable Special Acupoint strip (UI audit 3.3) */}
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto pb-0.5">
          <span className="shrink-0 pr-0.5 text-[11px] text-fg-subtle">特定穴:</span>
          {SPECIAL_CATEGORIES.map((cat) => {
            const active = specialFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSpecialFilter(active ? null : cat)}
                className={`shrink-0 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap transition ${
                  active
                    ? 'border-gold bg-gold/20 font-semibold text-gold-fg'
                    : 'border-line bg-surface-2/60 text-fg-muted hover:border-line-strong hover:text-fg'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Active removable filter pills */}
        {(searchQuery.trim() || specialFilter || activePrescription) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
            <span className="text-[11px] text-fg-subtle">筛选中:</span>
            {activePrescription && (
              <button
                type="button"
                onClick={() => selectPrescription(null)}
                className="inline-flex items-center gap-1 rounded-md bg-azure/20 px-2 py-0.5 font-medium text-azure-fg"
              >
                <span>配穴:{activePrescription.name}</span>
                <span>✕</span>
              </button>
            )}
            {specialFilter && (
              <button
                type="button"
                onClick={() => setSpecialFilter(null)}
                className="inline-flex items-center gap-1 rounded-md bg-gold/20 px-2 py-0.5 font-medium text-gold-fg"
              >
                <span>{specialFilter}</span>
                <span>✕</span>
              </button>
            )}
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="inline-flex items-center gap-1 rounded-md bg-accent/18 px-2 py-0.5 font-medium text-accent-fg"
              >
                <span>“{searchQuery.trim()}”</span>
                <span>✕</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                selectPrescription(null);
                clearFilters();
              }}
              className="ml-auto text-[11px] text-fg-subtle hover:text-fg"
            >
              全部重置
            </button>
          </div>
        )}

        {/* Recent History Quick Chips (UI audit 6.6) */}
        {recentIds.length > 1 && !searchQuery.trim() && !specialFilter && (
          <div className="no-scrollbar flex items-center gap-1 overflow-x-auto text-[11px]">
            <span className="shrink-0 text-fg-subtle">最近:</span>
            {recentIds.map((id) => {
              const pt = acupointMap.get(id);
              const active = id === selectedAcupointId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    selectAcupoint(id, { focus: 'auto' });
                    onSelectAcupointDone?.();
                  }}
                  className={`shrink-0 rounded px-1.5 py-0.5 whitespace-nowrap transition ${
                    active
                      ? 'bg-accent/20 font-medium text-accent-fg'
                      : 'bg-surface-2/70 text-fg-muted hover:text-fg'
                  }`}
                >
                  {pt?.name ?? id}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Collapsible 14-Meridian Selector (Single-Click Focus vs Multi-Compare — UI audit 5.1 & 5.3) */}
      <div className="shrink-0 border-b border-line bg-surface/60 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={() => setMeridianGridOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-fg-muted uppercase hover:text-fg"
          >
            <span className="text-[10px]">{meridianGridOpen ? '▾' : '▸'}</span>
            <span>十四经流注 ({visibleMeridians.length}/14)</span>
          </button>

          <div className="flex items-center gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => setMultiCompare(!multiCompare)}
              title="开启后点击经脉按钮可多条叠加对比；关闭时单击直接切换到该经"
              className={`rounded-md border px-1.5 py-0.5 font-medium transition ${
                multiCompare
                  ? 'border-azure bg-azure/18 text-azure-fg'
                  : 'border-line bg-surface-2/60 text-fg-subtle hover:text-fg'
              }`}
            >
              {multiCompare ? '多经叠加✓' : '单经切换'}
            </button>
            <button
              type="button"
              onClick={() => setVisibleMeridians(allCodes)}
              className="text-fg-muted hover:text-fg"
            >
              全选
            </button>
            <span className="text-line-strong">·</span>
            <button
              type="button"
              onClick={() => setVisibleMeridians([])}
              className="text-fg-subtle hover:text-fg"
            >
              清空
            </button>
          </div>
        </div>

        {meridianGridOpen && (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {orderedMeridians.map((m, idx) => {
              const checked = visibleMeridians.includes(m.code);
              const textCount = textCountByMeridian[m.code] ?? 0;
              return (
                <button
                  key={m.code}
                  type="button"
                  onClick={(e) => selectMeridian(m.code, e.metaKey || e.ctrlKey || e.shiftKey)}
                  title={`${idx < 12 ? `流注第${idx + 1}经 · ` : ''}${m.name}（${m.shichen} · ${m.element}）\n${
                    multiCompare ? '当前为多经叠加模式' : '单击仅看此经；按住 Ctrl/⌘ 点击叠加对比'
                  }`}
                  className={`flex items-center justify-between rounded-lg border px-2 py-1.5 text-left text-xs transition ${
                    checked
                      ? 'border-accent/70 bg-surface-2 font-semibold text-fg shadow-xs'
                      : 'border-line bg-surface/50 text-fg-muted hover:border-line-strong hover:text-fg'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/30"
                      style={{ backgroundColor: m.color, opacity: checked ? 1 : 0.45 }}
                    />
                    <span className="truncate">{m.shortName}</span>
                  </span>
                  <span className="ml-1 shrink-0 font-mono text-[10px] text-fg-subtle">
                    {textCount}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Collapsible Classic Point-Pairing Prescriptions Drawer (Audit 3.3) */}
      {prescriptions.length > 0 && (
        <div className="shrink-0 border-b border-line bg-surface/40 px-3.5 py-2">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setRxDrawerOpen((o) => !o)}
              className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-fg-muted uppercase hover:text-fg"
            >
              <span className="text-[10px]">{rxDrawerOpen ? '▾' : '▸'}</span>
              <span>经典临床配穴 ({prescriptions.length})</span>
            </button>
            {activePrescription && (
              <button
                type="button"
                onClick={() => selectPrescription(null)}
                className="text-[11px] text-azure-fg hover:underline"
              >
                退出配穴
              </button>
            )}
          </div>

          {rxDrawerOpen && (
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-0.5">
              {prescriptions.map((rx) => {
                const active = rx.id === activePrescriptionId;
                return (
                  <button
                    key={rx.id}
                    type="button"
                    onClick={() => {
                      selectPrescription(active ? null : rx.id);
                      onSelectAcupointDone?.();
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${
                      active
                        ? 'border-azure bg-azure/18 font-semibold text-fg'
                        : 'border-line bg-surface/60 text-fg-muted hover:border-line-strong hover:text-fg'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-fg">{rx.name}</div>
                      <div className="truncate text-[10px] text-fg-subtle">{rx.category}</div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-gold-fg">
                      {rx.points.join('+')}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Single Scrollable Acupoint List Filling Remaining Height (UI audit 3.1, 5.2, 5.4, 5.5) */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2.5">
        <div className="mb-2 flex items-center justify-between text-[11px] text-fg-subtle">
          <span>匹配穴位 ({filteredAcupoints.length}) · 按经脉循行序</span>
          <span>★ 重点掌握</span>
        </div>

        {groupedAcupoints.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong p-5 text-center text-xs text-fg-subtle">
            暂无匹配穴位，请选择上方经脉或调整筛选条件。
          </div>
        ) : (
          <div className="space-y-2.5">
            {groupedAcupoints.map(({ meta, items }) => {
              const isCollapsed = Boolean(collapsedGroups[meta.code]) && groupedAcupoints.length > 1;
              return (
                <div key={meta.code} className="rounded-xl border border-line bg-surface/50">
                  {/* Collapsible Meridian Group Header */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(meta.code)}
                    className="flex w-full items-center justify-between gap-2 rounded-t-xl px-2.5 py-1.5 text-left text-xs hover:bg-surface-2/60"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 font-semibold text-fg">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: meta.color }}
                      />
                      <span className="truncate">{meta.name}</span>
                      <span className="text-[11px] font-normal text-fg-subtle">
                        · {meta.element.split(' ')[0]}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-fg-subtle">
                      <span>{items.length}穴</span>
                      <span>{isCollapsed ? '▸' : '▾'}</span>
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="divide-y divide-line/60 border-t border-line/70">
                      {items.map((item) => {
                        const isSelected = item.code === selectedAcupointId;
                        const badges = specialBadges(item.specialCategory);
                        const mColor = meridianMap.get(item.meridianCode)?.color ?? meta.color;
                        const hasCoord = Boolean(coordinates?.points[item.code]);
                        return (
                          <button
                            key={item.code}
                            ref={(el) => {
                              rowRefs.current[item.code] = el;
                            }}
                            type="button"
                            onMouseEnter={() => setListHoverCode(item.code)}
                            onMouseLeave={() => setListHoverCode(null)}
                            onClick={() => {
                              selectAcupoint(item.code, { focus: 'auto' });
                              onSelectAcupointDone?.();
                            }}
                            onDoubleClick={() => {
                              selectAcupoint(item.code, { focus: 'full' });
                            }}
                            className={`flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left transition ${
                              isSelected
                                ? 'bg-accent/15 text-fg'
                                : 'text-fg hover:bg-surface-2/70'
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: mColor, opacity: hasCoord ? 1 : 0.35 }}
                              />
                              <span className="w-10 shrink-0 font-mono text-xs text-fg-muted">
                                {item.code}
                              </span>
                              <span className="truncate font-medium">{item.name}</span>
                              {item.textbookScope === 'undergraduate_core' && (
                                <span
                                  title="本科《针灸学》重点掌握穴"
                                  className="shrink-0 text-[11px] text-gold-fg"
                                >
                                  ★
                                </span>
                              )}
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                              {badges.map((b) => (
                                <span
                                  key={b}
                                  className="rounded border border-gold/40 bg-gold/12 px-1 py-0.5 text-[10px] font-medium leading-none text-gold-fg"
                                >
                                  {b}
                                </span>
                              ))}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
