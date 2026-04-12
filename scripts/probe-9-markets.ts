/**
 * Probe data availability for 9 candidate markets.
 * Investigation only — no DB writes.
 *
 * For each market:
 * 1. Try BLS QCEW at MSA level — check if all 4 NAICS 238x subsectors have data
 * 2. If MSA fails, try county-level aggregation
 * 3. Check FRED for permits, employment, unemployment, population
 * 4. Report pass/fail with recommended approach
 */

const FRED_KEY = "243729f2bb8bc8235355e8e1c1e422a1";
const BLS_BASE = "https://data.bls.gov/cew/data/api";
const FRED_BASE = "https://api.stlouisfed.org/fred";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface Candidate {
  name: string;
  short: string;
  state: string;
  cbsa: string;
  counties: Array<{ fips: string; name: string; state: string }>;
}

// 9 candidate markets with verified CBSA FIPS and OMB county definitions
const CANDIDATES: Candidate[] = [
  {
    name: "Memphis, TN-MS-AR",
    short: "Memphis",
    state: "TN",
    cbsa: "32820",
    counties: [
      { fips: "05035", name: "Crittenden", state: "AR" },
      { fips: "28033", name: "DeSoto", state: "MS" },
      { fips: "28093", name: "Marshall", state: "MS" },
      { fips: "28137", name: "Tate", state: "MS" },
      { fips: "28143", name: "Tunica", state: "MS" },
      { fips: "47047", name: "Fayette", state: "TN" },
      { fips: "47157", name: "Shelby", state: "TN" },
      { fips: "47167", name: "Tipton", state: "TN" },
    ],
  },
  {
    name: "Jackson, MS",
    short: "Jackson",
    state: "MS",
    cbsa: "27140",
    counties: [
      { fips: "28029", name: "Copiah", state: "MS" },
      { fips: "28049", name: "Hinds", state: "MS" },
      { fips: "28051", name: "Holmes", state: "MS" },
      { fips: "28089", name: "Madison", state: "MS" },
      { fips: "28121", name: "Rankin", state: "MS" },
      { fips: "28127", name: "Simpson", state: "MS" },
      { fips: "28163", name: "Yazoo", state: "MS" },
    ],
  },
  {
    name: "Birmingham-Hoover, AL",
    short: "Birmingham",
    state: "AL",
    cbsa: "13820",
    counties: [
      { fips: "01007", name: "Bibb", state: "AL" },
      { fips: "01009", name: "Blount", state: "AL" },
      { fips: "01073", name: "Jefferson", state: "AL" },
      { fips: "01115", name: "St. Clair", state: "AL" },
      { fips: "01117", name: "Shelby", state: "AL" },
      { fips: "01127", name: "Walker", state: "AL" },
    ],
  },
  {
    name: "Albuquerque, NM",
    short: "Albuquerque",
    state: "NM",
    cbsa: "10740",
    counties: [
      { fips: "35001", name: "Bernalillo", state: "NM" },
      { fips: "35043", name: "Sandoval", state: "NM" },
      { fips: "35057", name: "Torrance", state: "NM" },
      { fips: "35061", name: "Valencia", state: "NM" },
    ],
  },
  {
    name: "Tucson, AZ",
    short: "Tucson",
    state: "AZ",
    cbsa: "46060",
    counties: [
      { fips: "04019", name: "Pima", state: "AZ" },
    ],
  },
  {
    name: "Kansas City, MO-KS",
    short: "Kansas City",
    state: "MO",
    cbsa: "28140",
    counties: [
      { fips: "20091", name: "Johnson", state: "KS" },
      { fips: "20103", name: "Leavenworth", state: "KS" },
      { fips: "20107", name: "Linn", state: "KS" },
      { fips: "20121", name: "Miami", state: "KS" },
      { fips: "20209", name: "Wyandotte", state: "KS" },
      { fips: "29013", name: "Bates", state: "MO" },
      { fips: "29025", name: "Caldwell", state: "MO" },
      { fips: "29037", name: "Cass", state: "MO" },
      { fips: "29047", name: "Clay", state: "MO" },
      { fips: "29049", name: "Clinton", state: "MO" },
      { fips: "29095", name: "Jackson", state: "MO" },
      { fips: "29107", name: "Lafayette", state: "MO" },
      { fips: "29165", name: "Platte", state: "MO" },
      { fips: "29177", name: "Ray", state: "MO" },
    ],
  },
  {
    name: "Little Rock-North Little Rock-Conway, AR",
    short: "Little Rock",
    state: "AR",
    cbsa: "30780",
    counties: [
      { fips: "05045", name: "Faulkner", state: "AR" },
      { fips: "05051", name: "Garland", state: "AR" },
      { fips: "05053", name: "Grant", state: "AR" },
      { fips: "05085", name: "Lonoke", state: "AR" },
      { fips: "05105", name: "Perry", state: "AR" },
      { fips: "05119", name: "Pulaski", state: "AR" },
      { fips: "05125", name: "Saline", state: "AR" },
    ],
  },
  {
    name: "Richmond, VA",
    short: "Richmond",
    state: "VA",
    cbsa: "40060",
    counties: [
      { fips: "51007", name: "Amelia", state: "VA" },
      { fips: "51036", name: "Charles City", state: "VA" },
      { fips: "51041", name: "Chesterfield", state: "VA" },
      { fips: "51053", name: "Dinwiddie", state: "VA" },
      { fips: "51075", name: "Goochland", state: "VA" },
      { fips: "51085", name: "Hanover", state: "VA" },
      { fips: "51087", name: "Henrico", state: "VA" },
      { fips: "51127", name: "New Kent", state: "VA" },
      { fips: "51145", name: "Powhatan", state: "VA" },
      { fips: "51149", name: "Prince George", state: "VA" },
      { fips: "51183", name: "Sussex", state: "VA" },
      { fips: "51570", name: "Colonial Heights", state: "VA" },
      { fips: "51670", name: "Hopewell", state: "VA" },
      { fips: "51730", name: "Petersburg", state: "VA" },
      { fips: "51760", name: "Richmond City", state: "VA" },
    ],
  },
  {
    name: "Pittsburgh, PA",
    short: "Pittsburgh",
    state: "PA",
    cbsa: "38300",
    counties: [
      { fips: "42003", name: "Allegheny", state: "PA" },
      { fips: "42005", name: "Armstrong", state: "PA" },
      { fips: "42007", name: "Beaver", state: "PA" },
      { fips: "42019", name: "Butler", state: "PA" },
      { fips: "42051", name: "Fayette", state: "PA" },
      { fips: "42125", name: "Washington", state: "PA" },
      { fips: "42129", name: "Westmoreland", state: "PA" },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────

interface NaicsData {
  emp: number;
  estabs: number;
  suppressed: boolean;
}

async function fetchQcewArea(
  areaCode: string,
  year: number,
  quarter: number
): Promise<Record<string, NaicsData> | null> {
  const url = `${BLS_BASE}/${year}/${quarter}/area/${areaCode}.csv`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.split("\n");
    if (lines.length < 2) return null;
    const headers = lines[0].replace(/"/g, "").split(",");
    const result: Record<string, NaicsData> = {};
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const vals = lines[i].replace(/"/g, "").split(",");
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => (row[h] = vals[idx] || ""));
      if (row.own_code !== "5") continue;
      const ic = row.industry_code;
      if (!["2381", "2382", "2383", "2389"].includes(ic)) continue;
      const m1 = parseInt(row.month1_emplvl) || 0;
      const m2 = parseInt(row.month2_emplvl) || 0;
      const m3 = parseInt(row.month3_emplvl) || 0;
      const avgEmp = Math.round((m1 + m2 + m3) / 3);
      const estabs = parseInt(row.qtrly_estabs) || 0;
      const suppressed = row.disclosure_code === "N" || avgEmp === 0;
      result[ic] = { emp: avgEmp, estabs, suppressed };
    }
    return result;
  } catch {
    return null;
  }
}

interface QcewProbeResult {
  method: "msa" | "county-agg" | "failed";
  totalWorkers: number;
  bySector: Record<string, { emp: number; estabs: number; countiesContributing: number }>;
  suppressedSectors: string[];
  countiesWithData: number;
  totalCounties: number;
}

async function probeQcew(c: Candidate): Promise<QcewProbeResult> {
  // 1. Try MSA level first (Q2 2025, our established-latest quarter)
  const areaCode = `C${c.cbsa.slice(0, 4)}`;
  await sleep(600);
  const msaData = await fetchQcewArea(areaCode, 2025, 2);

  if (msaData) {
    const allFour = ["2381", "2382", "2383", "2389"].every(
      (n) => msaData[n] && !msaData[n].suppressed
    );
    if (allFour) {
      const bySector: QcewProbeResult["bySector"] = {};
      for (const n of ["2381", "2382", "2383", "2389"]) {
        bySector[n] = {
          emp: msaData[n].emp,
          estabs: msaData[n].estabs,
          countiesContributing: 1,
        };
      }
      const totalWorkers = Object.values(bySector).reduce((s, v) => s + v.emp, 0);
      return {
        method: "msa",
        totalWorkers,
        bySector,
        suppressedSectors: [],
        countiesWithData: 1,
        totalCounties: 1,
      };
    }
  }

  // 2. Fall back to county aggregation
  const bySector: QcewProbeResult["bySector"] = {
    "2381": { emp: 0, estabs: 0, countiesContributing: 0 },
    "2382": { emp: 0, estabs: 0, countiesContributing: 0 },
    "2383": { emp: 0, estabs: 0, countiesContributing: 0 },
    "2389": { emp: 0, estabs: 0, countiesContributing: 0 },
  };

  let countiesWithAnyData = 0;
  for (const county of c.counties) {
    await sleep(500);
    const countyData = await fetchQcewArea(county.fips, 2025, 2);
    if (!countyData) continue;
    let hasAny = false;
    for (const n of ["2381", "2382", "2383", "2389"]) {
      const d = countyData[n];
      if (d && !d.suppressed) {
        bySector[n].emp += d.emp;
        bySector[n].estabs += d.estabs;
        bySector[n].countiesContributing++;
        hasAny = true;
      }
    }
    if (hasAny) countiesWithAnyData++;
  }

  const suppressedSectors = ["2381", "2382", "2383", "2389"].filter(
    (n) => bySector[n].emp === 0
  );
  const allFour = suppressedSectors.length === 0;
  const totalWorkers = Object.values(bySector).reduce((s, v) => s + v.emp, 0);

  return {
    method: allFour ? "county-agg" : "failed",
    totalWorkers,
    bySector,
    suppressedSectors,
    countiesWithData: countiesWithAnyData,
    totalCounties: c.counties.length,
  };
}

// ─── FRED probe ───────────────────────────────────────────────────

async function fredSearch(query: string, frequency?: string): Promise<Array<{ id: string; title: string; observationEnd?: string }>> {
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
  await sleep(500);
  const res = await fetch(`${FRED_BASE}/series/search?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.seriess || [];
}

async function fredVerify(seriesId: string): Promise<{ exists: boolean; latestDate?: string }> {
  await sleep(500);
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: FRED_KEY,
    file_type: "json",
    sort_order: "desc",
    limit: "1",
  });
  const res = await fetch(`${FRED_BASE}/series/observations?${params}`);
  if (!res.ok) return { exists: false };
  const data = await res.json();
  const obs = data.observations?.[0];
  if (!obs) return { exists: false };
  return { exists: true, latestDate: obs.date };
}

interface FredProbeResult {
  permits: { seriesId?: string; latestDate?: string; status: "ok" | "stale" | "missing" };
  employment: { seriesId?: string; latestDate?: string; status: "ok" | "stale" | "missing" };
  unemployment: { seriesId?: string; latestDate?: string; status: "ok" | "stale" | "missing" };
  population: { seriesId?: string; latestDate?: string; status: "ok" | "missing" };
}

async function probeFred(c: Candidate): Promise<FredProbeResult> {
  const result: FredProbeResult = {
    permits: { status: "missing" },
    employment: { status: "missing" },
    unemployment: { status: "missing" },
    population: { status: "missing" },
  };

  // Permits: look for MSA-level BPPRIVSA
  const permitResults = await fredSearch(`${c.name} building permits private housing structures`);
  const permitMsa = permitResults.find(
    (s) => s.id.includes("BPPRIVSA") && !s.id.startsWith("BPPRIV") && s.title.includes("MSA")
  );
  if (permitMsa) {
    const v = await fredVerify(permitMsa.id);
    result.permits.seriesId = permitMsa.id;
    result.permits.latestDate = v.latestDate;
    if (v.exists && v.latestDate && v.latestDate >= "2025-06-01") {
      result.permits.status = "ok";
    } else if (v.exists) {
      result.permits.status = "stale";
    }
  }

  // Employment
  const empResults = await fredSearch(`${c.name} total nonfarm employees`, "Monthly");
  const empShort = empResults.find(
    (s) => s.title.includes("All Employees: Total Nonfarm") &&
      s.title.includes("MSA") &&
      s.id.endsWith("NA") && !s.id.endsWith("NAN")
  );
  const empMsa = empShort || empResults.find(
    (s) => s.title.includes("All Employees: Total Nonfarm") &&
      s.title.includes("MSA") &&
      s.id.startsWith("SMS")
  );
  if (empMsa) {
    const v = await fredVerify(empMsa.id);
    result.employment.seriesId = empMsa.id;
    result.employment.latestDate = v.latestDate;
    if (v.exists && v.latestDate && v.latestDate >= "2025-06-01") {
      result.employment.status = "ok";
    } else if (v.exists) {
      result.employment.status = "stale";
    }
  }

  // Unemployment
  const urResults = await fredSearch(`${c.name} unemployment rate`, "Monthly");
  const urMsa = urResults.find(
    (s) => s.title.includes("Unemployment Rate") && s.title.includes("MSA") && s.id.endsWith("URN")
  );
  if (urMsa) {
    const v = await fredVerify(urMsa.id);
    result.unemployment.seriesId = urMsa.id;
    result.unemployment.latestDate = v.latestDate;
    if (v.exists && v.latestDate && v.latestDate >= "2025-06-01") {
      result.unemployment.status = "ok";
    } else if (v.exists) {
      result.unemployment.status = "stale";
    }
  }

  // Population
  const popResults = await fredSearch(`${c.name} resident population`, "Annual");
  const popMsa = popResults.find(
    (s) => s.title.includes("Resident Population") && s.title.includes("MSA") && s.id.endsWith("POP")
  );
  if (popMsa) {
    const v = await fredVerify(popMsa.id);
    result.population.seriesId = popMsa.id;
    result.population.latestDate = v.latestDate;
    if (v.exists) {
      result.population.status = "ok";
    }
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log(`Probing ${CANDIDATES.length} candidate markets...\n`);

  const results: Array<{
    candidate: Candidate;
    qcew: QcewProbeResult;
    fred: FredProbeResult;
  }> = [];

  for (const c of CANDIDATES) {
    console.log(`\n━━━ ${c.short}, ${c.state} (${c.cbsa}) ━━━`);
    console.log(`QCEW probe:`);
    const qcew = await probeQcew(c);
    const method =
      qcew.method === "msa" ? "MSA-level ✓"
      : qcew.method === "county-agg" ? `County aggregation (${qcew.countiesWithData}/${qcew.totalCounties})`
      : `FAILED — missing ${qcew.suppressedSectors.join(",")}`;
    console.log(`  Method: ${method}`);
    console.log(`  Total workers: ${qcew.totalWorkers.toLocaleString()}`);
    for (const n of ["2381", "2382", "2383", "2389"]) {
      const s = qcew.bySector[n];
      console.log(`    NAICS ${n}: ${s.emp.toLocaleString().padStart(8)} workers, ${s.estabs.toLocaleString().padStart(6)} firms (${s.countiesContributing} sources)`);
    }

    console.log(`\nFRED probe:`);
    const fred = await probeFred(c);
    const renderStatus = (s: { seriesId?: string; latestDate?: string; status: string }) => {
      const icon = s.status === "ok" ? "✓" : s.status === "stale" ? "⚠" : "✗";
      return `${icon} ${s.status}${s.seriesId ? ` (${s.seriesId}${s.latestDate ? " → " + s.latestDate : ""})` : ""}`;
    };
    console.log(`  Permits:      ${renderStatus(fred.permits)}`);
    console.log(`  Employment:   ${renderStatus(fred.employment)}`);
    console.log(`  Unemployment: ${renderStatus(fred.unemployment)}`);
    console.log(`  Population:   ${renderStatus(fred.population)}`);

    results.push({ candidate: c, qcew, fred });
  }

  // ─── Final recommendation table ────────────────────────────────
  console.log("\n\n═══ SUMMARY: RECOMMENDED APPROACH ═══\n");
  console.log(
    `${"Market".padEnd(16)} ${"Capacity".padEnd(20)} ${"FRED Demand".padEnd(32)} Decision`
  );
  console.log("─".repeat(100));

  for (const r of results) {
    const capSource =
      r.qcew.method === "msa" ? "BLS MSA" :
      r.qcew.method === "county-agg" ? `County agg (${r.qcew.countiesWithData}/${r.qcew.totalCounties})` :
      `BLOCKED (${r.qcew.suppressedSectors.join(",")})`;

    const fredMissing: string[] = [];
    if (r.fred.permits.status !== "ok") fredMissing.push("permits");
    if (r.fred.employment.status !== "ok") fredMissing.push("emp");
    if (r.fred.unemployment.status !== "ok") fredMissing.push("UR");
    if (r.fred.population.status !== "ok") fredMissing.push("pop");
    const fredStatus = fredMissing.length === 0 ? "All MSA-level ✓" : `Missing: ${fredMissing.join(",")}`;

    let decision = "";
    if (r.qcew.method === "failed") {
      decision = "❌ SKIP";
    } else if (fredMissing.length === 0) {
      decision = r.qcew.method === "msa" ? "✅ ADD (direct)" : "✅ ADD (capacity county-agg)";
    } else if (fredMissing.length <= 1 && !fredMissing.includes("permits")) {
      decision = "✅ ADD (minor gap)";
    } else {
      decision = `⚠ ADD w/ county-agg for ${fredMissing.join(",")}`;
    }

    console.log(
      `${r.candidate.short.padEnd(16)} ${capSource.padEnd(20)} ${fredStatus.padEnd(32)} ${decision}`
    );
  }

  const addable = results.filter((r) => r.qcew.method !== "failed");
  console.log(`\n${addable.length} of ${results.length} markets can be added.`);
}

main().catch(console.error);
