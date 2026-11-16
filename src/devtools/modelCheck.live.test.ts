/**
 * The claim checker on a connected model: asks Power BI every claim the explanations make, for every measure of
 * the model, under a few report-filter setups picked from the columns those measures use. Read-only: every
 * query is an EVALUATE.
 *
 * Runs only when asked, naming the report the helper is connected to (it refuses any other):
 *   CLAIMS_MODEL="Report name" CLAIMS_HELPER=http://127.0.0.1:5093 DAXEXPLORER_HELPER_TOKEN=… npx vitest run src/devtools/modelCheck
 * Optional: CLAIMS_OUT (the report's path), CLAIMS_MAX_MEASURES (default 300), CLAIMS_FILTER_COLUMNS (default 4).
 *
 * The report holds the model's measure names and code, so it is written outside the repository by default (the
 * system's temp folder): never commit it.
 */
import { describe, expect, it } from 'vitest';
import { createHelperClient, type ModelMetadata } from '../app/helperClient';
import { measureDefinitionText, toModelSnapshot, toRelationshipModel } from '../app/modelConversion';
import type { ColumnName } from '../engine/context/model';
import { columnDax, type FilterValue, type ReportFilter } from '../engine/context/reportFilters';
import { splitMeasureDefinition } from '../engine/definition';
import { tokenize } from '../engine/lexer/lexer';
import { createModelIndex } from '../engine/model';
import { childrenOf, type AstNode } from '../engine/parser/ast';
import { parse } from '../engine/parser/parser';
import { askMeasure, type ClaimClient, type Scenario } from './claimAsk';
import type { MeasureRun, RunModel } from './claimRun';

declare const process: { env: Record<string, string | undefined> };

/** Node's file functions, loaded by name (the project has no Node type definitions). */
async function nodeFiles() {
  const [fs, os] = ['node:fs', 'node:os'];
  return {
    ...((await import(/* @vite-ignore */ fs)) as { mkdirSync: (path: string, options: { recursive: boolean }) => void; writeFileSync: (path: string, text: string) => void }),
    ...((await import(/* @vite-ignore */ os)) as { tmpdir: () => string }),
  };
}
const reportName = process.env.CLAIMS_MODEL;

describe.skipIf(!reportName)('claim checker (live, on the connected model)', () => {
  it('asks Power BI every claim for the model’s measures', async () => {
    const base = process.env.CLAIMS_HELPER ?? 'http://127.0.0.1:5093';
    const client = createHelperClient(process.env.DAXEXPLORER_HELPER_TOKEN ?? null, (path, init) => fetch(base + String(path), init));
    // Guard: only the report named on the command line.
    const health = await client.check();
    const connected = health.kind === 'available' ? health.status.connection?.reportName : null;
    expect(connected, `the helper must be connected to "${reportName}"`).toBe(reportName);

    const metadata = await client.model();
    const model: RunModel = { index: createModelIndex(toModelSnapshot(metadata)), relationships: toRelationshipModel(metadata) };
    const max = Number(process.env.CLAIMS_MAX_MEASURES ?? 300);
    const measures = metadata.measures.slice(0, max).map((m) => ({ id: `${m.table}[${m.name}]`, definition: measureDefinitionText(m.name, m.expression) }));
    const scenarios = await pickScenarios(client, metadata, measures.map((m) => m.definition), Number(process.env.CLAIMS_FILTER_COLUMNS ?? 4));

    const disagreements: string[] = [];
    let asked = 0;
    let confirmed = 0;
    let unaskable = 0;
    const perMeasure: { id: string; steps: number; unchecked: number; claims: number; disagreements: number }[] = [];
    const reasons = new Map<string, number>();
    const unknownFunctions = new Map<string, number>();
    for (const measure of measures) {
      let first: MeasureRun | null = null;
      let claims = 0;
      let wrong = 0;
      for (const scenario of scenarios) {
        const result = await askMeasure(client, measure.id, measure.definition, scenario, model);
        first ??= result.run;
        asked += result.asked;
        confirmed += result.confirmed.length;
        unaskable += result.unaskable.length;
        claims += result.asked;
        wrong += result.disagreements.length;
        disagreements.push(...result.disagreements);
      }
      // How much of the measure the app can explain (from its first run: the steps don't depend on the filters).
      const steps = first ? [...first.analysis.steps.values()] : [];
      const unchecked = steps.filter((s) => s.context.unknownReason || s.context.filter.caveats.length > 0).length;
      for (const insight of first?.analysis.insights ?? []) {
        if (insight.kind === 'not-modeled') reasons.set(insight.message, (reasons.get(insight.message) ?? 0) + 1);
      }
      for (const name of first?.options.binding?.unknownFunctions ?? []) unknownFunctions.set(name.toUpperCase(), (unknownFunctions.get(name.toUpperCase()) ?? 0) + 1);
      perMeasure.push({ id: measure.id, steps: steps.length, unchecked, claims, disagreements: wrong });
    }

    const fullyChecked = perMeasure.filter((m) => m.unchecked === 0).length;
    const sorted = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1]);
    const report = [
      `# Claim check: ${reportName}`,
      '',
      `${measures.length} measures, ${scenarios.length} filter setups (${scenarios.map((s) => s.id).join('; ')}).`,
      `${asked} claims asked: ${confirmed} confirmed, ${disagreements.length} disagreements, ${unaskable} not asked (they need a picked row).`,
      `${fullyChecked} of ${measures.length} measures are explained with no "not checked" step.`,
      '',
      '## Disagreements',
      ...(disagreements.length > 0 ? disagreements : ['None.']),
      '',
      '## Why steps are "not checked"',
      ...(reasons.size > 0 ? sorted(reasons).map(([reason, n]) => `- ${n} × ${reason}`) : ['Nothing.']),
      '',
      '## Functions the app doesn’t know',
      ...(unknownFunctions.size > 0 ? sorted(unknownFunctions).map(([name, n]) => `- ${name}: ${n} measure${n === 1 ? '' : 's'}`) : ['None.']),
      '',
      '## Measures',
      '| Measure | Steps | Not checked | Claims | Disagreements |',
      '|---|---|---|---|---|',
      ...perMeasure.map((m) => `| ${m.id.replace(/\|/g, '\\|')} | ${m.steps} | ${m.unchecked} | ${m.claims} | ${m.disagreements} |`),
      '',
    ].join('\n');
    const { mkdirSync, writeFileSync, tmpdir } = await nodeFiles();
    const out = process.env.CLAIMS_OUT ?? `${tmpdir()}/dax-explorer-claims/${reportName!.replace(/[^\w.-]+/g, '_')}.md`;
    mkdirSync(out.replace(/[\\/][^\\/]*$/, ''), { recursive: true });
    writeFileSync(out, report);
    console.log([...report.split('\n').slice(2, 5), `Report: ${out}`].join('\n'));
  }, 3_600_000);
});

/**
 * The filter setups: none, then one value each for the columns the measures use most (2 to 200 values, read
 * from the model), then the first two of those from different tables together.
 */
async function pickScenarios(client: ClaimClient, metadata: ModelMetadata, definitions: string[], count: number): Promise<Scenario[]> {
  const known = new Set(metadata.columns.map((c) => `${c.table}[${c.name}]`.toLowerCase()));
  const groups = new Set((metadata.calculationGroups ?? []).map((g) => g.table.toLowerCase()));
  const uses = new Map<string, { column: ColumnName; n: number }>();
  for (const definition of definitions) {
    const start = splitMeasureDefinition(definition).header?.expressionStart ?? 0;
    const { root } = parse(tokenize(definition, start).tokens);
    const visit = (node: AstNode) => {
      if (node.kind === 'ColumnRef') {
        const key = `${node.table}[${node.column}]`.toLowerCase();
        if (known.has(key) && !groups.has(node.table.toLowerCase()) && !/^(LocalDateTable|DateTableTemplate)_/.test(node.table)) {
          const entry = uses.get(key) ?? { column: { table: node.table, column: node.column }, n: 0 };
          entry.n++;
          uses.set(key, entry);
        }
      }
      for (const child of childrenOf(node)) visit(child.node);
    };
    if (root) visit(root);
  }
  // Columns a report would filter by: text, dates and whole numbers (not amounts), on lookup tables (the one
  // side of a relationship) first, and not keys.
  const typeOf = new Map(metadata.columns.map((c) => [`${c.table}[${c.name}]`.toLowerCase(), c.dataType.toLowerCase()]));
  const factTables = new Set(metadata.relationships.filter((r) => r.fromCardinality.toLowerCase() === 'many').map((r) => r.fromTable.toLowerCase()));
  const score = (c: ColumnName) => {
    const type = typeOf.get(`${c.table}[${c.column}]`.toLowerCase()) ?? '';
    // (INFO.VIEW.COLUMNS calls decimals "Number" and whole numbers "Integer".)
    if (/^number$|double|decimal|currency/.test(type) || /(key|id)$/i.test(c.column)) return -1;
    return factTables.has(c.table.toLowerCase()) ? 1 : 2;
  };
  const candidates = [...uses.values()].filter((u) => score(u.column) > 0).sort((a, b) => score(b.column) - score(a.column) || b.n - a.n);
  const picked: { column: ColumnName; value: FilterValue }[] = [];
  for (const { column } of candidates) {
    if (picked.length >= count) break;
    const ref = columnDax(column);
    try {
      const n = (await client.evaluate('scalar', `COUNTROWS(VALUES(${ref}))`)).rows[0]?.[0];
      if (typeof n !== 'number' || n < 2 || n > 200) continue;
      const first = await client.evaluate('table', `TOPN(1, FILTER(VALUES(${ref}), NOT ISBLANK(${ref})), ${ref}, ASC)`, 1);
      const value = first.rows[0]?.[0];
      if (value === undefined || value === null) continue;
      picked.push({ column, value: value as FilterValue });
    } catch {
      // A column whose values can't be read: left out.
    }
  }
  const filter = (p: { column: ColumnName; value: FilterValue }): ReportFilter => ({ kind: 'values', column: p.column, values: [p.value] });
  const label = (p: { column: ColumnName; value: FilterValue }) => `${p.column.table}[${p.column.column}] = ${JSON.stringify(p.value)}`;
  const scenarios: Scenario[] = [{ id: 'no filters', filters: [] }, ...picked.map((p) => ({ id: label(p), filters: [filter(p)] }))];
  const second = picked.find((p) => p.column.table.toLowerCase() !== picked[0]?.column.table.toLowerCase());
  if (picked[0] && second) scenarios.push({ id: `${label(picked[0])} and ${label(second)}`, filters: [filter(picked[0]), filter(second)] });
  return scenarios;
}
