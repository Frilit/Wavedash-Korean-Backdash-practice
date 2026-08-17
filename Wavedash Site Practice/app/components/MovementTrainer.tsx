"use client";

import {
  Activity, ChevronLeft, ChevronRight, Eye,
  Gamepad2, Gauge, Keyboard, Pause, Play, Radio, RotateCcw,
  Settings, ShieldCheck, SlidersHorizontal, Target, X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CameraMode, InputMotionSignal, MotionSignal } from "./TrainingStage";
import {
  detectChangedBinding,
  useInputManager,
  type DeviceMode,
  type GamepadDirectionMap,
  type KeyboardMap,
  type LogicalDirection,
  type RawGamepadSnapshot,
} from "../hooks/useInputManager";
import {
  advanceBackdashMotion, analyzeTransition, calculateStats, createAnalyzerState,
  createBackdashMotionState, DIRECTION_SYMBOLS, FRAME_MS, inputMotionDelta,
  lateralDirection, lateralMotionForTransition, SIDEWALK_HOLD_MS,
  type AnalyzerState, type Attempt, type BackdashMotionState, type Direction,
  type InputTransition, type PlayerSide,
} from "../../lib/movement";

type PracticeMode = "free" | "kbd" | "wave" | "timed";
type DrillTarget = "wave" | "kbd";

interface TrainerSettings {
  side: PlayerSide;
  deviceMode: DeviceMode;
  deadzone: number;
  activeGamepadIndex: number | null;
  customMap: GamepadDirectionMap;
  keyboardMap: KeyboardMap;
}

const defaultSettings: TrainerSettings = {
  side: "P1",
  deviceMode: "automatic",
  deadzone: 0.25,
  activeGamepadIndex: null,
  customMap: {},
  keyboardMap: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" },
};

const STORAGE_SETTINGS = "execution-lab.settings.v1";
const STORAGE_HISTORY = "execution-lab.history.v2";
const calibrationSteps: LogicalDirection[] = ["left", "right", "down", "up"];
const TrainingStage = lazy(() => import("./TrainingStage"));

const modes: { id: PracticeMode; label: string; index: string; detail: string }[] = [
  { id: "free", label: "Free practice", index: "01", detail: "Analyze both movement systems" },
  { id: "kbd", label: "Korean backdash", index: "02", detail: "b,b → db → n → b,b" },
  { id: "wave", label: "Wavedash", index: "03", detail: "f · n · d · df · f · f" },
  { id: "timed", label: "Timed drill", index: "04", detail: "Valid reps against the clock" },
];

function formatMs(value: number) { return value ? `${value.toFixed(1)} ms` : "—"; }
function formatFrames(value: number) { return value ? `${(value / FRAME_MS).toFixed(1)}f` : "—"; }
function keyLabel(code: string) { return code.replace("Key", "").replace("Arrow", ""); }

function Segmented<T extends string>({ value, values, onChange, label }: {
  value: T;
  values: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {values.map((item) => (
        <button key={item.value} type="button" className={value === item.value ? "selected" : ""} onClick={() => onChange(item.value)}>{item.label}</button>
      ))}
    </div>
  );
}

function Modal({ title, eyebrow, onClose, children, wide = false }: {
  title: string; eyebrow: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={wide ? "modal wide" : "modal"} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={`Close ${title}`}><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

export default function MovementTrainer() {
  const [settings, setSettings] = useState<TrainerSettings>(defaultSettings);
  const [mode, setMode] = useState<PracticeMode>("free");
  const [cameraMode, setCameraMode] = useState<CameraMode>("3/4");
  const [transitions, setTransitions] = useState<InputTransition[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [feedback, setFeedback] = useState({ label: "READY", detail: "Perform a sequence to begin analysis.", valid: true });
  const [motion, setMotion] = useState<MotionSignal>({ nonce: 0, kind: "reset" });
  const [inputMotion, setInputMotion] = useState<InputMotionSignal>({
    nonce: 0,
    direction: "n",
    previousDirection: "n",
    heldMs: 0,
    travelDelta: 0,
    backdashPhase: "none",
    lateralPhase: "none",
    lateralDirection: 0,
    lateralTravelDelta: 0,
  });
  const [successPulse, setSuccessPulse] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testerOpen, setTesterOpen] = useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibrationStep, setCalibrationStep] = useState(0);
  const [calibrationDraft, setCalibrationDraft] = useState<GamepadDirectionMap>({});
  const [capturingKey, setCapturingKey] = useState<LogicalDirection | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [replayAttempt, setReplayAttempt] = useState<Attempt | null>(null);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [durationNow, setDurationNow] = useState(0);
  const [timedSeconds, setTimedSeconds] = useState(30);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [timerActive, setTimerActive] = useState(false);
  const [drillTarget, setDrillTarget] = useState<DrillTarget>("wave");
  const analyzerRef = useRef<AnalyzerState>(createAnalyzerState());
  const backdashMotionRef = useRef<BackdashMotionState>(createBackdashMotionState());
  const transitionRef = useRef<InputTransition[]>([]);
  const attemptRef = useRef<Attempt[]>([]);
  const modeRef = useRef(mode);
  const timerActiveRef = useRef(timerActive);
  const timerEndsAtRef = useRef(0);
  const calibrationBaseline = useRef<RawGamepadSnapshot>({ buttons: [], axes: [], timestamp: 0 });

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { timerActiveRef.current = timerActive; }, [timerActive]);

  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem(STORAGE_SETTINGS);
      const savedHistory = localStorage.getItem(STORAGE_HISTORY);
      localStorage.removeItem("execution-lab.history.v1");
      // Hydrate device-local preferences after mount to keep server HTML deterministic.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (savedSettings) setSettings({ ...defaultSettings, ...JSON.parse(savedSettings) });
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory) as Attempt[];
        setAttempts(parsed);
        attemptRef.current = parsed;
      }
    } catch { /* Ignore malformed local-only data and use safe defaults. */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
  }, [settings]);

  const recordAttempts = useCallback((newAttempts: Attempt[]) => {
    if (!newAttempts.length) return;
    if (modeRef.current === "timed" && !timerActiveRef.current) return;
    const newestFirst = [...newAttempts].reverse();
    const next = [...newestFirst, ...attemptRef.current].slice(0, 80);
    attemptRef.current = next;
    setAttempts(next);
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(next));
    const latest = newestFirst[0];
    setFeedback({
      label: latest.feedback,
      detail: latest.valid ? `${formatMs(latest.durationMs)} · ${formatFrames(latest.durationMs)}` : "Measured from the chronological browser input stream.",
      valid: latest.valid,
    });
    for (const item of newAttempts) {
      if (item.valid) {
        setMotion({ nonce: item.timestamp, kind: item.kind });
        setSuccessPulse((value) => value + 1);
      }
    }
  }, []);

  const onTransition = useCallback((transition: InputTransition) => {
    const backdashMotion = advanceBackdashMotion(backdashMotionRef.current, transition.direction, transition.timestamp);
    backdashMotionRef.current = backdashMotion.state;
    const lateralMotion = lateralMotionForTransition(
      transition.previousDirection,
      transition.direction,
      transition.durationMs,
    );
    const travelDelta = transition.direction === "b" || transition.direction === "db" || transition.direction === "n"
      ? backdashMotion.travelDelta
      : inputMotionDelta(transition.previousDirection, transition.direction);
    setInputMotion({
      nonce: transition.timestamp,
      direction: transition.direction,
      previousDirection: transition.previousDirection,
      heldMs: transition.durationMs,
      travelDelta,
      backdashPhase: backdashMotion.phase,
      lateralPhase: lateralMotion.phase,
      lateralDirection: lateralMotion.direction,
      lateralTravelDelta: lateralMotion.travelDelta,
    });
    const nextTransitions = [transition, ...transitionRef.current].slice(0, 120);
    transitionRef.current = nextTransitions;
    setTransitions(nextTransitions);
    const result = analyzeTransition(analyzerRef.current, transition.direction, transition.timestamp, transition.durationMs);
    analyzerRef.current = result.state;
    recordAttempts(result.attempts);

    if (backdashMotion.phase === "kbd-cancel") {
      setFeedback({ label: "RECOVERY CANCEL", detail: "Down-back compressed the dash recovery. Release to neutral, then restart with back, back.", valid: true });
    } else if (backdashMotion.phase === "raw-recovery" && transition.direction === "b") {
      setFeedback({ label: "FULL RECOVERY", detail: "This back input arrived before recovery was cancelled, so retreat is reduced.", valid: false });
    }
  }, [recordAttempts]);

  const input = useInputManager({
    ...settings,
    exposeRawValues: testerOpen || calibrationOpen,
    onTransition,
  });

  useEffect(() => {
    const lateral = lateralDirection(input.direction);
    if (!lateral) return;
    const timer = window.setTimeout(() => {
      setInputMotion((current) => {
        if (current.direction !== input.direction) return current;
        return {
          ...current,
          nonce: performance.now(),
          previousDirection: input.direction,
          heldMs: SIDEWALK_HOLD_MS,
          travelDelta: 0,
          backdashPhase: "none",
          lateralPhase: "sidewalk",
          lateralDirection: lateral,
          lateralTravelDelta: 0,
        };
      });
    }, SIDEWALK_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [input.direction]);

  useEffect(() => {
    const timer = window.setInterval(() => setDurationNow(Math.max(0, performance.now() - input.directionStartedAt)), 50);
    return () => window.clearInterval(timer);
  }, [input.directionStartedAt]);

  useEffect(() => {
    if (!timerActive) return;
    const timer = window.setInterval(() => {
      const next = Math.max(0, (timerEndsAtRef.current - performance.now()) / 1000);
      setTimeRemaining(next);
      if (next <= 0) {
        setTimerActive(false);
        setFeedback({ label: "DRILL COMPLETE", detail: "Review your valid repetitions and timing consistency below.", valid: true });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [timerActive]);

  useEffect(() => {
    if (!capturingKey) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setSettings((value) => ({ ...value, keyboardMap: { ...value.keyboardMap, [capturingKey]: event.code } }));
      setCapturingKey(null);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [capturingKey]);

  useEffect(() => {
    if (!calibrationOpen || calibrationStep >= calibrationSteps.length || !input.rawGamepad.timestamp) return;
    const binding = detectChangedBinding(calibrationBaseline.current, input.rawGamepad);
    calibrationBaseline.current = input.rawGamepad;
    if (!binding) return;
    const logical = calibrationSteps[calibrationStep];
    const nextDraft = { ...calibrationDraft, [logical]: binding };
    setCalibrationDraft(nextDraft);
    if (calibrationStep === calibrationSteps.length - 1) {
      setSettings((value) => ({ ...value, customMap: nextDraft }));
      setCalibrationStep(calibrationSteps.length);
    } else setCalibrationStep((value) => value + 1);
  }, [input.rawGamepad, calibrationOpen, calibrationStep, calibrationDraft]);

  useEffect(() => {
    if (!replayPlaying || !replayAttempt) return;
    const timer = window.setInterval(() => {
      setReplayIndex((value) => {
        if (value >= replayAttempt.sequence.length - 1) {
          setReplayPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, Math.max(40, 180 / replaySpeed));
    return () => window.clearInterval(timer);
  }, [replayPlaying, replayAttempt, replaySpeed]);

  const selectedKind: DrillTarget | "all" = mode === "kbd" ? "kbd" : mode === "wave" ? "wave" : mode === "timed" ? drillTarget : "all";
  const relevantAttempts = useMemo(() => selectedKind === "all" ? attempts : attempts.filter((item) => item.kind === selectedKind), [attempts, selectedKind]);
  const stats = useMemo(() => calculateStats(relevantAttempts), [relevantAttempts]);
  const displayedDirection = replayAttempt ? replayAttempt.sequence[replayIndex]?.direction ?? "n" : input.direction;
  const activeController = input.gamepads.find((item) => item.index === settings.activeGamepadIndex) ?? input.gamepads[0];

  const resetSession = () => {
    analyzerRef.current = createAnalyzerState();
    backdashMotionRef.current = createBackdashMotionState();
    transitionRef.current = [];
    attemptRef.current = [];
    setTransitions([]);
    setAttempts([]);
    setFeedback({ label: "READY", detail: "Session reset. Your device-local settings are unchanged.", valid: true });
    setMotion({ nonce: performance.now(), kind: "reset" });
    setInputMotion({
      nonce: performance.now(),
      direction: "n",
      previousDirection: "n",
      heldMs: 0,
      travelDelta: 0,
      backdashPhase: "none",
      lateralPhase: "none",
      lateralDirection: 0,
      lateralTravelDelta: 0,
    });
    localStorage.removeItem(STORAGE_HISTORY);
  };

  const startTimed = () => {
    timerEndsAtRef.current = performance.now() + timedSeconds * 1000;
    timerActiveRef.current = true;
    setTimeRemaining(timedSeconds);
    setTimerActive(true);
    analyzerRef.current = createAnalyzerState();
    backdashMotionRef.current = createBackdashMotionState();
    setFeedback({ label: "DRILL LIVE", detail: `${timedSeconds} seconds · ${drillTarget === "wave" ? "Wavedash" : "Korean backdash"}`, valid: true });
  };

  const beginCalibration = () => {
    setCalibrationDraft({});
    setCalibrationStep(0);
    calibrationBaseline.current = input.rawGamepad;
    setCalibrationOpen(true);
  };

  const openReplay = (item: Attempt) => {
    setReplayAttempt(item);
    setReplayIndex(0);
    setReplayPlaying(false);
    setHistoryOpen(false);
  };

  return (
    <main className="trainer-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">M/8</span>
          <div><p className="eyebrow">Tekken movement practice</p><h1>Movement Trainer</h1></div>
        </div>
        <div className="top-actions">
          <div className="system-status">
            {activeController && input.source === "gamepad" ? <Gamepad2 size={14} /> : <Keyboard size={14} />}
            <span className={activeController ? "status-dot" : "status-dot keyboard-dot"} />
            <span>{activeController && input.source === "gamepad" ? "Controller active" : "Keyboard active"}</span>
          </div>
          <span className="side-pill">{settings.side}</span>
          <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><Settings size={18} /></button>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="panel mode-panel">
          <div className="panel-heading"><span>01</span><p>Practice protocol</p></div>
          <nav aria-label="Practice modes">
            {modes.map((item) => (
              <button className={mode === item.id ? "mode active" : "mode"} key={item.id} type="button" onClick={() => { setMode(item.id); setTimerActive(false); }}>
                <span>{item.index}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div>
              </button>
            ))}
          </nav>

          {(mode === "kbd" || (mode === "timed" && drillTarget === "kbd")) && (
            <section className="technique-note" aria-label="How Korean backdash works">
              <p className="micro-label">Why down-back?</p>
              <strong>Cancel recovery. Restart sooner.</strong>
              <code>b,b → db → n → b,b</code>
              <p><b>b,b</b> starts the retreat. <b>db</b> compresses the late recovery, then <b>n</b> resets the stick for the next dash.</p>
              <small>Raw repeated back inputs keep full recovery, so the dummy retreats less efficiently.</small>
            </section>
          )}

          {mode === "timed" && (
            <div className="drill-config">
              <p className="micro-label">Movement target</p>
              <Segmented value={drillTarget} label="Drill movement" onChange={setDrillTarget} values={[{ value: "wave", label: "Wavedash" }, { value: "kbd", label: "KBD" }]} />
              <p className="micro-label">Duration</p>
              <Segmented value={String(timedSeconds) as "10" | "30" | "60"} label="Drill duration" onChange={(value) => { setTimedSeconds(Number(value)); setTimeRemaining(Number(value)); }} values={[{ value: "10", label: "10s" }, { value: "30", label: "30s" }, { value: "60", label: "60s" }]} />
              <button className="primary-button" type="button" onClick={startTimed}>{timerActive ? <Radio size={14} /> : <Play size={14} />}{timerActive ? `${timeRemaining.toFixed(1)}s` : "Start drill"}</button>
            </div>
          )}

          <button className="quiet-button" type="button" onClick={resetSession}><RotateCcw size={13} /> Reset session</button>
        </aside>

        <section className="arena-wrap" aria-label="3D movement visualization">
          <div className="arena-topline">
            <span>Movement view</span>
            <div className="camera-tabs">{(["SIDE", "3/4", "FOOTWORK"] as CameraMode[]).map((item) => <button key={item} className={cameraMode === item ? "active" : ""} type="button" onClick={() => setCameraMode(item)}>{item}</button>)}</div>
          </div>
          <div className="arena"><Suspense fallback={<div className="stage-loading">Preparing movement visualization...</div>}><TrainingStage direction={displayedDirection} side={settings.side} cameraMode={cameraMode} motion={motion} inputMotion={inputMotion} successPulse={successPulse} /></Suspense></div>
          <div className="current-input">
            <div className="notation-readout"><p className="eyebrow">Current input</p><strong>{displayedDirection}</strong><span>{DIRECTION_SYMBOLS[displayedDirection]}</span></div>
            <div className="direction-pad" aria-label={`Current direction ${displayedDirection}`}>
              {(["ub", "u", "uf", "b", "n", "f", "db", "d", "df"] as Direction[]).map((key) => (
                <span className={displayedDirection === key ? "lit" : ""} key={key}>{DIRECTION_SYMBOLS[key]}</span>
              ))}
            </div>
            <div className="input-meta"><span>{formatMs(durationNow)}</span><small>{Math.max(0, Math.round(durationNow / FRAME_MS))} training frames</small><em>{input.source}</em></div>
          </div>
        </section>

        <aside className="panel history-panel">
          <div className="panel-heading"><span>02</span><p>Input history</p><button className="mini-action" type="button" onClick={() => setHistoryOpen(true)}>Review</button></div>
          <div className="browser-observed"><span>Browser-observed input</span><strong>{input.rawObserved}</strong><small>Trainer resolved: {input.direction}</small></div>
          <div className="history-list" aria-live="polite">
            <div className="history-row current"><strong>{DIRECTION_SYMBOLS[input.direction]}</strong><span>{input.direction}</span><small>{Math.max(0, Math.round(durationNow / FRAME_MS))}f</small></div>
            {transitions.slice(0, 11).map((item, index) => (
              <div className="history-row" key={`${item.timestamp}-${index}`}><strong>{DIRECTION_SYMBOLS[item.previousDirection]}</strong><span>{item.previousDirection}</span><small>{item.durationFrames}f <em>{item.durationMs.toFixed(1)}ms</em></small></div>
            ))}
            {!transitions.length && <p className="empty-state">Press a direction to begin the chronological input stream.</p>}
          </div>
          <div className={feedback.valid ? "feedback-card valid" : "feedback-card error"}>
            <span>{feedback.valid ? "Analyzer feedback" : "Sequence error"}</span><strong>{feedback.label}</strong><p>{feedback.detail}</p>
          </div>
          <div className="attempt-summary" aria-label="Performance summary">
            <div><span>Attempts</span><strong>{stats.total}</strong><small>{stats.success} valid / {stats.failed} failed</small></div>
            <div><span>Accuracy</span><strong>{stats.total ? `${stats.accuracy.toFixed(1)}%` : "—"}</strong><small>valid / total</small></div>
          </div>
        </aside>
      </section>

      {settingsOpen && (
        <Modal title="Input settings" eyebrow="Device-local configuration" onClose={() => setSettingsOpen(false)} wide>
          <div className="settings-grid">
            <section className="settings-section"><div className="section-title"><SlidersHorizontal size={15} /><div><h3>Input source</h3><p>Choose which browser input stream is accepted.</p></div></div>
              <Segmented value={settings.deviceMode} label="Input source" onChange={(deviceMode) => setSettings((value) => ({ ...value, deviceMode }))} values={[{ value: "automatic", label: "Automatic" }, { value: "keyboard", label: "Keyboard" }, { value: "controller", label: "Controller" }]} />
              <label className="field-label">Active controller<select value={settings.activeGamepadIndex ?? activeController?.index ?? ""} onChange={(event) => setSettings((value) => ({ ...value, activeGamepadIndex: Number(event.target.value) }))}><option value="">Automatic</option>{input.gamepads.map((item) => <option key={item.index} value={item.index}>{item.id}</option>)}</select></label>
              {!input.gamepads.length && <p className="inline-warning">No Gamepad API controller is currently visible. Keyboard practice remains available.</p>}
            </section>
            <section className="settings-section"><div className="section-title"><Target size={15} /><div><h3>Player side</h3><p>Forward and back are normalized to the selected side.</p></div></div>
              <Segmented value={settings.side} label="Player side" onChange={(side) => setSettings((value) => ({ ...value, side }))} values={[{ value: "P1", label: "Player 1" }, { value: "P2", label: "Player 2" }]} />
              <label className="range-label"><span>Analog deadzone <strong>{settings.deadzone.toFixed(2)}</strong></span><input type="range" min="0.1" max="0.6" step="0.01" value={settings.deadzone} onChange={(event) => setSettings((value) => ({ ...value, deadzone: Number(event.target.value) }))} /></label>
            </section>
            <section className="settings-section"><div className="section-title"><Gamepad2 size={15} /><div><h3>Controller mapping</h3><p>{Object.keys(settings.customMap).length >= 4 ? "Custom mapping stored locally." : "Standard mapping with axes fallback."}</p></div></div>
              <div className="button-row"><button className="secondary-button" type="button" onClick={beginCalibration} disabled={!activeController}><Gauge size={14} /> Recalibrate</button><button className="secondary-button" type="button" onClick={() => setTesterOpen(true)}><Activity size={14} /> Input tester</button></div>
              {activeController && <dl className="device-facts"><div><dt>Status</dt><dd>Connected</dd></div><div><dt>Buttons</dt><dd>{activeController.buttons}</dd></div><div><dt>Axes</dt><dd>{activeController.axes}</dd></div><div><dt>Mapping</dt><dd>{activeController.mapping === "standard" ? "Standard" : "Custom / Unknown"}</dd></div><div><dt>Index</dt><dd>{activeController.index}</dd></div></dl>}
            </section>
            <section className="settings-section"><div className="section-title"><Keyboard size={15} /><div><h3>Keyboard bindings</h3><p>Press a binding, then press the replacement key.</p></div></div>
              <div className="key-grid">{calibrationSteps.map((logical) => <button className={capturingKey === logical ? "key-capture listening" : "key-capture"} type="button" key={logical} onClick={() => setCapturingKey(logical)}><span>{logical}</span><strong>{capturingKey === logical ? "Press key…" : keyLabel(settings.keyboardMap[logical])}</strong></button>)}</div>
              <button className="text-button" type="button" onClick={() => setSettings((value) => ({ ...value, keyboardMap: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" } }))}>Use arrow keys</button>
            </section>
          </div>
          <div className="safety-banner"><ShieldCheck size={18} /><div><strong>Controller-safe by design</strong><p>The site reads navigator.getGamepads() only. It never uses WebHID, WebUSB, vibration, output reports, firmware tools, or system-wide input emulation.</p></div></div>
        </Modal>
      )}

      {testerOpen && (
        <Modal title="Controller input tester" eyebrow="Raw Gamepad API values" onClose={() => setTesterOpen(false)} wide>
          <div className="tester-summary"><div><span>Detected logical direction</span><strong>{input.rawObserved}</strong></div><div><span>Tekken direction</span><strong>{input.direction}</strong></div></div>
          {activeController ? <div className="raw-tester"><section><h3>Buttons</h3><div className="raw-grid">{input.rawGamepad.buttons.map((value, index) => <div className={value > 0.5 ? "raw-item on" : "raw-item"} key={index}><span>Button {index}</span><strong>{value.toFixed(3)}</strong></div>)}</div></section><section><h3>Axes</h3><div className="raw-grid axes">{input.rawGamepad.axes.map((value, index) => <div className={Math.abs(value) > settings.deadzone ? "raw-item on" : "raw-item"} key={index}><span>Axis {index}</span><strong>{value.toFixed(3)}</strong></div>)}</div></section></div> : <div className="no-controller"><Gamepad2 size={28} /><h3>No browser-visible controller</h3><p>This controller is not currently exposed through your browser&apos;s Gamepad API. Try another supported controller mode or browser configuration.</p></div>}
          <p className="tester-footnote">Values shown here are browser observations. Hardware-level SOCD information may already have been resolved before reaching the browser.</p>
        </Modal>
      )}

      {calibrationOpen && (
        <Modal title="Universal calibration" eyebrow="Local direction mapping" onClose={() => setCalibrationOpen(false)}>
          {calibrationStep < calibrationSteps.length ? <div className="calibration"><div className="calibration-steps">{calibrationSteps.map((step, index) => <span className={index < calibrationStep ? "done" : index === calibrationStep ? "active" : ""} key={step}>{index < calibrationStep ? "✓" : index + 1}</span>)}</div><div className="calibration-prompt"><Radio size={22} /><p>Press and release</p><strong>{calibrationSteps[calibrationStep].toUpperCase()}</strong><small>Move only one direction. A changed button or axis will be stored in this browser.</small></div></div> : <div className="calibration-complete"><ShieldCheck size={32} /><h3>Mapping complete</h3><p>Four logical directions were detected and saved locally. Nothing was written to the controller.</p><button className="primary-button" type="button" onClick={() => setCalibrationOpen(false)}>Use mapping</button></div>}
        </Modal>
      )}

      {historyOpen && (
        <Modal title="Attempt history" eyebrow="Device-local session data" onClose={() => setHistoryOpen(false)} wide>
          <div className="attempt-table"><div className="attempt-row heading"><span>Result</span><span>Movement</span><span>Timing</span><span>Feedback</span><span /></div>{attempts.length ? attempts.map((item) => <div className="attempt-row" key={item.id}><span className={item.valid ? "result valid" : "result invalid"}>{item.valid ? "Valid" : "Failed"}</span><span>{item.kind === "wave" ? "Wavedash" : "Korean backdash"}</span><span>{formatFrames(item.durationMs)} · {formatMs(item.durationMs)}</span><span>{item.feedback}</span><button className="mini-action" type="button" onClick={() => openReplay(item)}><Eye size={13} /> Replay</button></div>) : <p className="empty-state roomy">Completed and failed movement attempts will appear here.</p>}</div>
        </Modal>
      )}

      {replayAttempt && (
        <Modal title="Attempt replay" eyebrow="Recorded website data only" onClose={() => setReplayAttempt(null)}>
          <div className="replay-visual"><div className="replay-direction"><span>{DIRECTION_SYMBOLS[displayedDirection]}</span><strong>{displayedDirection}</strong></div><div><p>{replayAttempt.feedback}</p><strong>{replayAttempt.kind === "wave" ? "WAVEDASH" : "KOREAN BACKDASH"}</strong><small>Step {replayIndex + 1} of {replayAttempt.sequence.length} · {replayAttempt.sequence[replayIndex]?.offsetMs.toFixed(1)} ms</small></div></div>
          <div className="replay-controls"><button className="icon-button" type="button" onClick={() => setReplayIndex((value) => Math.max(0, value - 1))} aria-label="Previous replay frame"><ChevronLeft size={17} /></button><button className="primary-button compact" type="button" onClick={() => setReplayPlaying((value) => !value)}>{replayPlaying ? <Pause size={15} /> : <Play size={15} />}{replayPlaying ? "Pause" : "Play"}</button><button className="icon-button" type="button" onClick={() => setReplayIndex((value) => Math.min(replayAttempt.sequence.length - 1, value + 1))} aria-label="Next replay frame"><ChevronRight size={17} /></button><Segmented value={String(replaySpeed) as "0.25" | "0.5" | "1"} label="Replay speed" onChange={(value) => setReplaySpeed(Number(value))} values={[{ value: "0.25", label: "0.25×" }, { value: "0.5", label: "0.5×" }, { value: "1", label: "1×" }]} /></div>
          <div className="replay-sequence">{replayAttempt.sequence.map((item, index) => <button type="button" className={index === replayIndex ? "active" : ""} key={`${item.direction}-${index}`} onClick={() => setReplayIndex(index)}><span>{DIRECTION_SYMBOLS[item.direction]}</span><strong>{item.direction}</strong><small>{item.offsetMs.toFixed(0)}ms</small></button>)}</div>
          <p className="tester-footnote">Replay animates recorded website data inside this page. It never replays inputs into Windows, another application, Tekken, or a controller.</p>
        </Modal>
      )}
    </main>
  );
}
