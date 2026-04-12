import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { narratives } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  // Read from pre-generated narratives table
  const [cached] = await db
    .select()
    .from(narratives)
    .where(eq(narratives.type, "capacity"))
    .limit(1);

  if (cached && cached.metadata) {
    const meta = JSON.parse(cached.metadata);
    return NextResponse.json({
      implications: meta.implications || [],
      generatedAt: cached.generatedAt.toISOString(),
    });
  }

  return NextResponse.json({ implications: [], error: "Not yet generated" });
}
