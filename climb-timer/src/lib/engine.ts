// ===== Types & Enums =====
export enum Status {
  Pending = "pending",
  Running = "running",
  Done = "done",
}
export enum TT {
  EOF,
  NUM,
  PLUS,
  MUL,
  LP,
  RP,
  SIG,
}

export type WaitNode = {
  id: number;
  type: "wait";
  status: Status;
  seconds: number;
  elapsed: number;
  _lastUpdate: number;
  _lastElapsed: number;
  _beepElapsedMark: number;
  _paused?: boolean;
};
export type SignalNode = { id: number; type: "signal"; status: Status };
export type SequenceNode = {
  id: number;
  type: "sequence";
  status: Status;
  currentIndex: number;
  children: ASTNode[];
};
export type RepeatNode = {
  id: number;
  type: "repeat";
  status: Status;
  times: number;
  iteration: number;
  body: ASTNode;
};
export type ASTNode = WaitNode | SignalNode | SequenceNode | RepeatNode;

// ===== Signal manager =====
export class SignalManager {
  private queue: Array<() => void> = [];
  wait() {
    return new Promise<void>((res) => this.queue.push(res));
  }
  trigger() {
    const r = this.queue.shift();
    if (r) r();
  }
}

// ===== Beeper =====
export class Beeper {
  ctx: AudioContext | null = null;
  muted = false;
  // Routing AudioContext output through a MediaStream → <audio> element keeps
  // the context alive on iOS even when the screen is locked. iOS suspends
  // AudioContext in background but honours HTMLAudioElement playback.
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  liveAudio: HTMLAudioElement | null = null;
  private silenceNode: AudioBufferSourceNode | null = null;

  private get dest(): AudioNode {
    return (this.streamDest ?? this.ctx?.destination) as AudioNode;
  }

  unlock() {
    try {
      if (!this.ctx)
        this.ctx = new (
          window.AudioContext || (window as any).webkitAudioContext
        )();
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch (_) {
      /* no-op */
    }
  }

  // Call once during a user gesture after unlock(). Routes all AudioContext
  // audio through a MediaStream so iOS keeps it alive behind the lock screen.
  startLiveOutput() {
    if (!this.ctx || this.streamDest) return;
    try {
      this.streamDest = this.ctx.createMediaStreamDestination();
      this.liveAudio = new Audio();
      this.liveAudio.srcObject = this.streamDest.stream;
    } catch (_) {
      /* createMediaStreamDestination not supported — fall back to ctx.destination */
    }
  }

  startSilence() {
    if (!this.ctx || this.silenceNode) return;
    try {
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.dest);
      src.start();
      this.silenceNode = src;
    } catch (_) {
      /* no-op */
    }
  }

  stopSilence() {
    try { this.silenceNode?.stop(); } catch (_) { /* no-op */ }
    this.silenceNode = null;
  }

  beep({
    freq = 880,
    duration = 0.09,
    gain = 0.06,
    type = "sine",
  }: {
    freq?: number;
    duration?: number;
    gain?: number;
    type?: OscillatorType;
  } = {}) {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx;
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(1e-4, ctx.currentTime + duration);
    osc.connect(g).connect(this.dest);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.01);
  }
}

// ===== Lexer / Parser (supports 's') =====
class Lexer {
  constructor(
    private s: string,
    private i = 0,
  ) {}
  private peek() {
    return this.i < this.s.length ? this.s[this.i] : "\0";
  }
  private next() {
    return this.i < this.s.length ? this.s[this.i++] : "\0";
  }
  private skipWS() {
    while (/\s/.test(this.peek())) this.next();
  }
  private number(first: string) {
    let out = first;
    while (/\d/.test(this.peek())) out += this.next();
    return out;
  }
  nextToken() {
    this.skipWS();
    const c = this.next();
    if (c === "\0") return { t: TT.EOF };
    if (c === "+") return { t: TT.PLUS, lit: "+" };
    if (c === "*") return { t: TT.MUL, lit: "*" };
    if (c === "(") return { t: TT.LP, lit: "(" };
    if (c === ")") return { t: TT.RP, lit: ")" };
    if (c === "p" || c === "P") return { t: TT.SIG, lit: "p" };
    if (/\d/.test(c)) {
      const lit = this.number(c);
      const u = this.peek();
      // optional unit: 'm' = minutes, 's' = seconds (the default).
      if (u === "m" || u === "M") {
        this.next();
        return { t: TT.NUM, lit, unit: "m" };
      }
      if (u === "s" || u === "S") {
        this.next();
        return { t: TT.NUM, lit, unit: "s" };
      }
      return { t: TT.NUM, lit };
    }
    throw new Error(`Unexpected char ${JSON.stringify(c)}`);
  }
}

export class Parser {
  private l: Lexer;
  private cur: any;
  private peekTok: any;
  private nextId = 1;
  constructor(input: string) {
    this.l = new Lexer(input);
    this.cur = this.l.nextToken();
    this.peekTok = this.l.nextToken();
  }
  private adv() {
    this.cur = this.peekTok;
    this.peekTok = this.l.nextToken();
  }
  private id() {
    return this.nextId++;
  }
  parse(): ASTNode {
    const n = this.expr();
    if (this.cur.t !== TT.EOF) {
      if (this.cur.t === TT.RP)
        throw new Error("Unmatched ')' — remove it or add a matching '('");
      throw new Error(`Unexpected '${this.cur.lit ?? ""}' after expression`);
    }
    return n;
  }
  private expr(): ASTNode {
    const parts: ASTNode[] = [this.term()];
    while (this.cur.t === TT.PLUS) {
      this.adv();
      parts.push(this.term());
    }
    if (parts.length === 1) return parts[0];
    return {
      id: this.id(),
      type: "sequence",
      status: Status.Pending,
      currentIndex: 0,
      children: parts,
    };
  }
  // Parse "(expr)", consuming both parentheses.
  private group(): ASTNode {
    this.adv(); // consume '('
    const inner = this.expr();
    if (this.cur.t !== TT.RP)
      throw new Error("Unclosed '(' — add a matching ')'");
    this.adv(); // consume ')'
    return inner;
  }
  private term(): ASTNode {
    if (this.cur.t === TT.NUM) {
      const num = parseInt(this.cur.lit, 10);
      const unit: string | undefined = this.cur.unit;
      this.adv();
      // A '(' directly after a number is no longer an implicit repeat:
      // require an explicit operator, e.g. 4*(...).
      if (this.cur.t === TT.LP)
        throw new Error(`Missing '+' or '*' before '(' — write ${num}*(…)`);
      if (this.cur.t === TT.MUL) {
        if (unit)
          throw new Error("A repeat count can't have a unit — write 4*(…)");
        this.adv();
        // 4*(expr) or 4*term
        const body = this.cur.t === TT.LP ? this.group() : this.term();
        return {
          id: this.id(),
          type: "repeat",
          status: Status.Pending,
          times: num,
          iteration: 0,
          body,
        };
      }
      return {
        id: this.id(),
        type: "wait",
        status: Status.Pending,
        seconds: unit === "m" ? num * 60 : num,
        elapsed: 0,
        _lastUpdate: performance.now(),
        _lastElapsed: 0,
        _beepElapsedMark: 0,
      };
    }
    // A group after '+' (or at the start), e.g. 10+(5+11+p).
    if (this.cur.t === TT.LP) return this.group();
    if (this.cur.t === TT.SIG) {
      this.adv();
      return { id: this.id(), type: "signal", status: Status.Pending };
    }
    if (this.cur.t === TT.RP)
      throw new Error("Unexpected ')' — no matching '(' was opened");
    if (this.cur.t === TT.PLUS || this.cur.t === TT.MUL)
      throw new Error(
        `Unexpected '${this.cur.lit}' — expected a number, 's', or '('`,
      );
    throw new Error("Unexpected end of input — expected a number, 's', or '('");
  }
}

// ===== Evaluator =====
export class Evaluator {
  private paused = false;
  // Active pausable sleeps, so pause()/resume() can freeze/re-arm them.
  private activeSleeps = new Set<{ pause(): void; resume(): void }>();
  constructor(
    public ast: ASTNode,
    private signalMgr: SignalManager,
  ) {}
  get isPaused() {
    return this.paused;
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.activeSleeps.forEach((s) => s.pause());
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.activeSleeps.forEach((s) => s.resume());
  }
  reset(node: ASTNode = this.ast) {
    if (!node) return;
    if (node.type === "wait") {
      node.status = Status.Pending;
      node.elapsed = 0;
    } else if (node.type === "sequence") {
      node.status = Status.Pending;
      node.currentIndex = 0;
      node.children.forEach((ch) => this.reset(ch));
    } else if (node.type === "repeat") {
      node.status = Status.Pending;
      node.iteration = 0;
      this.reset(node.body);
    } else if (node.type === "signal") {
      node.status = Status.Pending;
    }
  }
  async run(
    signal: AbortSignal | undefined,
    onUpdate: (changed: ASTNode) => void,
  ) {
    // Pausable sleep: pause() freezes the remaining time, resume() re-arms it.
    const sleep = (ms: number) =>
      new Promise<void>((res, rej) => {
        if (signal?.aborted) return rej(new Error("aborted"));
        let remaining = ms;
        let startedAt = performance.now();
        let id: ReturnType<typeof setTimeout> | null = null;
        const ctrl = {
          pause() {
            if (id != null) {
              clearTimeout(id);
              id = null;
              remaining -= performance.now() - startedAt;
            }
          },
          resume() {
            startedAt = performance.now();
            id = setTimeout(done, Math.max(0, remaining));
          },
        };
        const cleanup = () => {
          if (id != null) clearTimeout(id);
          this.activeSleeps.delete(ctrl);
          signal?.removeEventListener("abort", onAbort);
        };
        const done = () => {
          cleanup();
          res();
        };
        const onAbort = () => {
          cleanup();
          rej(new Error("aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        this.activeSleeps.add(ctrl);
        // If already paused, stay armed-but-frozen until resume().
        if (!this.paused) {
          startedAt = performance.now();
          id = setTimeout(done, remaining);
        }
      });
    const exec = async (node: ASTNode): Promise<void> => {
      if (signal?.aborted) throw new Error("aborted");
      if (node.type === "wait") {
        node.status = Status.Running;
        onUpdate(node);
        while (node.elapsed < node.seconds) {
          await sleep(1000);
          node.elapsed++;
          onUpdate(node);
          if (signal?.aborted) throw new Error("aborted");
        }
        node.status = Status.Done;
        onUpdate(node);
      } else if (node.type === "signal") {
        node.status = Status.Running;
        onUpdate(node);
        await this.signalMgr.wait();
        if (signal?.aborted) throw new Error("aborted");
        node.status = Status.Done;
        onUpdate(node);
      } else if (node.type === "sequence") {
        node.status = Status.Running;
        onUpdate(node);
        for (let i = node.currentIndex; i < node.children.length; i++) {
          node.currentIndex = i;
          onUpdate(node);
          await exec(node.children[i]);
          if (signal?.aborted) throw new Error("aborted");
        }
        node.status = Status.Done;
        onUpdate(node);
      } else if (node.type === "repeat") {
        node.status = Status.Running;
        onUpdate(node);
        for (let i = node.iteration; i < node.times; i++) {
          node.iteration = i;
          onUpdate(node);
          this.reset(node.body);
          await exec(node.body);
          if (signal?.aborted) throw new Error("aborted");
        }
        node.status = Status.Done;
        onUpdate(node);
      }
    };
    await exec(this.ast);
  }
}

// ===== Ticker =====
export class Ticker {
  private rafId: number | null = null;
  private checkFn: () => boolean;
  private tickFn: () => void;

  constructor(checkFn: () => boolean, tickFn: () => void) {
    this.checkFn = checkFn;
    this.tickFn = tickFn;
  }

  start() {
    this.stop();
    if (!this.checkFn()) return;
    const step = () => {
      if (this.checkFn()) {
        this.tickFn();
        this.rafId = requestAnimationFrame(step);
      } else {
        this.rafId = null;
      }
    };
    this.rafId = requestAnimationFrame(step);
  }

  stop() {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

// ===== Helpers used by renderer/app =====
export function staticDuration(node: ASTNode | undefined): number {
  if (!node) return 0;
  if (node.type === "wait") return node.seconds;
  if (node.type === "signal") return 0;
  if (node.type === "sequence")
    return node.children.reduce((a, c) => a + staticDuration(c), 0);
  if (node.type === "repeat") return node.times * staticDuration(node.body);
  return 0;
}
export function remainingDuration(node: ASTNode | undefined): number {
  if (!node) return 0;
  if (node.type === "wait") {
    let rem = node.seconds - node.elapsed;
    if (node.status === Status.Done) rem = 0;
    return Math.max(0, rem);
  }
  if (node.type === "signal") return 0;
  if (node.type === "sequence") {
    if (node.status === Status.Done) return 0;
    let total = 0;
    for (let i = 0; i < node.children.length; i++) {
      const ch = node.children[i];
      if (i < node.currentIndex) continue;
      if (i === node.currentIndex) total += remainingDuration(ch);
      else total += staticDuration(ch);
    }
    return total;
  }
  if (node.type === "repeat") {
    if (node.status === Status.Done) return 0;
    const bodyDur = staticDuration(node.body);
    const bodyRem = remainingDuration(node.body);
    const remainingIters = Math.max(node.times - node.iteration - 1, 0);
    return bodyRem + remainingIters * bodyDur;
  }
  return 0;
}
export function formatWait(n: WaitNode) {
  if (n.status === Status.Running) {
    const base = n._lastElapsed ?? n.elapsed;
    // While paused, _lastElapsed holds the frozen fractional elapsed.
    if (n._paused) return Math.max(0, n.seconds - base).toFixed(1);
    const last = n._lastUpdate ?? performance.now();
    const dt = Math.max(0, (performance.now() - last) / 1000);
    const rem = Math.max(0, n.seconds - (base + dt));
    return rem.toFixed(1);
  }
  const remaining = Math.max(0, n.seconds - n.elapsed);
  // Always keep one decimal so the token width stays fixed (no reflow
  // when a wait reaches 0 or hasn't started yet).
  return remaining.toFixed(1);
}
