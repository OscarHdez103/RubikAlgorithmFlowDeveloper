import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Algorithm, Diagram, Id, StickerColor, StickerRef, StoreData } from "./types";
import { COLOR_HEX } from "./types";
import { exportJson, importJson, loadStore, saveStore } from "./storage";
import {
  allSelectableGroups,
  applyPermutationPower,
  clamp,
  composePermutations,
  computeMoveLoops,
  defaultDiagram,
  defaultLoopColor,
  deepClone,
  findLinkGroupForSticker,
  hslToHex,
  idx,
  movesToPermutation,
  normalizeMoves,
  permutationToMoves,
  uid,
  validateClosedLoop
} from "./utils";

type Mode = "editDiagram" | "editAlgorithm" | "combine";
type Tool = "paint" | "link";

/**
 * Combine (composition) UI item.
 * - algoId: which algorithm is used at this step (can be "" while choosing)
 * - powText: numeric text input that can be "" while editing
 * - invert: reverse (inverse permutation)
 * - remap: instance-only group-id remap (move/flip) for this step
 * - showRemap: toggle remap UI
 */
type CombineItem = {
  // Base
  algoId: Id | "";
  powText: string;
  invert: boolean;

  // Remap
  remap: Record<string, Id | "">; // oldGroupId -> newGroupId
  showRemap: boolean;

  // Collapse step UI
  collapsed: boolean;

  // Translate (conjugation wrapper)
  translateOn: boolean;
  translateAlgoId: Id | "";
  translatePowText: string;
  translateInvert: boolean;

  // Mirror (second conjugation wrapper, lower priority)
  mirrorOn: boolean;
  mirrorAlgoId: Id | "";
  mirrorPowText: string;
  mirrorInvert: boolean;
};

function invertPermutation(p: Map<Id, Id>) {
  const inv = new Map<Id, Id>();
  for (const [k, v] of p.entries()) inv.set(v, k);
  return inv;
}

function remapPermutation(p: Map<Id, Id>, remap: Record<string, Id | "">) {
  const out = new Map<Id, Id>();
  for (const [k, v] of p.entries()) {
    const nk = remap[k] && remap[k] !== "" ? (remap[k] as Id) : k;
    const nv = remap[v] && remap[v] !== "" ? (remap[v] as Id) : v;
    out.set(nk, nv);
  }
  return out;
}

export function App() {
  const [store, setStore] = useState<StoreData>(() => loadStore());
  const [mode, setMode] = useState<Mode>("editDiagram");
  const [tool, setTool] = useState<Tool>("paint");
  // Configuration menu (sidebar) collapse — gives more room to the diagram on small screens.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [selectedDiagramId, setSelectedDiagramId] = useState<Id>(() => store.ui.lastDiagramId ?? store.diagrams[0].id);
  const selectedDiagram = useMemo(
    () => store.diagrams.find(d => d.id === selectedDiagramId) ?? store.diagrams[0],
    [store.diagrams, selectedDiagramId]
  );

  const diagramAlgos = useMemo(
    () => store.algorithms.filter(a => a.diagramId === selectedDiagram.id),
    [store.algorithms, selectedDiagram.id]
  );

  const [selectedAlgoId, setSelectedAlgoId] = useState<Id | undefined>(() => diagramAlgos[0]?.id);
  const selectedAlgo = useMemo(
    () => store.algorithms.find(a => a.id === selectedAlgoId),
    [store.algorithms, selectedAlgoId]
  );

  const [paintColor, setPaintColor] = useState<StickerColor>("yellow");

  // Linking: select multiple stickers then "Create link group"
  const [pendingLinkStickers, setPendingLinkStickers] = useState<StickerRef[]>([]);
  const [pendingLinkName, setPendingLinkName] = useState("Edge");

  // Algorithm click-to-add arrows
  const [moveFrom, setMoveFrom] = useState<Id | "">("");
  const [moveFromSticker, setMoveFromSticker] = useState<StickerRef | null>(null);

  // Combine (new UI)
  const [combineItems, setCombineItems] = useState<CombineItem[]>([]);
  const [combineName, setCombineName] = useState("Combined");
  // Per-loop color overrides for the live combine preview (carried over into the saved algorithm).
  const [combineLoopColors, setCombineLoopColors] = useState<Record<string, string>>({});

  // Remap picking state (click stickers instead of dropdowns)
  const [remapPick, setRemapPick] = useState<{ stepIndex: number; oldId: Id } | null>(null);

  const [highlightMoveIndex, setHighlightMoveIndex] = useState<number | null>(null);
  // Which loop (by its stable key) is currently being "shown" via the Loops list. Mutually
  // exclusive with highlightMoveIndex — turning one on turns the other off.
  const [highlightLoopKey, setHighlightLoopKey] = useState<string | null>(null);

  function toggleHighlightMove(i: number) {
    setHighlightMoveIndex(prev => (prev === i ? null : i));
    setHighlightLoopKey(null);
  }

  function toggleHighlightLoop(key: string) {
    setHighlightLoopKey(prev => (prev === key ? null : key));
    setHighlightMoveIndex(null);
  }

  // Persist
  useEffect(() => {
    setStore(prev => {
      const next = deepClone(prev);
      next.ui.lastDiagramId = selectedDiagramId;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDiagramId]);

  useEffect(() => {
    saveStore(store);
  }, [store]);

  // Keep selected algo valid when diagram changes
  useEffect(() => {
    const algos = store.algorithms.filter(a => a.diagramId === selectedDiagram.id);
    if (!algos.length) setSelectedAlgoId(undefined);
    else if (!selectedAlgoId || !algos.some(a => a.id === selectedAlgoId)) setSelectedAlgoId(algos[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.algorithms, selectedDiagram.id]);

  const groups = useMemo(() => allSelectableGroups(selectedDiagram), [selectedDiagram]);

  const combinePreview = useMemo(() => {
    function getAlgoOrFail(id: Id | "", step: number, label: string) {
      if (!id) return { ok: false as const, algo: null as any, error: `Step ${step}: ${label} algorithm not selected.` };
      const algo = store.algorithms.find(a => a.id === id);
      if (!algo) return { ok: false as const, algo: null as any, error: `Step ${step}: ${label} algorithm no longer exists.` };

      const v = validateClosedLoop(algo.moves);
      if (!v.ok) return { ok: false as const, algo: null as any, error: `Step ${step}: "${algo.name}" (${label}) is not a closed loop.` };

      return { ok: true as const, algo, error: "" };
    }
    function buildPermutationFromAlgo(
        algo: Algorithm,
        powText: string,
        invert: boolean
    ) {
      let p = movesToPermutation(algo.moves);
      if (invert) p = invertPermutation(p);

      const pow = clamp(Math.floor(Number(powText || "1")), 1, 999);
      p = applyPermutationPower(p, pow);
      return p;
    }

    if (!combineItems.length) return { ok: true, moves: [] as { fromGroupId: Id; toGroupId: Id }[], error: "" };

    let result = new Map<Id, Id>(); // identity

    for (let i = 0; i < combineItems.length; i++) {
      const item = combineItems[i];
      if (!item.algoId) continue; // blank step is ignored

      const stepNo = i + 1;

      // ---- Base ----
      const baseRes = getAlgoOrFail(item.algoId, stepNo, "base");
      if (!baseRes.ok) return { ok: false, moves: [], error: baseRes.error };

      let baseP = buildPermutationFromAlgo(baseRes.algo, item.powText, item.invert);
      baseP = remapPermutation(baseP, item.remap);

      // ---- Translate (optional) ----
      // If ON but no algo chosen, treat as identity (no-op)
      let T: Map<Id, Id> | null = null;
      if (item.translateOn) {
        if (!item.translateAlgoId) {
          T = new Map<Id, Id>(); // identity
        } else {
          const trRes = getAlgoOrFail(item.translateAlgoId, stepNo, "translate");
          if (!trRes.ok) return { ok: false, moves: [], error: trRes.error };
          T = buildPermutationFromAlgo(trRes.algo, item.translatePowText, item.translateInvert);
        }
      }

      // ---- Mirror (optional) ----
      // If ON but no algo chosen, treat as identity (no-op)
      let M: Map<Id, Id> | null = null;
      if (item.mirrorOn) {
        if (!item.mirrorAlgoId) {
          M = new Map<Id, Id>(); // identity
        } else {
          const mRes = getAlgoOrFail(item.mirrorAlgoId, stepNo, "mirror");
          if (!mRes.ok) return { ok: false, moves: [], error: mRes.error };
          M = buildPermutationFromAlgo(mRes.algo, item.mirrorPowText, item.mirrorInvert);
        }
      }


      // ---- Build the step permutation S ----
      // Priority: Translate outer, Mirror inner
      // S = T ∘ M ∘ B ∘ M^{-1} ∘ T^{-1}
      let stepP = baseP;

      if (M) {
        const Minv = invertPermutation(M);
        stepP = composePermutations(M, stepP);
        stepP = composePermutations(stepP, Minv); // (M ∘ B) ∘ M^{-1}
      }

      if (T) {
        const Tinv = invertPermutation(T);
        stepP = composePermutations(T, stepP);
        stepP = composePermutations(stepP, Tinv); // (T ∘ ( ... )) ∘ T^{-1}
      }

      // apply earlier items first: result = stepP ∘ result
      result = composePermutations(stepP, result);
    }

    return { ok: true, moves: permutationToMoves(result), error: "" };
  }, [combineItems, store.algorithms]);

  function updateDiagram(mut: (d: Diagram) => void) {
    setStore(prev => {
      const next = deepClone(prev);
      const d = next.diagrams.find(x => x.id === selectedDiagram.id);
      if (!d) return prev;
      mut(d);
      return next;
    });
  }

  function updateAlgo(mut: (a: Algorithm) => void) {
    if (!selectedAlgo) return;
    setStore(prev => {
      const next = deepClone(prev);
      const a = next.algorithms.find(x => x.id === selectedAlgo.id);
      if (!a) return prev;
      mut(a);
      // keep moves valid if diagram changed
      const d = next.diagrams.find(x => x.id === a.diagramId);
      if (d) a.moves = normalizeMoves(d, a.moves);
      return next;
    });
  }

  function createDiagram() {
    setStore(prev => {
      const next = deepClone(prev);
      const d = defaultDiagram();
      d.name = `Diagram ${next.diagrams.length + 1}`;
      next.diagrams.push(d);
      next.ui.lastDiagramId = d.id;
      return next;
    });
    // selection will follow ui.lastDiagramId via effect
  }

  function deleteDiagram(id: Id) {
    setStore(prev => {
      const next = deepClone(prev);
      next.diagrams = next.diagrams.filter(d => d.id !== id);
      next.algorithms = next.algorithms.filter(a => a.diagramId !== id);
      if (!next.diagrams.length) {
        const d = defaultDiagram();
        next.diagrams = [d];
        next.ui.lastDiagramId = d.id;
      } else if (next.ui.lastDiagramId === id) {
        next.ui.lastDiagramId = next.diagrams[0].id;
      }
      return next;
    });
    if (selectedDiagramId === id) {
      const fallback = store.diagrams.find(d => d.id !== id)?.id;
      if (fallback) setSelectedDiagramId(fallback);
    }
  }

  function createAlgorithm() {
    const a: Algorithm = {
      id: uid(),
      diagramId: selectedDiagram.id,
      name: `Algo ${diagramAlgos.length + 1}`,
      moves: []
    };
    setStore(prev => {
      const next = deepClone(prev);
      next.algorithms.push(a);
      return next;
    });
    setSelectedAlgoId(a.id);
    setMode("editAlgorithm");
    setHighlightMoveIndex(null);
    setHighlightLoopKey(null);
    setMoveFrom("");
  }

  function deleteAlgorithm(id: Id) {
    setStore(prev => {
      const next = deepClone(prev);
      next.algorithms = next.algorithms.filter(a => a.id !== id);
      return next;
    });
    if (selectedAlgoId === id) setSelectedAlgoId(undefined);
    setMoveFrom("");
    setHighlightLoopKey(null);
    setHighlightMoveIndex(null);
  }

  function addGrid() {
    updateDiagram(d => {
      const count = d.grids.length + 1;
      const w = 3, h = 3;
      d.grids.push({
        id: uid(),
        name: `Grid ${count}`,
        x: 60 + 30 * count,
        y: 60 + 30 * count,
        w, h,
        stickers: Array.from({ length: w * h }, () => "gray")
      });
    });
  }

  function deleteGrid(gridId: Id) {
    updateDiagram(d => {
      d.grids = d.grids.filter(g => g.id !== gridId);
      for (const lg of d.links) lg.stickers = lg.stickers.filter(s => s.gridId !== gridId);
      d.links = d.links.filter(lg => lg.stickers.length >= 2);
    });
  }

  function createLinkGroup() {
    if (pendingLinkStickers.length < 2) return;
    updateDiagram(d => {
      const keys = new Set(pendingLinkStickers.map(s => `${s.gridId}:${s.r}:${s.c}`));
      for (const lg of d.links) {
        lg.stickers = lg.stickers.filter(s => !keys.has(`${s.gridId}:${s.r}:${s.c}`));
      }
      d.links = d.links.filter(lg => lg.stickers.length >= 2);

      d.links.push({
        id: uid(),
        name: pendingLinkName.trim() || "Link",
        stickers: deepClone(pendingLinkStickers)
      });
    });
    setPendingLinkStickers([]);
  }

  function removeStickerFromLinks(ref: StickerRef) {
    updateDiagram(d => {
      const k = `${ref.gridId}:${ref.r}:${ref.c}`;
      for (const lg of d.links) {
        lg.stickers = lg.stickers.filter(s => `${s.gridId}:${s.r}:${s.c}` !== k);
      }
      d.links = d.links.filter(lg => lg.stickers.length >= 2);
    });
  }

  // function addMoveByGroup(fromId: Id, toId: Id) {
  //   if (!selectedAlgo) return;
  //   if (fromId === toId) return;
  //
  //   updateAlgo(a => {
  //     const hasOut = a.moves.some(m => m.fromGroupId === fromId);
  //     const hasIn = a.moves.some(m => m.toGroupId === toId);
  //     if (hasOut || hasIn) return;
  //     a.moves.push({ fromGroupId: fromId, toGroupId: toId });
  //   });
  // }

  function deleteMove(i: number) {
    updateAlgo(a => {
      a.moves.splice(i, 1);
    });
  }

  // Export / Import
  const [jsonText, setJsonText] = useState("");
  const [importStatus, setImportStatus] = useState<string>("");

  function doExport() {
    setJsonText(exportJson(store));
    setImportStatus("Exported current data to the text box below.");
  }

  function doImport() {
    const parsed = importJson(jsonText);
    if (!parsed) {
      setImportStatus("❌ Import failed: invalid JSON structure.");
      return;
    }
    setStore(parsed);
    setSelectedDiagramId(parsed.ui.lastDiagramId ?? parsed.diagrams[0].id);
    setImportStatus("✅ Imported JSON into app storage.");
  }

  // In combine mode, show preview arrows on canvas
  const canvasAlgo =
    mode === "editAlgorithm"
      ? selectedAlgo
      : mode === "combine"
        ? ({
            id: "preview" as any,
            diagramId: selectedDiagram.id,
            name: "preview",
            moves: combinePreview.moves,
            loopColors: combineLoopColors
          } as Algorithm)
        : undefined;

  return (
    <div className={`app ${sidebarCollapsed ? "sidebarCollapsed" : ""}`}>
      <div className="sidebar">
        <div className="header">
          <div className="col">
            <div style={{ fontSize: 16, fontWeight: 700 }}>Cube Diagram Tool</div>
            <div className="muted">Diagrams • Links • Algorithms • Combine</div>
          </div>
          <div className="row">
            <button className={`btn ${mode === "editDiagram" ? "primary" : ""}`} onClick={() => { setMode("editDiagram"); setRemapPick(null); setMoveFrom(""); }}>
              Diagram
            </button>
            <button className={`btn ${mode === "editAlgorithm" ? "primary" : ""}`} onClick={() => { setMode("editAlgorithm"); setRemapPick(null); }}>
              Algorithm
            </button>
            <button className={`btn ${mode === "combine" ? "primary" : ""}`} onClick={() => { setMode("combine"); setMoveFrom(""); }}>
              Combine
            </button>
          </div>
        </div>

        <div className="card">
          <div className="row spread">
            <div className="col" style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>Diagram</div>
              <select
                className="field"
                value={selectedDiagramId}
                onChange={e => {
                  setSelectedDiagramId(e.target.value);
                  setPendingLinkStickers([]);
                  setMoveFrom("");
                  setRemapPick(null);
                }}
              >
                {store.diagrams.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="col" style={{ alignItems: "flex-end" }}>
              <button className="btn primary" onClick={createDiagram}>+ New</button>
              <button className="btn danger" onClick={() => deleteDiagram(selectedDiagram.id)}>Delete</button>
            </div>
          </div>

          <div className="row" style={{ marginTop: 8 }}>
            <input
              className="field"
              value={selectedDiagram.name}
              onChange={e => updateDiagram(d => { d.name = e.target.value; })}
              placeholder="Diagram name"
            />
          </div>

          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={addGrid}>+ Grid</button>
            <span className="badge">{selectedDiagram.grids.length} grids</span>
            <span className="badge">{selectedDiagram.links.length} link groups</span>
          </div>
        </div>

        {mode === "editDiagram" && (
          <div className="card">
            <div className="row spread">
              <div style={{ fontWeight: 700 }}>Tools</div>
              <span className="badge">Tap stickers</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className={`btn ${tool === "paint" ? "primary" : ""}`} onClick={() => setTool("paint")}>Paint</button>
              <button className={`btn ${tool === "link" ? "primary" : ""}`} onClick={() => setTool("link")}>Link</button>
            </div>

            {tool === "paint" && (
              <div className="col" style={{ marginTop: 10 }}>
                <div className="muted">Paint color</div>
                <div className="row">
                  {Object.keys(COLOR_HEX).map(k => {
                    const c = k as StickerColor;
                    return (
                      <button
                        key={c}
                        className={`btn ${paintColor === c ? "primary" : ""}`}
                        onClick={() => setPaintColor(c)}
                        title={c}
                        style={{ padding: 8 }}
                      >
                        <span style={{
                          display: "inline-block",
                          width: 16, height: 16,
                          borderRadius: 6,
                          background: COLOR_HEX[c],
                          border: "1px solid rgba(255,255,255,0.2)"
                        }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {tool === "link" && (
              <div className="col" style={{ marginTop: 10 }}>
                <div className="muted">
                  Tap stickers to select. Then create a link group. Selected: {pendingLinkStickers.length}
                </div>
                <input
                  className="field"
                  value={pendingLinkName}
                  onChange={e => setPendingLinkName(e.target.value)}
                  placeholder="Link group name (e.g., Edge UF)"
                />
                <div className="row">
                  <button className="btn primary" onClick={createLinkGroup} disabled={pendingLinkStickers.length < 2}>
                    Create link group
                  </button>
                  <button className="btn" onClick={() => setPendingLinkStickers([])}>Clear selection</button>
                </div>
                <div className="muted">
                  Tip: If you re-link a sticker, it is removed from previous link groups automatically.
                </div>
              </div>
            )}

            <div className="col" style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700 }}>Grids</div>
              {selectedDiagram.grids.map(g => (
                <div key={g.id} className="row spread" style={{ borderTop: "1px solid rgba(34,48,87,0.5)", paddingTop: 8 }}>
                  <div className="col" style={{ flex: 1 }}>
                    <input
                      className="field"
                      value={g.name}
                      onChange={e => updateDiagram(d => {
                        const gg = d.grids.find(x => x.id === g.id)!;
                        gg.name = e.target.value;
                      })}
                    />
                    <div className="row">
                      <span className="badge">{g.w}×{g.h}</span>
                      <span className="badge">x:{Math.round(g.x)} y:{Math.round(g.y)}</span>
                    </div>
                    <div className="row">
                      <span className="muted small">Resize:</span>
                      <button className="btn" onClick={() => updateDiagram(d => {
                        const gg = d.grids.find(x => x.id === g.id)!;
                        gg.w = clamp(gg.w - 1, 1, 12);
                        gg.stickers = Array.from({ length: gg.w * gg.h }, (_, i) => gg.stickers[i] ?? "gray");
                      })}>W-</button>
                      <button className="btn" onClick={() => updateDiagram(d => {
                        const gg = d.grids.find(x => x.id === g.id)!;
                        gg.w = clamp(gg.w + 1, 1, 12);
                        gg.stickers = Array.from({ length: gg.w * gg.h }, (_, i) => gg.stickers[i] ?? "gray");
                      })}>W+</button>
                      <button className="btn" onClick={() => updateDiagram(d => {
                        const gg = d.grids.find(x => x.id === g.id)!;
                        gg.h = clamp(gg.h - 1, 1, 12);
                        gg.stickers = Array.from({ length: gg.w * gg.h }, (_, i) => gg.stickers[i] ?? "gray");
                      })}>H-</button>
                      <button className="btn" onClick={() => updateDiagram(d => {
                        const gg = d.grids.find(x => x.id === g.id)!;
                        gg.h = clamp(gg.h + 1, 1, 12);
                        gg.stickers = Array.from({ length: gg.w * gg.h }, (_, i) => gg.stickers[i] ?? "gray");
                      })}>H+</button>
                    </div>
                  </div>
                  <button className="btn danger" onClick={() => deleteGrid(g.id)}>Delete</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === "editAlgorithm" && (
          <div className="card">
            <div className="row spread">
              <div className="col" style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>Algorithm</div>
                <select
                  className="field"
                  value={selectedAlgoId ?? ""}
                  onChange={e => {
                    setSelectedAlgoId(e.target.value || undefined);
                    setMoveFrom("");
                    setMoveFromSticker(null);
                    setHighlightMoveIndex(null);
                    setHighlightLoopKey(null);
                  }}
                >
                  <option value="">(none)</option>
                  {diagramAlgos.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div className="col" style={{ alignItems: "flex-end" }}>
                <button className="btn primary" onClick={createAlgorithm}>+ New</button>
                {selectedAlgo && <button className="btn danger" onClick={() => deleteAlgorithm(selectedAlgo.id)}>Delete</button>}
              </div>
            </div>

            {selectedAlgo ? (
              <>
                <div className="row" style={{ marginTop: 8 }}>
                  <input
                    className="field"
                    value={selectedAlgo.name}
                    onChange={e => updateAlgo(a => { a.name = e.target.value; })}
                    placeholder="Algorithm name"
                  />
                </div>

                <div className="col" style={{ marginTop: 10 }}>
                  <div className="row spread">
                    <div style={{ fontWeight: 700 }}>Moves (arrows)</div>
                    <div className="row">
                      {(() => {
                        const v = validateClosedLoop(selectedAlgo.moves);
                        return (
                          <span className={`badge ${v.ok ? "statusOk" : "statusBad"}`}>
                            {v.ok ? "closed loop ✅" : "not closed ❌"}
                          </span>
                        );
                      })()}
                      <span className="badge">{selectedAlgo.moves.length} arrows</span>
                    </div>
                  </div>

                  <div className="muted">
                    Click stickers to add an arrow: first click = <b>from</b>, second click = <b>to</b>. Current from:{" "}
                    <span className="badge">{moveFrom || "—"}</span>
                  </div>

                  <div className="col" style={{ marginTop: 10 }}>
                    {selectedAlgo.moves.map((m, i) => (
                      <div key={i} className="row spread" style={{ borderTop: "1px solid rgba(34,48,87,0.5)", paddingTop: 8 }}>
                        <div className="col" style={{ flex: 1 }}>
                          <div><span className="badge">from</span> {groups.find(g => g.id === m.fromGroupId)?.label ?? m.fromGroupId}</div>
                          <div><span className="badge">to</span> {groups.find(g => g.id === m.toGroupId)?.label ?? m.toGroupId}</div>
                        </div>
                        <div className="row">
                          <button
                              className={`btn ${highlightMoveIndex === i ? "primary" : ""}`}
                              onClick={() => toggleHighlightMove(i)}
                          >
                            {highlightMoveIndex === i ? "Showing" : "Show"}
                          </button>

                          <button
                              className="btn danger"
                              onClick={() => {
                                deleteMove(i);
                                setHighlightLoopKey(null);
                                setHighlightMoveIndex(prev => (prev === i ? null : prev !== null && prev > i ? prev - 1 : prev));
                              }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="col" style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 700 }}>Loops</div>
                  <div className="muted">
                    Arrows are grouped by connectivity. A loop A→B→A is size x2, A→B→C→A is size x3, etc.
                    Set a custom color per loop, or reset to the auto-assigned color.
                  </div>

                  <LoopColorEditor
                    moves={selectedAlgo.moves}
                    overrides={selectedAlgo.loopColors}
                    onSetColor={(key, hex) => updateAlgo(a => {
                      a.loopColors = { ...(a.loopColors ?? {}), [key]: hex };
                    })}
                    onResetColor={key => updateAlgo(a => {
                      if (!a.loopColors) return;
                      const next = { ...a.loopColors };
                      delete next[key];
                      a.loopColors = next;
                    })}
                    highlightedKey={highlightLoopKey}
                    onToggleHighlight={toggleHighlightLoop}
                  />
                </div>
              </>
            ) : (
              <div className="muted" style={{ marginTop: 10 }}>
                Create an algorithm to start adding moves.
              </div>
            )}
          </div>
        )}

        {mode === "combine" && (
          <div className="card">
            <div className="row spread">
              <div>
                <div style={{ fontWeight: 700 }}>Combine</div>
                <div className="muted">Build a sequence. Each step can choose an algorithm, power, reverse, and remap by clicking stickers.</div>
              </div>
              <span className={`badge ${combinePreview.ok ? "statusOk" : "statusBad"}`}>
                {combinePreview.ok ? "preview ok ✅" : "invalid ❌"}
              </span>
            </div>

            <div className="col" style={{ marginTop: 10 }}>
              <div className="muted">Result name</div>
              <input className="field" value={combineName} onChange={e => setCombineName(e.target.value)} />
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                onClick={() => {
                  setCombineItems(prev => [
                    ...prev,
                    {
                      algoId: "",
                      powText: "1",
                      invert: false,
                      remap: {},
                      showRemap: false,

                      collapsed: true,

                      translateOn: false,
                      translateAlgoId: "",
                      translatePowText: "1",
                      translateInvert: false,

                      mirrorOn: false,
                      mirrorAlgoId: "",
                      mirrorPowText: "1",
                      mirrorInvert: false
                    }
                  ]);
                }}
              >
                + Add step
              </button>

              <button
                className="btn"
                onClick={() => { setCombineItems([]); setRemapPick(null); setCombineLoopColors({}); }}
              >
                Clear
              </button>
            </div>

            {combineItems.length === 0 && (
              <div className="muted" style={{ marginTop: 10 }}>No steps yet.</div>
            )}

            <div className="col" style={{ marginTop: 10 }}>
              {combineItems.map((it, i) => (
                  <div key={i} className="col" style={{ borderTop: "1px solid rgba(34,48,87,0.5)", paddingTop: 10 }}>
                    <div className="row spread">
                      <div className="row" style={{ gap: 8, alignItems: "center" }}>
                        <div style={{ fontWeight: 700 }}>Step {i + 1}</div>

                        <button
                            className="btn"
                            onClick={() => {
                              setCombineItems(prev =>
                                  prev.map((x, idx) => (idx === i ? { ...x, collapsed: !x.collapsed, showRemap: false } : x))
                              );
                              setRemapPick(null);
                            }}
                        >
                          {it.collapsed ? "Show options" : "Hide options"}
                        </button>
                      </div>

                      <div className="row">
                        <button
                            className="btn"
                            onClick={() => {
                              setCombineItems(prev => {
                                if (i === 0) return prev;
                                const a = [...prev];
                                [a[i - 1], a[i]] = [a[i], a[i - 1]];
                                return a;
                              });
                            }}
                        >
                          ↑
                        </button>

                        <button
                            className="btn"
                            onClick={() => {
                              setCombineItems(prev => {
                                if (i === prev.length - 1) return prev;
                                const a = [...prev];
                                [a[i + 1], a[i]] = [a[i], a[i + 1]];
                                return a;
                              });
                            }}
                        >
                          ↓
                        </button>

                        <button
                            className="btn danger"
                            onClick={() => {
                              setCombineItems(prev => prev.filter((_, idx) => idx !== i));
                              setRemapPick(p => {
                                if (!p) return null;
                                if (p.stepIndex === i) return null;
                                if (p.stepIndex > i) return { ...p, stepIndex: p.stepIndex - 1 };
                                return p;
                              });
                              // setRemapPick(p => (p && p.stepIndex === i ? null : p));
                            }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {/* ALWAYS visible */}
                    <div className="col" style={{ marginTop: 8 }}>
                      <div className="muted">Algorithm</div>
                      <select
                          className="field"
                          value={it.algoId}
                          onChange={e => {
                            const newId = e.target.value as Id | "";
                            setCombineItems(prev =>
                                prev.map((x, idx) =>
                                    idx === i
                                        ? {
                                          ...x,
                                          algoId: newId,
                                          remap: {},
                                          showRemap: false
                                        }
                                        : x
                                )
                            );
                            setRemapPick(null);
                          }}
                      >
                        <option value="">(choose…)</option>
                        {diagramAlgos.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                        ))}
                      </select>
                    </div>

                    {/* Everything else collapses */}
                    {/* Everything else collapses */}
                    {!it.collapsed && (
                        <>
                          {/* Power + Reverse */}
                          <div className="row" style={{ marginTop: 8 }}>
                            <div className="col" style={{ flex: 1 }}>
                              <div className="muted">Power</div>
                              <input
                                  className="field"
                                  inputMode="numeric"
                                  value={it.powText}
                                  onChange={e => {
                                    const v = e.target.value;
                                    if (v === "" || /^[0-9]+$/.test(v)) {
                                      setCombineItems(prev => prev.map((x, idx) => (idx === i ? { ...x, powText: v } : x)));
                                    }
                                  }}
                                  onBlur={() => {
                                    setCombineItems(prev =>
                                        prev.map((x, idx) => {
                                          if (idx !== i) return x;
                                          const n = clamp(Math.floor(Number(x.powText || "1")), 1, 999);
                                          return { ...x, powText: String(n) };
                                        })
                                    );
                                  }}
                              />
                            </div>

                            <div className="col" style={{ minWidth: 140 }}>
                              <div className="muted">Reverse</div>
                              <button
                                  className={`btn ${it.invert ? "primary" : ""}`}
                                  onClick={() => setCombineItems(prev => prev.map((x, idx) => (idx === i ? { ...x, invert: !x.invert } : x)))}
                              >
                                {it.invert ? "ON" : "OFF"}
                              </button>
                            </div>
                          </div>

                          {/* Remap controls */}
                          <div className="row" style={{ marginTop: 8 }}>
                            <button
                                className="btn"
                                onClick={() => {
                                  setCombineItems(prev => prev.map((x, idx) => (idx === i ? { ...x, showRemap: !x.showRemap } : x)));
                                  setRemapPick(null);
                                }}
                                disabled={!it.algoId}
                            >
                              {it.showRemap ? "Hide remap" : "Remap (move/flip)"}
                            </button>

                            <button
                                className="btn"
                                onClick={() => {
                                  setCombineItems(prev => prev.map((x, idx) => (idx === i ? { ...x, remap: {} } : x)));
                                  setRemapPick(null);
                                }}
                                disabled={!it.algoId}
                            >
                              Clear remap
                            </button>

                            {remapPick && remapPick.stepIndex === i ? (
                                <span className="badge">
          Click a target sticker… (mapping: {groups.find(g => g.id === remapPick.oldId)?.label ?? remapPick.oldId})
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => setRemapPick(null)}>
            Cancel
          </button>
        </span>
                            ) : null}
                          </div>

                          {/* Remap list */}
                          {it.showRemap && it.algoId && (
                              <div className="col" style={{ marginTop: 8 }}>
                                <div className="muted">
                                  For this step only: pick a moved group (left) then click a sticker on the canvas to choose where it remaps to.
                                </div>

                                {(() => {
                                  const algo = store.algorithms.find(a => a.id === it.algoId);
                                  if (!algo) return null;

                                  const movedSet = new Set<Id>();
                                  for (const m of algo.moves) {
                                    movedSet.add(m.fromGroupId);
                                    movedSet.add(m.toGroupId);
                                  }
                                  const movedIds = Array.from(movedSet);

                                  return (
                                      <div className="col" style={{ gap: 8 }}>
                                        {movedIds.map(oldId => {
                                          const toId = it.remap[oldId] ?? "";
                                          const oldLabel = groups.find(g => g.id === oldId)?.label ?? oldId;
                                          const toLabel = toId ? (groups.find(g => g.id === toId)?.label ?? toId) : "(no change)";
                                          const pickingThis = remapPick && remapPick.stepIndex === i && remapPick.oldId === oldId;

                                          return (
                                              <div key={oldId} className="row spread" style={{ border: "1px solid rgba(34,48,87,0.5)", padding: 8, borderRadius: 10 }}>
                                                <div className="col" style={{ flex: 1, gap: 2 }}>
                                                  <div className="muted small">from</div>
                                                  <div>{oldLabel}</div>
                                                </div>

                                                <div className="col" style={{ flex: 1, gap: 2 }}>
                                                  <div className="muted small">to</div>
                                                  <div>{toLabel}</div>
                                                </div>

                                                <div className="row">
                                                  <button className={`btn ${pickingThis ? "primary" : ""}`} onClick={() => setRemapPick({ stepIndex: i, oldId })}>
                                                    {pickingThis ? "Picking…" : "Pick target"}
                                                  </button>

                                                  <button
                                                      className="btn"
                                                      onClick={() => {
                                                        setCombineItems(prev =>
                                                            prev.map((x, idx) => {
                                                              if (idx !== i) return x;
                                                              const next = { ...x.remap };
                                                              delete next[oldId];
                                                              return { ...x, remap: next };
                                                            })
                                                        );
                                                        setRemapPick(null);
                                                      }}
                                                      disabled={!toId}
                                                  >
                                                    Clear
                                                  </button>
                                                </div>
                                              </div>
                                          );
                                        })}
                                      </div>
                                  );
                                })()}
                              </div>
                          )}

                          {/* Translate (your existing block is fine; keep it, but put it here) */}
                          <div className="row" style={{ marginTop: 10 }}>
                            <div className="col" style={{ minWidth: 140 }}>
                              <div className="muted">Translate</div>
                              <button
                                  className={`btn ${it.translateOn ? "primary" : ""}`}
                                  onClick={() => {
                                    setCombineItems(prev =>
                                        prev.map((x, idx) => {
                                          if (idx !== i) return x;
                                          const on = !x.translateOn;
                                          return { ...x, translateOn: on };
                                        })
                                    );
                                    setRemapPick(null);
                                  }}
                                  disabled={!it.algoId}
                              >
                                {it.translateOn ? "ON" : "OFF"}
                              </button>
                            </div>

                            {it.translateOn && (
                                <div className="col" style={{ flex: 1 }}>
                                  <div className="muted">Translation algorithm</div>
                                  <select
                                      className="field"
                                      value={it.translateAlgoId}
                                      onChange={e => {
                                        const newId = e.target.value as Id | "";
                                        setCombineItems(prev => prev.map((x, idx) => (idx === i ? { ...x, translateAlgoId: newId } : x)));
                                      }}
                                  >
                                    <option value="">(choose…)</option>
                                    {diagramAlgos.map(a => (
                                        <option key={a.id} value={a.id}>
                                          {a.name}
                                        </option>
                                    ))}
                                  </select>

                                  <div className="row" style={{ marginTop: 8 }}>
                                    <div className="col" style={{ flex: 1 }}>
                                      <div className="muted">Translate power</div>
                                      <input
                                          className="field"
                                          inputMode="numeric"
                                          value={it.translatePowText}
                                          onChange={e => {
                                            const v = e.target.value;
                                            if (v === "" || /^[0-9]+$/.test(v)) {
                                              setCombineItems(prev => prev.map((x, idx) => (idx === i ? { ...x, translatePowText: v } : x)));
                                            }
                                          }}
                                          onBlur={() => {
                                            setCombineItems(prev =>
                                                prev.map((x, idx) => {
                                                  if (idx !== i) return x;
                                                  const n = clamp(Math.floor(Number(x.translatePowText || "1")), 1, 999);
                                                  return { ...x, translatePowText: String(n) };
                                                })
                                            );
                                          }}
                                      />
                                    </div>

                                    <div className="col" style={{ minWidth: 140 }}>
                                      <div className="muted">Translate reverse</div>
                                      <button
                                          className={`btn ${it.translateInvert ? "primary" : ""}`}
                                          onClick={() => setCombineItems(prev => prev.map((x, idx) => (idx === i ? { ...x, translateInvert: !x.translateInvert } : x)))}
                                      >
                                        {it.translateInvert ? "ON" : "OFF"}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                            )}
                          </div>

                          {/* Mirror (MISSING in your version) */}
                          <div className="row" style={{ marginTop: 10 }}>
                            <div className="col" style={{ minWidth: 140 }}>
                              <div className="muted">Mirror</div>
                              <button
                                  className={`btn ${it.mirrorOn ? "primary" : ""}`}
                                  disabled={!it.algoId}
                                  onClick={() => {
                                    setCombineItems(prev =>
                                        prev.map((x, idx) => {
                                          if (idx !== i) return x;
                                          const on = !x.mirrorOn;
                                          return { ...x, mirrorOn: on };
                                        })
                                    );
                                    setRemapPick(null);
                                  }}
                              >
                                {it.mirrorOn ? "ON" : "OFF"}
                              </button>
                            </div>

                            {it.mirrorOn && (
                                <div className="col" style={{ flex: 1 }}>
                                  <div className="muted">Mirror algorithm</div>
                                  <select
                                      className="field"
                                      value={it.mirrorAlgoId}
                                      onChange={e => {
                                        const newId = e.target.value as Id | "";
                                        setCombineItems(prev => prev.map((x, idx) => (idx === i ? { ...x, mirrorAlgoId: newId } : x)));
                                      }}
                                  >
                                    <option value="">(choose…)</option>
                                    {diagramAlgos.map(a => (
                                        <option key={a.id} value={a.id}>
                                          {a.name}
                                        </option>
                                    ))}
                                  </select>

                                  <div className="row" style={{ marginTop: 8 }}>
                                    <div className="col" style={{ flex: 1 }}>
                                      <div className="muted">Mirror power</div>
                                      <input
                                          className="field"
                                          inputMode="numeric"
                                          value={it.mirrorPowText}
                                          onChange={e => {
                                            const v = e.target.value;
                                            if (v === "" || /^[0-9]+$/.test(v)) {
                                              setCombineItems(prev => prev.map((x, idx) => (idx === i ? { ...x, mirrorPowText: v } : x)));
                                            }
                                          }}
                                          onBlur={() => {
                                            setCombineItems(prev =>
                                                prev.map((x, idx) => {
                                                  if (idx !== i) return x;
                                                  const n = clamp(Math.floor(Number(x.mirrorPowText || "1")), 1, 999);
                                                  return { ...x, mirrorPowText: String(n) };
                                                })
                                            );
                                          }}
                                      />
                                    </div>

                                    <div className="col" style={{ minWidth: 140 }}>
                                      <div className="muted">Mirror reverse</div>
                                      <button
                                          className={`btn ${it.mirrorInvert ? "primary" : ""}`}
                                          onClick={() => setCombineItems(prev => prev.map((x, idx) => (idx === i ? { ...x, mirrorInvert: !x.mirrorInvert } : x)))}
                                      >
                                        {it.mirrorInvert ? "ON" : "OFF"}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                            )}
                          </div>
                        </>
                    )}

                  </div>
              ))}

            </div>

            {!combinePreview.ok && (
              <div className="muted" style={{ marginTop: 10 }}>
                {combinePreview.error}
              </div>
            )}

            <div className="col" style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700 }}>Loops (combined result)</div>
              <div className="muted">
                Shows how the arrows of the combined result group into loops, and their sizes.
                Colors here are used on the canvas and carry over when you save.
              </div>

              <LoopColorEditor
                moves={combinePreview.moves}
                overrides={combineLoopColors}
                onSetColor={(key, hex) => setCombineLoopColors(prev => ({ ...prev, [key]: hex }))}
                onResetColor={key => setCombineLoopColors(prev => {
                  const next = { ...prev };
                  delete next[key];
                  return next;
                })}
                emptyLabel="No steps yet, or the preview isn't valid."
                highlightedKey={highlightLoopKey}
                onToggleHighlight={toggleHighlightLoop}
              />
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="btn primary"
                disabled={!combinePreview.ok || combineItems.length === 0}
                onClick={() => {
                  const newAlgo: Algorithm = {
                    id: uid(),
                    diagramId: selectedDiagram.id,
                    name: combineName.trim() || "Combined",
                    moves: combinePreview.moves,
                    loopColors: { ...combineLoopColors }
                  };
                  setStore(prev => {
                    const next = deepClone(prev);
                    next.algorithms.push(newAlgo);
                    return next;
                  });
                  setSelectedAlgoId(newAlgo.id);
                  setMode("editAlgorithm");
                  setMoveFrom("");
                }}
              >
                Save as new algorithm
              </button>
            </div>
          </div>
        )}

        <div className="card">
          <div className="row spread">
            <div style={{ fontWeight: 700 }}>Backup</div>
            <div className="row">
              <button className="btn" onClick={doExport}>Export</button>
              <button className="btn primary" onClick={doImport}>Import</button>
            </div>
          </div>
          <div className="muted">{importStatus}</div>
          <textarea
            className="field"
            style={{ height: 160, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
            value={jsonText}
            onChange={e => setJsonText(e.target.value)}
            placeholder="Export will appear here. Paste JSON here to import."
          />
        </div>

        <div className="muted">
          Storage: your browser localStorage. If you clear site data, you lose it — use Export as backup.
        </div>
      </div>

      <button
        className="sidebarToggle"
        onClick={() => setSidebarCollapsed(v => !v)}
        title={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
        aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
      >
        {sidebarCollapsed ? "☰" : "✕"}
      </button>

      <div className="canvasWrap">
        <DiagramCanvas
          diagram={selectedDiagram}
          algo={canvasAlgo}
          mode={mode}
          tool={tool}
          paintColor={paintColor}
          pendingLinkStickers={pendingLinkStickers}
          setPendingLinkStickers={setPendingLinkStickers}
          updateDiagram={updateDiagram}
          removeStickerFromLinks={removeStickerFromLinks}
          moveFrom={moveFrom}
          setMoveFrom={setMoveFrom}
          addMoveByGroup={(fromId, toId, fromSticker, toSticker) => {
            if (!selectedAlgo) return;
            updateAlgo(a => {
              const hasOut = a.moves.some(m => m.fromGroupId === fromId);
              const hasIn = a.moves.some(m => m.toGroupId === toId);
              if (hasOut || hasIn) return;

              a.moves.push({
                fromGroupId: fromId,
                toGroupId: toId,
                fromSticker,
                toSticker
              });
            });
          }}
          moveFromSticker={moveFromSticker}
          setMoveFromSticker={setMoveFromSticker}
          highlightMoveIndex={mode === "editAlgorithm" ? highlightMoveIndex : null}
          highlightLoopKey={mode === "editAlgorithm" || mode === "combine" ? highlightLoopKey : null}
          remapPick={remapPick}
          setRemapPick={setRemapPick}
          applyRemapTarget={(stepIndex, oldId, targetId) => {
            setCombineItems(prev => prev.map((x, idx) => {
              if (idx !== stepIndex) return x;
              return { ...x, remap: { ...x.remap, [oldId]: targetId } };
            }));
          }}
        />
      </div>
    </div>
  );
}

type CanvasProps = {
  diagram: Diagram;
  algo?: Algorithm;
  mode: Mode;
  tool: Tool;
  paintColor: StickerColor;
  pendingLinkStickers: StickerRef[];
  setPendingLinkStickers: React.Dispatch<React.SetStateAction<StickerRef[]>>;
  updateDiagram: (mut: (d: Diagram) => void) => void;
  removeStickerFromLinks: (ref: StickerRef) => void;

  moveFrom: Id | "";
  setMoveFrom: React.Dispatch<React.SetStateAction<Id | "">>;
  moveFromSticker: StickerRef | null;
  setMoveFromSticker: React.Dispatch<React.SetStateAction<StickerRef | null>>;
  addMoveByGroup: (fromId: Id, toId: Id, fromSticker: StickerRef, toSticker: StickerRef) => void;

  highlightMoveIndex: number | null;
  highlightLoopKey: string | null;

  remapPick: { stepIndex: number; oldId: Id } | null;
  setRemapPick: React.Dispatch<React.SetStateAction<{ stepIndex: number; oldId: Id } | null>>;
  applyRemapTarget: (stepIndex: number, oldId: Id, targetId: Id) => void;
};

const MIN_VIEW_SCALE = 0.25;
const MAX_VIEW_SCALE = 4;

function DiagramCanvas(props: CanvasProps) {
  const { diagram, algo, tool, paintColor } = props;

  // Pan/zoom viewport state for the grids layer. Purely a view concern (not persisted with
  // the diagram): translate + scale applied to a wrapper around the grids only, while the
  // arrow SVG overlay stays in the stable, untransformed frame (see render below).
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });

  // Reset the view whenever a different diagram is opened, so an old pan/zoom doesn't leave
  // the new diagram's grids scrolled out of view.
  useEffect(() => {
    setView({ x: 0, y: 0, scale: 1 });
  }, [diagram.id]);

  // Background pan (single pointer) and pinch-zoom (two pointers) tracking.
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const panState = useRef<{ pointerId: number; startX: number; startY: number; startViewX: number; startViewY: number } | null>(null);
  const pinchState = useRef<{ contentX: number; contentY: number; initialDist: number; initialScale: number } | null>(null);

  function isInsideGrid(target: EventTarget | null) {
    return !!(target as HTMLElement | null)?.closest?.(".grid");
  }

  function pointerDist(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // Pan/pinch/wheel can fire far more often than the screen can repaint, and every view
  // change cascades into a full arrow recompute — batching to at most once per animation
  // frame keeps panning/zooming feeling smooth instead of janky, especially on mobile.
  const pendingViewRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const viewRafRef = useRef<number | null>(null);

  function scheduleView(next: { x: number; y: number; scale: number }) {
    pendingViewRef.current = next;
    if (viewRafRef.current != null) return;
    viewRafRef.current = requestAnimationFrame(() => {
      viewRafRef.current = null;
      if (pendingViewRef.current) setView(pendingViewRef.current);
    });
  }

  useEffect(() => {
    return () => {
      if (viewRafRef.current != null) cancelAnimationFrame(viewRafRef.current);
    };
  }, []);

  // Dragging grids (always enabled)
  const dragRef = useRef<{
    gridId: Id;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    pointerId: number;
  } | null>(null);

  // For arrow endpoints, we need DOM refs
  const gridEls = useRef(new Map<Id, HTMLDivElement>());
  const stickerEls = useRef(new Map<string, HTMLDivElement>());

  function setGridEl(id: Id, el: HTMLDivElement | null) {
    if (!el) gridEls.current.delete(id);
    else gridEls.current.set(id, el);
  }
  function setStickerEl(key: string, el: HTMLDivElement | null) {
    if (!el) stickerEls.current.delete(key);
    else stickerEls.current.set(key, el);
  }

  function stickerKey(ref: StickerRef) {
    return `${ref.gridId}:${ref.r}:${ref.c}`;
  }

  function isPending(ref: StickerRef) {
    const k = stickerKey(ref);
    return props.pendingLinkStickers.some(s => stickerKey(s) === k);
  }

  function togglePending(ref: StickerRef) {
    const k = stickerKey(ref);
    props.setPendingLinkStickers(prev => {
      const has = prev.some(s => stickerKey(s) === k);
      if (has) return prev.filter(s => stickerKey(s) !== k);
      return [...prev, ref];
    });
  }

  function paint(ref: StickerRef) {
    props.updateDiagram(d => {
      const g = d.grids.find(x => x.id === ref.gridId);
      if (!g) return;
      g.stickers[idx(g.w, ref.r, ref.c)] = paintColor;
    });
  }

  function groupIdForSticker(d: Diagram, ref: StickerRef): Id {
    const lg = findLinkGroupForSticker(d, ref);
    if (lg) return lg.id;
    return `single:${stickerKey(ref)}`;
  }

  function onStickerTap(ref: StickerRef) {
    const gid = groupIdForSticker(diagram, ref);

    // Combine remap picking
    if (props.mode === "combine" && props.remapPick) {
      props.applyRemapTarget(props.remapPick.stepIndex, props.remapPick.oldId, gid);
      props.setRemapPick(null);
      return;
    }

    // Algorithm mode: click-to-add arrows
    if (props.mode === "editAlgorithm") {
      if (!algo) return;

      if (!props.moveFrom) {
        props.setMoveFrom(gid);
        props.setMoveFromSticker(ref);
        return;
      }

      if (props.moveFrom !== gid) {
        if (props.moveFromSticker) {
          props.addMoveByGroup(props.moveFrom as Id, gid, props.moveFromSticker, ref);
        }
      }

      props.setMoveFrom("");
      props.setMoveFromSticker(null);
      return;
    }

    // Diagram mode only
    if (props.mode === "editDiagram") {
      if (tool === "paint") paint(ref);
      if (tool === "link") togglePending(ref);
    }
  }

  function onGridPointerDown(e: React.PointerEvent, gridId: Id) {
    // don't start drag from sticker taps
    const target = e.target as HTMLElement;
    if (target?.classList?.contains("sticker")) return;

    const g = diagram.grids.find(x => x.id === gridId);
    if (!g) return;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    dragRef.current = {
      gridId,
      startX: e.clientX,
      startY: e.clientY,
      origX: g.x,
      origY: g.y,
      pointerId: e.pointerId
    };
  }

  function onGridPointerMove(e: React.PointerEvent) {
    const dr = dragRef.current;
    if (!dr) return;
    if (e.pointerId !== dr.pointerId) return;

    // Grids live inside the pan/zoom-scaled wrapper, so a raw screen-pixel delta needs to be
    // converted back to that wrapper's local units for the drag to track the cursor 1:1.
    const dx = (e.clientX - dr.startX) / view.scale;
    const dy = (e.clientY - dr.startY) / view.scale;

    props.updateDiagram(d => {
      const g = d.grids.find(x => x.id === dr.gridId);
      if (!g) return;
      g.x = dr.origX + dx;
      g.y = dr.origY + dy;
    });
  }

  function onGridPointerUp(e: React.PointerEvent) {
    const dr = dragRef.current;
    if (!dr) return;
    if (e.pointerId !== dr.pointerId) return;
    dragRef.current = null;
  }

  // --- Canvas background pan (drag) and pinch-zoom (two fingers) ---

  function onCanvasPointerDown(e: React.PointerEvent) {
    // Clicks/taps inside a grid are handled by onGridPointerDown (drag the grid) or a
    // sticker's own onClick — never start a background pan/pinch for those.
    if (isInsideGrid(e.target)) return;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Prefer a not-yet-applied scheduled view over the last-rendered state, so starting a
    // new gesture right after another one flushes doesn't anchor off a stale position.
    const curView = pendingViewRef.current ?? view;

    if (activePointers.current.size === 1) {
      pinchState.current = null;
      panState.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startViewX: curView.x,
        startViewY: curView.y
      };
    } else if (activePointers.current.size === 2) {
      panState.current = null;
      const pts = Array.from(activePointers.current.values());
      const rect = (document.getElementById("canvas-root"))?.getBoundingClientRect();
      if (rect) {
        const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
        const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
        pinchState.current = {
          contentX: (midX - curView.x) / curView.scale,
          contentY: (midY - curView.y) / curView.scale,
          initialDist: pointerDist(pts[0], pts[1]),
          initialScale: curView.scale
        };
      }
    }
  }

  function onCanvasPointerMove(e: React.PointerEvent) {
    // Existing grid-drag logic (no-op unless a grid drag is in progress).
    onGridPointerMove(e);

    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchState.current && activePointers.current.size >= 2) {
      const pts = Array.from(activePointers.current.values()).slice(0, 2);
      const rect = document.getElementById("canvas-root")?.getBoundingClientRect();
      if (!rect) return;

      const { contentX, contentY, initialDist, initialScale } = pinchState.current;
      const curDist = pointerDist(pts[0], pts[1]) || 1;
      const newScale = clamp(initialScale * (curDist / initialDist), MIN_VIEW_SCALE, MAX_VIEW_SCALE);

      const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
      const midY = (pts[0].y + pts[1].y) / 2 - rect.top;

      scheduleView({
        x: midX - contentX * newScale,
        y: midY - contentY * newScale,
        scale: newScale
      });
    } else if (panState.current && panState.current.pointerId === e.pointerId) {
      const ps = panState.current;
      const dx = e.clientX - ps.startX;
      const dy = e.clientY - ps.startY;
      scheduleView({ x: ps.startViewX + dx, y: ps.startViewY + dy, scale: view.scale });
    }
  }

  function onCanvasPointerUp(e: React.PointerEvent) {
    onGridPointerUp(e);

    activePointers.current.delete(e.pointerId);

    if (panState.current?.pointerId === e.pointerId) {
      panState.current = null;
    }

    if (pinchState.current) {
      pinchState.current = null;
      // If one finger is still down, resume a fresh single-finger pan anchored at its
      // current position so there's no jump when the second finger lifts.
      const remaining = Array.from(activePointers.current.entries());
      if (remaining.length === 1) {
        const [pointerId, pos] = remaining[0];
        const curView = pendingViewRef.current ?? view;
        panState.current = { pointerId, startX: pos.x, startY: pos.y, startViewX: curView.x, startViewY: curView.y };
      }
    }
  }

  function onCanvasWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = document.getElementById("canvas-root")?.getBoundingClientRect();
    if (!rect) return;

    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Chain off any not-yet-applied scheduled view so rapid wheel ticks (fast scrolling,
    // trackpads) accumulate correctly instead of all computing from the same stale state.
    const base = pendingViewRef.current ?? view;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newScale = clamp(base.scale * factor, MIN_VIEW_SCALE, MAX_VIEW_SCALE);
    const contentX = (px - base.x) / base.scale;
    const contentY = (py - base.y) / base.scale;

    scheduleView({
      x: px - contentX * newScale,
      y: py - contentY * newScale,
      scale: newScale
    });
  }

  // Group moves into their connected "loops" so every closed loop of arrows gets its own
  // color (custom via algo.loopColors, or an auto-assigned default) and a stable loop key,
  // used both for coloring and for the per-loop "Show" highlight.
  const moveLoopInfo = useMemo(() => {
    const out = new Map<number, { color: string; loopKey: string }>();
    if (!algo) return out;

    const loops = computeMoveLoops(algo.moves);
    loops.forEach((loop, li) => {
      const dc = defaultLoopColor(li);
      const color = algo.loopColors?.[loop.key] ?? `hsl(${dc.h}, ${dc.s}%, ${dc.l}%)`;
      for (const mi of loop.moveIndices) out.set(mi, { color, loopKey: loop.key });
    });

    return out;
  }, [algo]);

  const arrowSegments = useMemo(() => {
    if (!algo) return [];
    const gs = allSelectableGroups(diagram);
    const idToMembers = new Map(gs.map(g => [g.id, g.members] as const));

    const arrows: { from: StickerRef; to: StickerRef; i: number }[] = [];
    algo.moves.forEach((m, i) => {
      const fromMembers = idToMembers.get(m.fromGroupId);
      const toMembers = idToMembers.get(m.toGroupId);
      if (!fromMembers?.length || !toMembers?.length) return;

      const clickedFrom = m.fromSticker;
      const clickedTo = m.toSticker;
      const fromOk =
          clickedFrom &&
          clickedFrom.gridId === (clickedFrom.gridId) &&
          fromMembers.some(s => s.gridId === clickedFrom.gridId && s.r === clickedFrom.r && s.c === clickedFrom.c);

      const toOk =
          clickedTo &&
          toMembers.some(s => s.gridId === clickedTo.gridId && s.r === clickedTo.r && s.c === clickedTo.c);

      const defaultFrom = fromOk ? (clickedFrom as StickerRef) : fromMembers[0];
      const defaultTo = toOk ? (clickedTo as StickerRef) : toMembers[0];

      // arrows.push({ from: fromMembers[0], to: toMembers[0], i });
      // const defaultFrom = fromMembers[0];
      // const defaultTo = toMembers[0];

      // Start with the exact stickers selected (first member = selected)
      let chosenFrom = defaultFrom;
      let chosenTo = defaultTo;

      // If default pair is across different grids, try to find a same-grid pair.
      if (defaultFrom.gridId !== defaultTo.gridId) {
        // 1) Prefer a same-grid pair that stays in the source's grid.
        let found = false;
        for (const fm of fromMembers) {
          for (const tm of toMembers) {
            if (fm.gridId === tm.gridId && fm.gridId === defaultFrom.gridId) {
              chosenFrom = fm;
              chosenTo = tm;
              found = true;
              break;
            }
          }
          if (found) break;
        }

        // 2) If not found, fall back to any same-grid pair.
        if (!found) {
          outer: for (const fm of fromMembers) {
            for (const tm of toMembers) {
              if (fm.gridId === tm.gridId) {
                chosenFrom = fm;
                chosenTo = tm;
                break outer;
              }
            }
          }
        }
        // 3) If still not found, keep the default pair (first members).
      }

      arrows.push({ from: chosenFrom, to: chosenTo, i });
    });
    return arrows;
  }, [algo, diagram]);

  const [paths, setPaths] = useState<{
    d: string;
    head: { x: number; y: number; ang: number };
    key: string;
    i: number;
    color: string;
    loopKey: string;
  }[]>([]);

  function recomputePaths() {
    const out: {
      d: string;
      head: { x: number; y: number; ang: number };
      key: string;
      i: number;
      color: string;
      loopKey: string;
    }[] = [];
    const canvasEl = document.getElementById("canvas-root");
    if (!canvasEl) return;
    const canvasRect = canvasEl.getBoundingClientRect();

    for (const a of arrowSegments) {
      const fromK = `${a.from.gridId}:${a.from.r}:${a.from.c}`;
      const toK = `${a.to.gridId}:${a.to.r}:${a.to.c}`;
      const fromEl = stickerEls.current.get(fromK);
      const toEl = stickerEls.current.get(toK);
      if (!fromEl || !toEl) continue;

      const fr = fromEl.getBoundingClientRect();
      const tr = toEl.getBoundingClientRect();

      const x1 = (fr.left + fr.right) / 2 - canvasRect.left;
      const y1 = (fr.top + fr.bottom) / 2 - canvasRect.top;
      const x2 = (tr.left + tr.right) / 2 - canvasRect.left;
      const y2 = (tr.top + tr.bottom) / 2 - canvasRect.top;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const offset = ((a.i % 5) - 2) * 10;
      const cx1 = x1 + dx * 0.35 + nx * offset;
      const cy1 = y1 + dy * 0.35 + ny * offset;
      const cx2 = x1 + dx * 0.65 + nx * offset;
      const cy2 = y1 + dy * 0.65 + ny * offset;

      const d = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;

      const tx = x2 - cx2;
      const ty = y2 - cy2;
      const ang = Math.atan2(ty, tx);

      const info = moveLoopInfo.get(a.i);
      const color = info?.color ?? "hsl(210, 85%, 62%)";
      const loopKey = info?.loopKey ?? "";

      out.push({ d, head: { x: x2, y: y2, ang }, key: `${fromK}->${toK}:${a.i}`, i: a.i, color, loopKey });
    }

    setPaths(out);
  }

  // Keep a ref to the latest recompute closure so the mount-only effect below (resize
  // listener + ResizeObserver) always calls the current version instead of a stale one.
  const recomputeRef = useRef(recomputePaths);
  recomputeRef.current = recomputePaths;

  // Recompute whenever the underlying data or the view (pan/zoom) changes.
  useEffect(() => {
    recomputePaths();
    // view.x/y/scale: the SVG overlay stays in the stable frame while the grids pan/zoom
    // underneath it, so arrow positions must be recomputed whenever the view changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrowSegments, diagram, moveLoopInfo, view.x, view.y, view.scale]);

  // Recompute on any layout change affecting canvas-root's own size. window's "resize" event
  // only fires for the browser viewport itself — it does NOT fire when an internal layout
  // change (like collapsing the sidebar, which resizes canvas-root via a CSS grid track
  // animation) changes canvas-root's rendered size. Without a ResizeObserver here, arrows
  // stay stale (pinned to the old size) after toggling the sidebar. Set up once on mount and
  // always call the latest recompute via the ref above.
  useEffect(() => {
    const onResize = () => recomputeRef.current();
    window.addEventListener("resize", onResize);

    const canvasEl = document.getElementById("canvas-root");
    let ro: ResizeObserver | null = null;
    if (canvasEl && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => recomputeRef.current());
      ro.observe(canvasEl);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, []);

  // Highlighting: either a single arrow ("Show" on a move) or a whole loop ("Show" on a
  // loop) can be active at once. Non-highlighted arrows fade to near-invisible so the
  // highlighted one(s) are unambiguous.
  const highlightActive = props.highlightMoveIndex !== null || props.highlightLoopKey !== null;
  const DIM_OPACITY = 0.08;

  function isPathHighlighted(p: { i: number; loopKey: string }) {
    if (props.highlightMoveIndex !== null) return props.highlightMoveIndex === p.i;
    if (props.highlightLoopKey !== null) return props.highlightLoopKey === p.loopKey;
    return false;
  }

  return (
    <div
      id="canvas-root"
      className="canvas"
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onPointerCancel={onCanvasPointerUp}
      onWheel={onCanvasWheel}
    >
      {/*
        Arrow overlay stays in this stable, untransformed frame — it's positioned purely from
        live sticker screen coordinates (see recompute() above), so it doesn't need its own
        pan/zoom transform; it just tracks wherever the (separately transformed) grids below
        actually end up on screen.
      */}
      <svg className="arrowLayer" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {/*
          Both filters use filterUnits="userSpaceOnUse" with the region sized off the SVG's
          own viewport rather than the default objectBoundingBox (relative to whatever's being
          filtered). objectBoundingBox regions can go degenerate — and some browsers respond by
          flooding the entire filter region solid black — when the filtered group's content
          bounding box is momentarily zero/weird, e.g. mid-way through the sidebar-collapse
          layout transition. Sizing off the stable viewport avoids that failure mode entirely.
        */}
        <defs>
          <filter id="glow" filterUnits="userSpaceOnUse" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.6" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/*
            Outlines the combined silhouette of whatever is drawn inside the group this filter
            is applied to (every line, or every arrowhead, drawn together as one batch), so
            overlapping/touching pieces share one continuous ring with no internal seams.
            feMorphology dilates the shared alpha mask; the black copy sits behind the
            original artwork so only a thin ring around the outside remains visible.
          */}
          <filter id="arrowBorder" filterUnits="userSpaceOnUse" x="-50%" y="-50%" width="200%" height="200%">
            <feMorphology in="SourceAlpha" operator="dilate" radius="1" result="dilated" />
            <feFlood floodColor="#000000" floodOpacity="0.95" result="blackFlood" />
            <feComposite in="blackFlood" in2="dilated" operator="in" result="blackOutline" />
            <feMerge>
              <feMergeNode in="blackOutline" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/*
          Rendered in two passes so every arrowhead ends up above every line, no matter which
          arrow it belongs to. Without this, e.g. with arrows A->B and B->A, the line leaving
          B (for B->A) would be drawn after and cover the tip of the A->B arrowhead sitting at
          B (and symmetrically at A) — since both arrows are added/removed independently there
          is no single per-arrow draw order that keeps a head above a *different* arrow's line.
          Splitting into "all lines" then "all heads" guarantees it in every case.
        */}
        <g filter="url(#glow)">
          <g filter="url(#arrowBorder)">
            {paths.map(p => {
              const isHi = isPathHighlighted(p);

              const width = highlightActive
                  ? (isHi ? 4.0 : 1.4)
                  : 2.2;

              const opacity = highlightActive ? (isHi ? 1 : DIM_OPACITY) : 1;

              return (
                  <path
                    key={p.key}
                    d={p.d}
                    fill="none"
                    stroke={p.color}
                    strokeWidth={width}
                    strokeLinecap="round"
                    opacity={opacity}
                  />
              );
            })}
          </g>
        </g>

        <g filter="url(#glow)">
          <g filter="url(#arrowBorder)">
            {paths.map(p => {
              const isHi = isPathHighlighted(p);
              const opacity = highlightActive ? (isHi ? 1 : DIM_OPACITY) : 1;

              return (
                  <ArrowHead
                    key={p.key}
                    x={p.head.x}
                    y={p.head.y}
                    ang={p.head.ang}
                    color={p.color}
                    opacity={opacity}
                  />
              );
            })}
          </g>
        </g>
      </svg>

      {/* Pan/zoom lives here: translating/scaling this wrapper moves the grids without
          touching the arrow overlay above, or the grids' own local x/y coordinates. */}
      <div
        className="canvasContent"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "0 0" }}
      >
      {diagram.grids.map(g => (
        <div
          key={g.id}
          className="grid"
          ref={el => setGridEl(g.id, el)}
          style={{ left: g.x, top: g.y }}
          onPointerDown={e => onGridPointerDown(e, g.id)}
        >
          <div className="gridTitle">
            <div className="row">
              <div style={{ fontWeight: 700 }}>{g.name}</div>
              <span className="badge">{g.w}×{g.h}</span>
            </div>
            <div className="row">
              <span className="badge">drag</span>
            </div>
          </div>

          <div className="stickerGrid" style={{ gridTemplateColumns: `repeat(${g.w}, 28px)` }}>
            {Array.from({ length: g.w * g.h }, (_, i) => {
              const r = Math.floor(i / g.w);
              const c = i % g.w;
              const ref: StickerRef = { gridId: g.id, r, c };
              const color = g.stickers[i];
              const link = findLinkGroupForSticker(diagram, ref);
              const key = `${g.id}:${r}:${c}`;
              const selected = props.mode === "editDiagram" && tool === "link" && isPending(ref);

              const gid = groupIdForSticker(diagram, ref);
              const algoFrom = props.mode === "editAlgorithm" && props.moveFrom === gid;

              return (
                <div
                  key={key}
                  ref={el => setStickerEl(key, el)}
                  className={`sticker ${selected ? "selected" : ""} ${algoFrom ? "selected" : ""} ${props.mode === "combine" && props.remapPick && gid === props.remapPick.oldId ? "remapFrom" : ""}`}
                  style={{ background: COLOR_HEX[color] }}
                  onClick={() => onStickerTap(ref)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (props.mode === "editDiagram") props.removeStickerFromLinks(ref);
                  }}
                  title={
                    props.mode === "combine" && props.remapPick
                      ? "Click to choose remap target"
                      : link
                        ? `Linked: ${link.name} (right-click/long-press to unlink)`
                        : "Unlinked"
                  }
                />
              );
            })}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

function ArrowHead({
  x, y, ang, color, opacity
}: {
  x: number; y: number; ang: number; color: string; opacity?: number;
}) {
  const size = 7;
  const a1 = ang + Math.PI * 0.8;
  const a2 = ang - Math.PI * 0.8;
  const x1 = x + Math.cos(a1) * size;
  const y1 = y + Math.sin(a1) * size;
  const x2 = x + Math.cos(a2) * size;
  const y2 = y + Math.sin(a2) * size;

  return <path d={`M ${x} ${y} L ${x1} ${y1} L ${x2} ${y2} Z`} fill={color} opacity={opacity} />;
}

function LoopColorEditor({
  moves,
  overrides,
  onSetColor,
  onResetColor,
  emptyLabel = "No arrows yet.",
  highlightedKey,
  onToggleHighlight
}: {
  moves: { fromGroupId: Id; toGroupId: Id }[];
  overrides?: Record<string, string>;
  onSetColor: (key: string, hex: string) => void;
  onResetColor: (key: string) => void;
  emptyLabel?: string;
  highlightedKey?: string | null;
  onToggleHighlight?: (key: string) => void;
}) {
  const loops = useMemo(() => computeMoveLoops(moves), [moves]);

  if (loops.length === 0) {
    return <div className="muted" style={{ marginTop: 6 }}>{emptyLabel}</div>;
  }

  return (
    <div className="col" style={{ marginTop: 8 }}>
      {loops.map((loop, li) => {
        const dc = defaultLoopColor(li);
        const defaultHex = hslToHex(dc.h, dc.s, dc.l);
        const override = overrides?.[loop.key];
        const current = override ?? defaultHex;
        const isShowing = highlightedKey === loop.key;

        return (
          <div
            key={loop.key}
            className="row spread"
            style={{ borderTop: "1px solid rgba(34,48,87,0.5)", paddingTop: 8 }}
          >
            <div className="row" style={{ alignItems: "center", gap: 8 }}>
              <input
                type="color"
                value={current}
                onChange={e => onSetColor(loop.key, e.target.value)}
                title="Loop color"
                style={{ width: 32, height: 32, padding: 0, border: "none", background: "none", cursor: "pointer" }}
              />
              <div>Loop {li + 1}</div>

              {onToggleHighlight && (
                <button
                  className={`btn ${isShowing ? "primary" : ""}`}
                  onClick={() => onToggleHighlight(loop.key)}
                >
                  {isShowing ? "Showing" : "Show"}
                </button>
              )}

              <span className="badge">x{loop.size}</span>
            </div>

            <button className="btn" disabled={!override} onClick={() => onResetColor(loop.key)}>
              Reset
            </button>
          </div>
        );
      })}
    </div>
  );
}
