"use client";

/* eslint-disable react/no-unknown-property, react-hooks/immutability -- React Three Fiber animates Three.js bones and groups through refs. */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  inputTimingResponse,
  type BackdashMotionPhase,
  type Direction,
  type LateralDirection,
  type LateralMotionPhase,
  type PlayerSide,
} from "../../lib/movement";
import {
  createRushFighterRig,
  type RushBoneName,
  type RushFighterRig,
} from "../../lib/rushFighterShell";

export interface RiggedTrainingDummyProps {
  direction: Direction;
  side: PlayerSide;
  motion: { nonce: number; kind: "wave" | "kbd" | "backdash" | "reset" };
  inputMotion: {
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
  successPulse: number;
  focus: React.MutableRefObject<{ x: number; z: number }>;
}

type DebugPose = "neutral" | "crouch" | "backdash" | "sidestep" | null;

interface PoseTarget {
  hips: THREE.Vector3;
  leftFoot: THREE.Vector3;
  rightFoot: THREE.Vector3;
  leftHand: THREE.Vector3;
  rightHand: THREE.Vector3;
  torsoLean: number;
  torsoTwist: number;
  torsoRoll: number;
  leftFootPitch: number;
  rightFootPitch: number;
  leftFootYaw: number;
  rightFootYaw: number;
}

interface MovementEnergy {
  forward: number;
  compression: number;
  drive: number;
  exit: number;
  chain: number;
  backdash: number;
  cancel: number;
  reset: number;
  rawRecovery: number;
  sidestep: number;
}

const PLAYER_COLORS = { P1: "#f12437", P2: "#274cff" } as const;
const targetEuler = new THREE.Euler();
const targetQuaternion = new THREE.Quaternion();
const poseQuaternion = new THREE.Quaternion();
const parentWorldQuaternion = new THREE.Quaternion();
const modelWorldQuaternion = new THREE.Quaternion();
const currentWorldQuaternion = new THREE.Quaternion();
const currentDirection = new THREE.Vector3();
const desiredDirection = new THREE.Vector3();
const boneOrigin = new THREE.Vector3();
const childPosition = new THREE.Vector3();
const jointPosition = new THREE.Vector3();
const chainAxis = new THREE.Vector3();
const chainPole = new THREE.Vector3();
const chainKnee = new THREE.Vector3();
const worldTarget = new THREE.Vector3();
const worldTargetSecondary = new THREE.Vector3();
const worldPole = new THREE.Vector3();
const leftLegPoleLocal = new THREE.Vector3(1, 0, 0.28);
const rightLegPoleLocal = new THREE.Vector3(1, 0, -0.28);
const leftArmPoleLocal = new THREE.Vector3(-0.2, -0.8, 0.55);
const rightArmPoleLocal = new THREE.Vector3(-0.1, -0.75, -0.5);

function createPoseTarget(): PoseTarget {
  return {
    hips: new THREE.Vector3(),
    leftFoot: new THREE.Vector3(),
    rightFoot: new THREE.Vector3(),
    leftHand: new THREE.Vector3(),
    rightHand: new THREE.Vector3(),
    torsoLean: 0,
    torsoTwist: 0,
    torsoRoll: 0,
    leftFootPitch: 0,
    rightFootPitch: 0,
    leftFootYaw: 0,
    rightFootYaw: 0,
  };
}

function createMovementEnergy(): MovementEnergy {
  return {
    forward: 0,
    compression: 0,
    drive: 0,
    exit: 0,
    chain: 0,
    backdash: 0,
    cancel: 0,
    reset: 0,
    rawRecovery: 0,
    sidestep: 0,
  };
}

function poseBone(
  rig: RushFighterRig,
  name: RushBoneName,
  rotation: readonly [x: number, y: number, z: number],
  rate: number,
  delta: number,
) {
  targetEuler.set(rotation[0], rotation[1], rotation[2], "XYZ");
  poseQuaternion.setFromEuler(targetEuler);
  targetQuaternion.copy(rig.bindQuaternions[name]).multiply(poseQuaternion);
  rig.bones[name].quaternion.slerp(targetQuaternion, 1 - Math.exp(-rate * delta));
}

function aimBoneAt(
  bone: THREE.Bone,
  child: THREE.Bone,
  target: THREE.Vector3,
  rate: number,
  delta: number,
) {
  const parent = bone.parent;
  if (!parent) return;
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(boneOrigin);
  child.getWorldPosition(childPosition);
  currentDirection.copy(childPosition).sub(boneOrigin).normalize();
  desiredDirection.copy(target).sub(boneOrigin).normalize();
  poseQuaternion.setFromUnitVectors(currentDirection, desiredDirection);
  bone.getWorldQuaternion(currentWorldQuaternion);
  targetQuaternion.copy(poseQuaternion).multiply(currentWorldQuaternion);
  parent.getWorldQuaternion(parentWorldQuaternion).invert();
  targetQuaternion.premultiply(parentWorldQuaternion);
  bone.quaternion.slerp(targetQuaternion, 1 - Math.exp(-rate * delta));
  bone.updateWorldMatrix(true, true);
}

function solveTwoBone(
  upper: THREE.Bone,
  lower: THREE.Bone,
  end: THREE.Bone,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  rate: number,
  delta: number,
) {
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(boneOrigin);
  lower.getWorldPosition(jointPosition);
  end.getWorldPosition(childPosition);
  const upperLength = boneOrigin.distanceTo(jointPosition);
  const lowerLength = jointPosition.distanceTo(childPosition);
  chainAxis.copy(target).sub(boneOrigin);
  const distance = THREE.MathUtils.clamp(
    chainAxis.length(),
    Math.abs(upperLength - lowerLength) + 0.02,
    upperLength + lowerLength - 0.004,
  );
  chainAxis.normalize();
  chainPole.copy(pole).addScaledVector(chainAxis, -pole.dot(chainAxis));
  if (chainPole.lengthSq() < 0.0001) chainPole.set(1, 0, 0);
  chainPole.normalize();
  const along =
    (upperLength * upperLength - lowerLength * lowerLength + distance * distance) /
    (2 * distance);
  const bend = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  chainKnee.copy(boneOrigin).addScaledVector(chainAxis, along).addScaledVector(chainPole, bend);
  aimBoneAt(upper, lower, chainKnee, rate, delta);
  lower.getWorldPosition(jointPosition);
  aimBoneAt(lower, end, target, rate, delta);
}

function poseBoneWorld(
  bone: THREE.Bone,
  model: THREE.Object3D,
  rotation: readonly [x: number, y: number, z: number],
  rate: number,
  delta: number,
) {
  const parent = bone.parent;
  if (!parent) return;
  targetEuler.set(rotation[0], rotation[1], rotation[2], "XYZ");
  poseQuaternion.setFromEuler(targetEuler);
  model.getWorldQuaternion(modelWorldQuaternion);
  targetQuaternion.copy(modelWorldQuaternion).multiply(poseQuaternion);
  parent.getWorldQuaternion(parentWorldQuaternion).invert();
  targetQuaternion.premultiply(parentWorldQuaternion);
  bone.quaternion.slerp(targetQuaternion, 1 - Math.exp(-rate * delta));
}

function localPointToWorld(model: THREE.Object3D, local: THREE.Vector3, target: THREE.Vector3) {
  target.copy(local);
  return model.localToWorld(target);
}

function localDirectionToWorld(model: THREE.Object3D, local: THREE.Vector3, target: THREE.Vector3) {
  model.getWorldQuaternion(modelWorldQuaternion);
  return target.copy(local).applyQuaternion(modelWorldQuaternion).normalize();
}

function dampEnergy(energy: MovementEnergy, delta: number) {
  energy.forward = THREE.MathUtils.damp(energy.forward, 0, 6.5, delta);
  energy.compression = THREE.MathUtils.damp(energy.compression, 0, 7.5, delta);
  energy.drive = THREE.MathUtils.damp(energy.drive, 0, 6.2, delta);
  energy.exit = THREE.MathUtils.damp(energy.exit, 0, 7, delta);
  energy.chain = THREE.MathUtils.damp(energy.chain, 0, 3.25, delta);
  energy.backdash = THREE.MathUtils.damp(energy.backdash, 0, 5.4, delta);
  energy.cancel = THREE.MathUtils.damp(energy.cancel, 0, 8.8, delta);
  energy.reset = THREE.MathUtils.damp(energy.reset, 0, 9.5, delta);
  energy.rawRecovery = THREE.MathUtils.damp(energy.rawRecovery, 0, 2.15, delta);
  energy.sidestep = THREE.MathUtils.damp(energy.sidestep, 0, 5.1, delta);
}

function samplePose(
  pose: PoseTarget,
  direction: Direction,
  previousDirection: Direction,
  energy: MovementEnergy,
  lateralDirection: LateralDirection,
  sidewalkActive: boolean,
  elapsedTime: number,
  debugPose: DebugPose,
) {
  let forward = Math.max(direction === "f" ? 0.55 : 0, energy.forward);
  let compression = Math.max(direction === "d" ? 0.72 : 0, energy.compression);
  let drive = Math.max(direction === "df" ? 1 : 0, energy.drive);
  let exit = Math.max(direction === "f" && previousDirection === "df" ? 1 : 0, energy.exit);
  let backdash = energy.backdash;
  let cancel = Math.max(direction === "db" ? 0.72 : 0, energy.cancel);
  let recovery = energy.rawRecovery;
  let sidestep = Math.max(energy.sidestep, sidewalkActive ? 0.84 : 0);
  let lateral = lateralDirection;

  if (debugPose) {
    forward = 0;
    compression = debugPose === "crouch" ? 0.8 : 0;
    drive = debugPose === "crouch" ? 1 : 0;
    exit = 0;
    backdash = debugPose === "backdash" ? 1 : 0;
    cancel = 0;
    recovery = 0;
    sidestep = debugPose === "sidestep" ? 1 : 0;
    lateral = debugPose === "sidestep" ? 1 : 0;
  }

  const chain = Math.max(energy.chain, drive * 0.72, exit * 0.48);
  const sidewalkCycle = sidewalkActive && !debugPose ? Math.sin(elapsedTime * 8.4) : 0;
  const lateralAmount = sidestep * lateral;

  pose.hips.set(
    0.018 + forward * 0.045 + drive * 0.115 + exit * 0.07 - backdash * 0.11 - cancel * 0.025,
    0.82 - compression * 0.145 - drive * 0.17 - chain * 0.035 - cancel * 0.13 - backdash * 0.035 + recovery * 0.018,
    lateralAmount * 0.1,
  );

  pose.torsoLean =
    -0.1 - forward * 0.035 - compression * 0.08 - drive * 0.17 - exit * 0.055 + backdash * 0.14 - cancel * 0.055;
  pose.torsoTwist = 0.105 - drive * 0.035 + backdash * 0.02;
  pose.torsoRoll = -lateralAmount * 0.095;

  pose.leftFoot.set(
    0.27 + forward * 0.055 + drive * 0.25 + exit * 0.08 - backdash * 0.16 - cancel * 0.045,
    0.055,
    0.27 + lateralAmount * (0.15 + sidewalkCycle * 0.16),
  );
  pose.rightFoot.set(
    -0.22 + forward * 0.025 + drive * 0.08 + exit * 0.055 - backdash * 0.28 + cancel * 0.035,
    0.055,
    -0.27 + lateralAmount * (-0.08 - sidewalkCycle * 0.14),
  );
  if (sidewalkActive && !debugPose) {
    pose.leftFoot.y += Math.max(0, sidewalkCycle) * 0.075;
    pose.rightFoot.y += Math.max(0, -sidewalkCycle) * 0.075;
  } else if (sidestep > 0.1) {
    const movingLeft = lateral > 0;
    if (movingLeft) pose.leftFoot.y += sidestep * 0.025;
    else pose.rightFoot.y += sidestep * 0.025;
  }

  pose.leftHand.set(
    0.47 + forward * 0.035 + drive * 0.06 - backdash * 0.025,
    1.43 - compression * 0.105 - drive * 0.19 - cancel * 0.095,
    0.2 + lateralAmount * 0.025,
  );
  pose.rightHand.set(
    0.35 + forward * 0.02 + drive * 0.05 - backdash * 0.03,
    1.38 - compression * 0.085 - drive * 0.15 - cancel * 0.075,
    -0.17 - lateralAmount * 0.02,
  );

  pose.leftFootPitch = -drive * 0.045 + backdash * 0.025;
  pose.rightFootPitch = drive * 0.12 - backdash * 0.04;
  pose.leftFootYaw = 0.055 + lateralAmount * 0.04;
  pose.rightFootYaw = -0.09 + lateralAmount * 0.035;
}

export default function RiggedTrainingDummy({
  direction,
  side,
  motion,
  inputMotion,
  successPulse,
  focus,
}: RiggedTrainingDummyProps) {
  const debugPose = useMemo<DebugPose>(() => {
    if (typeof window === "undefined") return null;
    const value = new URLSearchParams(window.location.search).get("fighterPose");
    return value === "neutral" || value === "crouch" || value === "backdash" || value === "sidestep"
      ? value
      : null;
  }, []);
  const silhouette = useMemo(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("silhouette") === "1",
    [],
  );
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: PLAYER_COLORS.P1,
      roughness: 0.82,
      metalness: 0,
      flatShading: true,
    }),
    [],
  );
  const rig = useMemo(() => createRushFighterRig(material), [material]);
  const root = useRef<THREE.Group>(null);
  const pulseRing = useRef<THREE.Mesh>(null);
  const targetX = useRef(0);
  const targetZ = useRef(0);
  const velocityX = useRef(0);
  const velocityZ = useRef(0);
  const lastMotion = useRef(motion.nonce);
  const lastInputMotion = useRef(inputMotion.nonce);
  const previousDirection = useRef<Direction>(inputMotion.previousDirection);
  const timingResponse = useRef(1);
  const movementEnergy = useRef(createMovementEnergy());
  const lateralIntent = useRef<LateralDirection>(0);
  const sidewalkActive = useRef(false);
  const flash = useRef(0);
  const pose = useRef(createPoseTarget());

  useEffect(() => {
    material.color.set(silhouette ? "#020202" : PLAYER_COLORS[side]);
    material.needsUpdate = true;
  }, [material, side, silhouette]);

  useEffect(() => () => {
    rig.mesh.geometry.dispose();
    rig.skeleton.dispose();
    material.dispose();
  }, [material, rig]);

  useEffect(() => {
    if (motion.nonce === lastMotion.current) return;
    lastMotion.current = motion.nonce;
    if (motion.kind === "reset") {
      targetX.current = 0;
      targetZ.current = 0;
      velocityX.current = 0;
      velocityZ.current = 0;
      sidewalkActive.current = false;
      lateralIntent.current = 0;
      Object.assign(movementEnergy.current, createMovementEnergy());
    }
  }, [motion]);

  useEffect(() => {
    if (inputMotion.nonce === lastInputMotion.current) return;
    lastInputMotion.current = inputMotion.nonce;
    previousDirection.current = inputMotion.previousDirection;
    timingResponse.current = inputTimingResponse(inputMotion.heldMs);
    const energy = movementEnergy.current;

    if (inputMotion.direction === "f") {
      energy.forward = 1;
      if (inputMotion.previousDirection === "df") {
        energy.exit = 1;
        energy.chain = Math.max(energy.chain, 0.78);
      }
    }
    if (inputMotion.direction === "d") {
      energy.compression = 1;
      energy.chain = Math.max(energy.chain, 0.56);
    }
    if (inputMotion.direction === "df") {
      energy.drive = 1;
      energy.compression = Math.max(energy.compression, 0.72);
      energy.chain = 1;
    }
    if (inputMotion.backdashPhase === "backdash") energy.backdash = 1;
    if (inputMotion.backdashPhase === "kbd-cancel") {
      energy.cancel = 1;
      energy.chain = 0;
    }
    if (inputMotion.backdashPhase === "kbd-reset") energy.reset = 1;
    if (inputMotion.backdashPhase === "raw-recovery") energy.rawRecovery = 1;

    if (inputMotion.lateralDirection) lateralIntent.current = inputMotion.lateralDirection;
    if (inputMotion.lateralPhase === "sidestep-start") energy.sidestep = Math.max(energy.sidestep, 0.3);
    if (inputMotion.lateralPhase === "sidestep") energy.sidestep = 1;
    if (inputMotion.lateralPhase === "sidewalk") sidewalkActive.current = true;
    if (inputMotion.lateralPhase === "sidewalk-stop" || inputMotion.lateralPhase === "lateral-recovery") {
      sidewalkActive.current = false;
      if (inputMotion.lateralPhase === "lateral-recovery") lateralIntent.current = 0;
    }

    const facing = side === "P1" ? 1 : -1;
    targetX.current += inputMotion.travelDelta * facing;
    targetZ.current += inputMotion.lateralTravelDelta * facing;
  }, [inputMotion, side]);

  useEffect(() => {
    flash.current = 1;
  }, [successPulse]);

  useFrame(({ clock }, frameDelta) => {
    if (!root.current) return;
    const delta = Math.min(frameDelta, 0.05);
    const response = timingResponse.current;
    const poseRate = (7.2 + response * 5.2) * (movementEnergy.current.rawRecovery > 0.45 ? 0.76 : 1);
    const limbRate = 8.5 + response * 6.2;
    const facing = side === "P1" ? 1 : -1;
    dampEnergy(movementEnergy.current, delta);

    if (sidewalkActive.current && lateralIntent.current) {
      targetZ.current += lateralIntent.current * facing * 1.22 * delta;
    }

    root.current.rotation.y = side === "P1" ? 0 : Math.PI;
    const stiffnessX = 58 * Math.min(1.45, response);
    const stiffnessZ = sidewalkActive.current ? 34 : 52;
    velocityX.current += (targetX.current - root.current.position.x) * stiffnessX * delta;
    velocityZ.current += (targetZ.current - root.current.position.z) * stiffnessZ * delta;
    velocityX.current *= Math.exp(-(12.5 + response * 0.8) * delta);
    velocityZ.current *= Math.exp(-(sidewalkActive.current ? 9.5 : 12) * delta);
    root.current.position.x += velocityX.current * delta;
    root.current.position.z += velocityZ.current * delta;
    focus.current.x = root.current.position.x;
    focus.current.z = root.current.position.z;

    samplePose(
      pose.current,
      direction,
      previousDirection.current,
      movementEnergy.current,
      lateralIntent.current,
      sidewalkActive.current,
      clock.elapsedTime,
      debugPose,
    );

    rig.bones.Hips.position.x = THREE.MathUtils.damp(rig.bones.Hips.position.x, pose.current.hips.x, poseRate, delta);
    rig.bones.Hips.position.y = THREE.MathUtils.damp(rig.bones.Hips.position.y, pose.current.hips.y, poseRate, delta);
    rig.bones.Hips.position.z = THREE.MathUtils.damp(rig.bones.Hips.position.z, pose.current.hips.z, poseRate, delta);
    poseBone(rig, "Hips", [pose.current.torsoRoll * 0.24, pose.current.torsoTwist * 0.28, pose.current.torsoLean * 0.14], poseRate, delta);
    poseBone(rig, "Spine", [pose.current.torsoRoll * 0.5, pose.current.torsoTwist * 0.42, pose.current.torsoLean * 0.48], poseRate, delta);
    poseBone(rig, "Chest", [pose.current.torsoRoll * 0.55, pose.current.torsoTwist * 0.58, pose.current.torsoLean * 0.62], poseRate, delta);
    poseBone(rig, "Neck", [-pose.current.torsoRoll * 0.28, -pose.current.torsoTwist * 0.38, -pose.current.torsoLean * 0.42], poseRate, delta);
    poseBone(rig, "Head", [-pose.current.torsoRoll * 0.22, -pose.current.torsoTwist * 0.45, -pose.current.torsoLean * 0.38], poseRate, delta);
    poseBone(rig, "LeftShoulder", [-0.05, 0.08, -0.04], poseRate, delta);
    poseBone(rig, "RightShoulder", [0.04, -0.06, 0.03], poseRate, delta);

    root.current.updateWorldMatrix(true, true);
    localPointToWorld(root.current, pose.current.leftFoot, worldTarget);
    localDirectionToWorld(root.current, leftLegPoleLocal, worldPole);
    solveTwoBone(
      rig.bones.LeftUpperLeg,
      rig.bones.LeftLowerLeg,
      rig.bones.LeftFoot,
      worldTarget,
      worldPole,
      limbRate,
      delta,
    );
    localPointToWorld(root.current, pose.current.rightFoot, worldTargetSecondary);
    localDirectionToWorld(root.current, rightLegPoleLocal, worldPole);
    solveTwoBone(
      rig.bones.RightUpperLeg,
      rig.bones.RightLowerLeg,
      rig.bones.RightFoot,
      worldTargetSecondary,
      worldPole,
      limbRate,
      delta,
    );
    poseBoneWorld(
      rig.bones.LeftFoot,
      root.current,
      [0, pose.current.leftFootYaw, pose.current.leftFootPitch],
      limbRate,
      delta,
    );
    poseBoneWorld(
      rig.bones.RightFoot,
      root.current,
      [0, pose.current.rightFootYaw, pose.current.rightFootPitch],
      limbRate,
      delta,
    );

    root.current.updateWorldMatrix(true, true);
    localPointToWorld(root.current, pose.current.leftHand, worldTarget);
    localDirectionToWorld(root.current, leftArmPoleLocal, worldPole);
    solveTwoBone(
      rig.bones.LeftUpperArm,
      rig.bones.LeftForearm,
      rig.bones.LeftHand,
      worldTarget,
      worldPole,
      limbRate,
      delta,
    );
    localPointToWorld(root.current, pose.current.rightHand, worldTargetSecondary);
    localDirectionToWorld(root.current, rightArmPoleLocal, worldPole);
    solveTwoBone(
      rig.bones.RightUpperArm,
      rig.bones.RightForearm,
      rig.bones.RightHand,
      worldTargetSecondary,
      worldPole,
      limbRate,
      delta,
    );
    poseBoneWorld(rig.bones.LeftHand, root.current, [-0.1, 0.08, -0.18], limbRate, delta);
    poseBoneWorld(rig.bones.RightHand, root.current, [-0.08, -0.1, 0.2], limbRate, delta);

    rig.mesh.updateMatrixWorld(true);
    flash.current = THREE.MathUtils.damp(flash.current, 0, 6, delta);
    pulseRing.current?.scale.setScalar(0.42 + flash.current * 0.62);
  });

  return (
    <group ref={root}>
      <primitive object={rig.mesh} />
      <mesh ref={pulseRing} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]} scale={0.42}>
        <ringGeometry args={[0.5, 0.53, 40]} />
        <meshBasicMaterial
          color={side === "P1" ? "#c91d31" : "#2345dd"}
          transparent
          opacity={0.42}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
