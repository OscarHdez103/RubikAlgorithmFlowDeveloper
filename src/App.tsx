
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
      <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
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

              return (
                <div
                  key={key}
                  ref={el => setStickerEl(key, el)}
                  className={`sticker ${selected ? "selected" : ""}`}
                  style={{ background: COLOR_HEX[color] }}
                  onClick={() => onStickerTap(ref)}
                  onContextMenu={(e) => {
                    // long press/right click: remove from links
                    e.preventDefault();
                    props.removeStickerFromLinks(ref);
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
