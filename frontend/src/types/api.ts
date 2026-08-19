export type ActorTier = 'confirmed' | 'suspected' | 'none'
export type MarkerFill = 'red' | 'amber' | 'slate'
export type StatusStroke = 'resolved' | 'unresolved'
export type BadgeColor = 'red' | 'yellow' | 'green'
export type StatusFilter = 'resolved' | 'unresolved'
export type CoordinateSource = 'csv' | 'landing_midpoint' | 'cable_route' | 'none'

export interface IncidentSummary {
  id: string
  canonical_cable_name: string
  original_cable_name: string
  date: string
  type?: string | null
  specific_location?: string | null
  cause?: string | null
  suspected_actor?: string | null
  nation_state_suspected?: string | null
  outage_impact?: string | null
  dollar_cost?: string | null
  duration_of_outage?: string | null
  status?: string | null
  source?: string | null
  links: string[]
  actor_tier: ActorTier
  marker_fill: MarkerFill
  status_stroke: StatusStroke
  resolved: boolean
  badge_color: BadgeColor
  region: string
  latitude?: number | null
  longitude?: number | null
  coordinate_source: CoordinateSource
  suspected_countries: string[]
}

export interface IncidentListItem {
  id: string
  canonical_cable_name: string
  original_cable_name: string
  date: string
  type?: string | null
  status?: string | null
  cause?: string | null
  nation_state_suspected?: string | null
  actor_tier: ActorTier
  marker_fill: MarkerFill
  status_stroke: StatusStroke
  resolved: boolean
  badge_color: BadgeColor
  region: string
  latitude?: number | null
  longitude?: number | null
  suspected_countries: string[]
}

export interface IncidentMarker {
  id: string
  latitude: number
  longitude: number
  actor_tier: ActorTier
  resolved: boolean
  marker_fill: MarkerFill
  status_stroke: StatusStroke
  canonical_cable_name: string
  original_cable_name: string
  date: string
}

export interface CableSummary {
  name: string
  owners?: string | null
  region?: string | null
  status?: string | null
  length_km?: number | null
  length_display?: string | null
  incident_count: number
}

export interface CableDetail extends CableSummary {
  incidents: IncidentSummary[]
}

export interface FilterCount {
  value: string
  count: number
}

export interface FilterMeta {
  regions: FilterCount[]
  actor_tiers: FilterCount[]
  statuses: FilterCount[]
  suspected_countries: FilterCount[]
  cable_types: FilterCount[]
  total: number
}

export interface IncidentQuery {
  q: string
  regions: string[]
  actorTiers: ActorTier[]
  status: StatusFilter | null
  suspectedCountries: string[]
  cableTypes: string[]
}

export interface LLMSource {
  url: string
  title?: string | null
  snippet?: string | null
}

export interface IncidentSourcesResponse {
  incident_id: string
  existing_sources: string[]
  llm_sources: LLMSource[]
}

export interface IncidentSearchResult {
  id: number
  canonical_cable_name: string
  original_cable_name?: string | null
  date?: string | null
  type?: string | null
  specific_location?: string | null
  cause?: string | null
  suspected_actor?: string | null
  nation_state_suspected?: string | null
  outage_impact?: string | null
  dollar_cost?: string | null
  duration_of_outage?: string | null
  status?: string | null
  source?: string | null
  links: string[]
  score: number
}

export interface CableSearchResult {
  name: string
  owners?: string | null
  region?: string | null
  status?: string | null
  shape_length?: number | null
  score: number
}

export type SemanticSearchType = 'all' | 'incidents' | 'cables'

export interface SemanticSearchResponse {
  query: string
  incidents: IncidentSearchResult[]
  cables: CableSearchResult[]
}

export type PanelMode = 'closed' | 'cable' | 'incident' | 'group'

export interface HoverInfo {
  cableName: string
  incidents: Array<{ name: string; date: string }>
  x: number
  y: number
}
