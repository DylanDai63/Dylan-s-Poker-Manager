// 13×13 preflop matrix HTML — shared by the range reference view, the
// trainer's "show range" panel and the deal-range picker. Default output is
// identical to the original inline renderer in app.js; options add an
// optional highlighted cell, a selection (unselected cells get "off") and,
// for the picker, a data-hand attribute on every cell.

import { handAt, cellAction } from "./ranges.js";

export function rangeGridHTML(scenario, position, { highlight = null, selected = null, selectable = false } = {}) {
  const cells = [];
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const hand = handAt(r, c);
      const { r: pr, c: pc } = cellAction(r, c, scenario, position);
      const pf = Math.max(0, 1 - pr - pc);
      const bars = [
        pr > 0 ? `<div class="bar-r" style="flex-grow:${pr}"></div>` : "",
        pc > 0 ? `<div class="bar-c" style="flex-grow:${pc}"></div>` : "",
        pf > 0 ? `<div class="bar-f" style="flex-grow:${pf}"></div>` : "",
      ].join("");
      let cls = "range-cell";
      if (hand === highlight) cls += " hl";
      if (selected && !selected.has(hand)) cls += " off";
      const attr = selectable ? ` data-hand="${hand}"` : "";
      cells.push(`<div class="${cls}"${attr}><div class="bars">${bars}</div><span class="label">${hand}</span></div>`);
    }
  }
  return cells.join("");
}
