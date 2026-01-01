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
  
