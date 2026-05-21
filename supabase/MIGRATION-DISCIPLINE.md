# Supabase migration discipline

> Locked by Phase 05.5, D-B4 (Claude's-discretion → planning decision). Applies to every
> `supabase/migrations/*.sql` file from 05.5 onward.

## Rules

1. **Additive-only by default.** Allowed operations:
   - `CREATE TABLE`, `CREATE INDEX`, `CREATE TYPE`, `CREATE FUNCTION`, `CREATE VIEW`
   - `ALTER TABLE ... ADD COLUMN`, `ALTER TABLE ... ADD CONSTRAINT`
   - `INSERT INTO ...`, `UPDATE ...` (data seeds and idempotent corrections)
   - `COMMENT ON ...`

2. **Destructive operations require a tripwire.** A migration that uses
   `DROP`, `TRUNCATE`, `RENAME`, or `ALTER COLUMN TYPE` MUST begin with this line
   as the literal FIRST line of the file (before any other comment or SQL):

       -- DESTRUCTIVE: <one-line reason>

   Reviewer / `grep -l '^-- DESTRUCTIVE'` can trip the wire in CI/PR review.

3. **Never edit a migration that has been pushed.** `supabase migration list` is the
   source of truth — if the timestamp shows "Applied" in the "Remote" column, the file
   is immutable. To correct a mistake, write a NEW migration with a fresh timestamp.

4. **Filenames are auto-generated.** Always create new migrations with
   `supabase migration new <short_name>` so the CLI produces the
   `YYYYMMDDHHMMSS_<name>.sql` UTC-timestamped filename. Never hand-name
   (e.g., `0001_*.sql`) — timestamp prefixes are what keep parallel work in order.

5. **Single cloud project; no staging.** Per D-B3. Every push is "production." Treat
   additive-only as the load-bearing safety net; a destructive change should be reviewed
   before being committed, not afterward.

6. **Seeds MUST be idempotent.** Established by REVIEW.md WR-03 fix
   (`20260521075829_make_seeds_idempotent.sql`). Every `INSERT INTO …` migration row
   ends with `ON CONFLICT (<pkey-or-unique>) DO NOTHING` (or `DO UPDATE SET …` if the
   intent is upsert). A `INSERT` without an `ON CONFLICT` clause is a migration defect —
   reviewer should reject. Reason: replaying migrations against a dev branch / fresh DB
   should be a no-op for already-seeded rows, not a `_pkey` violation.

## Rationale

Phase 05.5 ships the v2.0 schema upfront (D-A1, D-A5). Phase 05.6 ports fetchers but
introduces no new DDL surface (per CONTEXT.md `<specifics>` — "If 05.6 discovers a
table is needed that 05.5 didn't create, that's a planning bug to flag back to 05.5").
Phase 05.7 cuts over. The discipline above keeps the schema stable across all three
phases.
