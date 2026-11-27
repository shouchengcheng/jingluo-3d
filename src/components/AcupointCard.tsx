import { useMemo } from 'react';
import { useAtlasStore } from '../store/useAtlasStore';

function parseOrder(code: string): number {
  const m = code.match(/\d+$/);
  return m ? Number.parseInt(m[0], 10) : 0;
}

export function AcupointCard() {
  const selectedId = useAtlasStore((s) => s.selectedAcupointId);
  const acupoints = useAtlasStore((s) => s.acupoints);
  const meridians = useAtlasStore((s) => s.meridians);
  const coordinates = useAtlasStore((s) => s.coordinates);
  const isQuizMode = useAtlasStore((s) => s.isQuizMode);
  const quizRevealedIds = useAtlasStore((s) => s.quizRevealedIds);

  const revealQuizAnswer = useAtlasStore((s) => s.revealQuizAnswer);
  const selectAcupoint = useAtlasStore((s) => s.selectAcupoint);
  const requestFocusSelected = useAtlasStore((s) => s.requestFocusSelected);

  const acupoint = useMemo(
    () => acupoints.find((a) => a.code === selectedId) ?? null,
    [acupoints, selectedId],
  );

  const coord = selectedId ? coordinates?.points[selectedId] : undefined;
  const meridianPrefix = selectedId?.replace(/\d+$/, '');
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

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-400">
        请在三维人体模型或左侧目录中点击任意穴位查看国标定位与临床详情。
      </div>
    );
  }

  const isAnswerHidden = isQuizMode && !quizRevealedIds[selectedId];

  if (isAnswerHidden) {
    return (
      <div className="flex h-full flex-col justify-between gap-4 overflow-y-auto p-5">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
            教学盲测模式进行中
          </div>
          <h2 className="text-xl font-bold text-white">请辨识当前高亮的三维穴位</h2>
          <p className="text-sm leading-relaxed text-slate-300">
            观察 3D 模型上金色光针指示的解剖部位与所属经脉循行走向，尝试在心中默念其
            <strong className="text-sky-300"> 穴位名称、国标代码、定位及特定穴属性</strong>。
          </p>

          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-400">
            <div>提示线索：</div>
            <ul className="mt-2 list-inside list-disc space-y-1 text-slate-300">
              <li>所属经脉：{meridianMeta ? meridianMeta.name : meridianPrefix}</li>
              {acupoint && (
                <li>
                  教材范围：
                  {acupoint.textbookScope === 'undergraduate_core'
                    ? '本科《针灸学》重点掌握穴'
                    : '本科《针灸学》一般了解穴'}
                </li>
              )}
            </ul>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={requestFocusSelected}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              拉近观察此穴
            </button>
            <button
              type="button"
              onClick={() => revealQuizAnswer(selectedId)}
              className="flex-1 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow hover:bg-emerald-400"
            >
              揭示国标答案
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Fallback card if user clicks a draft 3D marker from a Phase 2/3 meridian not yet populated with textbook prose
  if (!acupoint) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-5 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="font-mono text-xs text-sky-400">{selectedId}</span>
            <h2 className="mt-0.5 text-xl font-bold text-white">{selectedId}（待录入教材卡片）</h2>
            {meridianMeta && (
              <p className="mt-1 text-xs text-slate-400">
                {meridianMeta.name} · {meridianMeta.shichen}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={requestFocusSelected}
            className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
          >
            聚焦穴位
          </button>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-200">
          该穴位已从上游 <code className="font-mono">aicuc/3d-acupoint-atlas</code> 导入 3D
          初稿坐标（状态：<code className="font-mono">{coord?.audit.status ?? 'draft_imported'}</code>
          ），其 GB/T 12346-2021 完整教学卡片将在 Phase 2/3 录入。当前 Phase 1 已完整上线
          <strong> 手太阴肺经（LU1–LU11）</strong>全部 11 穴教学内容。
        </div>
      </div>
    );
  }

  const isVerified = coord?.audit.status === 'gb_verified';

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm lg:p-5">
      {/* Header */}
      <div className="border-b border-slate-800 pb-3.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-sky-500/20 px-2 py-0.5 font-mono text-xs font-semibold text-sky-300">
                {acupoint.code}
              </span>
              <span className="text-xs text-slate-400">{acupoint.pinyin}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                  isVerified
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-amber-500/15 text-amber-300'
                }`}
              >
                {isVerified ? '国标坐标已核' : '3D 初稿待核'}
              </span>
            </div>
            <h2 className="mt-1.5 text-2xl font-bold tracking-wide text-white">
              {acupoint.name}
            </h2>
          </div>

          <button
            type="button"
            onClick={requestFocusSelected}
            disabled={!coord}
            className="shrink-0 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/25 disabled:opacity-40"
          >
            聚焦视角
          </button>
        </div>

        {/* Meridian & Special Tags */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {meridianMeta && (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-slate-200"
              style={{ borderColor: `${meridianMeta.color}66` }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: meridianMeta.color }}
              />
              {meridianMeta.name}
            </span>
          )}
          {acupoint.specialCategory.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-200"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* 1. 精准定位 (GB/T 12346-2021) */}
      <section className="space-y-2 rounded-xl border border-slate-800/90 bg-slate-900/60 p-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold tracking-wider text-sky-400 uppercase">
            体表精准定位
          </h3>
          <span className="font-mono text-[11px] text-slate-500">{acupoint.standard}</span>
        </div>
        <div>
          <div className="text-[11px] font-medium text-slate-400">【国家标准定位】</div>
          <p className="mt-0.5 leading-relaxed text-slate-100">{acupoint.gbLocation}</p>
        </div>
        <div className="border-t border-slate-800/80 pt-2">
          <div className="text-[11px] font-medium text-slate-400">【临床简便取穴】</div>
          <p className="mt-0.5 leading-relaxed text-slate-300">{acupoint.quickLocation}</p>
        </div>
      </section>

      {/* 2. 名解与典籍由来 */}
      <section className="space-y-2 rounded-xl border border-slate-800/90 bg-slate-900/60 p-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold tracking-wider text-amber-400 uppercase">
            穴位名解与由来
          </h3>
          <span className="text-xs text-amber-200/90">{acupoint.etymology.origin}</span>
        </div>
        <p className="leading-relaxed text-slate-200">{acupoint.etymology.meaning}</p>
      </section>

      {/* 3. 临床应用与刺灸法 */}
      <section className="space-y-2.5 rounded-xl border border-slate-800/90 bg-slate-900/60 p-3.5">
        <h3 className="text-xs font-semibold tracking-wider text-emerald-400 uppercase">
          临床应用与操作
        </h3>

        <div>
          <span className="text-[11px] font-medium text-slate-400">【核心功效】</span>
          <p className="mt-0.5 font-medium text-emerald-200">{acupoint.clinical.functions}</p>
        </div>

        <div>
          <span className="text-[11px] font-medium text-slate-400">【主治病症】</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {acupoint.clinical.indications.map((ind) => (
              <span
                key={ind}
                className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
              >
                {ind}
              </span>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-800/80 pt-2">
          <span className="text-[11px] font-medium text-slate-400">【刺灸法与禁忌】</span>
          <p className="mt-0.5 leading-relaxed text-slate-200">{acupoint.clinical.operation}</p>
        </div>
      </section>

      {/* Previous / Next Acupoint along Meridian */}
      {siblings.length > 1 && (
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
          <button
            type="button"
            disabled={currentIdx <= 0}
            onClick={() => {
              const prev = siblings[currentIdx - 1];
              if (prev) selectAcupoint(prev.code, { focus: true });
            }}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            ← 上一穴
            {currentIdx > 0 && !isQuizMode ? ` (${siblings[currentIdx - 1].name})` : ''}
          </button>
          <span className="font-mono text-xs text-slate-400">
            {currentIdx + 1} / {siblings.length}
          </span>
          <button
            type="button"
            disabled={currentIdx < 0 || currentIdx >= siblings.length - 1}
            onClick={() => {
              const next = siblings[currentIdx + 1];
              if (next) selectAcupoint(next.code, { focus: true });
            }}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            下一穴
            {currentIdx >= 0 && currentIdx < siblings.length - 1 && !isQuizMode
              ? ` (${siblings[currentIdx + 1].name}) `
              : ' '}
            →
          </button>
        </div>
      )}
    </div>
  );
}
