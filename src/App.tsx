import { useEffect, useRef, useState } from 'react';
import { MeridianScene } from './engine/MeridianScene';
import { ResponsiveShell } from './components/layout/ResponsiveShell';
import { ControlPanel } from './components/ControlPanel';
import { AcupointCard } from './components/AcupointCard';
import { AuditCalibration } from './dev-tools/AuditCalibration';
import type { AmbiguousPick, HoverInfo, ProjectedLabel } from './types/atlas';

export function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [projectedLabels, setProjectedLabels] = useState<ProjectedLabel[]>([]);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [ambiguousPick, setAmbiguousPick] = useState<AmbiguousPick | null>(null);
  const [azimuthDeg, setAzimuthDeg] = useState(0);
  const [isInteracting, setIsInteracting] = useState(false);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;

    const scene = new MeridianScene(container, {
      onLabelsUpdate: setProjectedLabels,
      onHoverChange: setHoverInfo,
      onAmbiguousPick: setAmbiguousPick,
      onCameraAzimuth: setAzimuthDeg,
      onInteractionChange: (active) => {
        setIsInteracting(active);
        if (active) setAmbiguousPick(null);
      },
    });

    return () => {
      scene.dispose();
    };
  }, []);

  return (
    <ResponsiveShell
      canvasSlot={<div ref={viewportRef} className="h-full w-full touch-none" />}
      controlPanel={({ onSelectAcupointDone }) => (
        <ControlPanel onSelectAcupointDone={onSelectAcupointDone} />
      )}
      acupointCard={<AcupointCard />}
      devHeaderAction={import.meta.env.DEV ? <AuditCalibration /> : null}
      projectedLabels={projectedLabels}
      hoverInfo={hoverInfo}
      ambiguousPick={ambiguousPick}
      onDismissAmbiguous={() => setAmbiguousPick(null)}
      azimuthDeg={azimuthDeg}
      isInteracting={isInteracting}
    />
  );
}

export default App;
