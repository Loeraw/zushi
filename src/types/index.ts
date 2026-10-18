export type AppStatus = "idle" | "setup" | "game-detected" | "game-not-found" | "error";

export type PatcherStatus =
  | "Idle"
  | "Importing"
  | "BuildingOverlay"
  | "WaitingForGame"
  | "FoundGame"
  | "Scanning"
  | "Patching"
  | "InGame"
  | "GameExited"
  | { Error: string };

export interface Champion {
  id: string; // "Aatrox" - used in DDragon image URLs
  key: string; // "266" - numeric ID, matches LeagueSkins repo structure
  name: string; // "Aatrox"
  title: string; // "the Darkin Blade"
  tags: string[]; // ["Fighter", "Tank"]
}

export interface Skin {
  id: string; // "266007" - skin ID from skin_ids.json; keys the LeagueSkins repo lookup
  num: number; // 7 - skinId % 1000, used for splash art URLs
  name: string; // "Blood Moon Aatrox" - display name + local download folder name
  championId: string; // "Aatrox" - DDragon champion id for image URLs
  championName: string; // "Aatrox" - local download folder name (from base skin entry in skin_ids)
  previewUrl?: string; // Optional LeagueSkins preview for fixed form variants
}

export interface Chroma extends Skin {
  parentName: string;
  colors: string[];
}

export interface SkinForm extends Skin {
  parentName: string;
  label: string;
}

export interface SkinGroup {
  base: Skin;
  chromas: Chroma[];
  forms: SkinForm[];
}

export interface DownloadedSkin {
  champion_name: string;
  skin_name: string;
  zip_path: string;
}

export interface CustomEntry {
  name: string;
  file_path: string;
}

export interface CustomMod extends CustomEntry {
  enabled: boolean;
}
