/**
 * Deterministic FRED series ID lookup.
 * Given an MSA name and state, finds the exact population, permits,
 * employment, and unemployment series IDs.
 *
 * No guessing — actually queries FRED's search API and verifies each
 * returned series exists and has recent data.
 */

const FRED_KEY = "243729f2bb8bc8235355e8e1c1e422a1";
const BASE = "https://api.stlouisfed.org/fred";

interface SeriesResult {
  id: string;
  title: string;
  frequency: string;
  lastUpdate: string;
  observationEnd?: string;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
  return (data.seriess || []).map((s: SeriesResult) => ({
    id: s.id,
    title: s.title,
    frequency: s.frequency,
    lastUpdate: s.lastUpdate,
    observationEnd: s.observationEnd,
  }));
}

async function verifySeries(seriesId: string): Promise<{ exists: boolean; latestDate?: string; latestValue?: string }> {
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
  return { exists: true, latestDate: obs.date, latestValue: obs.value };
}

// Markets we need IDs for
const MARKETS = [
  { name: "New York", search: "New York Newark Jersey City MSA" },
  { name: "Los Angeles", search: "Los Angeles Long Beach Anaheim MSA" },
  { name: "Philadelphia", search: "Philadelphia Camden Wilmington MSA" },
  { name: "Miami", search: "Miami Fort Lauderdale Pompano MSA" },
  { name: "Boston", search: "Boston Cambridge Newton MSA" },
  { name: "Detroit", search: "Detroit Warren Dearborn MSA" },
  { name: "San Francisco", search: "San Francisco Oakland Berkeley MSA" },
  { name: "Seattle", search: "Seattle Tacoma Bellevue MSA" },
  { name: "Minneapolis", search: "Minneapolis St Paul Bloomington MSA" },
  { name: "San Diego", search: "San Diego Chula Vista Carlsbad MSA" },
  { name: "Sacramento", search: "Sacramento Roseville Folsom MSA" },
  { name: "Riverside", search: "Riverside San Bernardino Ontario MSA" },
  { name: "Baltimore", search: "Baltimore Columbia Towson MSA" },
  { name: "Columbus", search: "Columbus OH MSA" },
  { name: "Louisville", search: "Louisville Jefferson County MSA" },
  { name: "Milwaukee", search: "Milwaukee Waukesha MSA" },
  { name: "Salt Lake City", search: "Salt Lake City UT MSA" },
  { name: "Charleston", search: "Charleston North Charleston SC MSA" },
  { name: "Fort Myers", search: "Cape Coral Fort Myers FL MSA" },
  { name: "Myrtle Beach", search: "Myrtle Beach Conway MSA" },
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

  // 1. Find permits (monthly, "New Private Housing Structures Authorized by Building Permits")
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

  // 2. Single family permits
  if (result.totalPermits) {
    const sfId = result.totalPermits.replace("BPPRIVSA", "BP1FHSA");
    await sleep(500);
    const v = await verifySeries(sfId);
    if (v.exists && v.latestDate && v.latestDate >= "2025-06-01") {
      result.singleFamilyPermits = sfId;
    }
  }

  // 3. Employment (Total Nonfarm)
  await sleep(500);
  const empResults = await searchFred(`${market.search} total nonfarm employees`, "Monthly");
  const empMsa = empResults.find((s) =>
    s.title.includes("All Employees: Total Nonfarm") &&
    s.title.includes("MSA") &&
    !s.id.startsWith("SMU") && // SMU = non-SA
    s.id.endsWith("NA")
  );
  if (empMsa) {
    const v = await verifySeries(empMsa.id);
    if (v.exists && v.latestDate && v.latestDate >= "2025-06-01") {
      result.nonfarmEmployment = empMsa.id;
    }
  }
  // Fallback to SMS-style series if short ID not available
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

  // 4. Unemployment rate
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

  // 5. Population (annual)
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
    const complete =
      r.totalPermits && r.singleFamilyPermits && r.nonfarmEmployment && r.unemploymentRate && r.population;
    if (complete) {
      console.log("✓ COMPLETE");
    } else {
      const missing: string[] = [];
      if (!r.totalPermits) missing.push("permits");
      if (!r.singleFamilyPermits) missing.push("sf-permits");
      if (!r.nonfarmEmployment) missing.push("employment");
      if (!r.unemploymentRate) missing.push("UR");
      if (!r.population) missing.push("population");
      console.log(`✗ missing: ${missing.join(", ")}`);
    }
  }

  console.log("\n=== SERIES MAP (for fred-client.ts) ===\n");
  for (const r of results) {
    if (r.totalPermits && r.singleFamilyPermits && r.nonfarmEmployment && r.unemploymentRate && r.population) {
      console.log(`// ${r.name}`);
      console.log(`{`);
      console.log(`  totalPermits: "${r.totalPermits}",`);
      console.log(`  singleFamilyPermits: "${r.singleFamilyPermits}",`);
      console.log(`  nonfarmEmployment: "${r.nonfarmEmployment}",`);
      console.log(`  unemploymentRate: "${r.unemploymentRate}",`);
      console.log(`  population: "${r.population}",`);
      console.log(`},`);
    }
  }

  const complete = results.filter(
    (r) => r.totalPermits && r.singleFamilyPermits && r.nonfarmEmployment && r.unemploymentRate && r.population
  );
  const incomplete = results.filter(
    (r) => !(r.totalPermits && r.singleFamilyPermits && r.nonfarmEmployment && r.unemploymentRate && r.population)
  );

  console.log(`\n=== SUMMARY ===`);
  console.log(`COMPLETE: ${complete.length}/${results.length}`);
  console.log(`INCOMPLETE: ${incomplete.length}/${results.length}`);
  if (incomplete.length > 0) {
    console.log("\nIncomplete markets:");
    for (const r of incomplete) {
      console.log(`  ${r.name}:`);
      console.log(`    permits: ${r.totalPermits || "MISSING"}`);
      console.log(`    sf-permits: ${r.singleFamilyPermits || "MISSING"}`);
      console.log(`    employment: ${r.nonfarmEmployment || "MISSING"}`);
      console.log(`    UR: ${r.unemploymentRate || "MISSING"}`);
      console.log(`    population: ${r.population || "MISSING"}`);
    }
  }
}

main().catch(console.error);
