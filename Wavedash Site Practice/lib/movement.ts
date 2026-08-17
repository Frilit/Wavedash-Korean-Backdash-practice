export type Direction = "n" | "u" | "d" | "f" | "b" | "uf" | "ub" | "df" | "db";
export type PlayerSide = "P1" | "P2";
export type InputSource = "keyboard" | "gamepad";

export interface DirectionState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  timestamp: number;
}

export interface InputTransition {
  previousDirection: Direction;
  direction: Direction;
  timestamp: number;
  trainingFrame: number;
  durationMs: number;
  durationFrames: number;
  source: InputSource;
  rawObserved: string;
}

export interface Attempt {
  id: string;
  kind: "wave" | "kbd";
  valid: boolean;
  feedback: string;
  durationMs: number;
  timestamp: number;
  sequence: { direction: Direction; offsetMs: number }[];
}

export const FRAME_MS = 1000 / 60;
export const DIRECTION_SYMBOLS: Record<Direction, string> = {
  n: "•", u: "↑", d: "↓", f: "→", b: "←", uf: "↗", ub: "↖", df: "↘", db: "↙",
};

export function rawObservedLabel(state: Omit<DirectionState, "timestamp">): string {
  const parts: string[] = [];
  if (state.up) parts.push("UP");
  if (state.down) parts.push("DOWN");
  if (state.left) parts.push("LEFT");
  if (state.right) parts.push("RIGHT");
  return parts.length ? parts.join(" + ") : "NEUTRAL";
}

export function resolveDirection(
  state: Omit<DirectionState, "timestamp">,
  side: PlayerSide,
): Direction {
  const vertical = state.up === state.down ? "" : state.up ? "u" : "d";
  const physicalHorizontal = state.left === state.right ? "" : state.left ? "left" : "right";
  const horizontal = physicalHorizontal === "" ? "" :
    (side === "P1" ? physicalHorizontal === "right" : physicalHorizontal === "left") ? "f" : "b";
  if (!vertical && !horizontal) return "n";
  return `${vertical}${horizontal}` as Direction;
}

/**
 * World-space travel contributed by each observed directional transition.
 * A completed move is deliberately not required: hesitations and interrupted
 * sequences remain visible instead of being replaced by a canned animation.
 */
export function inputMotionDelta(previous: Direction, direction: Direction): number {
  if (direction === "df") return previous === "d" ? 0.3 : 0.2;
  if (direction === "f") {
    if (previous === "df") return 0.28;
    if (previous === "n") return 0.18;
    return 0.11;
  }
  if (direction === "d") return 0.025;
  return 0;
}

export type BackdashMotionPhase =
  | "none"
  | "back-prep"
  | "backdash"
  | "raw-recovery"
  | "kbd-cancel"
  | "kbd-reset";

export type LateralMotionPhase =
  | "none"
  | "sidestep-start"
  | "sidestep"
  | "sidewalk"
  | "sidewalk-stop"
  | "lateral-recovery";

export type LateralDirection = -1 | 0 | 1;

export const SIDEWALK_HOLD_MS = 170;

export interface LateralMotionResult {
  phase: LateralMotionPhase;
  direction: LateralDirection;
  travelDelta: number;
}

export function lateralDirection(direction: Direction): LateralDirection {
  if (direction === "u") return -1;
  if (direction === "d") return 1;
  return 0;
}

/**
 * A pure up/down press begins a lateral preparation. Releasing it quickly
 * completes a discrete sidestep; holding it long enough hands control to the
 * sidewalk state. Diagonals never count as lateral movement, so the down input
 * in a crouch-dash cannot accidentally move the fighter across the arena.
 */
export function lateralMotionForTransition(
  previousDirection: Direction,
  direction: Direction,
  previousHeldMs: number,
): LateralMotionResult {
  const currentLateral = lateralDirection(direction);
  const previousLateral = lateralDirection(previousDirection);

  if (currentLateral) {
    return { phase: "sidestep-start", direction: currentLateral, travelDelta: 0 };
  }

  if (!previousLateral) {
    return { phase: "none", direction: 0, travelDelta: 0 };
  }

  if (direction === "n" && previousHeldMs < SIDEWALK_HOLD_MS) {
    return { phase: "sidestep", direction: previousLateral, travelDelta: previousLateral * 0.46 };
  }

  if (direction === "n") {
    return { phase: "sidewalk-stop", direction: previousLateral, travelDelta: 0 };
  }

  return { phase: "lateral-recovery", direction: previousLateral, travelDelta: 0 };
}

export interface BackdashMotionState {
  backTapCount: 0 | 1;
  lastBackAt: number;
  recoveryUntil: number;
  cancelStage: "none" | "dash" | "cancel" | "reset";
}

export interface BackdashMotionResult {
  state: BackdashMotionState;
  phase: BackdashMotionPhase;
  travelDelta: number;
}

export function createBackdashMotionState(): BackdashMotionState {
  return { backTapCount: 0, lastBackAt: 0, recoveryUntil: 0, cancelStage: "none" };
}

/**
 * Models actual backdash recovery instead of assigning the same displacement
 * to every back input. A double-back launches the dash, db cancels its late
 * recovery, and neutral arms the next double-back. Raw back taps during the
 * recovery window only creep backward until that recovery expires.
 */
export function advanceBackdashMotion(
  current: BackdashMotionState,
  direction: Direction,
  timestamp: number,
): BackdashMotionResult {
  const state = { ...current };

  if (direction === "db") {
    if (state.cancelStage === "dash" && timestamp <= state.recoveryUntil) {
      state.cancelStage = "cancel";
      state.backTapCount = 0;
      state.recoveryUntil = timestamp + 90;
      return { state, phase: "kbd-cancel", travelDelta: -0.045 };
    }
    state.backTapCount = 0;
    return { state, phase: "none", travelDelta: 0 };
  }

  if (direction === "n") {
    if (state.cancelStage === "cancel") {
      state.cancelStage = "reset";
      return { state, phase: "kbd-reset", travelDelta: 0 };
    }
    if (state.cancelStage === "dash" && timestamp <= state.recoveryUntil) {
      return { state, phase: "raw-recovery", travelDelta: 0 };
    }
    return { state, phase: "none", travelDelta: 0 };
  }

  if (direction === "b") {
    if (state.cancelStage === "dash" && timestamp <= state.recoveryUntil) {
      state.lastBackAt = timestamp;
      state.backTapCount = 1;
      return { state, phase: "raw-recovery", travelDelta: -0.035 };
    }

    const isDoubleBack = state.backTapCount === 1 && timestamp - state.lastBackAt <= 320;
    if (isDoubleBack) {
      state.backTapCount = 0;
      state.lastBackAt = timestamp;
      state.cancelStage = "dash";
      state.recoveryUntil = timestamp + 360;
      return { state, phase: "backdash", travelDelta: -0.5 };
    }

    state.backTapCount = 1;
    state.lastBackAt = timestamp;
    if (timestamp > state.recoveryUntil) state.cancelStage = "none";
    return { state, phase: "back-prep", travelDelta: -0.055 };
  }

  return { state: createBackdashMotionState(), phase: "none", travelDelta: 0 };
}

/** Fast inputs blend quickly; slow inputs have time to settle into each pose. */
export function inputTimingResponse(previousHeldMs: number): number {
  const duration = Math.max(40, previousHeldMs || 120);
  return Math.min(2.35, Math.max(0.68, 155 / duration));
}

export interface AnalyzerState {
  wavePhase: 0 | 1 | 2 | 3 | 4 | 5;
  waveStartedAt: number;
  waveSequence: { direction: Direction; offsetMs: number }[];
  kbdPhase: 0 | 1 | 2 | 3 | 4 | 5;
  kbdStartedAt: number;
  kbdSequence: { direction: Direction; offsetMs: number }[];
}

export function createAnalyzerState(): AnalyzerState {
  return {
    wavePhase: 0,
    waveStartedAt: 0,
    waveSequence: [],
    kbdPhase: 0,
    kbdStartedAt: 0,
    kbdSequence: [],
  };
}

function attempt(
  kind: Attempt["kind"],
  valid: boolean,
  feedback: string,
  startedAt: number,
  timestamp: number,
  sequence: Attempt["sequence"],
): Attempt {
  return {
    id: `${kind}-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    valid,
    feedback,
    durationMs: Math.max(0, timestamp - startedAt),
    timestamp,
    sequence,
  };
}

export function analyzeTransition(
  current: AnalyzerState,
  direction: Direction,
  timestamp: number,
  previousDirectionDurationMs: number,
): { state: AnalyzerState; attempts: Attempt[] } {
  const state: AnalyzerState = {
    ...current,
    waveSequence: [...current.waveSequence],
    kbdSequence: [...current.kbdSequence],
  };
  const attempts: Attempt[] = [];

  if (current.wavePhase === 0) {
    if (direction === "f") {
      state.wavePhase = 1;
      state.waveStartedAt = timestamp;
      state.waveSequence = [{ direction, offsetMs: 0 }];
    }
  } else {
    state.waveSequence.push({ direction, offsetMs: timestamp - state.waveStartedAt });
    const failWave = (feedback: string) => {
      attempts.push(attempt("wave", false, feedback, state.waveStartedAt, timestamp, state.waveSequence));
      state.wavePhase = direction === "f" ? 1 : 0;
      state.waveStartedAt = direction === "f" ? timestamp : 0;
      state.waveSequence = direction === "f" ? [{ direction, offsetMs: 0 }] : [];
    };

    switch (current.wavePhase) {
      case 1:
        if (direction === "n") state.wavePhase = 2;
        else failWave(direction === "d" || direction === "df" ? "MISSED NEUTRAL" : "EXTRA INPUT");
        break;
      case 2:
        if (direction === "d") state.wavePhase = 3;
        else failWave(direction === "df" ? "MISSED DOWN" : "EXTRA INPUT");
        break;
      case 3:
        if (direction === "df") state.wavePhase = 4;
        else failWave("MISSED DF");
        break;
      case 4:
        if (direction === "f") state.wavePhase = 5;
        else failWave("FORWARD EXIT MISSING");
        break;
      case 5:
        // A real keyboard or pad reports neutral while the first forward is
        // released. Keep waiting for the second forward press that restarts
        // the next crouch-dash; logical input streams may provide f directly.
        if (direction === "n") break;
        if (direction === "f") {
          attempts.push(attempt("wave", true, "CLEAN WAVEDASH", state.waveStartedAt, timestamp, state.waveSequence));
          state.wavePhase = 1;
          state.waveStartedAt = timestamp;
          state.waveSequence = [{ direction, offsetMs: 0 }];
        } else failWave("RESTART FORWARD MISSING");
        break;
    }
  }

  if (current.kbdPhase === 0) {
    if (direction === "b") {
      state.kbdPhase = 1;
      state.kbdStartedAt = timestamp;
      state.kbdSequence = [{ direction, offsetMs: 0 }];
    }
  } else {
    state.kbdSequence.push({ direction, offsetMs: timestamp - state.kbdStartedAt });
    const failKbd = (feedback: string) => {
      attempts.push(attempt("kbd", false, feedback, state.kbdStartedAt, timestamp, state.kbdSequence));
      state.kbdPhase = direction === "b" ? 1 : 0;
      state.kbdStartedAt = direction === "b" ? timestamp : 0;
      state.kbdSequence = direction === "b" ? [{ direction, offsetMs: 0 }] : [];
    };

    switch (current.kbdPhase) {
      case 1:
        // A physical second tap reports neutral between b presses. Logical
        // notation may provide the two b inputs next to each other.
        if (direction === "n") break;
        if (direction === "b") {
          if (timestamp - state.kbdStartedAt > 320) failKbd("BACKDASH START TOO SLOW");
          else state.kbdPhase = 2;
        } else failKbd("SECOND BACK MISSING");
        break;
      case 2:
        if (direction === "db") state.kbdPhase = 3;
        else failKbd(direction === "b" || direction === "n" ? "RECOVERY NOT CANCELLED" : "DOWN-BACK CANCEL MISSING");
        break;
      case 3:
        if (previousDirectionDurationMs > 150) failKbd("DOWN-BACK HELD TOO LONG");
        else if (direction === "n") state.kbdPhase = 4;
        else failKbd("NEUTRAL RESET MISSING");
        break;
      case 4:
        if (direction === "b") state.kbdPhase = 5;
        else failKbd("RESTART BACK MISSING");
        break;
      case 5:
        if (direction === "n") break;
        if (direction === "b") {
          attempts.push(attempt("kbd", true, "RECOVERY CANCELLED", state.kbdStartedAt, timestamp, state.kbdSequence));
          // This second b has already launched the next backdash, so remain in
          // the dash phase and wait for its db cancel.
          state.kbdPhase = 2;
          state.kbdStartedAt = timestamp;
          state.kbdSequence = [{ direction, offsetMs: 0 }];
        } else failKbd("SECOND RESTART BACK MISSING");
        break;
    }
  }

  return { state, attempts };
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export function calculateStats(attempts: Attempt[]) {
  const successful = attempts.filter((item) => item.valid);
  const durations = successful.map((item) => item.durationMs);
  const average = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
  const variance = durations.length ? durations.reduce((sum, value) => sum + (value - average) ** 2, 0) / durations.length : 0;
  const consistency = average ? Math.max(0, 100 - (Math.sqrt(variance) / average) * 100) : 0;
  return {
    total: attempts.length,
    success: successful.length,
    failed: attempts.length - successful.length,
    accuracy: attempts.length ? (successful.length / attempts.length) * 100 : 0,
    average,
    median: median(durations),
    fastest: durations.length ? Math.min(...durations) : 0,
    slowest: durations.length ? Math.max(...durations) : 0,
    variance,
    consistency,
  };
}
