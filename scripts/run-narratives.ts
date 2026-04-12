import { POST } from "../src/app/api/cron/narratives/route";
import { NextRequest } from "next/server";

async function main() {
  const url = "http://localhost:3000/api/cron/narratives";
  const headers = new Headers({ authorization: `Bearer ${process.env.CRON_SECRET}` });
  const req = new NextRequest(url, { method: "POST", headers });
  const res = await POST(req);
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
