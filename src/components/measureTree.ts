/** A connected model's measure, as the picker lists it. */
export interface PickerMeasure {
  name: string;
  /** "Name =\nexpression", ready to explain. */
  text: string;
  /** The home table. */
  table: string;
  /** Power BI's display folder: "Sales\Targets" nests; "A;B" puts the measure in two folders. */
  folder: string | null;
}

export type MeasureNode =
  | { kind: 'folder'; name: string; /** Unique path, for remembering which folders are open. */ key: string; children: MeasureNode[]; count: number }
  | { kind: 'measure'; measure: PickerMeasure };

const byName = (a: MeasureNode, b: MeasureNode) => {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  const an = a.kind === 'folder' ? a.name : a.measure.name;
  const bn = b.kind === 'folder' ? b.name : b.measure.name;
  return an.localeCompare(bn, undefined, { sensitivity: 'base' });
};

/**
 * The measures as Power BI's Data pane shows them: home table, then display folders (nested with "\"),
 * then the measures. The table level is left out when only one table has measures.
 */
export function measureTree(measures: readonly PickerMeasure[]): MeasureNode[] {
  const tables = [...new Set(measures.map((m) => m.table))];
  const byTable = tables.length > 1;
  const root: MeasureNode[] = [];

  const folderIn = (list: MeasureNode[], name: string, key: string) => {
    let folder = list.find((n): n is Extract<MeasureNode, { kind: 'folder' }> => n.kind === 'folder' && n.name.toLowerCase() === name.toLowerCase());
    if (!folder) {
      folder = { kind: 'folder', name, key, children: [], count: 0 };
      list.push(folder);
    }
    return folder;
  };

  for (const measure of measures) {
    const folders = (measure.folder ?? '')
      .split(';')
      .map((f) => f.trim())
      .filter(Boolean);
    for (const path of folders.length > 0 ? folders : ['']) {
      let list = root;
      let key = '';
      const parents: Extract<MeasureNode, { kind: 'folder' }>[] = [];
      if (byTable) {
        key = measure.table;
        const t = folderIn(list, measure.table, key);
        parents.push(t);
        list = t.children;
      }
      for (const part of path.split('\\').map((p) => p.trim()).filter(Boolean)) {
        key = `${key}\\${part}`;
        const f = folderIn(list, part, key);
        parents.push(f);
        list = f.children;
      }
      list.push({ kind: 'measure', measure });
      for (const p of parents) p.count += 1;
    }
  }

  const sort = (list: MeasureNode[]) => {
    list.sort(byName);
    for (const n of list) if (n.kind === 'folder') sort(n.children);
  };
  sort(root);
  return root;
}

/** Measures whose name matches the search, with their folder path, for a flat list of results. */
export function searchMeasures(measures: readonly PickerMeasure[], search: string): { measure: PickerMeasure; path: string }[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const multipleTables = new Set(measures.map((m) => m.table)).size > 1;
  return measures
    .filter((m) => words.every((w) => m.name.toLowerCase().includes(w)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((m) => ({
      measure: m,
      path: [multipleTables ? m.table : null, ...(m.folder ? [m.folder.split(';')[0].trim().replace(/\\/g, ' › ')] : [])].filter(Boolean).join(' › '),
    }));
}
