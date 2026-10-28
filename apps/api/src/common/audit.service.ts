import { Injectable } from '@nestjs/common';
import type { Tx } from '../db/db.service';
import type { RequestContext } from './request-context';

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  companyId?: string | null;
  oldData?: unknown;
  newData?: unknown;
};

/** Writes to the append-only audit log inside the caller's transaction. */
@Injectable()
export class AuditService {
  async record(tx: Tx, ctx: Pick<RequestContext, 'tenantId' | 'userId' | 'ip'>, entry: AuditEntry): Promise<void> {
    await tx.query(
      `INSERT INTO core.audit_log (tenant_id, user_id, ip, company_id, action, entity_type, entity_id, old_data, new_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ctx.tenantId,
        ctx.userId,
        ctx.ip,
        entry.companyId ?? null,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.oldData === undefined ? null : JSON.stringify(entry.oldData),
        entry.newData === undefined ? null : JSON.stringify(entry.newData),
      ],
    );
  }
}
