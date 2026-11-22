# Canvas lesson & reference format

Lessons and reference sheets are Cursor Canvases (`.canvas.tsx`) the user opens beside the chat. Follow the `/canvas` skill for file location, imports, and slop rules. This file only covers teach-specific layout, naming, and quiz patterns.

## Files

```
/Users/<user>/.cursor/projects/<workspace>/canvases/lesson-0001-<dash-case-name>.canvas.tsx
/Users/<user>/.cursor/projects/<workspace>/canvases/reference-<dash-case-name>.canvas.tsx
```

- Default-export one React component per file.
- `import { … } from "cursor/canvas"` only — no relative imports, no npm, no Mermaid, no Tailwind CDN, no `./assets/` helpers.
- Colors from `useHostTheme()` tokens. Flat surfaces only.
- Embed all lesson content and quiz data inline — no `fetch()`, no network calls.
- Never write `.html` for lessons or references.

## Durable catalogs (teaching workspace)

Canvases live outside the teaching directory, so keep thin indexes in the workspace:

### `./lessons/INDEX.md`

```md
# Lessons

| # | Title | Purpose | Canvas |
|---|-------|---------|--------|
| 0001 | Progressive overload | One-session win: add load without form collapse | `/Users/<user>/.cursor/projects/<workspace>/canvases/lesson-0001-progressive-overload.canvas.tsx` |
```

### `./reference/INDEX.md`

```md
# Reference

| Slug | Title | Canvas |
|------|-------|--------|
| rpe-scale | RPE quick scale | `/Users/<user>/.cursor/projects/<workspace>/canvases/reference-rpe-scale.canvas.tsx` |
```

## Lesson scaffold

```tsx
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Divider,
  H1,
  H2,
  Link,
  Pill,
  Row,
  Stack,
  Text,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

const primarySource = {
  title: "…",
  href: "https://…",
} as const;

const quiz = {
  prompt: "…",
  choices: ["…", "…", "…", "…"] as const,
  correctIndex: 0,
} as const;

export default function Lesson0001Example() {
  const theme = useHostTheme();
  const [selected, setSelected] = useCanvasState<number | null>("selected", null);
  const [revealed, setRevealed] = useCanvasState("revealed", false);

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Row gap={8}>
          <Pill tone="info">Lesson 0001</Pill>
          <Text tone="secondary">Tied to mission · ~5 min</Text>
        </Row>
        <H1>Lesson title — one tangible win</H1>
        <Text tone="secondary">One sentence: what they can do after this lesson.</Text>
      </Stack>

      <Stack gap={12}>
        <H2>Know</H2>
        {/* tight knowledge only — cite with Link */}
      </Stack>

      <Stack gap={12}>
        <H2>Practice</H2>
        {/* quiz or steps — feedback via useCanvasState */}
      </Stack>

      <Callout tone="neutral">
        Ask follow-up questions in chat — the agent is your teacher for anything unclear.
      </Callout>

      <Stack gap={4}>
        <Text weight="semibold">Primary source</Text>
        <Link href={primarySource.href}>{primarySource.title}</Link>
      </Stack>
    </Stack>
  );
}
```

## Lesson structure

Keep one job per section. Typical order:

1. **Header** — lesson number pill, title (the win), one supporting sentence.
2. **Know** — only the knowledge required for the skill. Sparse prose. Cite claims with `Link`.
3. **Practice** — retrieval or steps with a tight feedback loop.
4. **Teacher reminder** — `Callout` telling them to ask follow-ups in chat.
5. **Primary source** — one high-trust resource.

Optional: a compact "Also see" row naming related lesson/reference canvases (paths also live in INDEX.md).

## Quiz pattern

- Equal-length choice labels (same word count; same character count when possible).
- Immediate feedback after submit — right/wrong + one-line why.
- Use `useCanvasState` so answers persist while the canvas stays open.
- Prefer `Checkbox` / `Button` / `Select` from `cursor/canvas` — never custom HTML forms.

## Reference scaffold

References are denser and more scannable than lessons — tables, short definition stacks, numbered sequences. No long teaching prose.

```tsx
import { H1, H2, Stack, Table, Text, useHostTheme } from "cursor/canvas";

export default function ReferenceExample() {
  useHostTheme();
  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <H1>Reference title</H1>
        <Text tone="secondary">Compressed essence — quick lookup</Text>
      </Stack>
      <H2>Section</H2>
      {/* Table, definition rows, or step lists */}
    </Stack>
  );
}
```

Glossaries: keep canonical terms in workspace `GLOSSARY.md`; the reference canvas is the visual quick-lookup of that same language — don't fork definitions.

## Slop / quality

- Flat, minimal, editorial — canvas slop rules (no gradients, shadows, emojis, rainbow).
- Mix open sections with cards; don't wrap every block in the same card.
- Never render empty quiz or placeholder sections — omit until you have real content.
- Pre-delivery: canvas TypeScript check clean; chat includes a markdown link to the `.canvas.tsx`.
