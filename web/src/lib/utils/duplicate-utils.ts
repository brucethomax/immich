import { getExifCount, getExifPrecision } from '$lib/utils/exif-utils';
import type { AssetResponseDto } from '@immich/sdk';
import { sortBy } from 'lodash-es';

// ── Duplicate selection rule types ──────────────────────────────────

/**
 * Available rule types for determining which duplicate to keep.
 * Rules are evaluated in priority order (first rule = highest priority).
 * Each rule narrows the candidate set; when only one remains, it wins.
 */
export type DuplicateSelectionRuleType =
  | 'exif-completeness' // Most (or fewest) populated EXIF fields
  | 'exif-precision' // Most precise EXIF numeric values (more decimal places)
  | 'file-size' // Largest or smallest file
  | 'image-resolution' // Highest or lowest pixel count (W × H)
  | 'date-original' // Newest or oldest by dateTimeOriginal
  | 'created-at' // Newest or oldest by file creation date
  | 'filename-alpha' // Alphabetically first or last filename
  | 'filename-length' // Shortest or longest filename
  | 'has-location'; // Prefer assets with (or without) GPS data

/**
 * Direction controls which end of the sorted list is "best".
 *  - 'desc' → higher value is kept (e.g. largest file, newest date)
 *  - 'asc'  → lower value is kept  (e.g. smallest file, oldest date)
 */
export type RuleDirection = 'asc' | 'desc';

export interface DuplicateSelectionRule {
  type: DuplicateSelectionRuleType;
  enabled: boolean;
  direction: RuleDirection;
}

/** Human-readable labels for each rule type */
export const ruleTypeLabels: Record<DuplicateSelectionRuleType, string> = {
  'exif-completeness': 'EXIF data completeness',
  'exif-precision': 'EXIF value precision',
  'file-size': 'File size',
  'image-resolution': 'Image resolution',
  'date-original': 'Date taken',
  'created-at': 'Created at',
  'filename-alpha': 'Filename alphabetically',
  'filename-length': 'Filename length',
  'has-location': 'Has GPS location',
};

/**
 * Direction labels per rule type.
 * Each rule type maps direction → human-readable description of what is *kept*.
 */
export const ruleDirectionLabels: Record<DuplicateSelectionRuleType, Record<RuleDirection, string>> = {
  'exif-completeness': { desc: 'Keep most complete', asc: 'Keep least complete' },
  'exif-precision': { desc: 'Keep most precise', asc: 'Keep least precise' },
  'file-size': { desc: 'Keep largest', asc: 'Keep smallest' },
  'image-resolution': { desc: 'Keep highest resolution', asc: 'Keep lowest resolution' },
  'date-original': { desc: 'Keep newest', asc: 'Keep oldest' },
  'created-at': { desc: 'Keep newest', asc: 'Keep oldest' },
  'filename-alpha': { asc: 'Keep A → Z first', desc: 'Keep Z → A first' },
  'filename-length': { asc: 'Keep shortest name', desc: 'Keep longest name' },
  'has-location': { desc: 'Keep with location', asc: 'Keep without location' },
};

/** Which rule types support direction toggling (most do) */
export const ruleSupportsDirection: Record<DuplicateSelectionRuleType, boolean> = {
  'exif-completeness': false, // "most complete" is almost always desired
  'exif-precision': false, // "most precise" is almost always desired
  'file-size': true,
  'image-resolution': true,
  'date-original': true,
  'created-at': true,
  'filename-alpha': true,
  'filename-length': true,
  'has-location': true,
};

/**
 * Returns the default set of rules matching the original `suggestDuplicate` behaviour.
 * Order = priority; first rule evaluated first.
 */
export const getDefaultDuplicateRules = (): DuplicateSelectionRule[] => [
  { type: 'has-location', enabled: true, direction: 'desc' },
  { type: 'exif-completeness', enabled: true, direction: 'desc' },
  { type: 'exif-precision', enabled: true, direction: 'desc' },
  { type: 'file-size', enabled: true, direction: 'desc' },
  { type: 'image-resolution', enabled: true, direction: 'desc' },
  { type: 'filename-length', enabled: true, direction: 'asc' },
  { type: 'date-original', enabled: false, direction: 'desc' },
  { type: 'created-at', enabled: false, direction: 'desc' },
  { type: 'filename-alpha', enabled: false, direction: 'asc' },
];

// ── Value extractors for each rule ──────────────────────────────────

const ruleValueExtractors: Record<DuplicateSelectionRuleType, (asset: AssetResponseDto) => number | string> = {
  'exif-completeness': (asset) => getExifCount(asset),
  'exif-precision': (asset) => getExifPrecision(asset),
  'file-size': (asset) => asset.exifInfo?.fileSizeInByte ?? 0,
  'image-resolution': (asset) => (asset.exifInfo?.exifImageWidth ?? 0) * (asset.exifInfo?.exifImageHeight ?? 0),
  'date-original': (asset) => {
    const dateStr = asset.exifInfo?.dateTimeOriginal ?? asset.localDateTime;
    return dateStr ? new Date(dateStr).getTime() : 0;
  },
  'created-at': (asset) => {
    const dateStr = asset.fileCreatedAt;
    return dateStr ? new Date(dateStr).getTime() : 0;
  },
  'filename-alpha': (asset) => asset.originalFileName ?? '',
  'filename-length': (asset) => (asset.originalFileName ?? '').length,
  'has-location': (asset) => (asset.exifInfo?.latitude != null && asset.exifInfo?.longitude != null ? 1 : 0),
};

// ── Core selection logic ────────────────────────────────────────────

/**
 * Applies a single rule to narrow the candidate list.
 * Sorts candidates by the rule's value, then keeps only those tied at the "best" end.
 */
const applyRule = (candidates: AssetResponseDto[], rule: DuplicateSelectionRule): AssetResponseDto[] => {
  if (candidates.length <= 1) {
    return candidates;
  }

  const extract = ruleValueExtractors[rule.type];

  // Sort ascending by extracted value
  const sorted = sortBy(candidates, (a) => extract(a));

  // Pick the "best" value from the correct end
  const bestAsset = rule.direction === 'desc' ? sorted.at(-1) : sorted.at(0);
  if (!bestAsset) {
    return candidates;
  }
  const bestValue = extract(bestAsset);

  // Keep only candidates that tie with the best value
  return sorted.filter((a) => extract(a) === bestValue);
};

/**
 * Suggests the best duplicate asset to keep from a list of duplicates
 * using the provided (or default) selection rules.
 *
 * Rules are evaluated in order. Each enabled rule narrows the candidate set.
 * When only one candidate remains (or all rules are exhausted), the last
 * candidate in the remaining set is returned.
 *
 * @param assets List of duplicate assets
 * @param rules  Optional ordered selection rules (defaults to getDefaultDuplicateRules())
 * @returns The best asset to keep
 */
export const suggestDuplicate = (
  assets: AssetResponseDto[],
  rules?: DuplicateSelectionRule[],
): AssetResponseDto | undefined => {
  if (assets.length === 0) {
    return undefined;
  }

  const activeRules = (rules ?? getDefaultDuplicateRules()).filter((r) => r.enabled);
  let candidates = [...assets];

  for (const rule of activeRules) {
    candidates = applyRule(candidates, rule);
    if (candidates.length <= 1) {
      break;
    }
  }

  return candidates.at(-1);
};

/**
 * Ranks duplicate assets by the selection rules, best keeper first.
 * Uses a composite comparison: for each enabled rule (in priority order),
 * assets are compared by extracted value. The "best" direction wins.
 *
 * @param assets List of duplicate assets
 * @param rules  Optional ordered selection rules (defaults to getDefaultDuplicateRules())
 * @returns A new array sorted best-keeper-first (index 0 = most keepable)
 */
export const rankDuplicates = (assets: AssetResponseDto[], rules?: DuplicateSelectionRule[]): AssetResponseDto[] => {
  if (assets.length <= 1) {
    return [...assets];
  }

  const activeRules = (rules ?? getDefaultDuplicateRules()).filter((r) => r.enabled);

  return [...assets].sort((a, b) => {
    for (const rule of activeRules) {
      const extract = ruleValueExtractors[rule.type];
      const valA = extract(a);
      const valB = extract(b);

      if (valA === valB) {
        continue;
      }

      // For string values, use localeCompare
      if (typeof valA === 'string' && typeof valB === 'string') {
        const cmp = valA.localeCompare(valB);
        if (cmp === 0) {
          continue;
        }
        // asc = lower string first is "best", desc = higher string first is "best"
        return rule.direction === 'asc' ? cmp : -cmp;
      }

      // For numeric values
      // desc = higher is better (should come first → negative when a > b)
      // asc = lower is better (should come first → negative when a < b)
      if (rule.direction === 'desc') {
        return (valB as number) - (valA as number);
      }
      return (valA as number) - (valB as number);
    }
    return 0;
  });
};

/**
 * Evaluates each enabled rule independently for a given asset against all assets.
 * Returns a map of rule type → whether this asset has the best (or tied-for-best) value.
 * Rules where all assets have the same value are omitted from the result.
 */
export const evaluateAssetRules = (
  asset: AssetResponseDto,
  allAssets: AssetResponseDto[],
  rules?: DuplicateSelectionRule[],
): Partial<Record<DuplicateSelectionRuleType, boolean>> => {
  const activeRules = (rules ?? getDefaultDuplicateRules()).filter((r) => r.enabled);
  const result: Partial<Record<DuplicateSelectionRuleType, boolean>> = {};

  for (const rule of activeRules) {
    const extract = ruleValueExtractors[rule.type];
    const assetValue = extract(asset);
    const allValues = allAssets.map((a) => extract(a));

    // For location rule, always show indicator if enabled, but only if not all values are identical
    if (rule.type === 'has-location') {
      if (new Set(allValues.map(String)).size <= 1) {
        continue;
      }
      const bestValue = rule.direction === 'desc' ? 1 : 0;
      result[rule.type] = assetValue === bestValue;
      continue;
    }

    // Skip rules where all values are identical
    if (new Set(allValues.map(String)).size <= 1) {
      continue;
    }

    // Find the best value
    const sorted = [...allValues].sort((a, b) => {
      if (typeof a === 'string' && typeof b === 'string') {
        // Case-sensitive comparison
        return a < b ? -1 : a > b ? 1 : 0;
      }
      return (a as number) - (b as number);
    });
    const bestValue = rule.direction === 'desc' ? sorted.at(-1) : sorted.at(0);

    result[rule.type] = String(assetValue) === String(bestValue);
  }

  return result;
};
