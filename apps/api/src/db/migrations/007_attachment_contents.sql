-- Attachment bytes held in the database (ATTACHMENT_STORAGE=database), for hosts without a
-- persistent disk such as Cloudflare Containers. Kept apart from gl.attachments so listings
-- and the tenant export never load file contents.

CREATE TABLE gl.attachment_contents (
  tenant_id uuid NOT NULL,
  id        uuid NOT NULL,
  content   bytea NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES gl.attachments(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE gl.attachment_contents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gl.attachment_contents
  USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant());

GRANT SELECT, INSERT, DELETE ON gl.attachment_contents TO erp_app;
