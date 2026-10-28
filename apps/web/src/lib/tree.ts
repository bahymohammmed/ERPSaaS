/** Orders hierarchical rows depth-first by code and annotates their depth. */
export const toTreeRows = <T extends { id: string; parent_id: string | null; code: string }>(rows: T[]): (T & { depth: number })[] => {
  const children = new Map<string | null, T[]>();
  for (const row of rows) children.set(row.parent_id, [...(children.get(row.parent_id) ?? []), row]);
  for (const list of children.values()) list.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  const ids = new Set(rows.map((r) => r.id));
  const roots = rows.filter((r) => !r.parent_id || !ids.has(r.parent_id));
  roots.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  const out: (T & { depth: number })[] = [];
  const visit = (row: T, depth: number) => {
    out.push({ ...row, depth });
    for (const child of children.get(row.id) ?? []) visit(child, depth + 1);
  };
  roots.forEach((r) => visit(r, 0));
  return out;
};
