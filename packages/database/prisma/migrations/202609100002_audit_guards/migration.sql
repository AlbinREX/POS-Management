-- Database-level safety beyond ORM relationships. Never edit an applied migration.
ALTER TABLE "User" ADD CONSTRAINT "User_email_normalized" CHECK (email = lower(trim(email)));
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_scope_required" CHECK (("branchId" IS NULL AND "userId" IS NULL) OR "organizationId" IS NOT NULL);
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_terminal_requires_branch" CHECK ("terminalId" IS NULL OR "branchId" IS NOT NULL);
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_terminal_scope_fkey" FOREIGN KEY ("terminalId", "branchId", "organizationId") REFERENCES "Terminal" ("id", "branchId", "organizationId") ON DELETE RESTRICT;
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_expiry_valid" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_expiry_valid" CHECK ("expiresAt" > "createdAt");
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
