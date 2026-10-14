export type Id = string;

export type StickerColor =
  | "white" | "yellow" | "red" | "orange" | "blue" | "green"
  | "gray" | "black" | "purple" | "pink" | "cyan" | "lime";

export const COLOR_HEX: Record<StickerColor, string> = {
  white: "#f3f6ff",
  yellow: "#ffd84d",
  red: "#ff4b5b",
  orange: "#ff8a2a",
  blue: "#3f7cff",
  green: "#35d07f",
  gray: "#8a93ad",
  black: "#0b0d12",
  purple: "#b16dff",
  pink: "#ff6ad7",
  cyan: "#45e6ff",
  lime: "#b7ff57"
};

export type StickerRef = {
  gridId: Id;
  r: number;
  c: number;
};

export type Grid = {
  id: Id;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  stickers: StickerColor[]; // length w*h
};

export type LinkGroup = {
  id: Id;
  name: string;
  stickers: StickerRef[]; // references across grids
};

export type Diagram = {
  id: Id;
  name: string;
  grids: Grid[];
  links: LinkGroup[];
};

export type AlgoMove = {
  // moves defined on link-groups or single stickers if not in any group
  fromGroupId: Id;
  toGroupId: Id;
  fromSticker?: StickerRef; // which sticker user clicked for "from"
  toSticker?: StickerRef;   // which sticker user clicked for "to"
};

export type Algorithm = {
  id: Id;
  diagramId: Id;
  name: string;
  moves: AlgoMove[];
  // Optional per-loop color overrides. Keyed by a stable loop key (see computeMoveLoops in utils.ts).
  // When absent for a loop, a default color is generated automatically.
  loopColors?: Record<string, string>;
};

export type StoreData = {
  diagrams: Diagram[];
  algorithms: Algorithm[];
  ui: {
    lastDiagramId?: Id;
  };
};
