import type { StoreData } from "./types";
import { defaultDiagram, deepClone, uid } from "./utils";

const KEY = "cube-diagram-tool:v1";

export function loadStore(): StoreData {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const d = defaultDiagram();
    return {
      diagrams: [d],
      algorithms: [],
      ui: { lastDiagramId: d.id }
    };
  }
  try {
    const parsed = JSON.parse(raw) as StoreData;
    // minimal sanity
    if (!parsed.diagrams?.length) {
      const d = defaultDiagram();
      return { diagrams: [d], algorithms: [], ui: { lastDiagramId: d.id } };
    }
    return parsed;
  } catch {
    const d = defaultDiagram();
    return { diagrams: [d], algorithms: [], ui: { lastDiagramId: d.id } };
  }
}

export function saveStore(data: StoreData) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function exportJson(data: StoreData) {
  return JSON.stringify(data, null, 2);
}

export function importJson(text: string): StoreData | null {
  try {
    const parsed = JSON.parse(text) as StoreData;
    if (!parsed.diagrams || !Array.isArray(parsed.diagrams)) return null;
    if (!parsed.algorithms || !Array.isArray(parsed.algorithms)) return null;
    if (!parsed.ui || typeof parsed.ui !== "object") parsed.ui = {};
    // ensure ids exist
    for (const d of parsed.diagrams) if (!d.id) d.id = uid();
    for (const a of parsed.algorithms) if (!a.id) a.id = uid();
    return deepClone(parsed);
  } catch {
    return null;
  }
        }
