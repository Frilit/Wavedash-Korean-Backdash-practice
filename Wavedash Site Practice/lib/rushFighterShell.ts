import * as THREE from "three";

/**
 * Observable reconstruction proportions. These are deliberately approximate
 * and are tuned from public R.U.S.H. footage, not claimed as original game data.
 */
export const RUSH_RECONSTRUCTION_PROPORTIONS = {
  overallHeight: 1.79,
  headHeight: 0.19,
  headWidth: 0.18,
  neckHeight: 0.105,
  shoulderWidth: 0.52,
  chestWidth: 0.47,
  waistWidth: 0.25,
  hipWidth: 0.32,
  upperArmLength: 0.3,
  forearmLength: 0.27,
  handLength: 0.13,
  thighLength: 0.43,
  shinLength: 0.43,
  footLength: 0.33,
  neutralStanceWidth: 0.58,
} as const;

export type RushBoneName =
  | "Root"
  | "Hips"
  | "Spine"
  | "Chest"
  | "Neck"
  | "Head"
  | "LeftShoulder"
  | "LeftUpperArm"
  | "LeftForearm"
  | "LeftHand"
  | "RightShoulder"
  | "RightUpperArm"
  | "RightForearm"
  | "RightHand"
  | "LeftUpperLeg"
  | "LeftLowerLeg"
  | "LeftFoot"
  | "RightUpperLeg"
  | "RightLowerLeg"
  | "RightFoot";

export type RushBones = Record<RushBoneName, THREE.Bone>;

export interface RushFighterRig {
  mesh: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  skeleton: THREE.Skeleton;
  bones: RushBones;
  bindPositions: Record<RushBoneName, THREE.Vector3>;
  bindQuaternions: Record<RushBoneName, THREE.Quaternion>;
}

type Point = readonly [x: number, y: number, z: number];

interface GeometryBuffers {
  positions: number[];
  skinIndices: number[];
  skinWeights: number[];
}

interface PrismOptions {
  centerX: number;
  centerZ: number;
  lowerY: number;
  upperY: number;
  lowerHalfX: number;
  lowerHalfZ: number;
  upperHalfX: number;
  upperHalfZ: number;
  boneIndex: number;
}

const BONE_ORDER: RushBoneName[] = [
  "Root", "Hips", "Spine", "Chest", "Neck", "Head",
  "LeftShoulder", "LeftUpperArm", "LeftForearm", "LeftHand",
  "RightShoulder", "RightUpperArm", "RightForearm", "RightHand",
  "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
  "RightUpperLeg", "RightLowerLeg", "RightFoot",
];

function createBone(name: RushBoneName, position: Point): THREE.Bone {
  const bone = new THREE.Bone();
  bone.name = name;
  bone.position.set(...position);
  return bone;
}

function createBones(): RushBones {
  const bones = {
    Root: createBone("Root", [0, 0, 0]),
    Hips: createBone("Hips", [0, 0.92, 0]),
    Spine: createBone("Spine", [0, 0.12, 0]),
    Chest: createBone("Chest", [0, 0.16, 0]),
    Neck: createBone("Neck", [0, 0.25, 0]),
    Head: createBone("Head", [0, 0.1, 0]),
    LeftShoulder: createBone("LeftShoulder", [0, 0.16, 0.25]),
    LeftUpperArm: createBone("LeftUpperArm", [0, -0.02, 0]),
    LeftForearm: createBone("LeftForearm", [0, -0.3, 0]),
    LeftHand: createBone("LeftHand", [0, -0.27, 0]),
    RightShoulder: createBone("RightShoulder", [0, 0.16, -0.25]),
    RightUpperArm: createBone("RightUpperArm", [0, -0.02, 0]),
    RightForearm: createBone("RightForearm", [0, -0.3, 0]),
    RightHand: createBone("RightHand", [0, -0.27, 0]),
    LeftUpperLeg: createBone("LeftUpperLeg", [0, 0, 0.16]),
    LeftLowerLeg: createBone("LeftLowerLeg", [0, -0.43, 0]),
    LeftFoot: createBone("LeftFoot", [0, -0.43, 0]),
    RightUpperLeg: createBone("RightUpperLeg", [0, 0, -0.16]),
    RightLowerLeg: createBone("RightLowerLeg", [0, -0.43, 0]),
    RightFoot: createBone("RightFoot", [0, -0.43, 0]),
  } satisfies RushBones;

  bones.Root.add(bones.Hips);
  bones.Hips.add(bones.Spine, bones.LeftUpperLeg, bones.RightUpperLeg);
  bones.Spine.add(bones.Chest);
  bones.Chest.add(bones.Neck, bones.LeftShoulder, bones.RightShoulder);
  bones.Neck.add(bones.Head);
  bones.LeftShoulder.add(bones.LeftUpperArm);
  bones.LeftUpperArm.add(bones.LeftForearm);
  bones.LeftForearm.add(bones.LeftHand);
  bones.RightShoulder.add(bones.RightUpperArm);
  bones.RightUpperArm.add(bones.RightForearm);
  bones.RightForearm.add(bones.RightHand);
  bones.LeftUpperLeg.add(bones.LeftLowerLeg);
  bones.LeftLowerLeg.add(bones.LeftFoot);
  bones.RightUpperLeg.add(bones.RightLowerLeg);
  bones.RightLowerLeg.add(bones.RightFoot);
  return bones;
}

function pushVertex(buffers: GeometryBuffers, point: Point, boneIndex: number) {
  buffers.positions.push(...point);
  buffers.skinIndices.push(boneIndex, 0, 0, 0);
  buffers.skinWeights.push(1, 0, 0, 0);
}

function addTriangle(buffers: GeometryBuffers, a: Point, b: Point, c: Point, boneIndex: number) {
  pushVertex(buffers, a, boneIndex);
  pushVertex(buffers, b, boneIndex);
  pushVertex(buffers, c, boneIndex);
}

function addQuad(
  buffers: GeometryBuffers,
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  boneIndex: number,
) {
  // The two triangles are coplanar: each quad reads as one large body plane.
  addTriangle(buffers, a, b, c, boneIndex);
  addTriangle(buffers, a, c, d, boneIndex);
}

function addTaperedPrism(buffers: GeometryBuffers, options: PrismOptions) {
  const {
    centerX, centerZ, lowerY, upperY,
    lowerHalfX, lowerHalfZ, upperHalfX, upperHalfZ, boneIndex,
  } = options;
  const l0: Point = [centerX - lowerHalfX, lowerY, centerZ - lowerHalfZ];
  const l1: Point = [centerX + lowerHalfX, lowerY, centerZ - lowerHalfZ];
  const l2: Point = [centerX + lowerHalfX, lowerY, centerZ + lowerHalfZ];
  const l3: Point = [centerX - lowerHalfX, lowerY, centerZ + lowerHalfZ];
  const u0: Point = [centerX - upperHalfX, upperY, centerZ - upperHalfZ];
  const u1: Point = [centerX + upperHalfX, upperY, centerZ - upperHalfZ];
  const u2: Point = [centerX + upperHalfX, upperY, centerZ + upperHalfZ];
  const u3: Point = [centerX - upperHalfX, upperY, centerZ + upperHalfZ];
  addQuad(buffers, l0, l3, l2, l1, boneIndex);
  addQuad(buffers, u0, u1, u2, u3, boneIndex);
  addQuad(buffers, l0, l1, u1, u0, boneIndex);
  addQuad(buffers, l1, l2, u2, u1, boneIndex);
  addQuad(buffers, l2, l3, u3, u2, boneIndex);
  addQuad(buffers, l3, l0, u0, u3, boneIndex);
}

function addHead(buffers: GeometryBuffers, boneIndex: number) {
  // Three deliberate rings create a readable crown, brow and jaw. This keeps
  // the head faceted without the floating-diamond silhouette of an octahedron.
  const top0: Point = [-0.05, 1.79, -0.065];
  const top1: Point = [0.06, 1.79, -0.065];
  const top2: Point = [0.06, 1.79, 0.065];
  const top3: Point = [-0.05, 1.79, 0.065];
  const brow0: Point = [-0.07, 1.7, -0.09];
  const brow1: Point = [0.09, 1.7, -0.09];
  const brow2: Point = [0.09, 1.7, 0.09];
  const brow3: Point = [-0.07, 1.7, 0.09];
  const jaw0: Point = [-0.045, 1.6, -0.055];
  const jaw1: Point = [0.065, 1.6, -0.055];
  const jaw2: Point = [0.065, 1.6, 0.055];
  const jaw3: Point = [-0.045, 1.6, 0.055];

  addQuad(buffers, top0, top1, top2, top3, boneIndex);
  addQuad(buffers, brow0, brow1, top1, top0, boneIndex);
  addQuad(buffers, brow1, brow2, top2, top1, boneIndex);
  addQuad(buffers, brow2, brow3, top3, top2, boneIndex);
  addQuad(buffers, brow3, brow0, top0, top3, boneIndex);
  addQuad(buffers, jaw0, jaw3, jaw2, jaw1, boneIndex);
  addQuad(buffers, jaw0, jaw1, brow1, brow0, boneIndex);
  addQuad(buffers, jaw1, jaw2, brow2, brow1, boneIndex);
  addQuad(buffers, jaw2, jaw3, brow3, brow2, boneIndex);
  addQuad(buffers, jaw3, jaw0, brow0, brow3, boneIndex);
}

function addFoot(buffers: GeometryBuffers, lateral: number, boneIndex: number) {
  const z0 = lateral - 0.085;
  const z1 = lateral + 0.085;
  const heelLow: Point = [-0.09, 0.035, z0];
  const heelLowOuter: Point = [-0.09, 0.035, z1];
  const toeLow: Point = [0.24, 0.035, z0];
  const toeLowOuter: Point = [0.24, 0.035, z1];
  const heelTop: Point = [-0.055, 0.16, z0];
  const heelTopOuter: Point = [-0.055, 0.16, z1];
  const toeTop: Point = [0.2, 0.095, z0];
  const toeTopOuter: Point = [0.2, 0.095, z1];
  addQuad(buffers, heelLow, toeLow, toeLowOuter, heelLowOuter, boneIndex);
  addQuad(buffers, heelTop, heelTopOuter, toeTopOuter, toeTop, boneIndex);
  addQuad(buffers, heelLow, heelTop, toeTop, toeLow, boneIndex);
  addQuad(buffers, heelLowOuter, toeLowOuter, toeTopOuter, heelTopOuter, boneIndex);
  addQuad(buffers, heelLow, heelLowOuter, heelTopOuter, heelTop, boneIndex);
  addQuad(buffers, toeLow, toeTop, toeTopOuter, toeLowOuter, boneIndex);
}

function createFighterGeometry(boneIndices: Record<RushBoneName, number>) {
  const buffers: GeometryBuffers = { positions: [], skinIndices: [], skinWeights: [] };
  const prism = (bone: RushBoneName, options: Omit<PrismOptions, "boneIndex">) =>
    addTaperedPrism(buffers, { ...options, boneIndex: boneIndices[bone] });

  prism("Hips", {
    centerX: 0, centerZ: 0, lowerY: 0.83, upperY: 1.04,
    lowerHalfX: 0.14, lowerHalfZ: 0.18, upperHalfX: 0.125, upperHalfZ: 0.14,
  });
  prism("Spine", {
    centerX: 0, centerZ: 0, lowerY: 1, upperY: 1.21,
    lowerHalfX: 0.115, lowerHalfZ: 0.13, upperHalfX: 0.15, upperHalfZ: 0.19,
  });
  prism("Chest", {
    centerX: 0.015, centerZ: 0, lowerY: 1.18, upperY: 1.48,
    lowerHalfX: 0.15, lowerHalfZ: 0.19, upperHalfX: 0.18, upperHalfZ: 0.26,
  });
  prism("Neck", {
    centerX: 0.005, centerZ: 0, lowerY: 1.485, upperY: 1.59,
    lowerHalfX: 0.06, lowerHalfZ: 0.065, upperHalfX: 0.045, upperHalfZ: 0.05,
  });
  addHead(buffers, boneIndices.Head);

  const addArm = (prefix: "Left" | "Right", lateral: number) => {
    prism(`${prefix}UpperArm`, {
      centerX: 0, centerZ: lateral, lowerY: 1.13, upperY: 1.48,
      lowerHalfX: 0.075, lowerHalfZ: 0.075, upperHalfX: 0.105, upperHalfZ: 0.105,
    });
    prism(`${prefix}Forearm`, {
      centerX: 0, centerZ: lateral, lowerY: 0.88, upperY: 1.17,
      lowerHalfX: 0.065, lowerHalfZ: 0.065, upperHalfX: 0.085, upperHalfZ: 0.085,
    });
    prism(`${prefix}Hand`, {
      centerX: 0.018, centerZ: lateral, lowerY: 0.75, upperY: 0.91,
      lowerHalfX: 0.045, lowerHalfZ: 0.055, upperHalfX: 0.07, upperHalfZ: 0.07,
    });
  };
  addArm("Left", 0.25);
  addArm("Right", -0.25);

  const addLeg = (prefix: "Left" | "Right", lateral: number) => {
    prism(`${prefix}UpperLeg`, {
      centerX: 0, centerZ: lateral, lowerY: 0.46, upperY: 0.94,
      lowerHalfX: 0.105, lowerHalfZ: 0.105, upperHalfX: 0.135, upperHalfZ: 0.14,
    });
    prism(`${prefix}LowerLeg`, {
      centerX: -0.005, centerZ: lateral, lowerY: 0.08, upperY: 0.5,
      lowerHalfX: 0.062, lowerHalfZ: 0.065, upperHalfX: 0.095, upperHalfZ: 0.095,
    });
    addFoot(buffers, lateral, boneIndices[`${prefix}Foot`]);
  };
  addLeg("Left", 0.16);
  addLeg("Right", -0.16);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(buffers.skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(buffers.skinWeights, 4));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = "RushReconstructionPurposefulPlanes";
  return geometry;
}

export function createRushFighterRig(material: THREE.MeshStandardMaterial): RushFighterRig {
  const bones = createBones();
  const orderedBones = BONE_ORDER.map((name) => bones[name]);
  const boneIndices = Object.fromEntries(BONE_ORDER.map((name, index) => [name, index])) as Record<RushBoneName, number>;
  const geometry = createFighterGeometry(boneIndices);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = "RushReconstructionFighter";
  mesh.add(bones.Root);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(orderedBones);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const bindPositions = Object.fromEntries(BONE_ORDER.map((name) => [name, bones[name].position.clone()])) as Record<RushBoneName, THREE.Vector3>;
  const bindQuaternions = Object.fromEntries(BONE_ORDER.map((name) => [name, bones[name].quaternion.clone()])) as Record<RushBoneName, THREE.Quaternion>;
  return { mesh, skeleton, bones, bindPositions, bindQuaternions };
}

export function countRushFighterTriangles(geometry: THREE.BufferGeometry) {
  return geometry.index ? geometry.index.count / 3 : geometry.getAttribute("position").count / 3;
}

export const RUSH_REQUIRED_BONES = BONE_ORDER;
