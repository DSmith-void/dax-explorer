# DAX Execution Explorer

A learning and debugging tool that will visually explain how a DAX expression is evaluated: filter context,
row context, context transition, CALCULATE modifiers, virtual tables, and more.

> **Status: early preview (milestone 1).** The application shell exists, but there is **no DAX parser or
> analyzer yet**. Pressing *Analyze DAX* currently reports that analysis is unavailable.

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

## Tech stack

React, TypeScript (strict), Vite, and plain CSS with custom properties for light/dark themes.

## License

Not yet chosen.
