import type { Tx } from '../db/db.service';

type HierarchyTable = 'gl.accounts' | 'gl.cost_centers';

/** Returns ids of the given roots and all their descendants. */
export const descendantIds = async (tx: Tx, table: HierarchyTable, companyId: string, rootIds: readonly string[]): Promise<string[]> => {
  if (rootIds.length === 0) return [];
  const rows = await tx.query<{ id: string }>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM ${table} WHERE company_id = $1 AND id = ANY($2::uuid[])
       UNION
       SELECT c.id FROM ${table} c JOIN tree t ON c.parent_id = t.id WHERE c.company_id = $1
     ) SELECT id FROM tree`,
    [companyId, rootIds],
  );
  return rows.map((r) => r.id);
};

/** True if candidateParentId is the node itself or one of its descendants (would create a cycle). */
export const wouldCreateCycle = async (tx: Tx, table: HierarchyTable, companyId: string, nodeId: string, candidateParentId: string): Promise<boolean> => {
  const ids = await descendantIds(tx, table, companyId, [nodeId]);
  return ids.includes(candidateParentId);
};
