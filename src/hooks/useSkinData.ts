import { useState, useEffect, useCallback } from "react";
import { getCached, getStale, setCache } from "../lib/cache";
import type { Champion, Skin, Chroma, SkinForm, SkinGroup } from "../types";

const SKIN_IDS_URL =
  "https://raw.githubusercontent.com/Alban1911/LeagueSkins/main/resources/en/skin_ids.json";
const TREE_API_URL =
  "https://api.github.com/repos/Alban1911/LeagueSkins/git/trees/main?recursive=1";
const SKINS_JSON_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/skins.json";

const SKIN_IDS_CACHE_KEY = "zushi:skin_ids";
// _v2 invalidates the stale name-based cache from older builds.
const REPO_ZIPS_CACHE_KEY = "zushi:repo_files_v2";
const CHROMAS_CACHE_KEY = "zushi:chromas";

let skinIdsCache: Record<string, string> | null = null;
let repoZipsCache: Map<string, string> | null = null;
let repoFormIdsByParent = new Map<string, string[]>();
let chromaInfoCache: Map<number, { colors: string[]; parentId: number }> | null = null;

const FORM_LABELS: Record<string, string> = {
  // Elementalist Lux.
  "99991": "Air",
  "99992": "Dark",
  "99993": "Ice",
  "99994": "Magma",
  "99995": "Mystic",
  "99996": "Nature",
  "99997": "Storm",
  "99998": "Water",
  "99999": "Fire",
  // Spirit Blossom Morgana.
  "25999": "Form 1",
  // Radiant Serpent Sett.
  "875998": "Form 2",
  "875999": "Form 3",
  // K/DA ALL OUT Seraphine.
  "147002": "Form 1",
  "147003": "Form 2",
  // DJ Sona.
  "37998": "Form 1",
  "37999": "Form 2",
  // Arcane Fractured Jinx.
  "222998": "Form 1",
  "222999": "Form 2",
  // Risen Legend Kai'Sa.
  "145071": "Form 1",
  "145999": "Form 2",
  // Revenant Reign Viego: the base package is the default / first form.
  "234994": "Form 2",
  "234995": "Form 3",
  "234996": "Form 4",
  "234997": "Form 5",
  "234998": "Form 6",
  "234999": "Form 7",
  // Sahn-Uzal Mordekaiser has two fixed evolved form packages.
  "82998": "Form 1",
  "82999": "Form 2",
  // Gun Goddess Miss Fortune.
  "21997": "Zero Hour",
  "21998": "Royal Arms",
  "21999": "Starswarm",
  // Risen Legend Ahri.
  "103086": "Immortalized Legend",
  "103087": "Form 2",
};

function rebuildRepoFormIndex(files: Map<string, string>): void {
  const next = new Map<string, string[]>();
  for (const [id, path] of files) {
    const match = path.match(/^skins\/\d+\/(\d+)\/(\d+)\/\2\.(?:fantome|zip)$/);
    if (!match || match[2] !== id) continue;
    const ids = next.get(match[1]) ?? [];
    ids.push(id);
    next.set(match[1], ids);
  }
  for (const ids of next.values()) ids.sort((a, b) => Number(a) - Number(b));
  repoFormIdsByParent = next;
}

// Reverse indices over skinIdsCache so name-based lookups are O(1) instead of
// scanning all ~9k entries on every call (My Skins does this per skin, per render).
let skinNameToId: Map<string, string> | null = null;
let skinChampNameToId: Map<string, string> | null = null;
let indexedFrom: Record<string, string> | null = null;

function ensureSkinIndexes(): void {
  if (!skinIdsCache) return;
  if (indexedFrom === skinIdsCache && skinNameToId) return;
  const nameToId = new Map<string, string>();
  const champNameToId = new Map<string, string>();
  for (const [id, name] of Object.entries(skinIdsCache)) {
    if (!nameToId.has(name)) nameToId.set(name, id);
    const champKey = Math.floor(parseInt(id, 10) / 1000);
    const key = `${champKey}:${name}`;
    if (!champNameToId.has(key)) champNameToId.set(key, id);
  }
  skinNameToId = nameToId;
  skinChampNameToId = champNameToId;
  indexedFrom = skinIdsCache;
}

export function ensureSkinIds(): Promise<Record<string, string>> {
  if (skinIdsCache) return Promise.resolve(skinIdsCache);

  const cached = getCached<Record<string, string>>(SKIN_IDS_CACHE_KEY);
  if (cached) {
    skinIdsCache = cached;
    return Promise.resolve(cached);
  }

  return fetch(SKIN_IDS_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data: Record<string, string>) => {
      skinIdsCache = data;
      setCache(SKIN_IDS_CACHE_KEY, data);
      return data;
    })
    .catch((err) => {
      const stale = getStale<Record<string, string>>(SKIN_IDS_CACHE_KEY);
      if (stale) {
        skinIdsCache = stale;
        return stale;
      }
      throw err;
    });
}

export function ensureRepoZips(): Promise<Map<string, string>> {
  if (repoZipsCache) return Promise.resolve(repoZipsCache);

  const cached = getCached<[string, string][]>(REPO_ZIPS_CACHE_KEY);
  if (cached) {
    repoZipsCache = new Map(cached);
    rebuildRepoFormIndex(repoZipsCache);
    return Promise.resolve(repoZipsCache);
  }

  return fetch(TREE_API_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      return res.json();
    })
    .then((data: { tree: { path: string; type: string }[] }) => {
      const map = new Map<string, string>();
      for (const entry of data.tree) {
        if (entry.type !== "blob" || !entry.path.startsWith("skins/")) continue;
        // Paths are id-based, e.g. "skins/222/222020/222025/222025.fantome".
        // The filename stem is the skin id, matching skin_ids.json keys.
        const filename = entry.path.split("/").pop() ?? "";
        const ext = filename.endsWith(".fantome")
          ? ".fantome"
          : filename.endsWith(".zip")
            ? ".zip"
            : null;
        if (!ext) continue;
        const skinId = filename.slice(0, -ext.length);
        if (!/^\d+$/.test(skinId)) continue;
        map.set(skinId, entry.path);
      }
      repoZipsCache = map;
      rebuildRepoFormIndex(map);
      setCache(REPO_ZIPS_CACHE_KEY, [...map.entries()]);
      return map;
    })
    .catch((err) => {
      const stale = getStale<[string, string][]>(REPO_ZIPS_CACHE_KEY);
      if (stale) {
        repoZipsCache = new Map(stale);
        return repoZipsCache;
      }
      throw err;
    });
}

export function ensureChromaInfo(): Promise<Map<number, { colors: string[]; parentId: number }>> {
  if (chromaInfoCache) return Promise.resolve(chromaInfoCache);

  const cached = getCached<[number, { colors: string[]; parentId: number }][]>(CHROMAS_CACHE_KEY);
  if (cached) {
    chromaInfoCache = new Map(cached);
    return Promise.resolve(chromaInfoCache);
  }

  return fetch(SKINS_JSON_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data: Record<string, { id: number; chromas?: { id: number; colors?: string[] }[] }>) => {
      const map = new Map<number, { colors: string[]; parentId: number }>();
      for (const [, skin] of Object.entries(data)) {
        if (!skin.chromas) continue;
        for (const c of skin.chromas) {
          map.set(c.id, { colors: c.colors ?? [], parentId: skin.id });
        }
      }
      chromaInfoCache = map;
      setCache(CHROMAS_CACHE_KEY, [...map.entries()]);
      return map;
    })
    .catch(() => {
      chromaInfoCache = new Map();
      return chromaInfoCache;
    });
}

export function getSkinsForChampion(champion: Champion, skinIds: Record<string, string>): Skin[] {
  const champKey = parseInt(champion.key, 10);
  const baseId = String(champKey * 1000);
  const championRepoName = skinIds[baseId] ?? champion.name;

  const skins: Skin[] = [];
  for (const [id, name] of Object.entries(skinIds)) {
    const numericId = parseInt(id, 10);
    const ownerKey = Math.floor(numericId / 1000);
    if (ownerKey !== champKey) continue;

    const num = numericId % 1000;
    if (num === 0) continue;

    // Skip chromas of the default skin (e.g. "Steel Blitzcrank") — not real,
    // applicable skins and they have no card to group under. See grouping below.
    const chromaInfo = chromaInfoCache?.get(numericId);
    if (chromaInfo && chromaInfo.parentId % 1000 === 0) continue;

    skins.push({
      id,
      num,
      name,
      championId: champion.id,
      championName: championRepoName,
    });
  }

  skins.sort((a, b) => a.num - b.num);
  return skins;
}

export function getSkinsGroupedForChampion(
  champion: Champion,
  skinIds: Record<string, string>
): SkinGroup[] {
  const flat = getSkinsForChampion(champion, skinIds);
  if (!chromaInfoCache || chromaInfoCache.size === 0) {
    return flat.map((s) => ({ base: s, chromas: [], forms: getFormsForSkin(s, skinIds) }));
  }

  const byId = new Map<number, Skin>();
  for (const s of flat) byId.set(parseInt(s.id, 10), s);

  const groups = new Map<number, SkinGroup>();
  const orphans: Chroma[] = [];

  for (const s of flat) {
    const numericId = parseInt(s.id, 10);
    const chromaInfo = chromaInfoCache.get(numericId);

    if (!chromaInfo) {
      groups.set(numericId, { base: s, chromas: [], forms: getFormsForSkin(s, skinIds) });
      continue;
    }

    const parentSkin = byId.get(chromaInfo.parentId);
    const parentName = parentSkin?.name ?? s.name.replace(/\s+\([^)]+\)$/, "");
    const chroma: Chroma = { ...s, parentName, colors: chromaInfo.colors };

    const parentGroup = groups.get(chromaInfo.parentId);
    if (parentGroup) {
      parentGroup.chromas.push(chroma);
    } else {
      orphans.push(chroma);
    }
  }

  for (const c of orphans) {
    const info = chromaInfoCache.get(parseInt(c.id, 10));
    const g = info ? groups.get(info.parentId) : undefined;
    if (g) {
      g.chromas.push(c);
    } else {
      groups.set(parseInt(c.id, 10), { base: c, chromas: [], forms: getFormsForSkin(c, skinIds) });
    }
  }

  const result = [...groups.values()];
  result.sort((a, b) => a.base.num - b.base.num);
  for (const g of result) g.chromas.sort((a, b) => a.num - b.num);
  return result;
}

function getFormsForSkin(base: Skin, skinIds: Record<string, string>): SkinForm[] {
  const formIds = repoFormIdsByParent.get(base.id) ?? [];
  return formIds
    .filter((id) => skinIds[id] === undefined)
    .map((id, index) => {
      const label = FORM_LABELS[id] ?? `Form ${index + 1}`;
      const path = repoZipsCache?.get(id);
      const previewUrl = path
        ? `https://raw.githubusercontent.com/Alban1911/LeagueSkins/main/${path.replace(/\.(?:fantome|zip)$/, ".png")}`
        : undefined;
      return {
        id,
        num: base.num,
        name: `${base.name} (${label})`,
        championId: base.championId,
        championName: base.championName,
        parentName: base.name,
        label,
        previewUrl,
      };
    });
}

export function lookupFormInfo(skinName: string): { parentName: string; label: string } | null {
  const match = skinName.match(/^(.+) \((Form \d+)\)$/);
  if (match) return { parentName: match[1], label: match[2] };

  if (!skinIdsCache) return null;
  for (const [parentId, formIds] of repoFormIdsByParent) {
    const parentName = skinIdsCache[parentId];
    if (!parentName) continue;
    for (const [index, formId] of formIds.entries()) {
      if (skinIdsCache[formId] !== undefined) continue;
      const label = FORM_LABELS[formId] ?? `Form ${index + 1}`;
      if (skinName === `${parentName} (${label})`) return { parentName, label };
    }
  }
  return null;
}

export function lookupChromaInfo(
  skinName: string
): { colors: string[]; parentName: string } | null {
  if (!skinIdsCache || !chromaInfoCache) return null;
  ensureSkinIndexes();

  const foundIdStr = skinNameToId!.get(skinName);
  if (foundIdStr === undefined) return null;

  const info = chromaInfoCache.get(parseInt(foundIdStr, 10));
  if (!info) return null;

  // skinIdsCache is already id→name, so the parent name is a direct lookup.
  const parentName = skinIdsCache[String(info.parentId)] ?? skinName.replace(/\s+\([^)]+\)$/, "");

  return { colors: info.colors, parentName };
}

/**
 * For a Skin object, return the splash num to use for DDragon images.
 * Chromas don't have their own splash on DDragon - we resolve to the base skin's num.
 */
export function getSplashNum(skin: Skin): number {
  if (!skinIdsCache) return skin.num;

  const match = skin.name.match(/^(.+?)\s+\([^)]+\)$/);
  if (!match) return skin.num;

  ensureSkinIndexes();
  const champKey = Math.floor(parseInt(skin.id, 10) / 1000);
  const baseId = skinChampNameToId!.get(`${champKey}:${match[1]}`);
  return baseId !== undefined ? parseInt(baseId, 10) % 1000 : skin.num;
}

/**
 * For a skin name string, look up the splash num to use for DDragon images.
 * Resolves chromas to their base skin's splash num.
 */
export function lookupSplashNum(skinName: string): number | null {
  if (!skinIdsCache) return null;
  ensureSkinIndexes();

  const form = lookupFormInfo(skinName);
  if (form) {
    const parentId = skinNameToId!.get(form.parentName);
    return parentId === undefined ? null : parseInt(parentId, 10) % 1000;
  }

  const foundId = skinNameToId!.get(skinName);
  if (foundId === undefined) return null;

  const champKey = Math.floor(parseInt(foundId, 10) / 1000);

  // Chroma ("BaseName (Variant)") resolves to its base skin's num.
  const match = skinName.match(/^(.+?)\s+\([^)]+\)$/);
  if (match) {
    const baseId = skinChampNameToId!.get(`${champKey}:${match[1]}`);
    if (baseId !== undefined) return parseInt(baseId, 10) % 1000;
  }

  return parseInt(foundId, 10) % 1000;
}

/**
 * Returns the exact download URL for a skin by looking up the repo tree.
 * Returns null if the skin doesn't exist in the repo.
 */
export function skinDownloadUrl(skin: Skin): string | null {
  if (!repoZipsCache) return null;

  const repoPath = repoZipsCache.get(skin.id);
  if (!repoPath) return null;

  const encoded = repoPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `https://raw.githubusercontent.com/Alban1911/LeagueSkins/main/${encoded}`;
}

export function isSkinAvailable(skin: Skin): boolean {
  if (!repoZipsCache) return true; // optimistic before tree loads
  return repoZipsCache.has(skin.id);
}

export function useSkinData(champion: Champion | null) {
  const [skinIds, setSkinIds] = useState<Record<string, string> | null>(skinIdsCache);
  const [skins, setSkins] = useState<Skin[]>([]);
  const [groups, setGroups] = useState<SkinGroup[]>([]);
  const [loading, setLoading] = useState(!skinIdsCache || !repoZipsCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([ensureSkinIds(), ensureRepoZips(), ensureChromaInfo()])
      .then(([ids]) => {
        // A fresh object also refreshes grouping after the chroma/form indexes load.
        setSkinIds({ ...ids });
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!champion || !skinIds) {
      setSkins([]);
      setGroups([]);
      return;
    }
    setSkins(getSkinsForChampion(champion, skinIds));
    setGroups(getSkinsGroupedForChampion(champion, skinIds));
  }, [champion, skinIds]);

  const getSkins = useCallback(
    (champ: Champion): Skin[] => {
      if (!skinIds) return [];
      return getSkinsForChampion(champ, skinIds);
    },
    [skinIds]
  );

  return { skins, groups, loading, error, getSkins };
}
