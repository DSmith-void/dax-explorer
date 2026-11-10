# DAX Execution Explorer

A learning and debugging tool that will visually explain how a DAX expression is evaluated: filter context,
row context, context transition, CALCULATE modifiers, virtual tables, and more.

> **Status: early preview (milestone 5).** DAX is parsed into a clickable expression tree, references are
> classified as measures or columns with their source of evidence, and a **symbolic context engine** shows, for
> every node, the filter and row context it is evaluated in and what it changes: CALCULATE filters and
> modifiers (REMOVEFILTERS, ALL, ALLEXCEPT, KEEPFILTERS), iterators, context transition, and when variables are
> evaluated. Filters coming from the report are shown as **F**. Relationships and anything else not modeled is
> labeled as such rather than guessed.

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

## DAX Explorer with your own data (Windows)

Without a connection the app explains DAX using built-in examples. To work with your own Power BI
model, use **DAX Explorer** (`DaxExplorer.exe`): a small local program that serves the app and
connects to reports open in Power BI Desktop on the same computer.

Build it once (requires the .NET 10 SDK; see `helper/global.json`):

```sh
npm run package      # creates release/DaxExplorer/DaxExplorer.exe (+ the app next to it)
```

Then double-click `release/DaxExplorer/DaxExplorer.exe`. It opens the app in your browser. In the
**Data** bar choose **Use my data**, pick a report open in Power BI Desktop and press **Connect**.
Nothing is read until you do. The packaged program is self-contained: it runs on Windows PCs without
.NET installed.

How it stays safe:

- It listens on `127.0.0.1` only (this computer, never the network) and rejects other host names.
- Each start creates a random token, passed to the page in the URL fragment (`#token=…`, never sent
  over the network); every data request must carry it, so other websites cannot read your model.
- It only runs read-only DAX queries, keeps model information in memory, and logs no model details.
- It only connects to ports that are running Power BI Desktop reports.

For UI development with hot reload **and** a Power BI connection, use `npm run dev:connected`: it
starts the helper and the dev server together with a shared random token (Ctrl+C stops both).
`npm run dev` alone works too, without the connection.

Helper tests: `dotnet test helper` (set `DAXEXPLORER_LIVE_TESTS=1` to also run the live test
against a single open synthetic report).

## Scripts

| Script            | What it does                                           |
| ----------------- | ------------------------------------------------------ |
| `npm run dev`     | Start the Vite dev server with hot reload              |
| `npm run dev:connected` | Dev server plus the local helper (Power BI Desktop connection) |
| `npm run package` | Build `release/DaxExplorer/DaxExplorer.exe` (Windows)  |
| `npm run build`   | Type-check (`tsc -b`) and build static files to `dist/` |
| `npm run preview` | Serve the production build locally                     |
| `npm run lint`    | Lint with oxlint                                       |
| `npm test`        | Run the unit tests once (Vitest)                       |
| `npm run test:watch` | Re-run tests automatically as files change          |

## Project layout

- `src/engine/` — the DAX engine: measure-header split, lexer, parser, function catalog, binder and the
  symbolic context analyzer.
  Pure TypeScript with **no UI dependencies**; the linter enforces this.
- `src/app/`, `src/components/`, `src/styles/` — the React user interface.
- `src/samples/` — synthetic sample measures.
- `helper/` — optional .NET 10 local helper that connects to Power BI Desktop (C#, ADOMD.NET).

## Tech stack

React, TypeScript (strict), Vite, Vitest, and plain CSS with custom properties for light/dark themes.

## License

Not yet chosen.
