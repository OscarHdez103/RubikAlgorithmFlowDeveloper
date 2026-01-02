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

type Tool = "paint" | "link";

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

  // Keep selected albuttonid
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
                    <select className="field" value={moveFrom} onChange={e => setMoveFrom(e.target.value as any)}>
                      <option value="">From…</option>
                      {groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                    </select>
                    <select className="field" value={moveTo} onChange={e => setMoveTo(e.target.value as any)}>
                      <option value="">To…</option>
                      {groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                    </select>
                    <button className="btn primary" onClick={addMove}>Add</button>
                  </div>

                  <div className="col" style={{ marginTop: 10 }}>
                    {selectedAlgo.moves.map((m, i) => (
                      <div key={i} className="row spread" style={{ borderTop: "1px solid rgba(34,48,87,0.5)", paddingTop: 8 }}>
                        <div className="col" style={{ flex: 1 }}>
                          <div><span className="badge">from</span> {groups.find(g => g.id === m.fromGroupId)?.label ?? m.fromGroupId}</div>
                          <div><span className="badge">to</span> {groups.find(g => g.id === m.toGroupId)?.label ?? m.toGroupId}</div>
                        </div>
                        <button className="btn danger" onClick={() => deleteMove(i)}>Delete</button>
                      </div>
                    ))}
                  </div>
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
            <div style={{ fontWeight: 700 }}>Combine</div>
            <div className="muted">
              Only “closed loop” algorithms can be combined safely.
            </div>

            <div className="col" style={{ marginTop: 10 }}>
              <div className="row">
                <input className="field" value={combineName} onChange={e => setCombineName(e.target.value)} placeholder="New algorithm name" />
              </div>

              <div className="col" style={{ marginTop: 8 }}>
                <div className="muted">Power (apply an algorithm N times)</div>
                <select className="field" value={combineA} onChange={e => setCombineA(e.target.value as any)}>
                  <option value="">Choose algorithm…</option>
                  {diagramAlgos.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <div className="row">
                  <input
                    className="field"
                    type="number"
                    min={1}
                    max={999}
                    value={powerTimes}
                    onChange={e => setPowerTimes(Number(e.target.value))}
                  />
                  <button className="btn primary" onClick={() => combineCreate("power")}>Create A^N</button>
                </div>
              </div>

              <div className="col" style={{ marginTop: 12 }}>
                <div className="muted">Compose (A ∘ B = first B then A)</div>
                <select className="field" value={combineA} onChange={e => setCombineA(e.target.value as any)}>
                  <option value="">Choose A…</option>
                  {diagramAlgos.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <select className="field" value={combineB} onChange={e => setCombineB(e.target.value as any)}>
                  <option value="">Choose B…</option>
                  {diagramAlgos.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button className="btn primary" onClick={() => combineCreate("compose")}>Create A∘B</button>
              </div>

              <div className="muted" style={{ marginTop: 10 }}>
                If buttons do nothing: the selected algorithm(s) are not closed loops (some moved group missing incoming/outgoing).
              </div>
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

      <div className="canvasWrap">
        <DiagramCanvas
  diagram={selectedDiagram}
  algo={mode === "editAlgorithm" ? selectedAlgo : undefined}
  mode={mode}
  tool={tool}
  paintColor={paintColor}
  pendingLinkStickers={pendingLinkStickers}
  setPendingLinkStickers={setPendingLinkStickers}
  updateDiagram={updateDiagram}
  removeStickerFromLinks={removeStickerFromLinks}
  moveFrom={moveFrom}
  setMoveFrom={setMoveFrom}
  addMoveByGroup={(fromId, toId) => {
    if (!selectedAlgo) return;
    updateAlgo(a => {
      const hasOut = a.moves.some(m => m.fromGroupId === fromId);
      const hasIn = a.moves.some(m => m.toGroupId === toId);
      if (hasOut || hasIn) return;
      a.moves.push({ fromGroupId: fromId, toGroupId: toId });
    });
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

  // algorithm click-to-add
  moveFrom: Id | "";
  setMoveFrom: React.Dispatch<React.SetStateAction<Id | "">>;
  addMoveByGroup: (fromId: Id, toId: Id) => void;
};

function DiagramCanvas(props: CanvasProps) {
  const { diagram, algo, tool, paintColor } = props;

  // Dragging grids
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

  function groupIdForSticker(diagram: Diagram, ref: StickerRef): Id {
  const lg = findLinkGroupForSticker(diagram, ref);
  if (lg) return lg.id;
  return `single:${stickerKey(ref)}`;
}

function onStickerTap(ref: StickerRef) {
  // IMPORTANT: behavior depends on MODE, not TOOL
  if (props.mode === "editAlgorithm") {
    const gid = groupIdForSticker(diagram, ref);

    // first click sets "from"
    if (!props.moveFrom) {
      props.setMoveFrom(gid);
      return;
    }

    // second click sets "to" and adds move
    if (props.moveFrom !== gid) {
      props.addMoveByGroup(props.moveFrom as Id, gid);
    }

    // reset so next arrow is easy
    props.setMoveFrom("");
    return;
  }

  // Combine mode: ignore sticker taps (prevents paint leaking)
  if (props.mode === "combine") return;

  // Diagram mode: existing behavior
  if (tool === "paint") paint(ref);
  if (tool === "link") togglePending(ref);
}

  function onGridPointerDown(e: React.PointerEvent, gridId: Id) {
    if (tool !== "move") return;
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
    const dx = e.clientX - dr.startX;
    const dy = e.clientY - dr.startY;
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

  // Build arrow list from algorithm on *groups*
  const arrowSegments = useMemo(() => {
    if (!algo) return [];
    const d = diagram;
    const groups = allSelectableGroups(d);

    const idToMembers = new Map(groups.map(g => [g.id, g.members] as const));

    // For each move, choose a representative member (first sticker) as anchor point for the arrow.
    const arrows: { from: StickerRef; to: StickerRef; i: number }[] = [];
    algo.moves.forEach((m, i) => {
      const fromMembers = idToMembers.get(m.fromGroupId);
      const toMembers = idToMembers.get(m.toGroupId);
      if (!fromMembers?.length || !toMembers?.length) return;
      arrows.push({ from: fromMembers[0], to: toMembers[0], i });
    });
    return arrows;
  }, [algo, diagram]);

  // Create SVG paths using DOM positions
  const [paths, setPaths] = useState<{ d: string; head: { x: number; y: number; ang: number }; key: string }[]>([]);
  useEffect(() => {
    function recompute() {
      const out: { d: string; head: { x: number; y: number; ang: number }; key: string }[] = [];
      for (const a of arrowSegments) {
        const fromK = `${a.from.gridId}:${a.from.r}:${a.from.c}`;
        const toK = `${a.to.gridId}:${a.to.r}:${a.to.c}`;
        const fromEl = stickerEls.current.get(fromK);
        const toEl = stickerEls.current.get(toK);
        const fromGridEl = gridEls.current.get(a.from.gridId);
        const toGridEl = gridEls.current.get(a.to.gridId);
        if (!fromEl || !toEl || !fromGridEl || !toGridEl) continue;

        // Convert to canvas coordinates: use canvas root rect
        const canvasEl = document.getElementById("canvas-root");
        if (!canvasEl) continue;
        const canvasRect = canvasEl.getBoundingClientRect();

        const fr = fromEl.getBoundingClientRect();
        const tr = toEl.getBoundingClientRect();

        const x1 = (fr.left + fr.right) / 2 - canvasRect.left;
        const y1 = (fr.top + fr.bottom) / 2 - canvasRect.top;
        const x2 = (tr.left + tr.right) / 2 - canvasRect.left;
        const y2 = (tr.top + tr.bottom) / 2 - canvasRect.top;

        // simple bezier with offset to reduce overlap
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const offset = ((a.i % 5) - 2) * 10; // -20..+20
        const cx1 = x1 + dx * 0.35 + nx * offset;
        const cy1 = y1 + dy * 0.35 + ny * offset;
        const cx2 = x1 + dx * 0.65 + nx * offset;
        const cy2 = y1 + dy * 0.65 + ny * offset;

        const d = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;

        // arrowhead direction based on tangent near end
        const tx = x2 - cx2;
        const ty = y2 - cy2;
        const ang = Math.atan2(ty, tx);

        out.push({ d, head: { x: x2, y: y2, ang }, key: `${fromK}->${toK}:${a.i}` });
      }
      setPaths(out);
    }

    recompute();
    const onResize = () => recompute();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [arrowSegments, diagram]);

  return (
    <div
      id="canvas-root"
      className="canvas"
      onPointerMove={onGridPointerMove}
      onPointerUp={onGridPointerUp}
      onPointerCancel={onGridPointerUp}
    >
      {/* Arrows layer */}
      <svg className="svgOverlay">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="1.6" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {paths.map(p => (
          <g key={p.key} filter="url(#glow)">
            <path d={p.d} fill="none" stroke="rgba(106,168,255,0.9)" strokeWidth={2.2} />
            <ArrowHead x={p.head.x} y={p.head.y} ang={p.head.ang} />
          </g>
        ))}
      </svg>

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
              <span className="badge">{tool === "move" ? "drag" : "tap"}</span>
            </div>
          </div>

          <div
            className="stickerGrid"
            style={{ gridTemplateColumns: `repeat(${g.w}, 28px)` }}
          >
            {Array.from({ length: g.w * g.h }, (_, i) => {
              const r = Math.floor(i / g.w);
              const c = i % g.w;
              const ref: StickerRef = { gridId: g.id, r, c };
              const color = g.stickers[i];
              const link = findLinkGroupForSticker(diagram, ref);
              const key = `${g.id}:${r}:${c}`;
              const selected = tool === "link" && isPending(ref);

const gid = groupIdForSticker(diagram, ref);
const isAlgoFrom = props.mode === "editAlgorithm" && props.moveFrom && props.moveFrom === gid;

              return (
                <div
                  key={key}
                  ref={el => setStickerEl(key, el)}
                  className={`sticker ${selected ? "selected" : ""} ${isAlgoFrom ? "selected" : ""}`}
                  style={{ background: COLOR_HEX[color] }}
                  onClick={() => onStickerTap(ref)}
                  onContextMenu={(e) => {
  e.preventDefault();
  if (props.mode === "editDiagram") props.removeStickerFromLinks(ref);
}}
                  title={link ? `Linked: ${link.name} (right-click/long-press to unlink)` : "Unlinked (tap to paint/link)"}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ArrowHead({ x, y, ang }: { x: number; y: number; ang: number }) {
  const size = 7;
  const a1 = ang + Math.PI * 0.8;
  const a2 = ang - Math.PI * 0.8;
  const x1 = x + Math.cos(a1) * size;
  const y1 = y + Math.sin(a1) * size;
  const x2 = x + Math.cos(a2) * size;
  const y2 = y + Math.sin(a2) * size;

  return (
    <path
      d={`M ${x} ${y} L ${x1} ${y1} L ${x2} ${y2} Z`}
      fill="rgba(106,168,255,0.95)"
      stroke="rgba(0,0,0,0.25)"
      strokeWidth={1}
    />
  );
}
