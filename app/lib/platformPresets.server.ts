import { autoDetectMapping, normalize } from "./orderFields.server";
import { getPlatformPreset } from "./platformPresets";

/**
 * Suggest a mapping for each header: platform-specific known headers first (exact normalized
 * match), then the generic ORDER_FIELDS synonym detector for anything a preset doesn't cover.
 * With no platformId, behaves exactly like autoDetectMapping.
 */
export function detectMappingForPlatform(
  headers: string[],
  platformId?: string | null,
): Record<string, string | null> {
  const preset = getPlatformPreset(platformId);
  if (!preset) return autoDetectMapping(headers);

  const suggestions: Record<string, string | null> = {};
  const usedTargets = new Set<string>();
  const unmatchedHeaders: string[] = [];

  for (const header of headers) {
    const normalizedHeader = normalize(header);
    let matchedKey: string | null = null;

    for (const [fieldKey, synonyms] of Object.entries(preset.headerSynonyms)) {
      if (usedTargets.has(fieldKey)) continue;
      if (synonyms?.some((syn) => normalize(syn) === normalizedHeader)) {
        matchedKey = fieldKey;
        break;
      }
    }

    if (matchedKey) {
      suggestions[header] = matchedKey;
      usedTargets.add(matchedKey);
    } else {
      unmatchedHeaders.push(header);
    }
  }

  if (unmatchedHeaders.length > 0) {
    const genericSuggestions = autoDetectMapping(unmatchedHeaders);
    for (const header of unmatchedHeaders) {
      const generic = genericSuggestions[header];
      if (generic && !usedTargets.has(generic)) {
        suggestions[header] = generic;
        usedTargets.add(generic);
      } else {
        suggestions[header] = null;
      }
    }
  }

  return suggestions;
}
