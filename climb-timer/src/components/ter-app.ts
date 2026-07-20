import { LitElement, html, css } from "lit";
import {
  Beeper,
  Evaluator,
  Parser,
  SignalManager,
  Status,
  Ticker,
  type ASTNode,
  type WaitNode,
  remainingDuration,
  staticDuration,
  formatWait,
} from "../lib/engine.ts";

import "./ter-list.ts";
import type { SavedExpr, Token, ExprState } from "./ter-list.ts";

const LS_KEY = "ter-expressions";

// Max width (in ch) a running wait will ever need: "<seconds>.0".
// The integer part only shrinks as it counts down, so the start value is widest.
function waitWidthCh(seconds: number): number {
  return String(seconds).length + 2;
}

function uid(): string {
  return (
    crypto.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

// Build a short looping silent WAV. Playing it keeps the page/audio session
// alive in the background and lets the Media Session show on the lock screen.
function silentWavUrl(seconds = 1): string {
  const rate = 8000;
  const n = rate * seconds;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true); // byte rate
  v.setUint16(32, 1, true); // block align
  v.setUint16(34, 8, true); // bits/sample
  str(36, "data");
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128); // 8-bit silence
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

function defaultExprs(): SavedExpr[] {
  return [
    { id: uid(), name: "Warm-up", expr: "4*(3+1+p)+15" },
    { id: uid(), name: "Quick set", expr: "10+5+10" },
  ];
}

function loadExprs(): SavedExpr[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0)
        return parsed as SavedExpr[];
    }
  } catch {
    /* ignore corrupt data */
  }
  return defaultExprs();
}

function saveExprs(items: SavedExpr[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

export class TerApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .hint {
      text-align: center;
      font-size: 12px;
      color: var(--muted);
      padding: 8px;
    }

    /* ===== Full-screen expanded stage ===== */
    .stage {
      position: fixed;
      inset: 0;
      z-index: 100;
      background: var(--bg, #0b1020);
      display: flex;
      flex-direction: column;
      padding: max(16px, env(safe-area-inset-top)) 16px
        max(16px, env(safe-area-inset-bottom));
      box-sizing: border-box;
    }
    .stage-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .stage-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .stage-close {
      flex: none;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      border: 1px solid var(--border, #1f2942);
      background: var(--panel, #131a2b);
      color: var(--text, #e7ecff);
      font-size: 20px;
      cursor: pointer;
    }
    .stage-tree {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-bottom: 8px;
    }
    .stage-error {
      color: #ff9aa2;
      font-size: 14px;
    }
    .sseq {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .snode {
      border: 1px solid var(--border, #1f2942);
      background: var(--panel, #131a2b);
      border-radius: 14px;
      padding: 16px;
      transition:
        border-color 0.2s,
        opacity 0.2s;
    }
    .snode.running {
      border-color: #3ddc84;
      box-shadow: 0 0 18px rgba(61, 220, 132, 0.15);
    }
    .snode.done {
      opacity: 0.4;
    }
    .swait {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: clamp(40px, 14vw, 96px);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      font-family:
        ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: var(--text, #e7ecff);
    }
    .snode.running .swait {
      color: #6bffac;
    }
    .ssig {
      text-align: center;
      font-size: 18px;
      font-weight: 600;
      color: var(--muted);
      padding: 6px;
    }
    .snode.running.ssig-node {
      border-color: #3ddc84;
      background: #14241a;
      cursor: pointer;
      padding: 22px;
    }
    .snode.running .ssig {
      color: #6bffac;
      font-size: clamp(24px, 7vw, 40px);
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      animation: sigpulse 1.1s ease-in-out infinite;
    }
    .ssig-hint {
      display: block;
      margin-top: 6px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.3px;
      color: #8fd6a8;
      text-transform: none;
      animation: none;
    }
    @keyframes sigpulse {
      0%,
      100% {
        transform: scale(1);
        opacity: 1;
      }
      50% {
        transform: scale(1.05);
        opacity: 0.7;
      }
    }
    .srepeat {
      border-left: 4px solid #6b8cff;
    }
    .snode.running.srepeat {
      border-left-color: #3ddc84;
    }
    .srepeat-head {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      font-weight: 700;
      color: #9fb8ff;
      margin-bottom: 14px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }
    .rep-round {
      margin-left: auto;
      font-size: 20px;
      font-weight: 800;
      padding: 4px 14px;
      border-radius: 999px;
      background: #23315c;
      border: 1px solid #6b8cff;
      color: #cfe2ff;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0;
    }
    .snode.running .rep-round {
      background: #1f7a47;
      border-color: #3ddc84;
      color: #eafff2;
    }
    .srepeat-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .stage-controls {
      display: flex;
      gap: 10px;
      padding-top: 12px;
    }
    .stage-controls button {
      flex: 1;
      padding: 16px;
      border-radius: 12px;
      border: 1px solid #26356a;
      background: #1a2652;
      color: #dbe3ff;
      font-weight: 700;
      font-size: 16px;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .stage-controls button:active {
      filter: brightness(1.15);
    }
    .stage-controls button.primary {
      background: #1f3d5c;
      border-color: #2a5580;
      color: #9fccff;
    }
    .stage-controls button.signal {
      background: #2a3d1a;
      border-color: #3a5a2a;
      color: #9fffb0;
    }
    .stage-controls button.danger {
      background: #5b2030;
      border-color: #7a2c40;
    }
  `;

  private exprs: SavedExpr[] = loadExprs();
  private runningId: string | null = null;
  private ast: ASTNode | null = null;
  private abortCtrl: AbortController | null = null;
  private evaluator: Evaluator | null = null;
  private paused = false;
  private awaitingSignal = false;
  private expandedId: string | null = null;
  private wakeLock: any = null;
  private keepAudio: HTMLAudioElement | null = null;
  private signalMgr = new SignalManager();
  private beeper = new Beeper();
  private ticker = new Ticker(
    () => this.runningId !== null,
    () => {
      this.rebuildTokens();
      this.updateRemaining();
      this.syncStateToCache();
      this.requestUpdate();
    },
  );
  private tokens: Token[] = [];
  private remaining: number | string = "--";
  private totalDur = 0;
  private errorMsg = "";

  private exprStates: Record<string, ExprState> = {};

  // Stable callback references
  private handleRun = (id: string) => this.run(id);
  private handleStop = () => this.stop();
  private handleSignal = () => this.signal();
  private handlePause = () => this.pause();
  private handleResume = () => this.resume();
  private handleExpand = (id: string) => this.expand(id);
  private handleCollapse = () => this.collapse();

  // Re-acquire the wake lock when returning to the tab (it auto-releases when hidden).
  private onVisibility = () => {
    if (document.visibilityState === "visible" && this.runningId) {
      this.acquireWakeLock();
      this.beeper.unlock();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.onVisibility);
    const states: Record<string, ExprState> = {};
    for (const e of this.exprs) {
      states[e.id] = this.computeState(e);
    }
    this.exprStates = states;
    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.releaseWakeLock();
  }

  private async acquireWakeLock() {
    try {
      const nav = navigator as any;
      if (nav.wakeLock && !this.wakeLock) {
        this.wakeLock = await nav.wakeLock.request("screen");
        this.wakeLock.addEventListener?.("release", () => {
          this.wakeLock = null;
        });
      }
    } catch {
      /* unsupported or denied — ignore */
    }
  }

  private releaseWakeLock() {
    try {
      this.wakeLock?.release();
    } catch {
      /* ignore */
    }
    this.wakeLock = null;
  }

  // ---- background / lock-screen keep-alive ----

  private startKeepAlive() {
    try {
      if (!this.keepAudio) {
        this.keepAudio = new Audio(silentWavUrl(1));
        this.keepAudio.loop = true;
      }
      this.keepAudio.play().catch(() => {});
    } catch {
      /* ignore */
    }
    // Play the AudioContext's live output stream. This keeps the AudioContext
    // active on iOS lock screen because iOS honours <audio> element playback.
    this.beeper.liveAudio?.play().catch(() => {});
    this.beeper.startSilence();
    this.setupMediaSession();
    this.updateMediaSession();
  }

  private stopKeepAlive() {
    try {
      this.keepAudio?.pause();
      if (this.keepAudio) this.keepAudio.currentTime = 0;
    } catch {
      /* ignore */
    }
    this.beeper.liveAudio?.pause();
    this.beeper.stopSilence();
    this.clearMediaSession();
  }

  private setupMediaSession() {
    const ms = (navigator as any).mediaSession;
    if (!ms) return;
    const set = (action: string, fn: (() => void) | null) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* unsupported action */
      }
    };
    set("play", () => this.resume());
    set("pause", () => this.pause());
    set("stop", () => this.stop());
    // Restart the current timer from the beginning.
    set("previoustrack", () => {
      if (this.runningId) this.run(this.runningId);
    });
    // Advance past a Proceed (signal) step.
    set("nexttrack", () => this.signal());
    // Explicitly disable seek controls so iOS shows ⏮ play/pause ⏭ only.
    set("seekbackward", null);
    set("seekforward", null);
  }

  private updateMediaSession() {
    const ms = (navigator as any).mediaSession;
    if (!ms) return;
    const name =
      this.exprs.find((e) => e.id === this.runningId)?.name ?? "Climb Timer";
    const remNum = typeof this.remaining === "number" ? this.remaining : 0;
    const status = this.paused
      ? "Paused"
      : this.awaitingSignal
        ? "Tap Proceed ▶"
        : `${remNum}s left`;
    try {
      if ((window as any).MediaMetadata) {
        const iconUrl = new URL("icon.svg", location.href).href;
        ms.metadata = new (window as any).MediaMetadata({
          title: name,
          artist: status,
          album: "Climb Timer",
          artwork: [{ src: iconUrl, type: "image/svg+xml" }],
        });
      }
      ms.playbackState = this.paused ? "paused" : "playing";
      if (this.totalDur > 0 && ms.setPositionState) {
        ms.setPositionState({
          duration: this.totalDur,
          position: Math.min(this.totalDur, Math.max(0, this.totalDur - remNum)),
          playbackRate: this.paused ? 0 : 1,
        });
      }
    } catch {
      /* ignore */
    }
  }

  private clearMediaSession() {
    const ms = (navigator as any).mediaSession;
    if (!ms) return;
    for (const action of ["play","pause","stop","previoustrack","nexttrack","seekbackward","seekforward"]) {
      try { ms.setActionHandler(action, null); } catch { /* unsupported */ }
    }
    try {
      ms.playbackState = "none";
      ms.metadata = null;
    } catch {
      /* ignore */
    }
  }

  private computeState(e: SavedExpr): ExprState {
    let totalDur = 0;
    let tokens: Token[] = [];
    let error = "";
    try {
      const p = new Parser(e.expr);
      const ast = p.parse();
      totalDur = staticDuration(ast);
      tokens = this.buildTokensFromAst(ast);
    } catch (err: any) {
      error = err.message;
    }
    return { running: false, remaining: totalDur, totalDur, error, tokens };
  }

  private buildTokensFromAst(ast: ASTNode): Token[] {
    const toks: Token[] = [];
    const addNum = (key: string, text: string, minCh?: number) =>
      toks.push({ kind: "num", key, text, flash: false, minCh });
    const addTxt = (key: string, text: string) =>
      toks.push({ kind: "txt", key, text, flash: false });
    const addSig = (key: string, text: string) =>
      toks.push({ kind: "sig", key, text, flash: false });
    const rec = (n: ASTNode) => {
      if (!n) return;
      if (n.type === "wait") {
        addNum("w-" + n.id, String(n.seconds), waitWidthCh(n.seconds));
      } else if (n.type === "signal") {
        addSig("s-" + n.id, "p");
      } else if (n.type === "sequence") {
        n.children.forEach((ch, i) => {
          rec(ch);
          if (i < n.children.length - 1) addTxt("p-" + n.id + "-" + i, " + ");
        });
      } else if (n.type === "repeat") {
        addNum("r-" + n.id, String(n.times), String(n.times).length);
        addTxt("mul-" + n.id, "*");
        addTxt("lp-" + n.id, "(");
        rec(n.body);
        addTxt("rp-" + n.id, ")");
      }
    };
    rec(ast);
    return toks;
  }

  private refreshState(id: string) {
    this.exprStates = {
      ...this.exprStates,
      [id]: {
        ...this.exprStates[id],
        totalDur: this.totalDur,
        remaining: this.remaining,
        error: this.errorMsg,
        tokens: this.tokens,
      },
    };
  }

  // ---- list management ----

  private updateExpr(id: string, expr: string) {
    this.exprs = this.exprs.map((e) => (e.id === id ? { ...e, expr } : e));
    saveExprs(this.exprs);
    const found = this.exprs.find((e) => e.id === id);
    if (found) {
      this.exprStates = {
        ...this.exprStates,
        [id]: this.computeState(found),
      };
    }
    this.requestUpdate();
  }

  private updateName(id: string, name: string) {
    this.exprs = this.exprs.map((e) =>
      e.id === id ? { ...e, name: name || "Untitled" } : e,
    );
    saveExprs(this.exprs);
    this.requestUpdate();
  }

  private addExpr() {
    const id = uid();
    const newExpr: SavedExpr = { id, name: "New", expr: "10" };
    this.exprs = [...this.exprs, newExpr];
    this.exprStates = { ...this.exprStates, [id]: this.computeState(newExpr) };
    saveExprs(this.exprs);
    this.requestUpdate();
  }

  private deleteExpr(id: string) {
    this.stop();
    this.exprs = this.exprs.filter((e) => e.id !== id);
    const { [id]: _, ...rest } = this.exprStates;
    this.exprStates = rest;
    saveExprs(this.exprs);
    if (this.runningId === id) this.runningId = null;
    this.requestUpdate();
  }

  // ---- engine ----

  private unlockAudio() {
    this.beeper.unlock();
    // Set up MediaStream routing so AudioContext stays alive behind the lock screen.
    this.beeper.startLiveOutput();
  }

  private parse(expr: string) {
    try {
      const p = new Parser(expr);
      this.ast = p.parse();
      this.errorMsg = "";
      this.totalDur = staticDuration(this.ast);
      this.seedTiming(this.ast);
      this.rebuildTokens();
      this.updateRemaining();
    } catch (e: any) {
      this.errorMsg = "Parse error: " + e.message;
      this.totalDur = 0;
    }
  }

  private run(id: string) {
    const found = this.exprs.find((e) => e.id === id);
    if (!found) return;
    this.stop();
    // Fresh instance each run so stale wait() callbacks from a previous
    // aborted run can never be resolved by the new run's trigger().
    this.signalMgr = new SignalManager();
    this.unlockAudio();
    this.parse(found.expr);
    if (!this.ast) {
      this.requestUpdate();
      return;
    }
    this.runningId = id;
    this.paused = false;
    this.awaitingSignal = false;
    this.acquireWakeLock();
    this.startKeepAlive();
    this.refreshState(id);

    // rAF-driven countdown display: synced to the browser's repaint so the
    // per-wait numbers animate smoothly via formatWait's interpolation.
    this.ticker.start();

    this.abortCtrl = new AbortController();
    const ev = new Evaluator(this.ast, this.signalMgr);
    this.evaluator = ev;
    const onUpdate = (changed: ASTNode) => {
      if ((changed as any).type === "wait") {
        const w = changed as WaitNode;
        w._lastUpdate = performance.now();
        w._lastElapsed = w.elapsed;
        this.beepIfNeeded(w);
      }
      this.awaitingSignal =
        (changed as any).type === "signal" &&
        changed.status === Status.Running;
      this.rebuildTokens(changed);
      this.updateRemaining();
      this.updateMediaSession();
      this.refreshState(id);
      this.requestUpdate();
    };
    this.requestUpdate();
    ev.run(this.abortCtrl.signal, onUpdate)
      .finally(() => {
        this.ticker.stop();
        this.releaseWakeLock();
        this.stopKeepAlive();
        this.evaluator = null;
        this.paused = false;
        this.awaitingSignal = false;
        this.refreshState(id);
        this.runningId = null;
        this.requestUpdate();
      })
      .catch((e: Error) => {
        if (e.message !== "aborted") this.errorMsg = "Error: " + e.message;
        this.refreshState(id);
        this.requestUpdate();
      });
  }

  private stop() {
    if (this.abortCtrl) {
      this.abortCtrl.abort();
      this.abortCtrl = null;
    }
    this.evaluator = null;
    this.paused = false;
    this.awaitingSignal = false;
    this.ticker.stop();
    this.releaseWakeLock();
    this.stopKeepAlive();
    if (this.runningId) {
      this.refreshState(this.runningId);
      this.runningId = null;
    }
    this.requestUpdate();
  }

  private expand(id: string) {
    this.expandedId = id;
    this.requestUpdate();
  }

  private collapse() {
    this.expandedId = null;
    this.requestUpdate();
  }

  private safeParse(expr: string): ASTNode | null {
    try {
      return new Parser(expr).parse();
    } catch {
      return null;
    }
  }

  private currentWait(): WaitNode | null {
    let found: WaitNode | null = null;
    const visit = (n: ASTNode) => {
      if (found || !n) return;
      if (n.type === "wait") {
        if (n.status === Status.Running) found = n;
      } else if (n.type === "sequence") n.children.forEach(visit);
      else if (n.type === "repeat") visit(n.body);
    };
    if (this.ast) visit(this.ast);
    return found;
  }

  private pause() {
    if (!this.evaluator || this.paused) return;
    // Freeze the active wait's display at its current fractional value.
    const w = this.currentWait();
    if (w) {
      const base = w._lastElapsed ?? w.elapsed;
      const dt = Math.max(0, (performance.now() - (w._lastUpdate ?? 0)) / 1000);
      w._lastElapsed = base + dt;
      w._paused = true;
    }
    this.evaluator.pause();
    this.paused = true;
    this.updateMediaSession();
    this.requestUpdate();
  }

  private resume() {
    if (!this.evaluator || !this.paused) return;
    const w = this.currentWait();
    if (w) {
      // Continue interpolating from the frozen fractional value.
      w._lastUpdate = performance.now();
      w._paused = false;
    }
    this.evaluator.resume();
    this.paused = false;
    this.updateMediaSession();
    this.requestUpdate();
  }

  private signal() {
    this.unlockAudio();
    this.signalMgr.trigger();
    this.updateMediaSession();
  }

  private seedTiming(n: ASTNode) {
    const visit = (node: ASTNode) => {
      if (node.type === "wait") {
        (node as WaitNode)._lastElapsed = node.elapsed;
        (node as WaitNode)._lastUpdate = performance.now();
        (node as WaitNode)._beepElapsedMark = node.elapsed;
      } else if (node.type === "sequence") node.children.forEach(visit);
      else if (node.type === "repeat") visit(node.body);
    };
    visit(n);
  }

  private waitRemaining(n: WaitNode) {
    let r = n.seconds - n.elapsed;
    if (n.status === Status.Done) r = 0;
    return r < 0 ? 0 : r;
  }

  private rebuildTokens(changed?: ASTNode) {
    const toks: Token[] = [];
    const flash = new Set<string>();
    const addNum = (key: string, text: string, minCh?: number) =>
      toks.push({ kind: "num", key, text, flash: false, minCh });
    const addTxt = (key: string, text: string) =>
      toks.push({ kind: "txt", key, text, flash: false });
    const addSig = (key: string, text: string) =>
      toks.push({ kind: "sig", key, text, flash: false });
    const rec = (n: ASTNode) => {
      if (!n) return;
      if (n.type === "wait") {
        const key = "w-" + n.id;
        addNum(key, formatWait(n as WaitNode), waitWidthCh(n.seconds));
        if (changed && changed === n) flash.add(key);
      } else if (n.type === "signal") {
        const key = "s-" + n.id;
        addSig(key, "p");
        if (changed && changed === n) flash.add(key);
      } else if (n.type === "sequence") {
        n.children.forEach((ch, i) => {
          rec(ch);
          if (i < n.children.length - 1)
            addTxt("plus-" + n.id + "-" + i, " + ");
        });
      } else if (n.type === "repeat") {
        const key = "r-" + n.id;
        const remaining =
          n.status === Status.Done ? 0 : Math.max(n.times - n.iteration, 0);
        addNum(key, String(remaining), String(n.times).length);
        addTxt("mul-" + n.id, "*");
        addTxt("lp-" + n.id, "(");
        rec(n.body);
        addTxt("rp-" + n.id, ")");
        if (changed && changed === n) flash.add(key);
      }
    };
    if (this.ast) rec(this.ast);
    toks.forEach((t) => {
      if (flash.has(t.key)) {
        t.flash = true;
        setTimeout(() => {
          t.flash = false;
          this.tokens = [...toks];
          this.syncStateToCache();
          this.requestUpdate();
        }, 60);
      }
    });
    this.tokens = toks;
  }

  private updateRemaining() {
    this.remaining = this.ast ? remainingDuration(this.ast) : "--";
  }

  private syncStateToCache() {
    if (this.runningId) {
      this.exprStates = {
        ...this.exprStates,
        [this.runningId]: {
          ...this.exprStates[this.runningId],
          remaining: this.remaining,
          error: this.errorMsg,
          tokens: this.tokens,
        },
      };
    }
  }

  private beepIfNeeded(n: WaitNode) {
    if (!this.beeper || !this.beeper.ctx) return;
    if (n._beepElapsedMark === undefined) n._beepElapsedMark = n.elapsed;
    if (n.elapsed === n._beepElapsedMark) return;
    n._beepElapsedMark = n.elapsed;
    const rem = this.waitRemaining(n);
    if (rem === 2 || rem === 1)
      this.beeper.beep({ freq: 880, duration: 0.09, gain: 0.15, type: "sine" });
    else if (rem === 0)
      this.beeper.beep({
        freq: 1320,
        duration: 0.2,
        gain: 0.25,
        type: "square",
      });
  }

  private statusClass(n: ASTNode): string {
    if (n.status === Status.Running) return "running";
    if (n.status === Status.Done) return "done";
    return "pending";
  }

  // Recursively render the AST as nested vertical boxes for the full-screen stage.
  private renderStageNode(n: ASTNode): unknown {
    if (!n) return "";
    if (n.type === "wait") {
      return html`<div class="snode swait-node ${this.statusClass(n)}">
        <div class="swait">${formatWait(n as WaitNode)}</div>
      </div>`;
    }
    if (n.type === "signal") {
      const running = n.status === Status.Running;
      return html`<div
        class="snode ssig-node ${this.statusClass(n)}"
        @click=${running ? this.handleSignal : null}
      >
        <div class="ssig">
          ${running
            ? html`👉 Tap to proceed
                <span class="ssig-hint">waiting for you</span>`
            : "proceed"}
        </div>
      </div>`;
    }
    if (n.type === "sequence") {
      return html`<div class="sseq">
        ${n.children.map((ch) => this.renderStageNode(ch))}
      </div>`;
    }
    // repeat (loop)
    const round = Math.min(n.iteration + 1, n.times);
    return html`<div class="snode srepeat ${this.statusClass(n)}">
      <div class="srepeat-head">
        <span class="rep-icon">↻</span>
        ${n.status === Status.Running
          ? html`<span class="rep-round">round ${round}/${n.times}</span>`
          : ""}
      </div>
      <div class="srepeat-body">${this.renderStageNode(n.body)}</div>
    </div>`;
  }

  private renderStage() {
    if (!this.expandedId) return "";
    const expr = this.exprs.find((e) => e.id === this.expandedId);
    if (!expr) return "";
    const isRunning = this.expandedId === this.runningId;
    const ast = isRunning ? this.ast : this.safeParse(expr.expr);

    return html`
      <div class="stage">
        <div class="stage-head">
          <div class="stage-title">${expr.name}</div>
          <button
            class="stage-close"
            title="Collapse"
            @click=${this.handleCollapse}
          >
            ×
          </button>
        </div>
        <div class="stage-tree">
          ${ast
            ? this.renderStageNode(ast)
            : html`<div class="stage-error">
                ${"Parse error: " + expr.expr}
              </div>`}
        </div>
        <div class="stage-controls">
          ${isRunning
            ? html`
                ${this.awaitingSignal
                  ? html`<button class="signal" @click=${this.handleSignal}>
                      Proceed
                    </button>`
                  : this.paused
                    ? html`<button class="signal" @click=${this.handleResume}>
                        Resume
                      </button>`
                    : html`<button class="primary" @click=${this.handlePause}>
                        Pause
                      </button>`}
                <button class="danger" @click=${this.handleStop}>Cancel</button>
              `
            : html`<button
                class="primary"
                ?disabled=${!ast}
                @click=${() => this.run(this.expandedId!)}
              >
                Run
              </button>`}
        </div>
      </div>
    `;
  }

  render() {
    return html`
      ${this.renderStage()}
      <span class="hint">Tap any button once to allow audio.</span>
      <ter-list
        .items=${this.exprs}
        .runningId=${this.runningId}
        .states=${this.exprStates}
        .paused=${this.paused}
        .awaitingSignal=${this.awaitingSignal}
        .onRunExpr=${this.handleRun}
        .onStopExpr=${this.handleStop}
        .onSignalExpr=${this.handleSignal}
        .onPauseExpr=${this.handlePause}
        .onResumeExpr=${this.handleResume}
        .onExpandExpr=${this.handleExpand}
        @expr-change=${(e: CustomEvent) => {
          this.updateExpr(e.detail.id, e.detail.expr);
        }}
        @name-change=${(e: CustomEvent) => {
          this.updateName(e.detail.id, e.detail.name);
        }}
        @delete-expr=${(e: CustomEvent) => {
          this.deleteExpr(e.detail);
        }}
        @add-expr=${() => {
          this.addExpr();
        }}
      ></ter-list>
    `;
  }
}
customElements.define("ter-app", TerApp);
