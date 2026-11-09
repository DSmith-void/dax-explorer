# DAX Execution Explorer

A learning and debugging tool that will visually explain how a DAX expression is evaluated: filter context,
row context, context transition, CALCULATE modifiers, virtual tables, and more.

> **Status: early preview (milestone 3).** DAX is parsed into an expression tree (function calls, references,
> variables, operators) that you can click to highlight the matching text. Syntax errors are reported with
> positions and the parser recovers to show as much of the tree as possible. There is **no semantic (context)
> analysis yet**, and the app says so explicitly.

## Design principles

- **Deterministic semantics.** What an expression means is decided by explicit rules and tests, never by an AI model.
- **Never guess.** Unsupported or uncertain behavior is reported as such.
- **Known vs. unavailable.** Results distinguish what is certain from what needs model metadata, query/visual
  context, or actual data.
- **Local first.** Runs entirely in the browser. No backend, no accounts, no data leaves the page.
- **Synthetic examples only.** All samples use a made-up model (Sales, Product, Customer, Date, Plant).

## Requirements

- Node.js 24 (pinned in `.node-version`; the minimum supported by the toolchain is 22.12)
- npm

## Getting started

```sh
npm install
npm run dev       # start the local dev server
```

## Scripts

| Script            | What it does                                           |
| ----------------- | ------------------------------------------------------ |
| `npm run dev`     | Start the Vite dev server with hot reload              |
| `npm run build`   | Type-check (`tsc -b`) and build static files to `dist/` |
| `npm run preview` | Serve the production build locally                     |
| `npm run lint`    | Lint with oxlint                                       |
| `npm test`        | Run the unit tests once (Vitest)                       |
| `npm run test:watch` | Re-run tests automatically as files change          |

## Project layout

- `src/engine/` — the DAX engine: measure-header split, lexer and parser. Pure TypeScript with
  **no UI dependencies**; the linter enforces this.
- `src/app/`, `src/components/`, `src/styles/` — the React user interface.
- `src/samples/` — synthetic sample measures.

## Tech stack

React, TypeScript (strict), Vite, Vitest, and plain CSS with custom properties for light/dark themes.

## License

Not yet chosen.
