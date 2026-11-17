-- AUD-03: the audit log cannot be edited or deleted by any role.
CREATE TRIGGER audit_no_update BEFORE UPDATE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'AuditLog is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'AuditLog is append-only'); END;
-- Uploaded file records are never edited except status; raw values never deleted.
CREATE TRIGGER fv_no_delete BEFORE DELETE ON "FinancialValue"
BEGIN SELECT RAISE(ABORT, 'FinancialValue rows are never deleted'); END;
CREATE TRIGGER rv_no_update BEFORE UPDATE ON "ReportVersion"
BEGIN SELECT RAISE(ABORT, 'Submitted report versions are immutable'); END;
