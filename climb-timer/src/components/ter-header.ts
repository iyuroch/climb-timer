import { LitElement, html, css } from "lit";

export class TerHeader extends LitElement {
  static styles = css`
    header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      background: #0d142a;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 18px;
    }
    code {
      background: var(--chip-bg, #0b1020);
      border: 1px solid var(--chip-border, #223055);
      border-radius: 5px;
      padding: 1px 5px;
      font-size: 12px;
      color: #cfe2ff;
    }
    summary {
      cursor: pointer;
      color: #cfe2ff;
      font-size: 13px;
      font-weight: 600;
      padding: 6px 12px;
      border: 1px solid #2a5580;
      background: #16223f;
      border-radius: 999px;
      width: fit-content;
      list-style: none;
      user-select: none;
      white-space: nowrap;
    }
    summary:hover {
      border-color: #6b8cff;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    summary::before {
      content: "? ";
      font-weight: 700;
      color: #9fccff;
    }
    details[open] summary::before {
      content: "× ";
    }
    .help {
      margin-top: 10px;
      display: grid;
      gap: 10px;
      font-size: 12.5px;
      color: var(--text);
    }
    .help h2 {
      margin: 0 0 4px;
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .rows {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
      align-items: baseline;
    }
    .rows .desc {
      color: var(--muted);
    }
  `;
  render() {
    return html`
      <header>
        <h1>Climb Timer</h1>
        <details>
          <summary>Syntax &amp; examples</summary>
          <div class="help">
            <div>
              <h2>Grammar</h2>
              <div class="rows">
                <code>10</code
                ><span class="desc">wait 10 seconds (s is the default)</span>
                <code>10s</code><span class="desc">wait 10 seconds</span>
                <code>10m</code><span class="desc">wait 10 minutes</span>
                <code>a + b</code><span class="desc">do a, then b</span>
                <code>p</code
                ><span class="desc">pause until you tap Proceed</span>
                <code>N*(…)</code><span class="desc">repeat the group N times</span>
                <code>(…)</code
                ><span class="desc"
                  >group — must follow <code>+</code> or <code>*</code></span
                >
              </div>
            </div>
            <div>
              <h2>Examples</h2>
              <div class="rows">
                <code>10+5+10</code
                ><span class="desc">10s, then 5s, then 10s</span>
                <code>4*(3+1+p)</code
                ><span class="desc">4 rounds of: 3s, 1s, wait for tap</span>
                <code>1m+(5+11+p)</code
                ><span class="desc">1 min, then 5s, 11s, wait for tap</span>
              </div>
            </div>
            <div>
              <h2>While running</h2>
              <div class="rows">
                <code>Pause</code
                ><span class="desc">freeze the countdown; Resume continues</span>
                <code>Proceed</code
                ><span class="desc">advance past a <code>p</code> signal</span>
                <code>Cancel</code><span class="desc">stop and reset</span>
                <code>♪</code
                ><span class="desc">beeps in the last 2s of each wait</span>
              </div>
            </div>
          </div>
        </details>
      </header>
    `;
  }
}
customElements.define("ter-header", TerHeader);
