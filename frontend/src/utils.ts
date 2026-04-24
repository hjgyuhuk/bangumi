import type { AnimeItem, SeasonInfo } from "./types";
import { SEASON_NAMES } from "./types";

export function getSeason(month: number): number {
  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month >= 10 && month <= 12) return 3;
  return 0;
}

export function getCurrentSeason(): SeasonInfo {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const season = getSeason(month);
  return {
    year,
    season,
    label: `${year} ${SEASON_NAMES[season]}`,
  };
}

export function getSeasonFromBeginDate(beginDate: string): SeasonInfo | null {
  const d = new Date(beginDate);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const season = getSeason(month);
  return { year, season, label: `${year} ${SEASON_NAMES[season]}` };
}

export function getSeasonKey(info: SeasonInfo): string {
  return `${info.year}-${info.season}`;
}

export function parseBroadcastDate(broadcast: string): Date | null {
  const match = broadcast.match(
    /^R\/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/
  );
  if (!match) return null;
  const d = new Date(match[1] + "Z");
  return isNaN(d.getTime()) ? null : d;
}

export function parseBroadcastDay(broadcast: string): number | null {
  const d = parseBroadcastDate(broadcast);
  if (!d) return null;
  const hour = d.getHours();
  let day = d.getDay();
  if (hour < 3) {
    day = (day + 6) % 7;
  }
  return day === 0 ? 6 : day - 1;
}

export function formatLocalTime(broadcast: string): string {
  const d = parseBroadcastDate(broadcast);
  if (!d) return "-";
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function getLocalMinutes(broadcast: string): number {
  const d = parseBroadcastDate(broadcast);
  if (!d) return Infinity;
  const h = d.getHours();
  const m = h * 60 + d.getMinutes();
  return h < 3 ? m + 24 * 60 : m;
}

export function groupAnimeByDay(items: AnimeItem[]): Map<number, AnimeItem[]> {
  const map = new Map<number, AnimeItem[]>();
  for (let i = 0; i < 7; i++) {
    map.set(i, []);
  }
  for (const item of items) {
    if (!item.broadcast) {
      map.get(0)!.push(item);
      continue;
    }
    const day = parseBroadcastDay(item.broadcast);
    if (day !== null) {
      map.get(day)!.push(item);
    }
  }
  for (const [, arr] of map) {
    arr.sort((a, b) => {
      const ta = a.broadcast ? getLocalMinutes(a.broadcast) : Infinity;
      const tb = b.broadcast ? getLocalMinutes(b.broadcast) : Infinity;
      return ta - tb;
    });
  }
  return map;
}

export function collectSeasons(items: AnimeItem[]): SeasonInfo[] {
  const seen = new Set<string>();
  const seasons: SeasonInfo[] = [];
  for (const item of items) {
    if (!item.beginDate) continue;
    const info = getSeasonFromBeginDate(item.beginDate);
    if (!info) continue;
    const key = getSeasonKey(info);
    if (!seen.has(key)) {
      seen.add(key);
      seasons.push(info);
    }
  }
  seasons.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.season - b.season;
  });
  return seasons;
}

export function filterBySeason(
  items: AnimeItem[],
  season: SeasonInfo
): AnimeItem[] {
  return items.filter((item) => {
    if (!item.beginDate) return false;
    const info = getSeasonFromBeginDate(item.beginDate);
    if (!info) return false;
    return info.year === season.year && info.season === season.season;
  });
}
