import { useEffect, useRef, useState } from 'react';
import { MeridianScene } from './engine/MeridianScene';
import { ResponsiveShell } from './components/layout/ResponsiveShell';
import { ControlPanel } from './components/ControlPanel';
import { AcupointCard } from './components/AcupointCard';
import { AuditCalibration } from './dev-tools/AuditCalibration';
import type { ProjectedLabel } from './types/atlas';

export function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [projectedLabels, setProjectedLabels] = useState<ProjectedLabel[]>([]);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;

    const scene = new MeridianScene(container, {
      onLabelsUpdate: setProjectedLabels,
    });

    return () => {
      scene.dispose();
    };
  }, []);

  return (
    <>
      <ResponsiveShell
        canvasSlot={<div ref={viewportRef} className="h-full w-full touch-none" />}
        controlPanel={({ onSelectAcupointDone }) => (
          <ControlPanel onSelectAcupointDone={onSelectAcupointDone} />
        )}
        acupointCard={<AcupointCard />}
        devHeaderAction={import.meta.env.DEV ? <AuditCalibration /> : null}
        projectedLabels={projectedLabels}
      />
    </>
  );
}

export default App;
