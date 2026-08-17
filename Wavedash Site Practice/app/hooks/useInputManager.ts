"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FRAME_MS,
  rawObservedLabel,
  resolveDirection,
  type Direction,
  type InputSource,
  type InputTransition,
  type PlayerSide,
} from "../../lib/movement";

export type DeviceMode = "automatic" | "keyboard" | "controller";
export type LogicalDirection = "up" | "down" | "left" | "right";
export type GamepadBinding =
  | { type: "button"; index: number }
  | { type: "axis"; index: number; sign: 1 | -1 };
export type GamepadDirectionMap = Partial<Record<LogicalDirection, GamepadBinding>>;
export type KeyboardMap = Record<LogicalDirection, string>;

export interface GamepadSummary {
  index: number;
  id: string;
  buttons: number;
  axes: number;
  mapping: string;
  connected: boolean;
}

export interface RawGamepadSnapshot {
  buttons: number[];
  axes: number[];
  timestamp: number;
}

interface InputManagerOptions {
  side: PlayerSide;
  deviceMode: DeviceMode;
  deadzone: number;
  activeGamepadIndex: number | null;
  customMap: GamepadDirectionMap;
  keyboardMap: KeyboardMap;
  exposeRawValues: boolean;
  onTransition: (transition: InputTransition) => void;
}

const emptyPhysical = { up: false, down: false, left: false, right: false };

function bindingActive(gamepad: Gamepad, binding: GamepadBinding | undefined, deadzone: number) {
  if (!binding) return false;
  if (binding.type === "button") return (gamepad.buttons[binding.index]?.value ?? 0) > 0.5;
  const value = gamepad.axes[binding.index] ?? 0;
  return binding.sign > 0 ? value > deadzone : value < -deadzone;
}

function readGamepad(gamepad: Gamepad, deadzone: number, customMap: GamepadDirectionMap) {
  if (Object.keys(customMap).length >= 4) {
    return {
      up: bindingActive(gamepad, customMap.up, deadzone),
      down: bindingActive(gamepad, customMap.down, deadzone),
      left: bindingActive(gamepad, customMap.left, deadzone),
      right: bindingActive(gamepad, customMap.right, deadzone),
    };
  }
  const axisX = gamepad.axes[0] ?? 0;
  const axisY = gamepad.axes[1] ?? 0;
  return {
    up: (gamepad.buttons[12]?.pressed ?? false) || axisY < -deadzone,
    down: (gamepad.buttons[13]?.pressed ?? false) || axisY > deadzone,
    left: (gamepad.buttons[14]?.pressed ?? false) || axisX < -deadzone,
    right: (gamepad.buttons[15]?.pressed ?? false) || axisX > deadzone,
  };
}

export function useInputManager(options: InputManagerOptions) {
  const [direction, setDirection] = useState<Direction>("n");
  const [rawObserved, setRawObserved] = useState("NEUTRAL");
  const [source, setSource] = useState<InputSource>("keyboard");
  const [directionStartedAt, setDirectionStartedAt] = useState(0);
  const [gamepads, setGamepads] = useState<GamepadSummary[]>([]);
  const [rawGamepad, setRawGamepad] = useState<RawGamepadSnapshot>({ buttons: [], axes: [], timestamp: 0 });
  const pressedKeys = useRef(new Set<string>());
  const currentDirection = useRef<Direction>("n");
  const currentStartedAt = useRef(0);
  const rawObservedRef = useRef("NEUTRAL");
  const sessionStartedAt = useRef(0);
  const gamepadSignature = useRef("");
  const rawUpdateAt = useRef(0);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const commit = useCallback((physical: typeof emptyPhysical, nextSource: InputSource) => {
    const opts = optionsRef.current;
    if (opts.deviceMode === "keyboard" && nextSource === "gamepad") return;
    if (opts.deviceMode === "controller" && nextSource === "keyboard") return;
    const timestamp = performance.now();
    if (!sessionStartedAt.current) sessionStartedAt.current = timestamp;
    if (!currentStartedAt.current) {
      currentStartedAt.current = timestamp;
      setDirectionStartedAt(timestamp);
    }
    const observed = rawObservedLabel(physical);
    const resolved = resolveDirection(physical, opts.side);
    if (observed !== rawObservedRef.current) {
      rawObservedRef.current = observed;
      setRawObserved(observed);
    }
    if (resolved === currentDirection.current) return;
    const previousDirection = currentDirection.current;
    const durationMs = timestamp - currentStartedAt.current;
    const transition: InputTransition = {
      previousDirection,
      direction: resolved,
      timestamp,
      trainingFrame: Math.round((timestamp - sessionStartedAt.current) / FRAME_MS),
      durationMs,
      durationFrames: Math.max(1, Math.round(durationMs / FRAME_MS)),
      source: nextSource,
      rawObserved: observed,
    };
    currentDirection.current = resolved;
    currentStartedAt.current = timestamp;
    setDirection(resolved);
    setDirectionStartedAt(timestamp);
    setSource(nextSource);
    opts.onTransition(transition);
  }, []);

  useEffect(() => {
    const physicalFromKeys = () => {
      const bindings = optionsRef.current.keyboardMap;
      return {
        up: pressedKeys.current.has(bindings.up),
        down: pressedKeys.current.has(bindings.down),
        left: pressedKeys.current.has(bindings.left),
        right: pressedKeys.current.has(bindings.right),
      };
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const bindings = Object.values(optionsRef.current.keyboardMap);
      if (!bindings.includes(event.code)) return;
      event.preventDefault();
      if (event.repeat) return;
      pressedKeys.current.add(event.code);
      commit(physicalFromKeys(), "keyboard");
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!pressedKeys.current.has(event.code)) return;
      event.preventDefault();
      pressedKeys.current.delete(event.code);
      commit(physicalFromKeys(), "keyboard");
    };
    const onBlur = () => {
      pressedKeys.current.clear();
      commit(emptyPhysical, "keyboard");
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp, { passive: false });
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [commit]);

  useEffect(() => {
    let animationFrame = 0;
    const poll = () => {
      const available = typeof navigator.getGamepads === "function"
        ? Array.from(navigator.getGamepads()).filter((item): item is Gamepad => Boolean(item))
        : [];
      const signature = available.map((item) => `${item.index}:${item.id}:${item.connected}`).join("|");
      if (signature !== gamepadSignature.current) {
        gamepadSignature.current = signature;
        setGamepads(available.map((item) => ({
          index: item.index,
          id: item.id || "Generic Gamepad",
          buttons: item.buttons.length,
          axes: item.axes.length,
          mapping: item.mapping || "custom",
          connected: item.connected,
        })));
      }
      const requested = optionsRef.current.activeGamepadIndex;
      const active = available.find((item) => item.index === requested) ?? available[0];
      if (active) {
        commit(readGamepad(active, optionsRef.current.deadzone, optionsRef.current.customMap), "gamepad");
        const now = performance.now();
        if (optionsRef.current.exposeRawValues && now - rawUpdateAt.current > 70) {
          rawUpdateAt.current = now;
          setRawGamepad({
            buttons: active.buttons.map((button) => button.value),
            axes: [...active.axes],
            timestamp: now,
          });
        }
      }
      animationFrame = requestAnimationFrame(poll);
    };
    animationFrame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(animationFrame);
  }, [commit]);

  useEffect(() => {
    const physical = {
      up: pressedKeys.current.has(options.keyboardMap.up),
      down: pressedKeys.current.has(options.keyboardMap.down),
      left: pressedKeys.current.has(options.keyboardMap.left),
      right: pressedKeys.current.has(options.keyboardMap.right),
    };
    commit(physical, "keyboard");
  }, [options.side, options.keyboardMap, commit]);

  return { direction, rawObserved, source, directionStartedAt, gamepads, rawGamepad };
}

export function detectChangedBinding(
  before: RawGamepadSnapshot,
  after: RawGamepadSnapshot,
): GamepadBinding | null {
  for (let index = 0; index < after.buttons.length; index += 1) {
    if ((after.buttons[index] ?? 0) > 0.65 && (before.buttons[index] ?? 0) < 0.35) return { type: "button", index };
  }
  for (let index = 0; index < after.axes.length; index += 1) {
    const delta = (after.axes[index] ?? 0) - (before.axes[index] ?? 0);
    if (Math.abs(delta) > 0.55) return { type: "axis", index, sign: delta > 0 ? 1 : -1 };
  }
  return null;
}
