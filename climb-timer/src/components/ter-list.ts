import { LitElement, html, css } from "lit";

export interface SavedExpr {
  id: string;
  name: string;
  expr: string;
}

export type ExprState = {
  running: boolean;
  remaining: number | string;
  totalDur: number;
  error: string;
  tokens: Token[];
};

export type Token = {
  kind: "num" | "txt" | "sig";
  key: string;
  text: string;
  flash?: boolean;
  /** Reserved width (in ch) for number tokens so the digits never reflow. */
  minCh?: number;
};

export class TerList extends LitElement {
  static properties = {
    items: { type: Array },
    runningId: { type: String },
    states: { type: Object },
    paused: { type: Boolean },
    awaitingSignal: { type: Boolean },
    onRunExpr: { type: Function },
    onStopExpr: { type: Function },
    onSignalExpr: { type: Function },
    onPauseExpr: { type: Function },
    onResumeExpr: { type: Function },
    onExpandExpr: { type: Function },
  } as const;
  declare items: SavedExpr[];
  declare runningId: string | null;
  declare states: Record<string, ExprState>;
  declare paused: boolean;
  declare awaitingSignal: boolean;
  declare onRunExpr: (id: string) => void;
  declare onStopExpr: () => void;
  declare onSignalExpr: () => void;
  declare onPauseExpr: () => void;
  declare onResumeExpr: () => void;
  declare onExpandExpr: (id: string) => void;

  private inlineEditId: string | null = null;
  private inlineValue = "";
  private inlineField: "name" | "expr" = "expr";

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .list {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-bottom: 80px;
    }
    .card {
      background: var(--panel, #131a2b);
      border: 1px solid var(--border, #1f2942);
      border-radius: 14px;
      padding: 14px;
      transition: border-color 0.2s;
    }
    .card.running {
      border-color: #3ddc84;
      box-shadow: 0 0 20px rgba(61, 220, 132, 0.15);
    }
    .card.editing {
      border-color: #6b8cff;
    }
    .card-top {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .card-info {
      flex: 1;
      min-width: 0;
    }
    .name {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 6px;
    }
    .expr-text {
      font-size: 18px;
      color: #cfe2ff;
      font-family:
        ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      cursor: pointer;
      padding: 4px 8px;
      background: #0b1020;
      border: 1px solid #223055;
      border-radius: 8px;
      display: inline-block;
      letter-spacing: 1px;
    }
    .expr-text:hover {
      border-color: #6b8cff;
      background: #111a30;
    }
    .expr-text.running {
      cursor: default;
      color: #6bffac;
      border-color: #2f7d52;
      background: #0c1f15;
      letter-spacing: 0;
      font-variant-numeric: tabular-nums;
    }
    .expr-text.running:hover {
      border-color: #2f7d52;
      background: #0c1f15;
    }
    .expr-text.running .rn {
      display: inline-block;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .expr-text.running .rt {
      white-space: pre;
    }
    .expr-input {
      font-size: 18px;
      padding: 4px 8px;
      border-radius: 8px;
      border: 1px solid #6b8cff;
      background: #0b1020;
      color: #cfe2ff;
      font-family:
        ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: 1px;
      box-sizing: border-box;
      outline: none;
      width: 100%;
    }
    .dur {
      font-size: 14px;
      font-weight: 600;
      color: #cfe2ff;
      font-family:
        ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      white-space: nowrap;
      padding-top: 2px;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    button {
      padding: 8px 14px;
      border-radius: 10px;
      border: 1px solid #26356a;
      background: #1a2652;
      color: #dbe3ff;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    button:active {
      filter: brightness(1.15);
    }
    button.primary {
      background: #1f3d5c;
      border-color: #2a5580;
      color: #9fccff;
    }
    button.danger {
      background: #5b2030;
      border-color: #7a2c40;
    }
    button.signal {
      background: #2a3d1a;
      border-color: #3a5a2a;
      color: #9fffb0;
    }
    button.expand {
      margin-left: auto;
      padding: 8px 12px;
      font-size: 16px;
      line-height: 1;
    }
    .expr-timer {
      margin-top: 8px;
      font-size: 13px;
      color: #b5c4ff;
    }
    .error {
      margin-top: 6px;
      font-size: 12px;
      color: #ff9aa2;
    }
    .fab {
      position: fixed;
      bottom: 28px;
      right: 28px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #6b8cff;
      color: #fff;
      border: none;
      font-size: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 6px 24px rgba(107, 140, 255, 0.35);
      z-index: 50;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .fab:active {
      transform: scale(0.94);
    }
  `;

  private onDelete(id: string, e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("delete-expr", {
        detail: id,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private startInlineEdit(
    id: string,
    field: "name" | "expr",
    value: string,
    e: Event,
  ) {
    e.stopPropagation();
    this.inlineEditId = id;
    this.inlineField = field;
    this.inlineValue = value;
    this.requestUpdate();
    requestAnimationFrame(() => {
      const sel =
        field === "name"
          ? `[data-name-input="${id}"]`
          : `[data-expr-input="${id}"]`;
      const input = this.shadowRoot?.querySelector(
        sel,
      ) as HTMLInputElement | null;
      input?.focus();
      input?.select();
    });
  }

  private commitInlineEdit(id: string) {
    this.inlineEditId = null;
    const eventName =
      this.inlineField === "name" ? "name-change" : "expr-change";
    this.dispatchEvent(
      new CustomEvent(eventName, {
        detail: { id, [this.inlineField]: this.inlineValue },
        bubbles: true,
        composed: true,
      }),
    );
    this.requestUpdate();
  }

  private cancelInlineEdit() {
    this.inlineEditId = null;
    this.requestUpdate();
  }

  private onInlineKeydown(id: string, e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      this.commitInlineEdit(id);
    } else if (e.key === "Escape") {
      this.cancelInlineEdit();
    }
  }

  private onFab() {
    this.dispatchEvent(
      new CustomEvent("add-expr", { bubbles: true, composed: true }),
    );
  }

  render() {
    const items = this.items ?? [];

    return html`
      <div class="list">
        ${items.length === 0
          ? html`<div
              style="text-align:center;color:var(--muted);padding:40px 0;font-size:14px"
            >
              No expressions yet.<br />Tap + to create one.
            </div>`
          : items.map((item) => {
              const running = this.runningId === item.id;
              const dur =
                this.states[item.id]?.totalDur != null
                  ? `${this.states[item.id].totalDur}s`
                  : "--";
              const rem =
                this.states[item.id]?.remaining != null &&
                typeof this.states[item.id].remaining === "number"
                  ? `${this.states[item.id].remaining}s`
                  : dur;

              return html`
                <div class="card ${running ? "running" : ""}">
                  <div class="card-top">
                    <div class="card-info">
                      ${this.inlineEditId === item.id &&
                      this.inlineField === "name"
                        ? html`<input
                            class="expr-input"
                            style="font-weight:700;font-size:16px;font-family:system-ui,-apple-system,sans-serif"
                            data-name-input=${item.id}
                            .value=${this.inlineValue}
                            @input=${(e: Event) =>
                              (this.inlineValue = (
                                e.target as HTMLInputElement
                              ).value)}
                            @keydown=${(e: KeyboardEvent) =>
                              this.onInlineKeydown(item.id, e)}
                            @blur=${() => this.commitInlineEdit(item.id)}
                          />`
                        : html`<div
                            class="name"
                            style="cursor:pointer"
                            @click=${(e: Event) =>
                              this.startInlineEdit(
                                item.id,
                                "name",
                                item.name,
                                e,
                              )}
                          >
                            ${item.name}
                          </div>`}
                      ${running
                        ? html`<div class="expr-text running">
                            ${(this.states[item.id]?.tokens ?? []).map((t) =>
                              t.kind === "num"
                                ? html`<span
                                    class="rn"
                                    style=${t.minCh
                                      ? `min-width:${t.minCh}ch`
                                      : ""}
                                    >${t.text}</span
                                  >`
                                : html`<span class="rt">${t.text}</span>`,
                            )}
                          </div>`
                        : this.inlineEditId === item.id &&
                            this.inlineField === "expr"
                          ? html`<input
                              class="expr-input"
                              data-expr-input=${item.id}
                              .value=${this.inlineValue}
                              @input=${(e: Event) =>
                                (this.inlineValue = (
                                  e.target as HTMLInputElement
                                ).value)}
                              @keydown=${(e: KeyboardEvent) =>
                                this.onInlineKeydown(item.id, e)}
                              @blur=${() => this.commitInlineEdit(item.id)}
                            />`
                          : html`<div
                              class="expr-text"
                              @click=${(e: Event) =>
                                this.startInlineEdit(
                                  item.id,
                                  "expr",
                                  item.expr,
                                  e,
                                )}
                            >
                              ${item.expr}
                            </div>`}
                    </div>
                    <span class="dur">${running ? rem : dur}</span>
                  </div>
                  ${this.states[item.id]?.error
                    ? html`<div class="error">
                        ${this.states[item.id].error}
                      </div>`
                    : ""}
                  ${running
                    ? html`
                        <div class="actions">
                          ${this.awaitingSignal
                            ? html`<button
                                class="signal"
                                @click=${(e: Event) => {
                                  e.stopPropagation();
                                  this.onSignalExpr?.();
                                }}
                              >
                                Proceed
                              </button>`
                            : this.paused
                              ? html`<button
                                  class="signal"
                                  @click=${(e: Event) => {
                                    e.stopPropagation();
                                    this.onResumeExpr?.();
                                  }}
                                >
                                  Resume
                                </button>`
                              : html`<button
                                  class="primary"
                                  @click=${(e: Event) => {
                                    e.stopPropagation();
                                    this.onPauseExpr?.();
                                  }}
                                >
                                  Pause
                                </button>`}
                          <button
                            class="danger"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              this.onStopExpr?.();
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            class="expand"
                            title="Full screen"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              this.onExpandExpr?.(item.id);
                            }}
                          >
                            ⤢
                          </button>
                        </div>
                      `
                    : html`
                        <div class="actions">
                          <button
                            class="primary"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              this.onRunExpr?.(item.id);
                            }}
                          >
                            Run
                          </button>
                          <button
                            class="expand"
                            title="Full screen"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              this.onExpandExpr?.(item.id);
                            }}
                          >
                            ⤢
                          </button>
                          <button
                            class="danger"
                            @click=${(e: Event) => this.onDelete(item.id, e)}
                          >
                            Delete
                          </button>
                        </div>
                      `}
                </div>
              `;
            })}
        ${items.length > 0
          ? html`<div
              style="text-align:center;padding:8px;font-size:12px;color:var(--muted)"
            >
              ${items.length} expression${items.length !== 1 ? "s" : ""}
            </div>`
          : ""}
      </div>
      <button class="fab" @click=${this.onFab} title="Add expression">+</button>
    `;
  }
}
customElements.define("ter-list", TerList);
