import { csvFormat, tsvParse } from 'd3-dsv'
import { utcParse } from 'd3-time-format'

async function text(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`fetch failed: ${response.status}`)
  return response.text()
}

// “Top” vehicles
const TOP_LAUNCH_VEHICLES = new Set([
  'Falcon9',
  'R-7',
  'R-14',
  'Thor',
  'DF5',
  'R-36',
  'Proton',
  'Titan',
  'Zenit',
  'Atlas',
])

// “Top” launching states
const TOP_STATES_MAP = new Map([
  ['US', 'United States'],
  ['SU', 'Soviet Union'],
  ['RU', 'Russia'],
  ['CN', 'China'],
])

// Load and parse launch vehicles.
const launchVehicles = tsvParse(await text('https://planet4589.org/space/gcat/tsv/tables/lv.tsv'))

// Construct map to lookup vehicle family from name.
const launchVehicleFamilyMap = new Map(launchVehicles.map((d) => [d['#LV_Name'], d.LV_Family.trim()]))

// Reduce cardinality by mapping smaller states to “Other”.
function normalizeState(d) {
  return TOP_STATES_MAP.get(d) ?? 'Other'
}

// Reduce cardinality by mapping smaller launch families to “Other”.
function normalizeFamily(d) {
  const family = launchVehicleFamilyMap.get(d)
  return TOP_LAUNCH_VEHICLES.has(family) ? family : 'Other'
}

// Parse dates!
const parseDate = utcParse('%Y %b %_d')

// Load and parse launch-log and trim down to smaller size.
const launchHistory = tsvParse(await text('https://planet4589.org/space/gcat/tsv/derived/launchlog.tsv'), (d) => ({
  date: parseDate(d.Launch_Date.slice(0, 11)),
  state: normalizeState(d.LVState),
  stateId: d.LVState,
  family: normalizeFamily(d.LV_Type),
})).filter((d) => d.date != null)

// Write out csv formatted data.
process.stdout.write(csvFormat(launchHistory))
