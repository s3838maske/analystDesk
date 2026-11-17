// Seed: pilot users, the pilot company universe and fictional DEMO companies for testing.
// Dev/pilot passwords below are for local setup only — change them on first deployment.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export const DEV_PASSWORD = process.env.SEED_PASSWORD ?? process.env.DEV_PASSWORD ?? "analystdesk-dev-2026";

const USERS = [
  { email: "admin@analystdesk.local", name: "Team Admin", role: "ADMIN" },
  { email: "analyst1@analystdesk.local", name: "Asha Analyst", role: "ANALYST" },
  { email: "analyst2@analystdesk.local", name: "Ravi Analyst", role: "ANALYST" },
  { email: "reviewer@analystdesk.local", name: "Meera Reviewer", role: "REVIEWER" },
  { email: "compliance@analystdesk.local", name: "Compliance Viewer", role: "COMPLIANCE" },
];

// Pilot universe: 3–4 sectors the team covers (SRS 9.1). Check BSE codes before the pilot.
const COMPANIES: [string, string, string | null, string][] = [
  ["Infosys Ltd", "INFY", "500209", "IT services"],
  ["Tata Consultancy Services Ltd", "TCS", "532540", "IT services"],
  ["Wipro Ltd", "WIPRO", "507685", "IT services"],
  ["HCL Technologies Ltd", "HCLTECH", "532281", "IT services"],
  ["Tech Mahindra Ltd", "TECHM", "532755", "IT services"],
  ["LTIMindtree Ltd", "LTIM", "540005", "IT services"],
  ["Hindustan Unilever Ltd", "HINDUNILVR", "500696", "FMCG"],
  ["ITC Ltd", "ITC", "500875", "FMCG"],
  ["Nestle India Ltd", "NESTLEIND", "500790", "FMCG"],
  ["Britannia Industries Ltd", "BRITANNIA", "500825", "FMCG"],
  ["Dabur India Ltd", "DABUR", "500096", "FMCG"],
  ["Marico Ltd", "MARICO", "531642", "FMCG"],
  ["Maruti Suzuki India Ltd", "MARUTI", "532500", "Automobiles"],
  ["Mahindra & Mahindra Ltd", "M&M", "500520", "Automobiles"],
  ["Bajaj Auto Ltd", "BAJAJ-AUTO", "532977", "Automobiles"],
  ["Hero MotoCorp Ltd", "HEROMOTOCO", "500182", "Automobiles"],
  ["Eicher Motors Ltd", "EICHERMOT", "505200", "Automobiles"],
  ["TVS Motor Company Ltd", "TVSMOTOR", "532343", "Automobiles"],
  ["Sun Pharmaceutical Industries Ltd", "SUNPHARMA", "524715", "Pharmaceuticals"],
  ["Dr. Reddy's Laboratories Ltd", "DRREDDY", "500124", "Pharmaceuticals"],
  ["Cipla Ltd", "CIPLA", "500087", "Pharmaceuticals"],
  ["Divi's Laboratories Ltd", "DIVISLAB", "532488", "Pharmaceuticals"],
  ["Lupin Ltd", "LUPIN", "500257", "Pharmaceuticals"],
  // Fictional companies for testing with the synthetic files in samples/
  ["Demo Alpha Industries Ltd (fictional)", "DEMOALPHA", null, "Demo"],
  ["Demo Beta Manufacturing Ltd (fictional)", "DEMOBETA", null, "Demo"],
  ["Demo Gamma Products Ltd (fictional)", "DEMOGAMMA", null, "Demo"],
  ["Demo Delta Works Ltd (fictional)", "DEMODELTA", null, "Demo"],
];

async function main() {
  const hash = await bcrypt.hash(DEV_PASSWORD, 10);
  for (const u of USERS) {
    await prisma.user.upsert({ where: { email: u.email }, update: process.env.SEED_PASSWORD || process.env.DEV_PASSWORD ? { passwordHash: hash } : {}, create: { ...u, passwordHash: hash } });
  }
  for (const [name, nse, bse, sector] of COMPANIES) {
    await prisma.company.upsert({ where: { nse }, update: { name, bse, sector }, create: { name, nse, bse, sector } });
  }
  console.log(`Seeded ${USERS.length} users and ${COMPANIES.length} companies.`);
}

main().finally(() => prisma.$disconnect());
