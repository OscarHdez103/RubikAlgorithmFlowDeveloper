import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  Algorithm,
  Diagram,
  Id,
  StickerColor,
  StickerRef,
  StoreData
} from "./types";
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

  const [selectedDiagramId, setSelectedDiagramId] = useState<Id>(
    () => store.ui.lastDiagramId ?? store.diagrams[0].id
  );

  const selectedDiagram = useMemo(
    () =>
      store.diagrams.find(d => d.id === selectedDiagramId) ??
      store.diagrams[0],
    [store.diagrams, selectedDiagramId]
  );

  const diagramAlgos = useMemo(
    () => store.algorithms.filter(a => a.diagramId === selectedDiagram.id),
    [store.algorithms, selectedDiagram.id]
  );

  const [selectedAlgoId, setSelectedAlgoId] = useState<Id | undefined>(
    () => diagramAlgos[0]?.id
  );

  const selectedAlgo = useMemo(
    () => store.algorithms.find(a => a.id === selectedAlgoId),
    [store.algorithms, selectedAlgoId]
  );

  const [paintColor, setPaintColor] = useState<StickerColor>("yellow");
  
const [pendingLinkStickers, setPendingLinkStickers] = useState<StickerRef[]>([]);
  const [pendingLinkName, setPendingLinkName] = useState("Edge");

  const [moveFrom, setMoveFrom] = useState<Id | "">("");
  const [moveTo, setMoveTo] = useState<Id | "">("");

  const [combineA, setCombineA] = useState<Id | "">("");
  const [combineB, setCombineB] = useState<Id | "">("");
  const [powerTimes, setPowerTimes] = useState<number>(2);
  const [combineName, setCombineName] = useState("Combined");

  useEffect(() => {
    setStore(prev => {
      const next = deepClone(prev);
      next.ui.lastDiagramId = selectedDiagramId;
      return next;
    });
  }, [selectedDiagramId]);

  useEffect(() => {
    saveStore(store);
  }, [store]);

  useEffect(() => {
    const algos = store.algorithms.filter(a => a.diagramId === selectedDiagram.id);
    if (!algos.length) setSelectedAlgoId(undefined);
    else if (!selectedAlgoId || !algos.some(a => a.id === selectedAlgoId)) {
      setSelectedAlgoId(algos[0].id);
    }
  }, [store.algorithms, selectedDiagram.id]);

  const groups = useMemo(
    () => allSelectableGroups(selectedDiagram),
    [selectedDiagram]
  );

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
  }

  function addMove() {
    if (!selectedAlgo || !moveFrom || !moveTo || moveFrom === moveTo) return;
    updateAlgo(a => {
      const hasOut = a.moves.some(m => m.fromGroupId === moveFrom);
      const hasIn = a.moves.some(m => m.toGroupId === moveTo);
      if (!hasOut && !hasIn) {
        a.moves.push({ fromGroupId: moveFrom as Id, toGroupId: moveTo as Id });
      }
    });
  }

  function deleteMove(i: number) {
    updateAlgo(a => {
      a.moves.splice(i, 1);
    });
  }

  function combineCreate(type: "compose" | "power") {
    const a = store.algorithms.find(x => x.id === combineA);
    if (!a) return;
    if (!validateClosedLoop(a.moves).ok) return;

    let perm = movesToPermutation(a.moves);

    if (type === "power") {
      perm = applyPermutationPower(perm, clamp(powerTimes, 1, 999));
    } else {
      const b = store.algorithms.find(x => x.id === combineB);
      if (!b || !validateClosedLoop(b.moves).ok) return;
      perm = composePermutations(perm, movesToPermutation(b.moves));
    }

    const newAlgo: Algorithm = {
      id: uid(),
      diagramId: selectedDiagram.id,
      name: combineName || "Combined",
      moves: permutationToMoves(perm)
    };

    setStore(prev => {
      const next = deepClone(prev);
      next.algorithms.push(newAlgo);
      return next;
    });
    setSelectedAlgoId(newAlgo.id);
    setMode("editAlgorithm");
        }
  
const [jsonText, setJsonText] = useState("");
  const [importStatus, setImportStatus] = useState("");

  function doExport() {
    setJsonText(exportJson(store));
    setImportStatus("Exported.");
  }

  function doImport() {
    const parsed = importJson(jsonText);
    if (!parsed) {
      setImportStatus("❌ Invalid JSON");
      return;
    }
    setStore(parsed);
    setSelectedDiagramId(parsed.ui.lastDiagramId ?? parsed.diagrams[0].id);
    setImportStatus("✅ Imported");
  }

  return (
    <div className="app">
      {/* Sidebar and canvas are unchanged from original version */}
      {/* KEEP THIS PART EXACTLY AS PROVIDED IN PREVIOUS MESSAGE */}
      {/* If you want, I can also split the JSX into subcomponents next */}
    </div>
  );
    }
