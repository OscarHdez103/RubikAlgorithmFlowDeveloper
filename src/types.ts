:root {
  --bg: #0b0d12;
  --panel: #121726;
  --panel2: #0f1320;
  --text: #e8ecff;
  --muted: #aab2d5;
  --border: #223057;
  --accent: #6aa8ff;
  --danger: #ff6a7a;
  --ok: #57ffb0;
}

* { box-sizing: border-box; }
html, body { height: 100%; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; }
button, input, select { font: inherit; }

a { color: var(--accent); }

.app {
  display: grid;
  grid-template-columns: 340px 1fr;
  height: 100vh;
}

@media (max-width: 920px) {
  .app { grid-template-columns: 1fr; grid-template-rows: 330px 1fr; }
}

.sidebar {
  border-right: 1px solid var(--border);
  background: linear-gradient(180deg, var(--panel), var(--panel2));
  padding: 12px;
  overflow: auto;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.card {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  background: rgba(255,255,255,0.02);
  margin-bottom: 12px;
}

.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.col { display: flex; flex-direction: column; gap: 8px; }
.spread { justify-content: space-between; }
.muted { color: var(--muted); font-size: 12px; }

.btn {
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.03);
  color: var(--text);
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
}
.btn:hover { border-color: #3a4f86; }
.btn.primary { border-color: rgba(106,168,255,0.6); box-shadow: 0 0 0 1px rgba(106,168,255,0.2) inset; }
.btn.danger { border-color: rgba(255,106,122,0.6); }

.field {
  width: 100%;
  border: 1px solid var(--border);
  background: rgba(0,0,0,0.25);
  color: var(--text);
  padding: 8px 10px;
  border-radius: 10px;
}

.canvasWrap {
  position: relative;
  overflow: hidden;
}

.canvas {
  position: relative;
  width: 100%;
  height: 100%;
  touch-action: none;
  background:
    radial-gradient(circle at 30% 20%, rgba(106,168,255,0.08), transparent 45%),
    radial-gradient(circle at 70% 60%, rgba(87,255,176,0.06), transparent 55%),
    linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.0));
}

.grid {
  position: absolute;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  background: rgba(0,0,0,0.22);
  box-shadow: 0 10px 30px rgba(0,0,0,0.35);
  user-select: none;
}

.gridTitle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.stickerGrid {
  display: grid;
  gap: 6px;
}

.sticker {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: 1px solid rgba(255,255,255,0.15);
  box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset;
  position: relative;
}

.sticker.selected {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.badge {
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
}

.statusOk { color: var(--ok); }
.statusBad { color: var(--danger); }
.small { font-size: 12px; }
