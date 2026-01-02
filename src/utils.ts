import type { Diagram, Grid, Id, LinkGroup, StickerRef, StickerColor } from "./types";
export function uid(): Id {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function idx(w: number, r: number, c: number) {
  return r * w + c;
}

export function stickerKey(s: StickerRef) {
  return `${s.gridId}:${s.r}:${s.c}`;
}

export function gridStickerCenterPx(gridEl: HTMLElement, stickerEl: HTMLElement) {
  const g = gridEl.getBoundingClientRect();
  const s = stickerEl.getBoundingClientRect();
  return {
    x: (s.left + s.right) / 2 - g.left,
    y: (s.top + s.bottom) / 2 - g.top
  };
}

export function findLinkGroupForSticker(diagram: Diagram, ref: StickerRef): LinkGroup | undefined {
  const key = stickerKey(ref);
  return diagram.links.find(lg => lg.stickers.some(s => stickerKey(s) === key));
}

export function allSelectableGroups(diagram: Diagram): { id: Id; label: string; members: StickerRef[] }[] {
  // groups are link groups + implied singleton stickers not in any link group
  const groups: { id: Id; label: string; members: StickerRef[] }[] = [];

  for (const lg of diagram.links) {
    groups.push({ id: lg.id, label: `🔗 ${lg.name}`, members: lg.stickers });
  }

  const linked = new Set<string>();
  for (const lg of diagram.links) for (const s of lg.stickers) linked.add(stickerKey(s));

  for (const g of diagram.grids) {
    for (let r = 0; r < g.h; r++) {
      for (let c = 0; c < g.w; c++) {
        const ref = { gridId: g.id, r, c };
        const k = stickerKey(ref);
        if (linked.has(k)) continue;
        // singleton pseudo-group id stable-ish
        const id = `single:${k}`;
        groups.push({ id, label: `▫️ ${g.name}[${r},${c}]`, members: [ref] });
      }
    }
  }

  return groups;
}

export function isSingletonGroupId(id: Id) {
  return id.startsWith("single:");
}

// Ensure a move references valid group IDs in current diagram
export function normalizeMoves(diagram: Diagram, moves: { fromGroupId: Id; toGroupId: Id }[]) {
  const groups = allSelectableGroups(diagram);
  const ids = new Set(groups.map(g => g.id));
  return moves.filter(m => ids.has(m.fromGroupId) && ids.has(m.toGroupId));
}

export function validateClosedLoop(moves: { fromGroupId: Id; toGroupId: Id }[]) {
  // Each moved group: outdegree <=1 and indegree <=1 (we enforce in editor)
  // Closed loop requirement for combination: if a group has out, it must have in; and vice-versa.
  const out = new Map<Id, Id>();
  const inn = new Map<Id, Id>();
  for (const m of moves) {
    out.set(m.fromGroupId, m.toGroupId);
    inn.set(m.toGroupId, m.fromGroupId);
  }
  const moved = new Set<Id>([...out.keys(), ...inn.keys()]);
  const missingIn: Id[] = [];
  const missingOut: Id[] = [];
  for (const g of moved) {
    if (!inn.has(g)) missingIn.push(g);
    if (!out.has(g)) missingOut.push(g);
  }
  return { ok: missingIn.length === 0 && missingOut.length === 0, missingIn, missingOut };
}

export function composePermutations(
  // permutation maps group -> group (must be bijection on moved set)
  a: Map<Id, Id>,
  b: Map<Id, Id>
) {
  // return a∘b: first apply b, then a
  const r = new Map<Id, Id>();
  const keys = new Set<Id>([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const bk = b.get(k) ?? k;
    const ak = a.get(bk) ?? bk;
    if (ak !== k) r.set(k, ak);
  }
  return r;
}

export function movesToPermutation(moves: { fromGroupId: Id; toGroupId: Id }[]) {
  const p = new Map<Id, Id>();
  for (const m of moves) p.set(m.fromGroupId, m.toGroupId);
  return p;
}

export function permutationToMoves(p: Map<Id, Id>) {
  const moves: { fromGroupId: Id; toGroupId: Id }[] = [];
  for (const [k, v] of p.entries()) moves.push({ fromGroupId: k, toGroupId: v });
  return moves;
}

export function applyPermutationPower(p: Map<Id, Id>, times: number) {
  // fast exponentiation
  let result = new Map<Id, Id>(); // identity
  let base = new Map(p);
  let n = times;

  while (n > 0) {
    if (n & 1) result = composePermutations(base, result);
    n >>= 1;
    if (n > 0) base = composePermutations(base, base);
  }
  return result;
}

export function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export function defaultGrid(name: string, w: number, h: number, x: number, y: number): Grid {
  const stickers = Array.from({ length: w * h }, () => "gray");
  return { id: uid(), name, w, h, x, y, stickers };
}

export function defaultDiagram(): Diagram {
  return {
    id: uid(),
    name: "New Diagram",
    grids: [
      defaultGrid("U", 3, 3, 40, 40),
      defaultGrid("F", 3, 3, 220, 170)
    ],
    links: []
  };
}
