import { useEffect, useRef } from 'react';
import { useAtlasStore } from '../store/useAtlasStore';

const SHORTCUT_ROWS: { keys: string; desc: string }[] = [
  { keys: 'F', desc: '聚焦当前选中穴位最佳观察视角' },
  { keys: 'R', desc: '复位全身标准解剖正面视角' },
  { keys: '1 / 2 / 3 / 4', desc: '切换 正面 / 背面 / 右侧 / 左侧 视角' },
  { keys: '← / →', desc: '切换同经脉上一穴 / 下一穴' },
  { keys: 'Q', desc: '开启或退出教学盲测模式' },
  { keys: 'Space', desc: '盲测模式下揭示答案 / 已答后切下一题' },
  { keys: '[', desc: '折叠或展开左侧目录栏（投影扩屏）' },
  { keys: '?', desc: '打开或关闭快捷键说明' },
];

export interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
  onToggle: () => void;
}

export function ShortcutsModal({ open, onClose, onToggle }: ShortcutsModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) closeBtnRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (open) {
        if (e.key === 'Escape' || e.key === '?') {
          e.preventDefault();
          onClose();
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          closeBtnRef.current?.focus();
          return;
        }
      }

      if (inInput || e.metaKey || e.ctrlKey || e.altKey) return;

      const s = useAtlasStore.getState();
      if (e.key === '?') {
        e.preventDefault();
        onToggle();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        s.requestFocusSelected('full');
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        s.requestViewPreset('reset');
      } else if (e.key === '1') {
        s.requestViewPreset('front');
      } else if (e.key === '2') {
        s.requestViewPreset('back');
      } else if (e.key === '3') {
        s.requestViewPreset('right');
      } else if (e.key === '4') {
        s.requestViewPreset('left');
      } else if (e.key === 'ArrowLeft') {
        if (!s.isQuizMode) {
          e.preventDefault();
          s.stepSibling(-1);
        }
      } else if (e.key === 'ArrowRight') {
        if (!s.isQuizMode) {
          e.preventDefault();
          s.stepSibling(1);
        }
      } else if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        s.setQuizMode(!s.isQuizMode);
      } else if (e.key === '[') {
        e.preventDefault();
        s.setLeftPanelCollapsed(!s.leftPanelCollapsed);
      } else if (e.key === ' ') {
        if (s.isQuizMode && s.quizQuestion) {
          e.preventDefault();
          if (!s.quizQuestion.answer) s.revealQuizAnswer();
          else s.nextQuizQuestion();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, onToggle]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="glass animate-fade-in-up w-full max-w-md rounded-xl p-5 text-sm"
      >
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div>
            <h2 id="shortcuts-modal-title" className="font-serif text-lg font-bold text-fg">
              课堂演示键盘快捷键
            </h2>
            <p className="text-xs text-fg-subtle">在非输入框焦点下可直接触发</p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            aria-label="关闭快捷键说明"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 divide-y divide-line">
          {SHORTCUT_ROWS.map((r) => (
            <div key={r.keys} className="flex items-center justify-between gap-3 py-2 text-xs">
              <span className="text-fg-muted">{r.desc}</span>
              <kbd className="shrink-0 rounded-md border border-line-strong bg-surface-2 px-2 py-0.5 font-mono text-[11px] font-semibold text-fg">
                {r.keys}
              </kbd>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-lg bg-surface-2/80 px-3 py-2 text-xs text-fg-subtle">
          提示：在 3D 模型上<strong className="text-fg">单击</strong>穴位仅选中并保持当前观察距离，
          <strong className="text-fg">双击</strong>穴位平滑飞至最佳视角；按住{' '}
          <kbd className="font-mono text-fg">Ctrl / ⌘</kbd> 点击经络可叠加多经对比。
        </div>
      </div>
    </div>
  );
}
