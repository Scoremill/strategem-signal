import { db } from "@/lib/db";
import { geographies } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const markets = await db.select().from(geographies).orderBy(geographies.shortName);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1E293B]">Portfolio Dashboard</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Demand-Capacity overview across {markets.length} monitored markets
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Markets Monitored</p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">{markets.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Favorable</p>
          <p className="text-3xl font-bold text-green-600 mt-1">—</p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">Ratio &lt; 0.85</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Equilibrium</p>
          <p className="text-3xl font-bold text-yellow-600 mt-1">—</p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">Ratio 0.85–1.15</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Constrained</p>
          <p className="text-3xl font-bold text-red-600 mt-1">—</p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">Ratio &gt; 1.15</p>
        </div>
      </div>

      {/* Market list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-[#1E293B]">Monitored Markets</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-5 font-medium text-[#6B7280]">Market</th>
                <th className="text-left py-3 px-5 font-medium text-[#6B7280]">State</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Population</th>
                <th className="text-center py-3 px-5 font-medium text-[#6B7280]">Demand</th>
                <th className="text-center py-3 px-5 font-medium text-[#6B7280]">Capacity</th>
                <th className="text-center py-3 px-5 font-medium text-[#6B7280]">Ratio</th>
                <th className="text-center py-3 px-5 font-medium text-[#6B7280]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {markets.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-5 font-medium text-[#1E293B]">{m.shortName}</td>
                  <td className="py-3 px-5 text-[#6B7280]">{m.state}</td>
                  <td className="py-3 px-5 text-right text-[#6B7280]">
                    {m.population ? (m.population / 1_000_000).toFixed(1) + "M" : "—"}
                  </td>
                  <td className="py-3 px-5 text-center text-[#6B7280]">—</td>
                  <td className="py-3 px-5 text-center text-[#6B7280]">—</td>
                  <td className="py-3 px-5 text-center text-[#6B7280]">—</td>
                  <td className="py-3 px-5 text-center">
                    <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
                      Awaiting Data
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
