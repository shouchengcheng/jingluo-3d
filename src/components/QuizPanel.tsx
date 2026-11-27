import { useMemo } from 'react';
import { buildQuizPool } from '../store/quizLogic';
import { useAtlasStore } from '../store/useAtlasStore';
import { SPECIAL_CATEGORIES } from '../utils/acupointMeta';
import type { QuizKind, QuizScope } from '../types/atlas';

const SCOPE_OPTIONS: { key: QuizScope; label: string }[] = [
  { key: 'visible', label: '已选经脉' },
  { key: 'meridian', label: '当前单经' },
  { key: 'core', label: '重点掌握穴' },
  { key: 'special', label: '特定穴' },
  { key: 'wrong', label: '错题本' },
  { key: 'all', label: '全部 151 穴' },
];

export interface QuizPanelProps {
  onSelectAcupointDone?: () => void;
}

export function QuizPanel({ onSelectAcupointDone }: QuizPanelProps) {
  const acupoints = useAtlasStore((s) => s.acupoints);
  const coordinates = useAtlasStore((s) => s.coordinates);
  const meridians = useAtlasStore((s) => s.meridians);
  const visibleMeridians = useAtlasStore((s) => s.visibleMeridians);
  const selectedAcupointId = useAtlasStore((s) => s.selectedAcupointId);
  const specialFilter = useAtlasStore((s) => s.specialFilter);

  const quizKind = useAtlasStore((s) => s.quizKind);
  const quizScope = useAtlasStore((s) => s.quizScope);
  const quizTeacher = useAtlasStore((s) => s.quizTeacher);
  const quizStats = useAtlasStore((s) => s.quizStats);
  const quizWrongCodes = useAtlasStore((s) => s.quizWrongCodes);

  const setQuizKind = useAtlasStore((s) => s.setQuizKind);
  const setQuizScope = useAtlasStore((s) => s.setQuizScope);
  const setQuizTeacher = useAtlasStore((s) => s.setQuizTeacher);
  const setSpecialFilter = useAtlasStore((s) => s.setSpecialFilter);
  const setVisibleMeridians = useAtlasStore((s) => s.setVisibleMeridians);
  const nextQuizQuestion = useAtlasStore((s) => s.nextQuizQuestion);
  const resetQuizStats = useAtlasStore((s) => s.resetQuizStats);
  const setQuizMode = useAtlasStore((s) => s.setQuizMode);
  const selectAcupoint = useAtlasStore((s) => s.selectAcupoint);

  const poolSize = useMemo(
    () =>
      buildQuizPool(
        {
          acupoints,
          coordinates,
          visibleMeridians,
          selectedAcupointId,
          specialFilter,
          wrongCodes: quizWrongCodes,
        },
        quizScope,
      ).length,
    [acupoints, coordinates, visibleMeridians, selectedAcupointId, specialFilter, quizWrongCodes, quizScope],
  );

  const accuracy =
    quizStats.total > 0 ? Math.round((quizStats.correct / quizStats.total) * 100) : 0;

  const acupointMap = useMemo(() => new Map(acupoints.map((a) => [a.code, a])), [acupoints]);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3.5 text-[13px]">
      <div className="space-y-3.5">
        {/* Quiz Mode Switcher: Identify vs Locate (UI audit 7.1) */}
        <section className="space-y-2 rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
              题型模式
            </span>
            <span className="font-mono text-[11px] text-gold-fg">题库 {poolSize} 穴</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['identify', '看点认穴', '3D 高亮一点，四选一或输拼音'],
                ['locate', '看名找穴', '给穴名，在人体表面点出位置'],
              ] as [QuizKind, string, string][]
            ).map(([k, title, hint]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setQuizKind(k);
                  onSelectAcupointDone?.();
                }}
                className={`tap rounded-lg border p-2 text-left transition ${
                  quizKind === k
                    ? 'border-accent bg-accent/15 text-fg'
                    : 'border-line bg-surface-2/60 text-fg-muted hover:text-fg'
                }`}
              >
                <div className="text-xs font-semibold">{title}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-fg-subtle">{hint}</div>
              </button>
            ))}
          </div>

          {/* Classroom Teacher Mode Toggle (UI audit 7.5) */}
          <label className="mt-1 flex cursor-pointer items-center justify-between rounded-lg border border-line bg-surface-2/50 px-2.5 py-2 text-xs">
            <div>
              <div className="font-medium text-fg">课堂教师提问模式</div>
              <div className="text-[11px] text-fg-subtle">大字出题、隐藏线索，按空格揭示答案</div>
            </div>
            <input
              type="checkbox"
              checked={quizTeacher}
              onChange={(e) => setQuizTeacher(e.target.checked)}
              className="h-4 w-4 accent-[var(--c-accent)]"
            />
          </label>
        </section>

        {/* Scope Selector (UI audit 7.2) */}
        <section className="space-y-2 rounded-xl border border-line bg-surface p-3">
          <span className="block text-xs font-semibold tracking-wider text-fg-muted uppercase">
            考查范围
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {SCOPE_OPTIONS.map((opt) => {
              const disabled = opt.key === 'wrong' && quizWrongCodes.length === 0;
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => setQuizScope(opt.key)}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition disabled:opacity-35 ${
                    quizScope === opt.key
                      ? 'border-azure bg-azure/18 text-azure-fg'
                      : 'border-line bg-surface-2/50 text-fg-muted hover:text-fg'
                  }`}
                >
                  {opt.label}
                  {opt.key === 'wrong' && quizWrongCodes.length > 0
                    ? ` (${quizWrongCodes.length})`
                    : ''}
                </button>
              );
            })}
          </div>

          {(quizScope === 'visible' || quizScope === 'meridian') && (
            <div className="pt-1">
              <div className="mb-1 text-[11px] text-fg-subtle">快速切换考查经脉：</div>
              <div className="flex flex-wrap gap-1">
                {meridians.map((m) => {
                  const active = visibleMeridians.includes(m.code);
                  return (
                    <button
                      key={m.code}
                      type="button"
                      onClick={() => {
                        setVisibleMeridians([m.code]);
                        nextQuizQuestion();
                      }}
                      className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition ${
                        active && visibleMeridians.length === 1
                          ? 'border-accent bg-accent/15 font-medium text-fg'
                          : 'border-line bg-surface-2/50 text-fg-muted hover:text-fg'
                      }`}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: m.color }}
                      />
                      {m.shortName}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {quizScope === 'special' && (
            <div className="pt-1">
              <div className="mb-1 text-[11px] text-fg-subtle">限定特定穴类别：</div>
              <div className="flex flex-wrap gap-1">
                {SPECIAL_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSpecialFilter(specialFilter === cat ? null : cat)}
                    className={`rounded-md border px-2 py-0.5 text-[11px] transition ${
                      specialFilter === cat
                        ? 'border-gold bg-gold/20 font-medium text-gold-fg'
                        : 'border-line bg-surface-2/50 text-fg-muted hover:text-fg'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Live Scoreboard (UI audit 7.3) */}
        <section className="space-y-2.5 rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
              本轮测验统计
            </span>
            {quizStats.total > 0 && (
              <button
                type="button"
                onClick={resetQuizStats}
                className="text-[11px] text-fg-subtle hover:text-fg"
              >
                清零记录
              </button>
            )}
          </div>

          <div className="grid grid-cols-4 gap-1.5 text-center">
            <div className="rounded-lg bg-surface-2 p-2">
              <div className="font-mono text-base font-bold text-fg">{quizStats.total}</div>
              <div className="text-[10px] text-fg-subtle">已答题</div>
            </div>
            <div className="rounded-lg bg-surface-2 p-2">
              <div className="font-mono text-base font-bold text-ok-fg">{accuracy}%</div>
              <div className="text-[10px] text-fg-subtle">正确率</div>
            </div>
            <div className="rounded-lg bg-surface-2 p-2">
              <div className="font-mono text-base font-bold text-gold-fg">{quizStats.streak}</div>
              <div className="text-[10px] text-fg-subtle">当前连对</div>
            </div>
            <div className="rounded-lg bg-surface-2 p-2">
              <div className="font-mono text-base font-bold text-azure-fg">
                {quizStats.bestStreak}
              </div>
              <div className="text-[10px] text-fg-subtle">最高连对</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              nextQuizQuestion();
              onSelectAcupointDone?.();
            }}
            className="tap w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
          >
            换一题 / 抽考下一穴 →
          </button>
        </section>

        {/* Wrong-Answer Review Book (UI audit 7.3) */}
        <section className="space-y-2 rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
              待巩固错题 ({quizWrongCodes.length})
            </span>
            {quizWrongCodes.length > 0 && quizScope !== 'wrong' && (
              <button
                type="button"
                onClick={() => setQuizScope('wrong')}
                className="text-xs font-medium text-accent-fg hover:underline"
              >
                只练错题 →
              </button>
            )}
          </div>

          {quizWrongCodes.length === 0 ? (
            <p className="text-xs text-fg-subtle">
              答错或点击「看答案」的穴位会自动收入错题本，便于课后集中复盘。
            </p>
          ) : (
            <div className="space-y-1">
              {quizWrongCodes.map((code) => {
                const pt = acupointMap.get(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      setQuizMode(false);
                      selectAcupoint(code, { focus: 'full' });
                      onSelectAcupointDone?.();
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-line bg-surface-2/60 px-2.5 py-1.5 text-left text-xs hover:border-accent/50"
                  >
                    <span className="font-medium text-fg">{pt?.name ?? code}</span>
                    <span className="font-mono text-[11px] text-fg-muted">
                      {code} · 退出盲测查看
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
