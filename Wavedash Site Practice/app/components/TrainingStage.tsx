"use client";

/* eslint-disable react/no-unknown-property, react-hooks/immutability -- React Three Fiber animates Three.js objects through refs and defines its own JSX attributes. */

import { Grid } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  type BackdashMotionPhase,
  type Direction,
  type LateralDirection,
  type LateralMotionPhase,
  type PlayerSide,
} from "../../lib/movement";
import RiggedTrainingDummy from "./RiggedTrainingDummy";

export type CameraMode = "SIDE" | "3/4" | "FOOTWORK";
export type MotionSignal = { nonce: number; kind: "wave" | "kbd" | "backdash" | "reset" };
export type InputMotionSignal = {
  nonce: number;
  direction: Direction;
  previousDirection: Direction;
  heldMs: number;
  travelDelta: number;
  backdashPhase: BackdashMotionPhase;
  lateralPhase: LateralMotionPhase;
  lateralDirection: LateralDirection;
  lateralTravelDelta: number;
};

interface StageProps {
  direction: Direction;
  side: PlayerSide;
  cameraMode: CameraMode;
  motion: MotionSignal;
  inputMotion: InputMotionSignal;
  successPulse: number;
}

export interface ArenaFocus {
  x: number;
  z: number;
}

function ArenaCamera({ mode, focus }: { mode: CameraMode; focus: React.RefObject<ArenaFocus> }) {
  const { camera } = useThree();
  const trackedX = useRef(0);
  const trackedZ = useRef(0);
  const desired = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const characterX = focus.current?.x ?? 0;
    const characterZ = focus.current?.z ?? 0;
    trackedX.current = THREE.MathUtils.damp(trackedX.current, characterX, 3.1, delta);
    trackedZ.current = THREE.MathUtils.damp(trackedZ.current, characterZ, 2.6, delta);
    const x = trackedX.current;
    const z = trackedZ.current;

    if (mode === "SIDE") desired.current.set(x, 2.15, z + 5.65);
    if (mode === "3/4") desired.current.set(x + 2.35, 2.18, z + 4.15);
    if (mode === "FOOTWORK") desired.current.set(x + 0.45, 1.28, z + 4.35);

    camera.position.x = THREE.MathUtils.damp(camera.position.x, desired.current.x, 6.5, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, desired.current.y, 6.5, delta);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, desired.current.z, 6.5, delta);
    const visibleTravel = x + (characterX - x) * 0.24;
    const visibleDepth = z + (characterZ - z) * 0.38;
    camera.lookAt(visibleTravel, mode === "FOOTWORK" ? 0.88 : 1.32, visibleDepth);
  });

  return null;
}

function InfiniteArena({
  focus,
  silhouetteDebug,
}: {
  focus: React.RefObject<ArenaFocus>;
  silhouetteDebug: boolean;
}) {
  const trackingFloor = useRef<THREE.Group>(null);
  const horizon = useRef<THREE.Group>(null);

  useFrame(() => {
    const x = focus.current?.x ?? 0;
    const z = focus.current?.z ?? 0;
    if (trackingFloor.current) trackingFloor.current.position.set(x, 0, z);
    if (horizon.current) horizon.current.position.set(x, 0, z - 8.5);
  });

  return (
    <>
      {silhouetteDebug ? <color attach="background" args={["#f1f1ed"]} /> : null}
      <fog attach="fog" args={[silhouetteDebug ? "#f1f1ed" : "#dce7e8", 13, 46]} />
      <ambientLight intensity={1.08} color="#f5f5f2" />
      <hemisphereLight args={["#f8fbff", "#b8b8b3", 1.35]} />

      <group ref={trackingFloor}>
        <directionalLight
          castShadow
          position={[4, 8, 6]}
          intensity={3.15}
          color="#ffffff"
          shadow-mapSize={[1024, 1024]}
        />
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
          <planeGeometry args={[130, 130]} />
          <meshBasicMaterial color={silhouetteDebug ? "#e9e9e5" : "#e8e5e2"} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
          <planeGeometry args={[130, 0.045]} />
          <meshBasicMaterial color={silhouetteDebug ? "#a7a7a2" : "#111111"} toneMapped={false} />
        </mesh>
        <pointLight position={[0, 2.2, 3.5]} intensity={1.5} color="#ffffff" distance={9} />
      </group>

      <Grid
        position={[0, 0, 0]}
        args={[60, 60]}
        cellSize={0.5}
        cellThickness={0.62}
        cellColor={silhouetteDebug ? "#bcbcb6" : "#c7c3c0"}
        sectionSize={4}
        sectionThickness={1.25}
        sectionColor={silhouetteDebug ? "#898983" : "#66676a"}
        fadeDistance={42}
        fadeStrength={1.1}
        infiniteGrid
      />

      <group ref={horizon} position={[0, 0, -8.5]}>
        <mesh position={[0, 0.18, 0.16]}>
          <boxGeometry args={[130, 0.035, 0.04]} />
          <meshBasicMaterial color={silhouetteDebug ? "#999993" : "#6f7377"} transparent opacity={0.58} toneMapped={false} />
        </mesh>
      </group>
    </>
  );
}

function StageScene(props: StageProps) {
  const focus = useRef<ArenaFocus>({ x: 0, z: 0 });
  const silhouetteDebug = useMemo(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("silhouette") === "1",
    [],
  );
  return (
    <>
      <ArenaCamera mode={props.cameraMode} focus={focus} />
      <InfiniteArena focus={focus} silhouetteDebug={silhouetteDebug} />
      <RiggedTrainingDummy {...props} focus={focus} />
    </>
  );
}

export default function TrainingStage(props: StageProps) {
  return (
    <div className="three-stage">
      <Canvas
        shadows="percentage"
        dpr={[1, 1.6]}
        camera={{ position: [0, 2.45, 7.8], fov: 34 }}
        gl={{ antialias: true, alpha: true }}
        fallback={<div className="webgl-fallback">3D preview unavailable. Input analysis remains active.</div>}
      >
        <Suspense fallback={null}>
          <StageScene {...props} />
        </Suspense>
      </Canvas>
    </div>
  );
}
