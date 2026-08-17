import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
import {
  countRushFighterTriangles,
  createRushFighterRig,
  RUSH_RECONSTRUCTION_PROPORTIONS,
  RUSH_REQUIRED_BONES,
} from "../lib/rushFighterShell";

function createTestRig() {
  return createRushFighterRig(new THREE.MeshStandardMaterial({ flatShading: true }));
}

test("replacement fighter uses one skinned surface and a complete purpose-built humanoid rig", () => {
  const rig = createTestRig();
  assert.ok(rig.mesh.isSkinnedMesh);
  assert.equal(rig.mesh.skeleton, rig.skeleton);
  assert.equal(rig.skeleton.bones.length, RUSH_REQUIRED_BONES.length);
  assert.deepEqual(rig.skeleton.bones.map((bone) => bone.name), [...RUSH_REQUIRED_BONES]);

  for (const boneName of RUSH_REQUIRED_BONES) {
    assert.equal(rig.bones[boneName].isBone, true, `missing humanoid bone ${boneName}`);
  }
  assert.equal(rig.bones.LeftLowerLeg.parent, rig.bones.LeftUpperLeg);
  assert.equal(rig.bones.LeftFoot.parent, rig.bones.LeftLowerLeg);
  assert.equal(rig.bones.RightLowerLeg.parent, rig.bones.RightUpperLeg);
  assert.equal(rig.bones.RightFoot.parent, rig.bones.RightLowerLeg);

  const geometry = rig.mesh.geometry;
  assert.ok(geometry.getAttribute("skinIndex"));
  assert.ok(geometry.getAttribute("skinWeight"));
  assert.equal(geometry.getAttribute("skinIndex").count, geometry.getAttribute("position").count);
  assert.equal(geometry.getAttribute("skinWeight").count, geometry.getAttribute("position").count);
});

test("fighter uses few deliberate planes instead of triangle soup", () => {
  const rig = createTestRig();
  const triangles = countRushFighterTriangles(rig.mesh.geometry);
  assert.ok(triangles >= 150, `expected enough planes to describe a fighter, got ${triangles}`);
  assert.ok(triangles <= 230, `triangle budget regressed into surface noise: ${triangles}`);
  assert.equal(rig.mesh.material.flatShading, true);

  const source = readFileSync(new URL("../lib/rushFighterShell.ts", import.meta.url), "utf8");
  for (const banned of ["SphereGeometry", "CylinderGeometry", "CapsuleGeometry", "createRushFacetedSegment", "twists ="]) {
    assert.equal(source.includes(banned), false, `${banned} must not return to the fighter builder`);
  }
});

test("reconstruction proportions preserve a readable fighting silhouette", () => {
  const p = RUSH_RECONSTRUCTION_PROPORTIONS;
  assert.ok(p.overallHeight / p.headHeight > 9 && p.overallHeight / p.headHeight < 10);
  assert.ok(p.headHeight <= 0.19, "head should remain compact beside the raised guard");
  assert.ok(p.headWidth < p.chestWidth * 0.45);
  assert.ok(p.neckHeight < p.headHeight * 0.6);
  assert.ok(p.shoulderWidth > p.chestWidth);
  assert.ok(p.chestWidth > p.hipWidth);
  assert.ok(p.hipWidth > p.waistWidth);
  assert.ok(p.footLength > p.handLength * 2);
  assert.ok(p.neutralStanceWidth > p.shoulderWidth);
});

test("runtime no longer loads or poses the discarded imported mannequin", () => {
  const component = readFileSync(new URL("../app/components/RiggedTrainingDummy.tsx", import.meta.url), "utf8");
  for (const discardedPath of ["useGLTF", "SkeletonUtils", "FIGHTER_MODEL_URL", "training-fighter.gltf", "cloneSkeleton"]) {
    assert.equal(component.includes(discardedPath), false, `${discardedPath} belongs to the discarded character`);
  }
  assert.ok(component.includes("solveTwoBone"));
  assert.ok(component.includes("velocityX.current"));
  assert.ok(component.includes("fighterPose"));
});
