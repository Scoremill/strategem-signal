"use server";

/**
 * Business Case save/share/delete server actions.
 *
 * Per-user + per-org scoped via tenantQuery. A user can save as many
 * cases as they want against any market in the system. The `shared`
 * flag flips the case from personal to org-visible — a future org-
 * level dashboard will surface shared cases for peer review.
 */
import { getSession } from "@/lib/auth";
import { tenantQuery } from "@/lib/db";
import { businessCases } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type {
  BusinessCaseInputs,
  OrganicOutput,
  AcquisitionOutput,
  Recommendation,
} from "@/lib/business-case/types";

export interface SaveBusinessCaseArgs {
  geographyId: string;
  title: string;
  notes?: string | null;
  inputs: BusinessCaseInputs;
  organic: OrganicOutput;
  acquisition: AcquisitionOutput;
  recommendation: Recommendation;
}

export async function saveBusinessCase(args: SaveBusinessCaseArgs) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not signed in" };

  const title = args.title?.trim();
  if (!title) return { ok: false as const, error: "Title is required" };

  const t = tenantQuery(session.orgId);
  const inserted = await t.insert(businessCases, {
    userId: session.userId,
    geographyId: args.geographyId,
    title,
    notes: args.notes?.trim() || null,
    inputsJson: args.inputs,
    organicOutputsJson: args.organic,
    acquisitionOutputsJson: args.acquisition,
    recommendation: args.recommendation,
    shared: false,
  });

  revalidatePath(`/markets/${args.geographyId}`);
  revalidatePath(`/markets/${args.geographyId}/business-case`);
  revalidatePath(`/business-cases`);

  const row = (inserted as Array<{ id: string }>)[0];
  return { ok: true as const, id: row?.id ?? null };
}

export async function toggleShareBusinessCase(
  caseId: string,
  shared: boolean
) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not signed in" };

  const t = tenantQuery(session.orgId);
  const updated = await t.update(
    businessCases,
    { shared, updatedAt: new Date() },
    and(
      eq(businessCases.id, caseId),
      // Only the author can toggle their own case's share flag.
      eq(businessCases.userId, session.userId)
    )!
  );

  if ((updated as unknown[]).length === 0) {
    return { ok: false as const, error: "Case not found" };
  }

  revalidatePath("/business-cases");
  return { ok: true as const };
}

export async function deleteBusinessCase(caseId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not signed in" };

  const t = tenantQuery(session.orgId);
  const deleted = await t.delete(
    businessCases,
    and(
      eq(businessCases.id, caseId),
      eq(businessCases.userId, session.userId)
    )!
  );

  if ((deleted as unknown[]).length === 0) {
    return { ok: false as const, error: "Case not found" };
  }

  revalidatePath("/business-cases");
  return { ok: true as const };
}
