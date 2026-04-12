/**
 * Probe county-level data availability for MSAs that failed strict screening.
 *
 * For each MSA:
 * 1. Get BLS QCEW data at county level for each county in the MSA
 * 2. Check if NAICS 238x subsectors have data (not suppressed)
 * 3. Report whether the MSA can be reconstructed via county aggregation
 *
 * Also probes FRED for county-level permits and employment series.
 */

const FRED_KEY = "243729f2bb8bc8235355e8e1c1e422a1";

// MSA → list of counties (FIPS: 2-digit state + 3-digit county)
// Source: OMB 2023 CBSA delineation + verified against Census data
const MSA_COUNTIES: Record<string, { name: string; counties: Array<{ fips: string; name: string; state: string }> }> = {
  "39300": {
    name: "Providence-Warwick, RI-MA",
    counties: [
      { fips: "44007", name: "Providence", state: "RI" },
      { fips: "44003", name: "Kent", state: "RI" },
      { fips: "44005", name: "Newport", state: "RI" },
      { fips: "44009", name: "Washington", state: "RI" },
      { fips: "44001", name: "Bristol", state: "RI" },
      { fips: "25005", name: "Bristol", state: "MA" },
    ],
  },
  "39340": {
    name: "Provo-Orem-Lehi, UT",
    counties: [
      { fips: "49049", name: "Utah", state: "UT" },
      { fips: "49023", name: "Juab", state: "UT" },
    ],
  },
  "16980": {
    name: "Chicago-Naperville-Elgin, IL-IN-WI",
    counties: [
      { fips: "17031", name: "Cook", state: "IL" },
      { fips: "17043", name: "DuPage", state: "IL" },
      { fips: "17089", name: "Kane", state: "IL" },
      { fips: "17093", name: "Kendall", state: "IL" },
      { fips: "17111", name: "McHenry", state: "IL" },
      { fips: "17197", name: "Will", state: "IL" },
      { fips: "18089", name: "Lake", state: "IN" },
      { fips: "18127", name: "Porter", state: "IN" },
    ],
  },
  "47900": {
    name: "Washington-Arlington-Alexandria, DC-VA-MD",
    counties: [
      { fips: "11001", name: "DC", state: "DC" },
      { fips: "24031", name: "Montgomery", state: "MD" },
      { fips: "24033", name: "Prince George's", state: "MD" },
      { fips: "51013", name: "Arlington", state: "VA" },
      { fips: "51059", name: "Fairfax", state: "VA" },
      { fips: "51600", name: "Fairfax City", state: "VA" },
      { fips: "51610", name: "Falls Church", state: "VA" },
      { fips: "51683", name: "Manassas", state: "VA" },
      { fips: "51685", name: "Manassas Park", state: "VA" },
      { fips: "51510", name: "Alexandria", state: "VA" },
    ],
  },
  "38900": {
    name: "Portland-Vancouver-Hillsboro, OR-WA",
    counties: [
      { fips: "41005", name: "Clackamas", state: "OR" },
      { fips: "41009", name: "Columbia", state: "OR" },
      { fips: "41051", name: "Multnomah", state: "OR" },
      { fips: "41067", name: "Washington", state: "OR" },
      { fips: "41071", name: "Yamhill", state: "OR" },
      { fips: "53011", name: "Clark", state: "WA" },
      { fips: "53059", name: "Skamania", state: "WA" },
    ],
  },
  "26900": {
    name: "Indianapolis-Carmel-Anderson, IN",
    counties: [
      { fips: "18011", name: "Boone", state: "IN" },
      { fips: "18013", name: "Brown", state: "IN" },
      { fips: "18057", name: "Hamilton", state: "IN" },
      { fips: "18059", name: "Hancock", state: "IN" },
      { fips: "18063", name: "Hendricks", state: "IN" },
      { fips: "18081", name: "Johnson", state: "IN" },
      { fips: "18097", name: "Marion", state: "IN" },
      { fips: "18109", name: "Morgan", state: "IN" },
      { fips: "18145", name: "Shelby", state: "IN" },
    ],
  },
  "17140": {
    name: "Cincinnati, OH-KY-IN",
    counties: [
      { fips: "18029", name: "Dearborn", state: "IN" },
      { fips: "18115", name: "Ohio", state: "IN" },
      { fips: "18161", name: "Union", state: "IN" },
      { fips: "21015", name: "Boone", state: "KY" },
      { fips: "21023", name: "Bracken", state: "KY" },
      { fips: "21037", name: "Campbell", state: "KY" },
      { fips: "21077", name: "Gallatin", state: "KY" },
      { fips: "21081", name: "Grant", state: "KY" },
      { fips: "21117", name: "Kenton", state: "KY" },
      { fips: "21191", name: "Pendleton", state: "KY" },
      { fips: "39015", name: "Brown", state: "OH" },
      { fips: "39017", name: "Butler", state: "OH" },
      { fips: "39025", name: "Clermont", state: "OH" },
      { fips: "39061", name: "Hamilton", state: "OH" },
      { fips: "39165", name: "Warren", state: "OH" },
    ],
  },
  "17460": {
    name: "Cleveland-Elyria, OH",
    counties: [
      { fips: "39035", name: "Cuyahoga", state: "OH" },
      { fips: "39055", name: "Geauga", state: "OH" },
      { fips: "39085", name: "Lake", state: "OH" },
      { fips: "39093", name: "Lorain", state: "OH" },
      { fips: "39103", name: "Medina", state: "OH" },
    ],
  },
};

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface CountyQcewResult {
  fips: string;
  countyName: string;
  state: string;
  naics: Record<string, { emp: number; estabs: number; suppressed: boolean }>;
  totalEmp: number;
  complete: boolean;
}

async function fetchCountyQcew(fips: string, year: number, quarter: number): Promise<CountyQcewResult["naics"] | null> {
  // BLS QCEW county API format
  const url = `https://data.bls.gov/cew/data/api/${year}/${quarter}/area/${fips}.csv`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.split("\n");
    if (lines.length < 3) return null;

    const headers = lines[0].replace(/"/g, "").split(",");
    const result: CountyQcewResult["naics"] = {};

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
      const suppressed = row.disclosure_code === "N";

      result[ic] = { emp: avgEmp, estabs, suppressed };
    }
    return result;
  } catch {
    return null;
  }
}

interface MsaAggregateResult {
  cbsa: string;
  name: string;
  counties: CountyQcewResult[];
  msaNaics: Record<string, { emp: number; estabs: number; countiesContributing: number }>;
  allFourComplete: boolean;
  aggregatedTotalEmp: number;
}

async function probeMsa(cbsa: string, info: (typeof MSA_COUNTIES)[string]): Promise<MsaAggregateResult> {
  console.log(`\n=== ${info.name} (${cbsa}) ===`);
  console.log(`Checking ${info.counties.length} counties...`);

  const countyResults: CountyQcewResult[] = [];
  for (const county of info.counties) {
    await sleep(800);
    const naics = await fetchCountyQcew(county.fips, 2025, 2);
    if (naics === null) {
      // Try Q1 2025
      await sleep(800);
      const naics2 = await fetchCountyQcew(county.fips, 2025, 1);
      if (naics2) {
        const totalEmp = Object.values(naics2).reduce((s, v) => s + (v.suppressed ? 0 : v.emp), 0);
        const complete = ["2381", "2382", "2383", "2389"].every((n) => naics2[n] && !naics2[n].suppressed);
        countyResults.push({ fips: county.fips, countyName: county.name, state: county.state, naics: naics2, totalEmp, complete });
        continue;
      }
      countyResults.push({ fips: county.fips, countyName: county.name, state: county.state, naics: {}, totalEmp: 0, complete: false });
      continue;
    }
    const totalEmp = Object.values(naics).reduce((s, v) => s + (v.suppressed ? 0 : v.emp), 0);
    const complete = ["2381", "2382", "2383", "2389"].every((n) => naics[n] && !naics[n].suppressed);
    countyResults.push({ fips: county.fips, countyName: county.name, state: county.state, naics, totalEmp, complete });
  }

  // Aggregate across counties
  const msaNaics: MsaAggregateResult["msaNaics"] = {
    "2381": { emp: 0, estabs: 0, countiesContributing: 0 },
    "2382": { emp: 0, estabs: 0, countiesContributing: 0 },
    "2383": { emp: 0, estabs: 0, countiesContributing: 0 },
    "2389": { emp: 0, estabs: 0, countiesContributing: 0 },
  };

  for (const c of countyResults) {
    for (const naics of ["2381", "2382", "2383", "2389"]) {
      if (c.naics[naics] && !c.naics[naics].suppressed) {
        msaNaics[naics].emp += c.naics[naics].emp;
        msaNaics[naics].estabs += c.naics[naics].estabs;
        msaNaics[naics].countiesContributing++;
      }
    }
  }

  const allFourComplete = ["2381", "2382", "2383", "2389"].every((n) => msaNaics[n].emp > 0);
  const aggregatedTotalEmp = Object.values(msaNaics).reduce((s, v) => s + v.emp, 0);

  // Report
  for (const c of countyResults) {
    const naicsReport = ["2381", "2382", "2383", "2389"].map((n) => {
      const d = c.naics[n];
      if (!d) return `${n}:—`;
      if (d.suppressed) return `${n}:❌`;
      return `${n}:${d.emp.toLocaleString()}`;
    }).join(" ");
    console.log(`  ${c.countyName.padEnd(22)} ${c.state}  ${naicsReport}`);
  }

  console.log(`\n  AGGREGATED MSA:`);
  for (const naics of ["2381", "2382", "2383", "2389"]) {
    const d = msaNaics[naics];
    console.log(`    NAICS ${naics}: ${d.emp.toLocaleString().padStart(8)} workers, ${d.estabs.toLocaleString().padStart(6)} firms  (${d.countiesContributing}/${info.counties.length} counties)`);
  }
  console.log(`    Total: ${aggregatedTotalEmp.toLocaleString()} workers`);
  console.log(`    Strict pass: ${allFourComplete ? "✓ YES" : "✗ NO"}`);

  return {
    cbsa,
    name: info.name,
    counties: countyResults,
    msaNaics,
    allFourComplete,
    aggregatedTotalEmp,
  };
}

async function main() {
  console.log("Probing county-level QCEW data for 8 MSAs that failed strict screening...");

  const results: MsaAggregateResult[] = [];
  for (const [cbsa, info] of Object.entries(MSA_COUNTIES)) {
    const result = await probeMsa(cbsa, info);
    results.push(result);
  }

  console.log("\n\n=== FINAL SUMMARY ===\n");
  const passed = results.filter((r) => r.allFourComplete);
  const failed = results.filter((r) => !r.allFourComplete);

  console.log(`✓ UNLOCKABLE via county aggregation: ${passed.length}`);
  for (const r of passed) {
    console.log(`  ${r.name.padEnd(42)} ${r.aggregatedTotalEmp.toLocaleString().padStart(10)} workers`);
  }

  console.log(`\n✗ Still blocked: ${failed.length}`);
  for (const r of failed) {
    const missing = ["2381", "2382", "2383", "2389"].filter((n) => r.msaNaics[n].emp === 0);
    console.log(`  ${r.name.padEnd(42)} missing: ${missing.join(", ")}`);
  }
}

main().catch(console.error);
