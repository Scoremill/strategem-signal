import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { narratives } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Read from pre-generated narratives table
  const [cached] = await db
    .select()
    .from(narratives)
    .where(and(eq(narratives.type, "market"), eq(narratives.geographyId, id)))
    .limit(1);

  if (cached) {
    return NextResponse.json({
      full: cached.fullNarrative || "",
      snippet: cached.snippet || "",
      generatedAt: cached.generatedAt.toISOString(),
    });
  }

  return NextResponse.json({ full: "", snippet: "", error: "Narrative not yet generated. Run the narratives pipeline from Admin." });
}
