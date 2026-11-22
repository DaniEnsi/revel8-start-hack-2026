# Canvas report format

The architectural review is a single Cursor Canvas (`.canvas.tsx`) the user opens beside the chat. Follow the `/canvas` skill for file location, imports, and slop rules. This file only covers the architecture-review layout and diagram patterns.

## File

```
/Users/<user>/.cursor/projects/<workspace>/canvases/architecture-review.canvas.tsx
```

- Default-export one React component.
- `import { … } from "cursor/canvas"` only — no relative imports, no npm, no Mermaid, no Tailwind CDN.
- Colors from `useHostTheme()` tokens. Flat surfaces only.
- Embed candidate data as const arrays/objects in the file.

## Scaffold

```tsx
import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Code,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Text,
  computeDAGLayout,
  useHostTheme,
} from "cursor/canvas";

const candidates = [ /* … */ ] as const;

export default function ArchitectureReview() {
  const theme = useHostTheme();
  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <H1>Architecture review</H1>
        <Text tone="secondary">{{repo}} · {{date}}</Text>
        {/* compact legend: solid = module, dashed = seam, accent = deep, danger stroke = leak */}
      </Stack>
      {/* candidate cards */}
      {/* top recommendation */}
    </Stack>
  );
}
```

No introduction paragraph — straight into candidates after the title/legend.

## Candidate card

Prose is sparse. Use `/codebase-design` glossary terms without ceremony.

Each candidate is one `Card` (collapsible is fine for long reviews):

- **Title** — short, names the deepening (plain text in `CardHeader`).
- **Trailing pills** — strength + dependency category in `CardHeader` `trailing`:
  - `Strong` → `Pill` tone `success`
  - `Worth exploring` → `Pill` tone `warning`
  - `Speculative` → `Pill` tone `neutral`
  - Category tag (`in-process`, `local-substitutable`, `ports & adapters`, `mock`) → second `Pill` tone `info` or `neutral`
- **Files** — `Code` / monospace `Text` list inside `CardBody`.
- **Before / After** — `Grid columns={2}` with two diagram panels. This is the centrepiece.
- **Problem / Solution** — one sentence each.
- **Wins** — short bullets (≤6 words each) naming locality / leverage / test-surface gains.
- **ADR callout** (if applicable) — `Callout` tone `warning`, one line.

Mix open sections with cards for the top recommendation — don't make the whole canvas a wall of identical cards.

## Diagram patterns

Prefer built-in primitives + raw SVG styled with theme tokens. Pick the pattern that fits. Mix them.

### DAG (call graphs / dependency flow)

Use `computeDAGLayout` then render SVG nodes/edges yourself:

```tsx
function DepGraph({ leakIds }: { leakIds: Set<string> }) {
  const theme = useHostTheme();
  const layout = computeDAGLayout({
    nodes: [{ id: "loaders" }, { id: "cmdk" }, { id: "ai" }, { id: "sitemap" }],
    edges: [
      { from: "loaders", to: "cmdk" },
      { from: "loaders", to: "ai" },
      { from: "loaders", to: "sitemap" },
    ],
    direction: "vertical",
    nodeWidth: 120,
    nodeHeight: 32,
  });
  return (
    <svg width={layout.width} height={layout.height}>
      {layout.edges.map((e) => (
        <line
          key={`${e.from}-${e.to}`}
          x1={e.sourceX}
          y1={e.sourceY}
          x2={e.targetX}
          y2={e.targetY}
          stroke={theme.stroke.secondary}
          strokeWidth={1.5}
          strokeDasharray={e.isBackEdge ? "4 4" : undefined}
        />
      ))}
      {layout.nodes.map((n) => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`}>
          <rect
            width={120}
            height={32}
            rx={4}
            fill={theme.fill.secondary}
            stroke={leakIds.has(n.id) ? theme.diff.removedStroke : theme.stroke.primary}
            strokeWidth={leakIds.has(n.id) ? 2 : 1}
          />
          <text x={60} y={20} textAnchor="middle" fill={theme.text.primary} fontSize={11}>
            {n.id}
          </text>
        </g>
      ))}
    </svg>
  );
}
```

- Solid stroke = module edge.
- Dashed stroke = seam / optional edge.
- Danger / `diff.removedStroke` = leakage.
- Deep module after: fill `theme.fill.primary` or thicker stroke with `theme.accent.primary`.

### Cross-section (layered shallowness)

Stack horizontal bands (`Row`/`div` with `borderLeft` from tokens) showing layers a call passes through.

- Before: several thin bands (HTTP → prompt → memory → context → stream).
- After: thin HTTP adapter + one thick deep band labelled with the consolidated responsibility.

### Mass diagram (interface as wide as implementation)

Two rectangles per module — short/tall relative heights:

- Before: interface band nearly as tall as implementation (shallow).
- After: short interface band over a tall implementation band (deep).

Use `theme.fill.tertiary` for interface, `theme.fill.primary` / accent for deep implementation. Label with `Text` size `small` uppercase via style, not emoji.

### Call-graph collapse

Before: nested boxes for the call tree. After: one deep box with internal calls shown in `theme.text.tertiary` inside it.

## Style guidance

- Flat, minimal, editorial — follow canvas slop rules (no gradients, shadows, emojis, rainbow).
- One accent for the top recommendation / deep modules; red/`danger`/`deleted` only for leakage.
- Keep before/after diagrams roughly equal height so the `Grid` reads as a pair.
- Module labels inside diagrams: small, schematic (`fontSize: 11`, uppercase tracking via `letterSpacing`).

## Top recommendation

One `Callout` tone `success` (or a distinct open `Stack` under `H2`) — candidate name, one sentence why, no second essay.

## Tone

Plain English, concise — architectural nouns from `/codebase-design`.

**Use exactly:** module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.

**Never substitute:** component, service, unit (for module) · API, signature (for interface) · boundary (for seam) · layer, wrapper (for module, when you mean module).

**Wins bullets** name the gain in glossary terms: *"locality: bugs concentrate in one module"*, *"leverage: one interface, N call sites"*, *"interface shrinks; implementation absorbs the wrappers"*. Don't write *"easier to maintain"* or *"cleaner code"*.

No hedging. If a sentence could be a bullet, make it a bullet.
