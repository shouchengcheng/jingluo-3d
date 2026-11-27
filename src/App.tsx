import { useEffect, useRef } from 'react';
import { MeridianScene } from './engine/MeridianScene';

export function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;

    const scene = new MeridianScene(container);
    return () => {
      scene.dispose();
    };
  }, []);

  return (
    <div className="relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-wide text-emerald-400">
            jingluo-3d
          </h1>
          <span className="hidden text-xs text-slate-400 sm:inline">
            3D 中医经络穴位教学系统 · GB/T 12346-2021
          </span>
        </div>
        {import.meta.env.DEV && (
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
            DEV 环境就绪
          </span>
        )}
      </header>

      <main className="relative flex-1 overflow-hidden">
        <div ref={viewportRef} className="h-full w-full" />
      </main>

      <footer className="z-10 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-900/90 px-4 py-2 text-xs text-slate-400">
        <span>
          3D 模型与初稿坐标源自{' '}
          <a
            href="https://github.com/aicuc/3d-acupoint-atlas"
            target="_blank"
            rel="noreferrer"
            className="text-emerald-400 underline-offset-2 hover:underline"
          >
            aicuc/3d-acupoint-atlas
          </a>{' '}
          (MIT License)
        </span>
        <span>代码: MIT · 数据与文档: CC BY-NC-SA 4.0</span>
      </footer>
    </div>
  );
}

export default App;
