import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Badge,
  Button,
  CommandPalette,
  Empty,
  Link,
  Loader,
  Select,
  Surface,
  Switch,
  Table,
  Tabs,
  Text,
  Tooltip,
} from "@cloudflare/kumo";
import {
  ArrowSquareOut,
  ArrowCounterClockwise,
  CalendarBlank,
  Clock,
  Globe,
  Heart,
  MagnifyingGlass,
  Television,
} from "@phosphor-icons/react";
import type { OnAirData, SeasonInfo } from "./types";
import { DAY_NAMES, SEASON_NAMES } from "./types";
import {
  collectSeasons,
  filterBySeason,
  formatLocalTime,
  getCurrentSeason,
  getSeasonFromBeginDate,
  getSeasonKey,
  groupAnimeByDay,
  parseBroadcastDay,
} from "./utils";
import { isFollowed, toggleFollow } from "./follow";

const DATA_URL = import.meta.env.VITE_DATA_URL || "/data/on-air.json";

const TYPE_BADGE_MAP: Record<string, string> = {
  tv: "primary",
  web: "info",
};

const FOLLOW_ONLY_STORAGE_KEY = "bangumi-follow-only";

function getItemId(item: { title: string; sites?: { key: string; id: string }[] }): string {
  const bangumiSite = item.sites?.find((s) => s.key === "bangumi");
  return bangumiSite?.id ?? item.title;
}

function getDisplayTitle(item: { title: string; zhHansTitles?: string[] }): string {
  return item.zhHansTitles?.[0] ?? item.title;
}

interface SearchItem {
  id: string;
  title: string;
  originalTitle?: string;
  season: SeasonInfo;
  dayIndex: number;
  time: string;
  type?: string;
  sortKey: number;
}

interface SearchGroup {
  label: string;
  sortKey: number;
  items: SearchItem[];
}

function getSearchBroadcastSortKey(dayIndex: number, time: string): number {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1;

  return dayIndex * 24 * 60 + hour * 60 + minute;
}

function sortSearchItemsByBroadcastDesc(a: SearchItem, b: SearchItem): number {
  return b.sortKey - a.sortKey;
}

function sortSearchGroupsBySeasonDesc(a: SearchGroup, b: SearchGroup): number {
  return b.sortKey - a.sortKey;
}

function getBrowserTodayDayIndex(): number {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1;
}

function isSameSeason(a: SeasonInfo, b: SeasonInfo): boolean {
  return a.year === b.year && a.season === b.season;
}

function loadFollowOnly(): boolean {
  try {
    return localStorage.getItem(FOLLOW_ONLY_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveFollowOnly(value: boolean): void {
  try {
    localStorage.setItem(FOLLOW_ONLY_STORAGE_KEY, String(value));
  } catch {
    // Ignore storage errors so the switch still works in restricted browsers.
  }
}

export default function App() {
  const [data, setData] = useState<OnAirData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<SeasonInfo | null>(null);
  const [followOnly, setFollowOnly] = useState(loadFollowOnly);
  const [followTick, setFollowTick] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focusedSearchItem, setFocusedSearchItem] = useState<SearchItem | null>(null);
  const [activeTab, setActiveTab] = useState(() => String(getBrowserTodayDayIndex()));
  const todayDayIndex = useMemo(() => getBrowserTodayDayIndex(), []);
  const currentSeason = useMemo(() => getCurrentSeason(), []);

  const handleToggleFollow = useCallback(() => {
    setFollowTick((t) => t + 1);
  }, []);

  useEffect(() => {
    fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d: OnAirData) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    saveFollowOnly(followOnly);
  }, [followOnly]);

  const allSeasons = useMemo(() => {
    if (!data) return [];
    return collectSeasons(data.items);
  }, [data]);

  useEffect(() => {
    if (!selectedSeason && allSeasons.length > 0) {
      const found = allSeasons.find((s) => isSameSeason(s, currentSeason));
      setSelectedSeason(found ?? allSeasons[allSeasons.length - 1]);
    }
  }, [allSeasons, currentSeason, selectedSeason]);

  const seasonItems = useMemo(() => {
    if (!data || !selectedSeason) return [];
    return filterBySeason(data.items, selectedSeason);
  }, [data, selectedSeason]);

  const filtered = useMemo(() => {
    if (!followOnly) return seasonItems;
    return seasonItems.filter((item) => isFollowed(getItemId(item)));
  }, [seasonItems, followOnly, followTick]);

  const visibleItems = useMemo(() => {
    if (!focusedSearchItem) return filtered;
    return seasonItems.filter((item) => getItemId(item) === focusedSearchItem.id);
  }, [seasonItems, filtered, focusedSearchItem]);

  const grouped = useMemo(() => groupAnimeByDay(visibleItems), [visibleItems]);

  const activeDays = useMemo(() => {
    const days = new Set<number>();
    for (let i = 0; i < 7; i++) {
      if ((grouped.get(i) ?? []).length > 0) days.add(i);
    }
    if (
      selectedSeason &&
      !focusedSearchItem &&
      isSameSeason(selectedSeason, currentSeason)
    ) {
      days.add(todayDayIndex);
    }
    return Array.from(days).sort((a, b) => a - b);
  }, [grouped, selectedSeason, focusedSearchItem, currentSeason, todayDayIndex]);

  useEffect(() => {
    if (activeDays.length > 0 && !activeDays.includes(Number(activeTab))) {
      const fallbackDay = activeDays.includes(todayDayIndex)
        ? todayDayIndex
        : activeDays[0];
      setActiveTab(String(fallbackDay));
    }
  }, [activeDays, activeTab, todayDayIndex]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const searchItems = useMemo(() => {
    if (!data) return [];
    return data.items.map((item): SearchItem => {
      const season = item.beginDate
        ? getSeasonFromBeginDate(item.beginDate)
        : currentSeason;
      const dayIndex = item.broadcast ? parseBroadcastDay(item.broadcast) ?? 0 : 0;
      const time = item.broadcast ? formatLocalTime(item.broadcast) : "";
      return {
        id: getItemId(item),
        title: getDisplayTitle(item),
        originalTitle: item.originalTitle,
        season,
        dayIndex,
        time,
        type: item.type,
        sortKey: getSearchBroadcastSortKey(dayIndex, time),
      };
    });
  }, [data, currentSeason]);

  const searchGroups = useMemo(() => {
    const map = new Map<string, SearchGroup>();
    for (const item of searchItems) {
      const key = getSeasonKey(item.season);
      if (!map.has(key)) {
        map.set(key, {
          label: `${item.season.year} ${SEASON_NAMES[item.season.season]}`,
          sortKey: item.season.year * 10 + item.season.season,
          items: [],
        });
      }
      map.get(key)!.items.push(item);
    }
    for (const group of map.values()) {
      group.items.sort(sortSearchItemsByBroadcastDesc);
    }
    return Array.from(map.values()).sort(sortSearchGroupsBySeasonDesc);
  }, [searchItems]);

  const filteredSearchGroups = useMemo(() => {
    if (!search.trim()) return searchGroups;
    const q = search.toLowerCase();
    return searchGroups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            (item.originalTitle && item.originalTitle.toLowerCase().includes(q))
        ).sort(sortSearchItemsByBroadcastDesc),
      }))
      .filter((group) => group.items.length > 0);
  }, [searchGroups, search]);

  const handleSearchSelect = useCallback(
    (item: SearchItem) => {
      setSelectedSeason(item.season);
      setActiveTab(String(item.dayIndex));
      setFocusedSearchItem(item);
      setSearchOpen(false);
      setSearch("");
    },
    []
  );

  const handleClearFocusedSearchItem = useCallback(() => {
    setFocusedSearchItem(null);
  }, []);

  const handleFollowOnlyChange = useCallback(() => {
    setFocusedSearchItem(null);
    setFollowOnly((v) => !v);
  }, []);

  const handleSearchOpenChange = useCallback((open: boolean) => {
    setSearchOpen(open);
    if (!open) setSearch("");
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          gap: 16,
        }}
      >
        <Loader size="lg" />
        <Text variant="secondary">加载中...</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 64 }}>
        <Surface style={{ padding: 32, maxWidth: 480, margin: "0 auto" }}>
          <Text variant="error" size="lg" bold>
            加载失败
          </Text>
          <Text variant="secondary" style={{ marginTop: 8 }}>
            {error}
          </Text>
        </Surface>
      </div>
    );
  }

  if (!data || !selectedSeason) return null;

  const tabs = activeDays.map((d) => ({
    value: String(d),
    label: `${d === todayDayIndex ? "今天" : DAY_NAMES[d]} (${(grouped.get(d) ?? []).length})`,
  }));

  const currentDay = Number(activeTab);
  const currentItems = grouped.get(currentDay) ?? [];
  const currentDayLabel = currentDay === todayDayIndex ? "今天" : DAY_NAMES[currentDay];

  return (
    <div
      style={{
        maxWidth: 1280,
        height: "100dvh",
        margin: "0 auto",
        padding: "16px 16px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      className="sm:!p-6"
    >
      <div style={{ marginBottom: 20 }} className="sm:!mb-6">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Television size={28} weight="duotone" />
          <Text variant="heading1" className="!text-2xl sm:!text-[30px]">每周番剧放送表</Text>
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="搜索番剧"
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--kumo-color-hairline, #e2e2e2)",
              background: "var(--kumo-color-background, #fafafa)",
              cursor: "pointer",
              color: "var(--kumo-color-subtle, #888)",
              fontSize: 13,
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.borderColor = "var(--kumo-color-inactive, #bbb)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.borderColor = "var(--kumo-color-hairline, #e2e2e2)";
            }}
          >
            <MagnifyingGlass size={14} weight="duotone" />
            <span className="hide-mobile">搜索</span>
            <kbd
              style={{
                padding: "1px 5px",
                borderRadius: 4,
                border: "1px solid var(--kumo-color-hairline, #e2e2e2)",
                background: "var(--kumo-color-background, #fafafa)",
                fontSize: 11,
                fontFamily: "monospace",
              }}
              className="hide-mobile"
            >
              ⌘K
            </kbd>
          </button>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <CalendarBlank size={13} weight="duotone" />
            <Text variant="secondary" size="sm">
              更新于 {new Date(data.updatedAt).toLocaleString("zh-CN")}
            </Text>
          </div>
          <Badge variant="outline">{data.count} 部</Badge>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <Text variant="secondary" size="sm" as="span">
          选择季度
        </Text>
        <div style={{ flex: "1 1 220px", minWidth: 180 }}>
          <Select
            aria-label="选择季度"
            value={getSeasonKey(selectedSeason)}
            renderValue={(v) => {
              const [yearStr, seasonStr] = (v as string).split("-");
              const s = allSeasons.find(
                (s) => s.year === Number(yearStr) && s.season === Number(seasonStr)
              );
              return s ? `${s.year} ${SEASON_NAMES[s.season]}` : String(v);
            }}
            onValueChange={(v) => {
              const [yearStr, seasonStr] = (v as string).split("-");
              const found = allSeasons.find(
                (s) =>
                  s.year === Number(yearStr) && s.season === Number(seasonStr)
              );
              if (found) {
                setSelectedSeason(found);
                setFocusedSearchItem(null);
              }
            }}
          >
            {allSeasons.map((s) => (
              <Select.Option key={getSeasonKey(s)} value={getSeasonKey(s)}>
                {s.year} {SEASON_NAMES[s.season]}
              </Select.Option>
            ))}
          </Select>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Switch
            label="只看关注"
            checked={followOnly}
            onClick={handleFollowOnlyChange}
          />
        </div>
      </div>

      <Surface
        style={{
          padding: "16px",
          minHeight: 0,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        className="sm:!p-6"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Text variant="heading2" className="!text-lg sm:!text-xl">
              {selectedSeason.year} {SEASON_NAMES[selectedSeason.season]}
            </Text>
            <Badge variant="primary">{visibleItems.length} 部</Badge>
            {focusedSearchItem && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleClearFocusedSearchItem}
              >
                <ArrowCounterClockwise size={14} weight="bold" />
                撤销搜索
              </Button>
            )}
          </div>
          <Text variant="secondary" size="sm">
            {currentDayLabel} 放送
          </Text>
        </div>

        {tabs.length === 0 ? (
          <Empty
            title="暂无数据"
            description={followOnly ? "没有关注的番剧" : "该季度暂无放送中的番剧"}
            icon={<Television size={48} weight="duotone" />}
          />
        ) : (
          <div style={{ minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="tabs-scroll">
              <Tabs
                tabs={tabs}
                value={activeTab}
                onValueChange={setActiveTab}
                variant="underline"
              />
            </div>
            <div style={{ marginTop: 16, minHeight: 0, flex: 1, display: "flex" }}>
              {currentItems.length === 0 ? (
                <Empty
                  title={`${currentDayLabel}暂无放送`}
                  description={followOnly ? "该日没有关注的番剧" : "该日没有正在播出的番剧"}
                  size="sm"
                />
              ) : (
                <div className="table-scroll">
                  <Table style={{ minWidth: 560 }}>
                    <Table.Header>
                      <Table.Row>
                        <Table.Head style={{ width: 40 }}></Table.Head>
                        <Table.Head>番剧</Table.Head>
                        <Table.Head>类型</Table.Head>
                        <Table.Head>时间</Table.Head>
                        <Table.Head className="hide-mobile">语言</Table.Head>
                        <Table.Head>链接</Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {currentItems.map((item, i) => {
                        const id = getItemId(item);
                        const displayTitle = getDisplayTitle(item);
                        const bangumiSite = item.sites?.find(
                          (s) => s.key === "bangumi"
                        );
                        const broadcastTime = item.broadcast
                          ? formatLocalTime(item.broadcast)
                          : null;
                        const followed = isFollowed(id);

                        return (
                          <Table.Row key={`${item.title}-${i}`}>
                            <Table.Cell>
                              <button
                                onClick={() => {
                                  toggleFollow(id);
                                  handleToggleFollow();
                                }}
                                aria-label={followed ? "取消关注" : "关注"}
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  padding: 4,
                                  display: "flex",
                                  alignItems: "center",
                                  color: followed
                                    ? "var(--kumo-color-danger, #e53e3e)"
                                    : "var(--kumo-color-inactive, #aaa)",
                                  transition: "color 0.15s",
                                }}
                              >
                                <Heart
                                  size={16}
                                  weight={followed ? "fill" : "regular"}
                                />
                              </button>
                            </Table.Cell>
                            <Table.Cell>
                              <Tooltip content={item.originalTitle}>
                                <Text bold className="!text-sm sm:!text-base">{displayTitle}</Text>
                              </Tooltip>
                            </Table.Cell>
                            <Table.Cell>
                              <Badge
                                variant={
                                  (TYPE_BADGE_MAP[item.type ?? ""] as any) ??
                                  "secondary"
                                }
                              >
                                {item.type === "tv"
                                  ? "TV"
                                  : item.type === "web"
                                    ? "WEB"
                                    : item.type?.toUpperCase() ?? "-"}
                              </Badge>
                            </Table.Cell>
                            <Table.Cell>
                              {broadcastTime ? (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                >
                                  <Clock size={12} weight="duotone" />
                                  <Text size="sm">{broadcastTime}</Text>
                                </div>
                              ) : (
                                <Text variant="secondary" size="sm">-</Text>
                              )}
                            </Table.Cell>
                            <Table.Cell className="hide-mobile">
                              <Badge variant="outline">
                                {item.language === "ja" ? "日语" : item.language ?? "-"}
                              </Badge>
                            </Table.Cell>
                            <Table.Cell>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {bangumiSite?.url && (
                                  <Link
                                    href={bangumiSite.url}
                                    target="_blank"
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 3,
                                      }}
                                    >
                                      Bangumi
                                      <ArrowSquareOut size={11} />
                                    </div>
                                  </Link>
                                )}
                                {item.officialSite && (
                                  <Link
                                    href={item.officialSite}
                                    target="_blank"
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 3,
                                      }}
                                    >
                                      <Globe size={11} weight="duotone" />
                                      官网
                                      <ArrowSquareOut size={11} />
                                    </div>
                                  </Link>
                                )}
                                {!bangumiSite?.url && !item.officialSite && (
                                  <Text variant="secondary" size="sm">-</Text>
                                )}
                              </div>
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </Surface>

      <CommandPalette.Root
        open={searchOpen}
        onOpenChange={handleSearchOpenChange}
        items={filteredSearchGroups}
        value={search}
        onValueChange={setSearch}
        itemToStringValue={(group: any) => group.label}
        onSelect={(item: any) => handleSearchSelect(item)}
        getSelectableItems={(groups: any) =>
          groups
            .flatMap((g: any) => g.items)
            .sort(sortSearchItemsByBroadcastDesc)
        }
      >
        <CommandPalette.Input placeholder="搜索番剧名称..." />
        <CommandPalette.List>
          <CommandPalette.Results>
            {(group: any) => (
              <CommandPalette.Group key={group.label} items={group.items}>
                <CommandPalette.GroupLabel>
                  {group.label}
                </CommandPalette.GroupLabel>
                <CommandPalette.Items>
                  {(item: any) => (
                    <CommandPalette.Item
                      key={item.id}
                      value={item}
                      onClick={() => handleSearchSelect(item)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.title}
                        </span>
                        <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, color: "var(--kumo-color-subtle, #888)", fontSize: 12 }}>
                          <span>{DAY_NAMES[item.dayIndex]}</span>
                          {item.time && <span>{item.time}</span>}
                          {item.type && (
                            <Badge variant="outline" className="!text-[10px]">
                              {item.type === "tv" ? "TV" : item.type === "web" ? "WEB" : item.type.toUpperCase()}
                            </Badge>
                          )}
                        </span>
                      </div>
                    </CommandPalette.Item>
                  )}
                </CommandPalette.Items>
              </CommandPalette.Group>
            )}
          </CommandPalette.Results>
          <CommandPalette.Empty>未找到匹配的番剧</CommandPalette.Empty>
        </CommandPalette.List>
        <CommandPalette.Footer>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <kbd style={{ padding: "1px 5px", borderRadius: 4, border: "1px solid var(--kumo-color-hairline, #e2e2e2)", fontSize: 11 }}>↑↓</kbd>
            <span>导航</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <kbd style={{ padding: "1px 5px", borderRadius: 4, border: "1px solid var(--kumo-color-hairline, #e2e2e2)", fontSize: 11 }}>↵</kbd>
            <span>跳转</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <kbd style={{ padding: "1px 5px", borderRadius: 4, border: "1px solid var(--kumo-color-hairline, #e2e2e2)", fontSize: 11 }}>esc</kbd>
            <span>关闭</span>
          </span>
        </CommandPalette.Footer>
      </CommandPalette.Root>
    </div>
  );
}
