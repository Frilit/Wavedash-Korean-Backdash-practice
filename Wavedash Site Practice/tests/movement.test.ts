import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceBackdashMotion,
  analyzeTransition,
  createAnalyzerState,
  createBackdashMotionState,
  inputMotionDelta,
  inputTimingResponse,
  lateralMotionForTransition,
  rawObservedLabel,
  resolveDirection,
  type AnalyzerState,
  type Attempt,
  type Direction,
} from "../lib/movement";

function run(sequence: Direction[], spacing = 24, held: number[] = []) {
  let state: AnalyzerState = createAnalyzerState();
  const attempts: Attempt[] = [];
  sequence.forEach((direction, index) => {
    const result = analyzeTransition(state, direction, index * spacing, held[index] ?? spacing);
    state = result.state;
    attempts.push(...result.attempts);
  });
  return attempts;
}

test("normalizes physical directions relative to player side", () => {
  const right = { up: false, down: false, left: false, right: true };
  assert.equal(resolveDirection(right, "P1"), "f");
  assert.equal(resolveDirection(right, "P2"), "b");
  assert.equal(resolveDirection({ ...right, down: true }, "P1"), "df");
  assert.equal(resolveDirection({ ...right, down: true }, "P2"), "db");
});

test("keeps browser-observed SOCD separate from trainer resolution", () => {
  const socd = { up: true, down: true, left: true, right: true };
  assert.equal(rawObservedLabel(socd), "UP + DOWN + LEFT + RIGHT");
  assert.equal(resolveDirection(socd, "P1"), "n");
});

test("detects a clean wavedash chronologically", () => {
  const attempts = run(["f", "n", "d", "df", "f", "f"]);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].valid, true);
  assert.equal(attempts[0].feedback, "CLEAN WAVEDASH");
});

test("classifies missing wavedash neutral", () => {
  const attempts = run(["f", "d"]);
  assert.equal(attempts[0].valid, false);
  assert.equal(attempts[0].feedback, "MISSED NEUTRAL");
});

test("classifies missing wavedash down", () => {
  const attempts = run(["f", "n", "df"]);
  assert.equal(attempts[0].feedback, "MISSED DOWN");
});

test("does not count the crouch-dash portion without the restart forward", () => {
  const attempts = run(["f", "n", "d", "df", "f"]);
  assert.equal(attempts.some((item) => item.kind === "wave" && item.valid), false);
});

test("detects repeated wavedashes without searching unordered history", () => {
  const attempts = run(["f", "n", "d", "df", "f", "f", "n", "d", "df", "f", "f"]);
  assert.equal(attempts.filter((item) => item.valid && item.kind === "wave").length, 2);
});

test("accepts the neutral reported between two physical forward taps", () => {
  const attempts = run(["f", "n", "d", "df", "f", "n", "f"]);
  assert.equal(attempts.some((item) => item.kind === "wave" && item.valid), true);
});

test("detects the exact Korean backdash structure", () => {
  const attempts = run(["b", "b", "db", "n", "b", "b"], 30);
  assert.equal(attempts.some((item) => item.kind === "kbd" && item.valid), true);
});

test("detects repeated Korean backdashes", () => {
  const attempts = run(["b", "b", "db", "n", "b", "b", "db", "n", "b", "b"], 30);
  assert.equal(attempts.filter((item) => item.kind === "kbd" && item.valid).length, 2);
});

test("accepts neutral between the physical double-back taps", () => {
  const attempts = run(["b", "n", "b", "db", "n", "b", "n", "b"], 30);
  assert.equal(attempts.some((item) => item.kind === "kbd" && item.valid), true);
});

test("rejects raw repeated backdashes without the down-back cancel", () => {
  const attempts = run(["b", "n", "b", "n", "b", "n", "b"], 30);
  assert.equal(attempts.some((item) => item.kind === "kbd" && item.valid), false);
  assert.equal(attempts.some((item) => item.feedback === "RECOVERY NOT CANCELLED"), true);
});

test("classifies an over-held down-back cancel", () => {
  const attempts = run(["b", "b", "db", "n"], 30, [30, 30, 30, 180]);
  assert.equal(attempts.at(-1)?.feedback, "DOWN-BACK HELD TOO LONG");
});

test("classifies missing back during KBD restart", () => {
  const attempts = run(["b", "b", "db", "n", "d"], 30);
  assert.equal(attempts.at(-1)?.feedback, "RESTART BACK MISSING");
});

test("equivalent normalized device states produce the same notation", () => {
  const keyboardObserved = { up: false, down: true, left: false, right: true };
  const gamepadObserved = { up: false, down: true, left: false, right: true };
  assert.equal(resolveDirection(keyboardObserved, "P1"), resolveDirection(gamepadObserved, "P1"));
  assert.equal(resolveDirection(keyboardObserved, "P2"), resolveDirection(gamepadObserved, "P2"));
});

test("wavedash phases accumulate real forward world travel", () => {
  const sequence: Direction[] = ["f", "n", "d", "df", "f", "n", "f"];
  const travel = sequence.reduce((sum, direction, index) => (
    sum + inputMotionDelta(sequence[index - 1] ?? "n", direction)
  ), 0);
  assert.ok(travel > 0.8);
});

test("Korean backdash phases accumulate real backward world travel", () => {
  const sequence: Direction[] = ["b", "n", "b", "db", "n", "b", "n", "b"];
  let state = createBackdashMotionState();
  let travel = 0;
  sequence.forEach((direction, index) => {
    const result = advanceBackdashMotion(state, direction, index * 60);
    state = result.state;
    travel += result.travelDelta;
  });
  assert.ok(travel < -1);
});

test("raw back taps retreat less efficiently than a recovery-cancelled KBD", () => {
  const travelFor = (sequence: Direction[]) => {
    let state = createBackdashMotionState();
    return sequence.reduce((travel, direction, index) => {
      const result = advanceBackdashMotion(state, direction, index * 60);
      state = result.state;
      return travel + result.travelDelta;
    }, 0);
  };
  const kbdTravel = travelFor(["b", "n", "b", "db", "n", "b", "n", "b"]);
  const rawTravel = travelFor(["b", "n", "b", "n", "b", "n", "b"]);
  assert.ok(kbdTravel < rawTravel - 0.4);
});

test("animation response preserves the user's input rhythm", () => {
  assert.ok(inputTimingResponse(45) > inputTimingResponse(220));
});

test("quick pure up or down taps become real lateral sidesteps", () => {
  const up = lateralMotionForTransition("u", "n", 92);
  const down = lateralMotionForTransition("d", "n", 110);
  assert.equal(up.phase, "sidestep");
  assert.equal(down.phase, "sidestep");
  assert.ok(up.travelDelta < 0);
  assert.ok(down.travelDelta > 0);
});

test("held lateral input exits sidewalk without adding a tap burst", () => {
  const release = lateralMotionForTransition("u", "n", 240);
  assert.equal(release.phase, "sidewalk-stop");
  assert.equal(release.travelDelta, 0);
});

test("crouch-dash diagonals never become sidesteps", () => {
  const crouchDash = lateralMotionForTransition("d", "df", 70);
  assert.equal(crouchDash.phase, "lateral-recovery");
  assert.equal(crouchDash.travelDelta, 0);
});
