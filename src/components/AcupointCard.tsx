import { useMemo, useState } from 'react';
import { LOCATE_TOLERANCE_CM } from '../store/quizLogic';
import { QUIZ_REVEAL_TOKEN, useAtlasStore } from '../store/useAtlasStore';
import { categoryBase, isBilateralCode, parseOrder } from '../utils/acupointMeta';
import { extractSafetyNotice } from '../utils/safety';
import { buildDeepLinkUrl } from '../utils/urlSync';
import type { Acupoint } from '../types/atlas';

type CardTab = 'location' | 'etymology' | 'indications' | 'operation' | 'all';

const CARD_TABS: { key: CardTab; label: string }[] = [
  { key: 'all', label: '全览' },
  { key: 'location', label: '定位' },
  { key: 'etymology', label: '名解' },
  { key: 'indications', label: '主治' },
  { key: 'operation', label: '刺灸' },
];

export function AcupointCard() {
  const [tab, setTab] = useState<CardTab>('all');
  const [typedGuess, setTypedGuess] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  const selectedId = useAtlasStore((s) => s.selectedAcupointId);
  const activeSide = useAtlasStore((s) => s.activeSide);
  const visibleMeridians = useAtlasStore((s) => s.visibleMeridians);
  const uiTheme = useAtlasStore((s) => s.uiTheme);
  const acupoints = useAtlasStore((s) => s.acupoints);
  const meridians = useAtlasStore((s) => s.meridians);
  const coordinates = useAtlasStore((s) => s.coordinates);
  const prescriptions = useAtlasStore((s) => s.prescriptions);
  const activePrescriptionId = useAtlasStore((s) => s.activePrescriptionId);
  const specialFilter = useAtlasStore((s) => s.specialFilter);
  const searchQuery = useAtlasStore((s) => s.searchQuery);
  const recentIds = useAtlasStore((s) => s.recentIds);

  const isQuizMode = useAtlasStore((s) => s.isQuizMode);
  const quizKind = useAtlasStore((s) => s.quizKind);
  const quizTeacher = useAtlasStore((s) => s.quizTeacher);
  const quizQuestion = useAtlasStore((s) => s.quizQuestion);

  const selectAcupoint = useAtlasStore((s) => s.selectAcupoint);
  const selectPrescription = useAtlasStore((s) => s.selectPrescription);
  const flipActiveSide = useAtlasStore((s) => s.flipActiveSide);
  const requestFocusSelected = useAtlasStore((s) => s.requestFocusSelected);
  const applyTagFilter = useAtlasStore((s) => s.applyTagFilter);
  const answerQuizChoice = useAtlasStore((s) => s.answerQuizChoice);
  const answerQuizTyped = useAtlasStore((s) => s.answerQuizTyped);
  const revealQuizAnswer = useAtlasStore((s) => s.revealQuizAnswer);
  const nextQuizQuestion = useAtlasStore((s) => s.nextQuizQuestion);

  const activePrescription = useMemo(
    () => prescriptions.find((p) => p.id === activePrescriptionId) ?? null,
    [prescriptions, activePrescriptionId],
  );

  const handleCopyDeepLink = async () => {
    const url = buildDeepLinkUrl({
      selectedAcupointId: selectedId,
      visibleMeridians,
      activeSide,
      uiTheme,
      activePrescriptionId,
      isQuizMode,
    });
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1800);
  };

  const acupointMap = useMemo(
    () => new Map<string, Acupoint>(acupoints.map((a) => [a.code, a])),
    [acupoints],
  );

  const effectiveId = isQuizMode && quizQuestion ? quizQuestion.code : selectedId;
  const acupoint = effectiveId ? (acupointMap.get(effectiveId) ?? null) : null;
  const coord = effectiveId ? coordinates?.points[effectiveId] : undefined;
  const meridianPrefix = effectiveId?.replace(/\d+$/, '');
  const meridianMeta = useMemo(
    () => meridians.find((m) => m.code === meridianPrefix) ?? null,
    [meridians, meridianPrefix],
  );

  const siblings = useMemo(() => {
    if (!acupoint) return [];
    return acupoints
      .filter((a) => a.meridianCode === acupoint.meridianCode)
      .sort((a, b) => parseOrder(a.code) - parseOrder(b.code));
  }, [acupoint, acupoints]);

  const currentIdx = useMemo(
    () => (acupoint ? siblings.findIndex((s) => s.code === acupoint.code) : -1),
    [acupoint, siblings],
  );

  const safety = useMemo(
    () => extractSafetyNotice(acupoint?.clinical.operation),
    [acupoint?.clinical.operation],
  );

  if (!effectiveId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-fg-muted">
        <p>请在三维人体模型或左侧目录中点击任意穴位，查看国标定位与临床详情。</p>
        {recentIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
            <span className="text-fg-subtle">回到最近查看：</span>
            {recentIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => selectAcupoint(id, { focus: 'auto' })}
                className="rounded-md border border-line bg-surface-2 px-2 py-1 text-fg hover:border-accent"
              >
                {acupointMap.get(id)?.name ?? id}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // Active-Recall Quiz View (Pending Answer) — UI audit 7.1 & 7.5
  // =========================================================================
  if (isQuizMode && quizQuestion && !quizQuestion.answer) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-[13px] lg:p-5">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent-fg">
            {quizKind === 'identify' ? '盲测 · 看点认穴' : '盲测 · 看名找穴'}
          </span>
          <button
            type="button"
            onClick={() => {
              setTypedGuess('');
              nextQuizQuestion();
            }}
            className="text-xs text-fg-muted hover:text-fg"
          >
            换一题 →
          </button>
        </div>

        {quizKind === 'identify' ? (
          <>
            <div>
              <h2 className="font-serif text-xl font-bold text-fg">
                请辨识 3D 模型上高亮的穴位
              </h2>
              <p className="mt-1 leading-relaxed text-fg-muted">
                观察三维人体上朱砂靶环与毫针所指的体表部位，从下方四项中选出正确穴位，或直接输入穴名 / 拼音首字母作答。
              </p>
            </div>

            {!quizTeacher && (
              <div className="rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-xs text-fg-muted">
                <span className="text-fg-subtle">线索：</span>
                <span>{meridianMeta ? meridianMeta.name : meridianPrefix}</span>
                {acupoint && (
                  <span>
                    {' '}
                    ·{' '}
                    {acupoint.textbookScope === 'undergraduate_core'
                      ? '本科重点掌握穴 ★'
                      : '扩展穴位'}
                  </span>
                )}
              </div>
            )}

            {/* 4-option multiple choice */}
            <div className="grid grid-cols-1 gap-2">
              {quizQuestion.options.map((optCode, i) => {
                const opt = acupointMap.get(optCode);
                return (
                  <button
                    key={optCode}
                    type="button"
                    onClick={() => {
                      setTypedGuess('');
                      answerQuizChoice(optCode);
                    }}
                    className="tap flex items-center justify-between rounded-xl border border-line-strong bg-surface-2/70 px-3.5 py-2.5 text-left transition hover:border-accent hover:bg-surface-3"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-surface-3 font-mono text-xs text-fg-muted">
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span className="font-serif text-base font-bold text-fg">
                        {opt?.name ?? optCode}
                      </span>
                    </span>
                    <span className="font-mono text-xs text-fg-subtle">{optCode}</span>
                  </button>
                );
              })}
            </div>

            {/* Typed pinyin / initials / name recall */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!typedGuess.trim()) return;
                answerQuizTyped(typedGuess);
                setTypedGuess('');
              }}
              className="flex gap-1.5 pt-1"
            >
              <input
                type="text"
                value={typedGuess}
                onChange={(e) => setTypedGuess(e.target.value)}
                placeholder="或输入穴名 / 拼音 / 首字母（如 ty）回车..."
                className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs text-fg placeholder-fg-subtle focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-azure px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
              >
                提交
              </button>
            </form>

            <div className="mt-auto flex items-center gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => requestFocusSelected('full')}
                className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs font-medium text-fg hover:bg-surface-3"
              >
                拉近聚焦 (F)
              </button>
              <button
                type="button"
                onClick={revealQuizAnswer}
                className="flex-1 rounded-lg border border-gold/50 bg-gold/15 px-3 py-2 text-xs font-semibold text-gold-fg hover:bg-gold/25"
              >
                看国标答案 (Space)
              </button>
            </div>
          </>
        ) : (
          /* "看名找穴" Locate Mode */
          <>
            <div className="rounded-xl border border-accent/40 bg-accent/10 p-4">
              <div className="font-mono text-xs text-accent-fg">{quizQuestion.code}</div>
              <h2 className="mt-1 font-serif text-2xl font-bold text-fg">
                {acupoint?.name ?? quizQuestion.code}
              </h2>
              {meridianMeta && (
                <div className="mt-1 text-xs text-fg-muted">
                  {meridianMeta.name} · {acupoint?.pinyin}
                </div>
              )}
            </div>

            <p className="leading-relaxed text-fg-muted">
              请自由旋转、缩放三维人体模型，直接在皮肤表面
              <strong className="text-fg">点击该穴位的标准解剖位置</strong>
              （体表误差 ≤ {LOCATE_TOLERANCE_CM} cm 判为正确，双侧穴位点任一侧均可）。
            </p>

            {!quizTeacher && acupoint && acupoint.specialCategory.length > 0 && (
              <div className="rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-xs text-fg-muted">
                特定穴提示：{acupoint.specialCategory.join(' · ')}
              </div>
            )}

            <div className="mt-auto flex items-center gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={revealQuizAnswer}
                className="w-full rounded-lg border border-gold/50 bg-gold/15 px-3 py-2 text-xs font-semibold text-gold-fg hover:bg-gold/25"
              >
                揭示正确三维位置 (Space)
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // Fallback if coordinate exists without prose
  if (!acupoint) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-5 text-[13px]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="font-mono text-xs text-accent-fg">{effectiveId}</span>
            <h2 className="mt-0.5 font-serif text-2xl font-bold text-fg">{effectiveId}</h2>
          </div>
          <button
            type="button"
            onClick={() => requestFocusSelected('full')}
            className="rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent-fg"
          >
            聚焦穴位
          </button>
        </div>
      </div>
    );
  }

  const isVerified = coord?.audit.status === 'gb_verified';
  const bilateral = isBilateralCode(acupoint.code);
  const quizAnswer = isQuizMode ? quizQuestion?.answer : null;

  return (
    <div className="flex h-full flex-col overflow-hidden text-[13px]">
      {/* 1. Meridian Color Top Bar + Prev/Next Sibling Nav (UI audit 6.1) */}
      {meridianMeta && (
        <div
          style={{ borderTopColor: meridianMeta.color }}
          className="shrink-0 border-t-[3px] border-b border-line bg-surface px-4 py-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: meridianMeta.color }}
              />
              <span className="truncate font-semibold text-fg">{meridianMeta.name}</span>
              <span className="shrink-0 text-fg-subtle">
                · {meridianMeta.shichen.split(' ')[0]} · {meridianMeta.element.split(' ')[0]}
              </span>
            </div>

            {siblings.length > 1 && !isQuizMode && (
              <div className="flex shrink-0 items-center gap-1 text-[11px]">
                <button
                  type="button"
                  disabled={currentIdx <= 0}
                  title={currentIdx > 0 ? `上一穴：${siblings[currentIdx - 1].name} (←)` : ''}
                  onClick={() => {
                    const prev = siblings[currentIdx - 1];
                    if (prev) selectAcupoint(prev.code, { focus: 'auto' });
                  }}
                  className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-fg-muted hover:text-fg disabled:opacity-35"
                >
                  ‹ 上穴
                </button>
                <span className="font-mono text-[10px] text-fg-subtle">
                  {currentIdx + 1}/{siblings.length}
                </span>
                <button
                  type="button"
                  disabled={currentIdx < 0 || currentIdx >= siblings.length - 1}
                  title={
                    currentIdx >= 0 && currentIdx < siblings.length - 1
                      ? `下一穴：${siblings[currentIdx + 1].name} (→)`
                      : ''
                  }
                  onClick={() => {
                    const next = siblings[currentIdx + 1];
                    if (next) selectAcupoint(next.code, { focus: 'auto' });
                  }}
                  className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-fg-muted hover:text-fg disabled:opacity-35"
                >
                  下穴 ›
                </button>
              </div>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-fg-subtle">{meridianMeta.route}</div>
        </div>
      )}

      {/* Main Scrollable Card Body */}
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-4 lg:px-5">
        {/* Quiz Result Feedback Banner when answered */}
        {quizAnswer && (
          <div
            className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-xs ${
              quizAnswer.chosen === QUIZ_REVEAL_TOKEN && quizTeacher
                ? 'border-azure/50 bg-azure/15 text-azure-fg'
                : quizAnswer.correct
                  ? 'border-ok/50 bg-ok/15 text-ok-fg'
                  : 'border-danger/50 bg-danger/15 text-danger-fg'
            }`}
          >
            <div>
              <div className="font-semibold">
                {quizAnswer.chosen === QUIZ_REVEAL_TOKEN && quizTeacher
                  ? '已向课堂展示标准答案'
                  : quizAnswer.correct
                    ? '回答正确！'
                    : quizAnswer.chosen === QUIZ_REVEAL_TOKEN
                      ? '已揭示答案（计入待巩固错题）'
                      : '回答有误（已加入错题本）'}
              </div>
              {quizAnswer.distanceCm !== undefined && (
                <div className="mt-0.5 text-[11px] opacity-90">
                  点选体表偏差：{quizAnswer.distanceCm} cm（≤ {LOCATE_TOLERANCE_CM} cm 判对）
                </div>
              )}
              {quizAnswer.chosen &&
                quizAnswer.chosen !== QUIZ_REVEAL_TOKEN &&
                !quizAnswer.correct && (
                  <div className="mt-0.5 text-[11px] opacity-90">
                    你的作答：{acupointMap.get(quizAnswer.chosen)?.name ?? quizAnswer.chosen}
                  </div>
                )}
            </div>
            <button
              type="button"
              onClick={nextQuizQuestion}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              下一题 →
            </button>
          </div>
        )}

        {/* 2. Serif Display Heading + Side Indicator + Focus Action (UI audit 2.3 & 4.7) */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-accent/40 bg-accent/15 px-2 py-0.5 font-mono text-xs font-semibold text-accent-fg">
                {acupoint.code}
              </span>
              <span className="text-xs text-fg-muted">{acupoint.pinyin}</span>
              {bilateral ? (
                <button
                  type="button"
                  onClick={flipActiveSide}
                  title="点击切换对侧同名穴位"
                  className="rounded-md border border-azure/40 bg-azure/12 px-1.5 py-0.5 text-[11px] font-medium text-azure-fg hover:bg-azure/22"
                >
                  {activeSide === 1 ? '右侧 ⇄' : '左侧 ⇄'}
                </button>
              ) : (
                <span className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-subtle">
                  正中单穴
                </span>
              )}
              {acupoint.textbookScope === 'undergraduate_core' && (
                <span className="rounded-md bg-gold/18 px-1.5 py-0.5 text-[11px] font-medium text-gold-fg">
                  ★ 重点掌握
                </span>
              )}
            </div>

            <h2 className="mt-1.5 font-serif text-[26px] leading-tight font-bold tracking-wide text-fg">
              {acupoint.name}
            </h2>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleCopyDeepLink()}
              title="复制当前穴位/配穴教学链接（可直接粘贴至课件 PPT）"
              className="tap rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-muted transition hover:text-fg"
            >
              {linkCopied ? '已复制✓' : '分享链接'}
            </button>
            <button
              type="button"
              onClick={() => requestFocusSelected('full')}
              disabled={!coord}
              title="平滑飞至该穴位最佳观察角度 (快捷键 F)"
              className="tap rounded-lg border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent/25 disabled:opacity-40"
            >
              聚焦视角
            </button>
          </div>
        </div>

        {/* Active Clinical Point-Pairing Prescription Banner (Audit 3.3) */}
        {activePrescription && !isQuizMode && (
          <div className="space-y-2 rounded-xl border border-azure/45 bg-azure/10 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-azure-fg">
                配穴演示：{activePrescription.name}
              </span>
              <button
                type="button"
                onClick={() => selectPrescription(null)}
                className="text-[11px] text-fg-subtle hover:text-fg"
              >
                退出配穴 ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {activePrescription.points.map((code) => {
                const pt = acupointMap.get(code);
                const isCur = code === acupoint.code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => selectAcupoint(code, { focus: 'full' })}
                    className={`rounded-md border px-2 py-0.5 text-xs font-medium transition ${
                      isCur
                        ? 'border-accent bg-accent/20 text-accent-fg'
                        : 'border-gold/45 bg-gold/12 text-gold-fg hover:border-gold'
                    }`}
                  >
                    {pt?.name ?? code} ({code})
                  </button>
                );
              })}
            </div>
            <p className="leading-relaxed text-fg">{activePrescription.rationale}</p>
            <div className="text-[11px] text-fg-muted">
              <span className="text-fg-subtle">协同主治：</span>
              {activePrescription.indications}
            </div>
          </div>
        )}

        {/* Clickable Special Category Tags (UI audit 6.3) */}
        {acupoint.specialCategory.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {acupoint.specialCategory.map((tag) => {
              const base = categoryBase(tag);
              const active = specialFilter === base;
              return (
                <button
                  key={tag}
                  type="button"
                  title={`点击在 3D 模型中筛选全部「${base}」`}
                  onClick={() =>
                    applyTagFilter({ category: active ? undefined : base })
                  }
                  className={`rounded-md border px-2 py-0.5 text-xs font-medium transition ${
                    active
                      ? 'border-gold bg-gold/25 text-gold-fg'
                      : 'border-gold/35 bg-gold/10 text-gold-fg hover:border-gold'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}

        {/* 3. Prominent Clinical Safety Warning Box ABOVE Content Sections (UI audit 6.2) */}
        {safety && (
          <div
            className={`rounded-xl border p-3 text-xs leading-relaxed ${
              safety.level === 'danger'
                ? 'border-danger/55 bg-danger/12 text-danger-fg'
                : 'border-warn/55 bg-warn/12 text-warn-fg'
            }`}
          >
            <div className="flex items-center gap-1.5 font-semibold">
              <span>{safety.level === 'danger' ? '⚠ 针刺高危 / 禁刺警示' : '⚑ 操作慎刺与禁忌提示'}</span>
            </div>
            <p className="mt-1 text-fg">{safety.clauses.join('；')}。</p>
          </div>
        )}

        {/* 4. Segmented Section Tabs (UI audit 6.4) */}
        <div className="sticky top-0 z-10 -mx-1 flex items-center gap-1 rounded-lg border border-line bg-surface/95 p-1 backdrop-blur-xs">
          {CARD_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-md py-1 text-xs font-medium transition ${
                tab === t.key
                  ? 'bg-surface-3 font-semibold text-fg shadow-xs'
                  : 'text-fg-muted hover:text-fg'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Section A: Location + GB/T 12346-2021 Provenance (UI audit 6.4 & 6.5) */}
        {(tab === 'all' || tab === 'location') && (
          <section className="space-y-2.5 rounded-xl border border-line bg-surface p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <h3 className="text-xs font-semibold tracking-wider text-azure-fg uppercase">
                体表精准定位
              </h3>
              <div className="flex items-center gap-1.5">
                <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                  {acupoint.standard}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    isVerified
                      ? 'bg-ok/18 text-ok-fg'
                      : 'bg-surface-2 text-fg-subtle'
                  }`}
                >
                  {isVerified ? '3D坐标已按国标复核' : '3D坐标初稿(以国标原文为准)'}
                </span>
              </div>
            </div>

            <div className="rounded-lg bg-surface-2/65 p-2.5">
              <div className="text-[11px] font-medium text-fg-subtle">国家标准定位原文</div>
              <p className="mt-1 leading-[1.68] text-fg">{acupoint.gbLocation}</p>
            </div>

            <div className="rounded-lg border border-dashed border-line-strong p-2.5">
              <div className="text-[11px] font-medium text-fg-subtle">临床简便取穴法</div>
              <p className="mt-1 leading-[1.68] text-fg-muted">{acupoint.quickLocation}</p>
            </div>
          </section>
        )}

        {/* Section B: Etymology & Classical Origin */}
        {(tab === 'all' || tab === 'etymology') && (
          <section className="space-y-2 rounded-xl border border-line bg-surface p-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold tracking-wider text-gold-fg uppercase">
                穴位名解与典籍出处
              </h3>
              <span className="text-xs font-medium text-gold-fg">{acupoint.etymology.origin}</span>
            </div>
            <p className="leading-[1.68] text-fg">{acupoint.etymology.meaning}</p>
          </section>
        )}

        {/* Section C: Functions & Clickable Indications (UI audit 6.3) */}
        {(tab === 'all' || tab === 'indications') && (
          <section className="space-y-2.5 rounded-xl border border-line bg-surface p-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wider text-ok-fg uppercase">
                功效与主治病症
              </h3>
              <span className="text-[11px] text-fg-subtle">点选病症可检索同治配穴</span>
            </div>

            <div>
              <div className="text-[11px] text-fg-subtle">核心功效</div>
              <p className="mt-0.5 font-semibold text-fg">{acupoint.clinical.functions}</p>
            </div>

            <div>
              <div className="text-[11px] text-fg-subtle">主治病症</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {acupoint.clinical.indications.map((ind) => {
                  const active = searchQuery.trim() === ind;
                  return (
                    <button
                      key={ind}
                      type="button"
                      title={`点击筛选主治含「${ind}」的全部穴位`}
                      onClick={() =>
                        applyTagFilter({ indication: active ? undefined : ind })
                      }
                      className={`rounded-md border px-2 py-0.5 text-xs transition ${
                        active
                          ? 'border-accent bg-accent/20 font-medium text-accent-fg'
                          : 'border-line-strong bg-surface-2 text-fg hover:border-accent/60'
                      }`}
                    >
                      {ind}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Section D: Needling & Moxibustion Operation */}
        {(tab === 'all' || tab === 'operation') && (
          <section className="space-y-2 rounded-xl border border-line bg-surface p-3.5">
            <h3 className="text-xs font-semibold tracking-wider text-accent-fg uppercase">
              常规刺灸法与操作要点
            </h3>
            <p className="leading-[1.68] text-fg">{acupoint.clinical.operation}</p>
          </section>
        )}
      </div>
    </div>
  );
}
