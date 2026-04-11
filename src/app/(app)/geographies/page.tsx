import { db } from "@/lib/db";
import { geographies } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function GeographiesPage() {
  const markets = await db.select().from(geographies).orderBy(geographies.name);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#1E293B]">Markets</h1>
      <p className="text-sm text-[#6B7280] mt-1">
        All {markets.length} monitored MSA markets
      </p>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {markets.map((m) => (
          <div
            key={m.id}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:border-[#F97316]/50 transition-colors"
          >
            <h3 className="font-semibold text-[#1E293B]">{m.shortName}</h3>
            <p className="text-xs text-[#6B7280] mt-0.5">{m.name}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-[#6B7280]">
              <span>CBSA: {m.cbsaFips}</span>
              <span>{m.state}</span>
              {m.population && (
                <span>Pop: {(m.population / 1_000_000).toFixed(1)}M</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
