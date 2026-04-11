import { db } from "@/lib/db";
import {
  fetchLogs,
  permitData,
  employmentData,
  migrationData,
  tradeCapacityData,
  demandCapacityScores,
} from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const logs = await db
    .select()
    .from(fetchLogs)
    .orderBy(desc(fetchLogs.runAt))
    .limit(20);

  // Get data counts
  const [permits] = await db.select({ count: sql<number>`count(*)` }).from(permitData);
  const [employment] = await db.select({ count: sql<number>`count(*)` }).from(employmentData);
  const [population] = await db.select({ count: sql<number>`count(*)` }).from(migrationData);
  const [capacity] = await db.select({ count: sql<number>`count(*)` }).from(tradeCapacityData);
  const [scores] = await db.select({ count: sql<number>`count(*)` }).from(demandCapacityScores);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1E293B]">Admin</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Pipeline health, manual triggers, and capacity alerts
        </p>
      </div>

      <AdminClient
        logs={logs.map((l) => ({
          ...l,
          runAt: l.runAt.toISOString(),
          recordsFetched: l.recordsFetched ?? 0,
          recordsNew: l.recordsNew ?? 0,
        }))}
        dataCounts={{
          permits: Number(permits.count),
          employment: Number(employment.count),
          population: Number(population.count),
          capacity: Number(capacity.count),
          scores: Number(scores.count),
        }}
      />
    </div>
  );
}
