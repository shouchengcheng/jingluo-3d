import { useEffect, useRef } from 'react';
import type { Vec3Tuple } from '../types/atlas';

/**
 * 3D surface bone-proportional reference landmarks on the 1.75m normalized human body (Audit 3.2).
 * Used when `showLandmarks` is enabled in the viewport HUD.
 */
export interface AnatomicalLandmark {
  id: string;
  name: string;
  note: string;
  position: Vec3Tuple;
  bilateral: boolean;
}

export const ANATOMICAL_LANDMARKS: AnatomicalLandmark[] = [
  {
    id: 'c7',
    name: '第7颈椎棘突 (C7)',
    note: '低头时项后最隆起棘突，下凹即大椎 (GV14)',
    position: [0, 1.472, -0.036],
    bilateral: false,
  },
  {
    id: 'clavicle-notch',
    name: '胸骨上窝',
    note: '前颈下端胸骨柄上缘凹陷，即天突 (CV22)',
    position: [0, 1.466, 0.065],
    bilateral: false,
  },
  {
    id: 'nipple-level',
    name: '第4肋间隙 · 乳中线',
    note: '两乳头之间折作 8 寸，正中即膻中 (CV17)',
    position: [0, 1.361, 0.104],
    bilateral: false,
  },
  {
    id: 'scapula-inf',
    name: '肩胛骨下角',
    note: '直立垂臂时平第 7 胸椎棘突（膈俞 BL17 水平）',
    position: [0.115, 1.305, -0.068],
    bilateral: true,
  },
  {
    id: 'umbilicus',
    name: '脐中',
    note: '胸剑联合至脐中 8 寸，脐中至耻骨联合上缘 5 寸',
    position: [0, 1.116, 0.145],
    bilateral: false,
  },
  {
    id: 'iliac-crest',
    name: '髂嵴最高点连线',
    note: '平第 4 腰椎棘突（腰阳关 GV3 / 大肠俞 BL25 水平）',
    position: [0, 1.088, -0.03],
    bilateral: false,
  },
  {
    id: 'wrist-crease',
    name: '腕掌侧远端横纹',
    note: '肘横纹至腕横纹 12 寸（太渊 / 大陵 / 神门同线）',
    position: [0.376, 0.974, 0.024],
    bilateral: true,
  },
  {
    id: 'patella-apex',
    name: '髌底 / 犊鼻窝',
    note: '髌底至内踝尖 15 寸；犊鼻至外踝尖 16 寸',
    position: [0.125, 0.625, 0.056],
    bilateral: true,
  },
  {
    id: 'med-malleolus',
    name: '内踝尖',
    note: '内踝尖至足底 3 寸；上 3 寸即三阴交 (SP6)',
    position: [0.075, 0.112, 0.015],
    bilateral: true,
  },
  {
    id: 'lat-malleolus',
    name: '外踝尖',
    note: '犊鼻至外踝尖 16 寸；上 3 寸即悬钟 (GB39)',
    position: [0.142, 0.102, -0.008],
    bilateral: true,
  },
];

const CUN_ROWS: { region: string; span: string; cun: string; note: string }[] = [
  { region: '头面部', span: '前发际正中 → 后发际正中', cun: '12 寸', note: '眉间(印堂)至前发际 3 寸；大椎至后发际 3 寸' },
  { region: '头面部', span: '额角发际(头维)之间 / 耳后两乳突之间', cun: '9 寸', note: '用于头面横向折量' },
  { region: '胸腹部', span: '胸骨上窝(天突) → 胸剑联合中点(歧骨)', cun: '9 寸', note: '两乳头之间折作 8 寸' },
  { region: '胸腹部', span: '胸剑联合中点 → 脐中', cun: '8 寸', note: '中脘居二者连线中点（脐上 4 寸）' },
  { region: '胸腹部', span: '脐中 → 耻骨联合上缘(曲骨)', cun: '5 寸', note: '石门 2 寸 · 关元 3 寸 · 中极 4 寸' },
  { region: '背腰部', span: '肩胛骨内侧缘 → 后正中线', cun: '3 寸', note: '背俞穴一侧线 1.5 寸 · 二侧线 3 寸' },
  { region: '上肢部', span: '腋前/后纹头 → 肘横纹(平肘尖)', cun: '9 寸', note: '天府在腋前纹头下 3 寸，侠白下 4 寸' },
  { region: '上肢部', span: '肘横纹(平肘尖) → 腕掌(背)侧横纹', cun: '12 寸', note: '孔最腕上 7 寸 · 支沟 3 寸 · 内关/外关 2 寸' },
  { region: '下肢部', span: '耻骨联合上缘 → 股骨内上髁上缘', cun: '18 寸', note: '大转子至膝中 19 寸（风市在膝上 7 寸）' },
  { region: '下肢部', span: '胫骨内侧髁下缘(阴陵泉) → 内踝尖', cun: '13 寸', note: '三阴交在内踝尖上 3 寸 · 地机在阴陵泉下 3 寸' },
  { region: '下肢部', span: '膝中(腘横纹 / 犊鼻) → 外踝尖', cun: '16 寸', note: '足三里膝下 3 寸 · 上巨虚 6 寸 · 丰隆/条口 8 寸' },
];

export interface CunReferenceModalProps {
  open: boolean;
  onClose: () => void;
  showLandmarks: boolean;
  onToggleLandmarks: () => void;
}

export function CunReferenceModal({
  open,
  onClose,
  showLandmarks,
  onToggleLandmarks,
}: CunReferenceModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Focus trap + Escape handling (Audit 4.4)
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const focusables = dialog?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && focusables && focusables.length > 0) {
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cun-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="glass animate-fade-in-up flex max-h-[85dvh] w-full max-w-2xl flex-col rounded-xl p-5 text-[13px]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
          <div>
            <h2 id="cun-modal-title" className="font-serif text-lg font-bold text-fg">
              GB/T 12346-2021 骨度分寸折量表与体表标志
            </h2>
            <p className="text-xs text-fg-subtle">
              不分男女老幼肥瘦，均按体表骨节标志折定寸数作为定穴基准
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleLandmarks}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                showLandmarks
                  ? 'border-gold bg-gold/20 text-gold-fg'
                  : 'border-line-strong bg-surface-2 text-fg-muted hover:text-fg'
              }`}
            >
              {showLandmarks ? '✓ 3D 骨性标志已开' : '在 3D 显示骨性标志'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭骨度分寸表"
              className="rounded-lg px-2 py-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line text-fg-subtle">
                <th className="py-2 pr-2 font-semibold">部位</th>
                <th className="py-2 pr-2 font-semibold">起止体表骨性标志</th>
                <th className="py-2 pr-2 font-semibold whitespace-nowrap">常用骨度</th>
                <th className="py-2 font-semibold">代表取穴要点</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {CUN_ROWS.map((r, i) => (
                <tr key={i} className="hover:bg-surface-2/50">
                  <td className="py-2 pr-2 font-medium whitespace-nowrap text-azure-fg">
                    {r.region}
                  </td>
                  <td className="py-2 pr-2 font-medium text-fg">{r.span}</td>
                  <td className="py-2 pr-2 font-mono font-bold whitespace-nowrap text-gold-fg">
                    {r.cun}
                  </td>
                  <td className="py-2 text-fg-muted">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
