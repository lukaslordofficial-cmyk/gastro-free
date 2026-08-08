/**
 * Haversine — dystans w km między dwoma punktami GPS.
 */
const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** Format UI: „12,4 km” / „850 m”. */
export function formatDistanceKm(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return '— km';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`;
}

/** Szacunek ETA dostawy: ~40 km/h + bufor (tylko podgląd UI). */
export function estimateEtaMinutes(distanceKm: number | null | undefined): number | null {
  if (distanceKm == null || !Number.isFinite(distanceKm)) return null;
  return Math.max(25, Math.round((distanceKm / 40) * 60 + 20));
}
