import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Algorithm, Diagram, Id, StickerColor, StickerRef, StoreData } from "./types";
import { COLOR_HEX } from "./types";
import { exportJson, importJson, loadStore, saveStore } from "./storage";
import {
  allSelectableGroups,
  applyPermutationPower,
  clamp,
  composePermutations,
  defaultDiagram,
  deepClone,
  findLinkGroupForSticker,
  idx,
  movesToPermutation,
  normalizeMoves,
  permutationToMoves,
  uid,
  validateClosedLoop
} from "./utils";

type Mode = "editDiagram" | "editAlgorithm" | "combine";

type Tool = "paint" | "link" | "move";

export function App() {
  const [store, setStore] = useState<StoreData>(() => loadStore());
  const [mode, setMode] = useState<Mode>("editDiagram");
  const [tool, setTool] = useState<Tool>("paint");

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

  // Algorithm moves editor
  const [moveFrom, setMoveFrom] = useState<Id | "">("");
  const [moveTo, setMoveTo] = useState<Id | "">("");

  // Combine
  const [combineA, setCombineA] = useState<Id | "">("");
  const [combineB, setCombineB] = useState<Id | "">("");
  const [powerTimes, setPowerTimes] = useState<number>(2);
  const [combineName, setCombineName] = useState("Combined");

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

  // Keep selected algo valid
  useEffect(() => {
    const algos = store.algorithms.filter(a => a.diagramId === selectedDiagram.id);
    if (!algos.length) setSelectedAlgoId(undefined);
    else if (!selectedAlgoId || !algos.some(a => a.id === selectedAlgoId)) setSelectedAlgoId(algos[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.algorithms, selectedDiagram.id]);

  const groups = useMemo(() => allSelectableGroups(selectedDiagram), [selectedDiagram]);

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
    // selectedDiagramId will update via ui.lastDiagramId effect, but we set directly too:
    const nextId = store.diagrams.length ? `pending` : `pending`;
    void nextId;
    setSelectedDiagramId(prev => prev); // no-op; selection will change after store updates
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
  }

  function deleteAlgorithm(id: Id) {
    setStore(prev => {
      const next = deepClone(prev);
      next.algorithms = next.algorithms.filter(a => a.id !== id);
      return next;
    });
    if (selectedAlgoId === id) setSelectedAlgoId(undefined);
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
      // remove references from links
      for (const lg of d.links) lg.stickers = lg.stickers.filter(s => s.gridId !== gridId);
      d.links = d.links.filter(lg => lg.stickers.length >= 2);
    });
  }

  function createLinkGroup() {
    if (pendingLinkStickers.length < 2) return;
    updateDiagram(d => {
      // remove these stickers from any existing link groups first
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

  function addMove() {
    if (!selectedAlgo) return;
    if (!moveFrom || !moveTo) return;
    if (moveFrom === moveTo) return;

    updateAlgo(a => {
      // enforce at most one outgoing + incoming per group
      const hasOut = a.moves.some(m => m.fromGroupId === moveFrom);
      const hasIn = a.moves.some(m => m.toGroupId === moveTo);
      if (hasOut || hasIn) return;

      a.moves.push({ fromGroupId: moveFrom as Id, toGroupId: moveTo as Id });
    });
  }

  function deleteMove(i: number) {
    updateAlgo(a => {
      a.moves.splice(i, 1);
    });
  }

  function combineCreate(type: "compose" | "power") {
    // Build permutation from algos (must be closed loops)
    const a = store.algorithms.find(x => x.id === combineA);
    if (!a) return;

    const diagram = store.diagrams.find(d => d.id === selectedDiagram.id)!;

    const valA = validateClosedLoop(a.moves);
    if (!valA.ok) return;

    let permA = movesToPermutation(a.moves);

    let permOut = new Map<Id, Id>();

    if (type === "power") {
      const times = clamp(Math.floor(powerTimes), 1, 999);
      permOut = applyPermutationPower(permA, times);
    } else {
      const b = store.algorithms.find(x => x.id === combineB);
      if (!b) return;
      const valB = validateClosedLoop(b.moves);
      if (!valB.ok) return;
      const permB = movesToPermutation(b.moves);
      // compose: first B then A
      permOut = composePermutations(permA, permB);
    }

    const outMoves = permutationToMoves(permOut);

    const newAlgo: Algorithm = {
      id: uid(),
      diagramId: diagram.id,
      name: combineName.trim() || "Combined",
      moves: outMoves
    };

    setStore(prev => {
      const next = deepClone(prev);
      next.algorithms.push(newAlgo);
      return next;
    });
    setSelectedAlgoId(newAlgo.id);
    setMode("editAlgorithm");
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

  return (
    <div className="app">
      <div className="sidebar">
        <div className="header">
          <div className="col">
            <div style={{ fontSize: 16, fontWeight: 700 }}>Cube Diagram Tool</div>
            <div className="muted">Diagrams • Links • Algorithms • Combine</div>
          </div>
          <div className="row">
            <button className={`btn ${mode === "editDiagram" ? "primary" : ""}`} onClick={() => setMode("editDiagram")}>Diagram</button>
            <button className={`btn ${mode === "editAlgorithm" ? "primary" : ""}`} onClick={() => setMode("editAlgorithm")}>Algorithm</button>
            <button className={`btn ${mode === "combine" ? "primary" : ""}`} onClick={() => setMode("combine")}>Combine</button>
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
              <button className={`btn ${tool === "move" ? "primary" : ""}`} onClick={() => setTool("move")}>Move grids</button>
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
                  onChange={e => setSelectedAlgoId(e.target.value || undefined)}
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
                    Rule enforced: each group has ≤1 outgoing, and each group has ≤1 incoming.
                  </div>

                  <div className="row" style={{ marginTop: 8 }}>
                    <select className="field" value={moveFrom} onChange={e => setMoveFrom(e.target.value as a
