export interface AnimeItem {
  title: string;
  originalTitle?: string;
  zhHansTitles?: string[];
  type?: string;
  language?: string;
  officialSite?: string;
  beginDate?: string;
  broadcast?: string;
  comment?: string;
  sites?: AnimeSite[];
}

export interface AnimeSite {
  key: string;
  id: string;
  title?: string;
  url?: string;
  type?: string;
}

export interface OnAirData {
  updatedAt: string;
  source: string;
  count: number;
  items: AnimeItem[];
}

export interface SeasonInfo {
  year: number;
  season: number;
  label: string;
}

export const SEASON_NAMES = ["冬季", "春季", "夏季", "秋季"] as const;

export const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;
