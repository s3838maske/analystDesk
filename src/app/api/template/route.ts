import { NextResponse } from "next/server";
import { buildTemplate } from "@/lib/ingest";

export async function GET() {
  return new NextResponse(new Uint8Array(buildTemplate()), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="AnalystDesk_upload_template.xlsx"' },
  });
}
