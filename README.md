# AnalystDesk (MVP / pilot)

Internal web app that takes a listed Indian company from uploaded financials to an approved ratio and valuation report: upload → validation flags → ratios and peer comparison → assumptions and model (3-statement, DCF, sensitivity, trading comps) → drafted report → senior review with change requests → approval. Every number links back to its source cell and formula.

Built to the SRS "Financial Analyst Automation App" v0.1, section 9 MVP scope: TypeScript, Next.js, SQLite via Prisma, decimal.js for all money math, ExcelJS (live formulas), docx, and PDF via a local Chrome.

## Run it

```bash
npm install
npx prisma migrate deploy
npm run seed
npm run dev
```

Open http://localhost:3000. Seeded pilot accounts (local dev only; the password is `SEED_PASSWORD` (or `DEV_PASSWORD`) from `.env`, or the default in `prisma/seed.ts`; change it before anyone else uses the app):

| Email | Role |
| --- | --- |
| analyst1@analystdesk.local, analyst2@analystdesk.local | Analyst |
| reviewer@analystdesk.local | Senior reviewer |
| admin@analystdesk.local | Team admin |
| compliance@analystdesk.local | Compliance viewer |

Try it with the synthetic files in `samples/` (fictional DEMO companies; regenerate with `npm run samples`):
1. Sign in as an analyst → New analysis → search "DEMOALPHA", FY2021–FY2025, untick quarters, pick the reviewer.
2. Data: upload `demo_financials_template.xlsx` (standard template), `demo_prices.csv` (Prices), and `demo_gamma_terminal_export_lakh.xlsx` (opens the column-mapping screen: company Demo Gamma, unit lakh).
3. Validation: two planted errors are flagged (FY2023 balance sheet off by ₹37.5 cr, FY2024 capex sign). Correct them with a reason.
4. Ratios → Model (confirm key assumptions) → Report (write conclusion, recommendation, risks) → Review (submit).
5. Sign in as the reviewer → raise change requests or approve.

`.env` settings: `DATABASE_URL`, `UPLOAD_DIR` (raw files are stored here unchanged), `CHROME_PATH` (Chrome/Chromium for PDF export and chart images in Word).

## Tests

```bash
npm test
```

Covers parsing, units, period handling, validation checks, ratios, model balance and reproducibility, a cross-check of the DCF against an independent float calculation, and a recalculation of the exported Excel workbook's live formulas with an independent formula engine (results must match the app within 0.01%).

## Where things are

| Area | Code |
| --- | --- |
| Chart of accounts, synonyms (VAL-01) | `src/lib/coa.ts` |
| Units and currency (VAL-02) | `src/lib/units.ts` |
| Validation checks (VAL-03/04) | `src/lib/validation.ts` |
| Ratios + formulas for lineage (RAT) | `src/lib/ratios.ts` |
| Assumptions, forecast, DCF, sensitivity, comps (MOD) | `src/lib/model.ts` |
| Excel export with live formulas (MOD-07) | `src/lib/export-xlsx.ts` |
| Upload parsing: template, wide layouts, prices (ING) | `src/lib/ingest.ts`, `src/server/ingest.ts` |
| Report template, tokens, change log (REP, REV-06) | `src/lib/report.ts`, `src/server/report.ts` |
| Locks, re-validation, model re-run (REV-04, VAL-07) | `src/server/analysis.ts` |
| Lineage (AUD-01) | `src/server/lineage.ts` |
| Append-only audit log (AUD-03) | `prisma/migrations/*_audit_append_only` (SQLite triggers) |

## SRS coverage (MVP scope, section 9.1)

Done: all Must items in SET, ING, VAL, RAT, MOD, REP, REV and AUD, plus ADM-01 and ADM-03. Also in: peer-set templates, in-app "waiting for you" notices (REV-09, in-app part), audit CSV export (AUD-04), configurable disclosure section (CMP-01).

Not done yet (needed before wider use):
- **MFA and SSO (NFR-07).** Pilot login is email + password with server-side sessions and roles.
- **PDF table extraction (ING-05, Should)** and **XBRL parsing.** PDFs and XBRL files are stored unchanged as source documents; their figures go in through the template or the mapping screen.
- Encryption at rest (NFR-08), India-region hosting, backups (NFR-06/09/10): deployment work for after the office-machine pilot.
- Admin screens for flag thresholds, data sources and report templates (ADM-04, REP-05; Should). Thresholds are constants in `src/lib/validation.ts`.
- One-off item tagging (VAL-08), scenarios (MOD-06), custom ratios (RAT-04), transcript summaries (QUAL-03), email notifications, the hours dashboard (ADM-02).
- QUAL-01 (attach notes and documents): files can be uploaded as source documents, but there is no dedicated notes/links panel yet.
- Banks, NBFCs and insurers need their own chart of accounts (SRS 10.1); the model assumes a non-financial company.
- Check the BSE codes in `prisma/seed.ts` before the pilot.
