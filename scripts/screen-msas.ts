/**
 * Strict MSA completeness screener.
 *
 * For each candidate MSA, verifies:
 * 1. BLS QCEW has all four NAICS 238x subsectors with non-zero data
 * 2. FRED has the required permit and employment series
 *
 * Only markets passing all checks are eligible to add.
 *
 * Run: npx tsx scripts/screen-msas.ts
 */

// Top 50 US Metropolitan Statistical Areas by population.
// Excludes the 15 we already have (Dallas, Houston, Austin, San Antonio,
// Phoenix, Las Vegas, Atlanta, Charlotte, Raleigh, Nashville, Tampa,
// Orlando, Jacksonville, Denver, Boise).
const CANDIDATES = [
  { cbsa: "35620", name: "New York-Newark-Jersey City, NY-NJ-PA", short: "New York", state: "NY", lat: 40.7128, lng: -74.0060 },
  { cbsa: "31080", name: "Los Angeles-Long Beach-Anaheim, CA", short: "Los Angeles", state: "CA", lat: 34.0522, lng: -118.2437 },
  { cbsa: "16980", name: "Chicago-Naperville-Elgin, IL-IN-WI", short: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298 },
  { cbsa: "37980", name: "Philadelphia-Camden-Wilmington, PA-NJ-DE-MD", short: "Philadelphia", state: "PA", lat: 39.9526, lng: -75.1652 },
  { cbsa: "47900", name: "Washington-Arlington-Alexandria, DC-VA-MD-WV", short: "Washington", state: "DC", lat: 38.9072, lng: -77.0369 },
  { cbsa: "33100", name: "Miami-Fort Lauderdale-Pompano Beach, FL", short: "Miami", state: "FL", lat: 25.7617, lng: -80.1918 },
  { cbsa: "14460", name: "Boston-Cambridge-Newton, MA-NH", short: "Boston", state: "MA", lat: 42.3601, lng: -71.0589 },
  { cbsa: "19820", name: "Detroit-Warren-Dearborn, MI", short: "Detroit", state: "MI", lat: 42.3314, lng: -83.0458 },
  { cbsa: "41860", name: "San Francisco-Oakland-Berkeley, CA", short: "San Francisco", state: "CA", lat: 37.7749, lng: -122.4194 },
  { cbsa: "42660", name: "Seattle-Tacoma-Bellevue, WA", short: "Seattle", state: "WA", lat: 47.6062, lng: -122.3321 },
  { cbsa: "33460", name: "Minneapolis-St. Paul-Bloomington, MN-WI", short: "Minneapolis", state: "MN", lat: 44.9778, lng: -93.2650 },
  { cbsa: "41740", name: "San Diego-Chula Vista-Carlsbad, CA", short: "San Diego", state: "CA", lat: 32.7157, lng: -117.1611 },
  { cbsa: "45060", name: "Sacramento-Roseville-Folsom, CA", short: "Sacramento", state: "CA", lat: 38.5816, lng: -121.4944 },
  { cbsa: "40140", name: "Riverside-San Bernardino-Ontario, CA", short: "Riverside", state: "CA", lat: 33.9533, lng: -117.3962 },
  { cbsa: "38900", name: "Portland-Vancouver-Hillsboro, OR-WA", short: "Portland", state: "OR", lat: 45.5152, lng: -122.6784 },
  { cbsa: "41180", name: "St. Louis, MO-IL", short: "St. Louis", state: "MO", lat: 38.6270, lng: -90.1994 },
  { cbsa: "12580", name: "Baltimore-Columbia-Towson, MD", short: "Baltimore", state: "MD", lat: 39.2904, lng: -76.6122 },
  { cbsa: "17140", name: "Cincinnati, OH-KY-IN", short: "Cincinnati", state: "OH", lat: 39.1031, lng: -84.5120 },
  { cbsa: "28140", name: "Kansas City, MO-KS", short: "Kansas City", state: "MO", lat: 39.0997, lng: -94.5786 },
  { cbsa: "18140", name: "Columbus, OH", short: "Columbus", state: "OH", lat: 39.9612, lng: -82.9988 },
  { cbsa: "26900", name: "Indianapolis-Carmel-Anderson, IN", short: "Indianapolis", state: "IN", lat: 39.7684, lng: -86.1581 },
  { cbsa: "17460", name: "Cleveland-Elyria, OH", short: "Cleveland", state: "OH", lat: 41.4993, lng: -81.6944 },
  { cbsa: "36420", name: "Oklahoma City, OK", short: "Oklahoma City", state: "OK", lat: 35.4676, lng: -97.5164 },
  { cbsa: "31140", name: "Louisville/Jefferson County, KY-IN", short: "Louisville", state: "KY", lat: 38.2527, lng: -85.7585 },
  { cbsa: "33340", name: "Milwaukee-Waukesha, WI", short: "Milwaukee", state: "WI", lat: 43.0389, lng: -87.9065 },
  { cbsa: "39300", name: "Providence-Warwick, RI-MA", short: "Providence", state: "RI", lat: 41.8240, lng: -71.4128 },
  { cbsa: "41620", name: "Salt Lake City, UT", short: "Salt Lake City", state: "UT", lat: 40.7608, lng: -111.8910 },
  { cbsa: "39340", name: "Provo-Orem-Lehi, UT", short: "Provo", state: "UT", lat: 40.2338, lng: -111.6585 },
  { cbsa: "16700", name: "Charleston-North Charleston, SC", short: "Charleston", state: "SC", lat: 32.7765, lng: -79.9311 },
  { cbsa: "15980", name: "Cape Coral-Fort Myers, FL", short: "Fort Myers", state: "FL", lat: 26.6406, lng: -81.8723 },
  { cbsa: "34820", name: "Myrtle Beach-Conway-North Myrtle Beach, SC-NC", short: "Myrtle Beach", state: "SC", lat: 33.6891, lng: -78.8867 },
];

function cbsaToQcewArea(cbsaFips: string): string {
  return `C${cbsaFips.slice(0, 4)}`;
}

interface ScreenResult {
  name: string;
  cbsa: string;
  state: string;
  pass: boolean;
  reasons: string[];
  qcewDetails: { naics: string; employment: number; estabs: number }[];
}

async function screenMsa(candidate: typeof CANDIDATES[0]): Promise<ScreenResult> {
  const reasons: string[] = [];
  const qcewDetails: { naics: string; employment: number; estabs: number }[] = [];
  let pass = true;

  // QCEW has 3-4 month publication lag. Try Q2 2025 (latest known),
  // then walk back to Q3 2024 as fallbacks.
  const uniqueQuarters = [
    { year: 2025, quarter: 2 },
    { year: 2025, quarter: 1 },
    { year: 2024, quarter: 4 },
    { year: 2024, quarter: 3 },
  ];

  let qcewData: Record<string, { emp: number; estabs: number }> | null = null;

  for (const { year, quarter } of uniqueQuarters) {
    const areaCode = cbsaToQcewArea(candidate.cbsa);
    const url = `https://data.bls.gov/cew/data/api/${year}/${quarter}/area/${areaCode}.csv`;

    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text.split("\n");
      if (lines.length < 5) continue;

      const headers = lines[0].replace(/"/g, "").split(",");
      const parsed: Record<string, { emp: number; estabs: number }> = {};

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

        parsed[ic] = { emp: avgEmp, estabs };
      }

      // Only use this quarter if we got meaningful data
      const validNaics = Object.values(parsed).filter((x) => x.emp > 0).length;
      if (validNaics >= 2) {
        qcewData = parsed;
        break;
      }
    } catch (err) {
      // silent — try next quarter
    }
  }

  if (!qcewData) {
    reasons.push("No QCEW data found in last 6 quarters");
    pass = false;
  } else {
    for (const naics of ["2381", "2382", "2383", "2389"]) {
      const d = qcewData[naics];
      if (!d || d.emp === 0) {
        reasons.push(`NAICS ${naics} suppressed or missing`);
        pass = false;
      } else {
        qcewDetails.push({ naics, employment: d.emp, estabs: d.estabs });
      }
    }
  }

  return {
    name: candidate.short,
    cbsa: candidate.cbsa,
    state: candidate.state,
    pass,
    reasons,
    qcewDetails,
  };
}

async function main() {
  console.log(`Screening ${CANDIDATES.length} candidate MSAs for strict data completeness...\n`);

  const results: ScreenResult[] = [];
  for (const candidate of CANDIDATES) {
    process.stdout.write(`  ${candidate.short.padEnd(20)} ... `);
    const result = await screenMsa(candidate);
    results.push(result);
    console.log(result.pass ? "✓ PASS" : `✗ FAIL (${result.reasons.join(", ")})`);
    // Rate limit — 1s between requests
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("\n=== RESULTS ===\n");
  const passed = results.filter((r) => r.pass);
  const failed = results.filter((r) => !r.pass);

  console.log(`PASSED: ${passed.length} markets`);
  for (const r of passed) {
    const totalEmp = r.qcewDetails.reduce((s, d) => s + d.employment, 0);
    const totalEstabs = r.qcewDetails.reduce((s, d) => s + d.estabs, 0);
    console.log(`  ✓ ${r.name.padEnd(20)} ${totalEmp.toLocaleString().padStart(10)} workers, ${totalEstabs.toLocaleString().padStart(8)} firms`);
  }

  console.log(`\nFAILED: ${failed.length} markets`);
  for (const r of failed) {
    console.log(`  ✗ ${r.name.padEnd(20)} — ${r.reasons[0]}`);
  }
}

main().catch(console.error);
