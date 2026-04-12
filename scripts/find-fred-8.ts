/**
 * Find FRED series for the 8 markets unlocked via county aggregation.
 */

const FRED_KEY = "243729f2bb8bc8235355e8e1c1e422a1";
const BASE = "https://api.stlouisfed.org/fred";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface SeriesResult {
  id: string;
  title: string;
  frequency: string;
  observationEnd?: string;
}

async function searchFred(query: string, frequency?: string): Promise<SeriesResult[]> {
  const params = new URLSearchParams({
    search_text: query,
    api_key: FRED_KEY,
    file_type: "json",
    limit: "15",
  });
  if (frequency) {
    params.set("filter_variable", "frequency");
    params.set("filter_value", frequency);
  }
  const res = await fetch(`${BASE}/series/search?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.seriess || [];
}

async function verifySeries(seriesId: string): Promise<{ exists: boolean; latestDate?: string }> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: FRED_KEY,
    file_type: "json",
    sort_order: "desc",
    limit: "1",
  });
  const res = await fetch(`${BASE}/series/observations?${params}`);
  if (!res.ok) return { exists: false };
  const data = await res.json();
  const obs = data.observations?.[0];
  if (!obs) return { exists: false };
  return { exists: true, latestDate: obs.date };
}

const MARKETS = [
  { name: "Chicago", search: "Chicago Naperville Elgin MSA" },
  { name: "Washington DC", search: "Washington Arlington Alexandria MSA" },
  { name: "Portland OR", search: "Portland Vancouver Hillsboro MSA" },
  { name: "Indianapolis", search: "Indianapolis Carmel Anderson MSA" },
  { name: "Cincinnati", search: "Cincinnati OH MSA" },
  { name: "Cleveland", search: "Cleveland Elyria MSA" },
  { name: "Providence", search: "Providence Warwick MSA" },
  { name: "Provo", search: "Provo Orem MSA" },
];

interface MsaSeries {
  name: string;
  totalPermits?: string;
  singleFamilyPermits?: string;
  nonfarmEmployment?: string;
  unemploymentRate?: string;
  population?: string;
}

async function findMsaSeries(market: { name: string; search: string }): Promise<MsaSeries> {
  const result: MsaSeries = { name: market.name };

  // Permits
  await sleep(500);
  const permitResults = await searchFred(`${market.search} building permits private housing structures`);
  const permitMsa = permitResults.find((s) =>
    s.id.includes("BPPRIVSA") && !s.id.startsWith("BPPRIV") && s.title.includes("MSA")
  );
  if (permitMsa) {
    const v = await verifySeries(permitMsa.id);
    if (v.exists && v.latestDate && v.latestDate >= "2025-06-01") {
      result.totalPermits = permitMsa.id;
    }
  }

  // SF permits
  if (result.totalPermits) {
    const sfId = result.totalPermits.replace("BPPRIVSA", "BP1FHSA");
    await sleep(500);
    const v = await verifySeries(sfId);
    if (v.exists && v.latestDate && v.latestDate >= "2025-06-01") {
      result.singleFamilyPermits = sfId;
    }
  }

  // Employment
  await sleep(500);
  const empResults = await searchFred(`${market.search} total nonfarm employees`, "Monthly");
  const empMsa = empResults.find((s) =>
    s.title.includes("All Employees: Total Nonfarm") &&
    s.title.includes("MSA") &&
    s.id.endsWith("NA") &&
    !s.id.endsWith("NAN")
  );
  if (empMsa) {
    const v = await verifySeries(empMsa.id);
    if (v.exists && v.latestDate && v.latestDate >= "2025-06-01") {
      result.nonfarmEmployment = empMsa.id;
    }
  }
  if (!result.nonfarmEmployment) {
    const smsEmp = empResults.find((s) =>
      s.title.includes("All Employees: Total Nonfarm") &&
      s.title.includes("MSA") &&
      s.id.startsWith("SMS")
    );
    if (smsEmp) {
      const v = await verifySeries(smsEmp.id);
      if (v.exists && v.latestDate && v.latestDate >= "2025-06-01") {
        result.nonfarmEmployment = smsEmp.id;
      }
    }
  }

  // UR
  await sleep(500);
  const urResults = await searchFred(`${market.search} unemployment rate`, "Monthly");
  const urMsa = urResults.find((s) =>
    s.title.includes("Unemployment Rate") &&
    s.title.includes("MSA") &&
    s.id.endsWith("URN")
  );
  if (urMsa) {
    const v = await verifySeries(urMsa.id);
    if (v.exists) {
      result.unemploymentRate = urMsa.id;
    }
  }

  // Population
  await sleep(500);
  const popResults = await searchFred(`${market.search} resident population`, "Annual");
  const popMsa = popResults.find((s) =>
    s.title.includes("Resident Population") &&
    s.title.includes("MSA") &&
    s.id.endsWith("POP")
  );
  if (popMsa) {
    const v = await verifySeries(popMsa.id);
    if (v.exists) {
      result.population = popMsa.id;
    }
  }

  return result;
}

async function main() {
  const results: MsaSeries[] = [];
  for (const market of MARKETS) {
    process.stdout.write(`${market.name.padEnd(16)} ... `);
    const r = await findMsaSeries(market);
    results.push(r);
    const missing: string[] = [];
    if (!r.totalPermits) missing.push("permits");
    if (!r.singleFamilyPermits) missing.push("sf-permits");
    if (!r.nonfarmEmployment) missing.push("employment");
    if (!r.unemploymentRate) missing.push("UR");
    if (!r.population) missing.push("population");
    if (missing.length === 0) console.log("✓ COMPLETE");
    else console.log(`✗ missing: ${missing.join(", ")}`);
  }

  console.log("\n=== SERIES MAP ===\n");
  for (const r of results) {
    console.log(`// ${r.name}`);
    console.log(`{`);
    console.log(`  totalPermits: "${r.totalPermits || ''}",`);
    console.log(`  singleFamilyPermits: "${r.singleFamilyPermits || ''}",`);
    console.log(`  nonfarmEmployment: "${r.nonfarmEmployment || ''}",`);
    console.log(`  unemploymentRate: "${r.unemploymentRate || ''}",`);
    console.log(`  population: "${r.population || ''}",`);
    console.log(`},`);
  }
}

main().catch(console.error);
