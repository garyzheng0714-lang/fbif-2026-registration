export type BitableFieldMeta = {
  name: string;
  type: unknown;
  uiType: string;
  optionsByName: Map<string, string>;
  optionsById: Set<string>;
};

function trim(v: unknown) {
  return String(v || '').trim();
}

export function normalizeSelectOptionText(value: unknown) {
  return trim(value).replace(/[\s\u200B-\u200D\uFEFF]/g, '');
}

export function resolveSingleSelectOptionId(meta: BitableFieldMeta, rawValue: unknown) {
  const value = trim(rawValue);
  if (!value) return null;
  if (meta.uiType !== 'SingleSelect' && meta.type !== 3) return null;

  if (value.startsWith('opt') && meta.optionsById.has(value)) {
    return value;
  }

  const exact = meta.optionsByName.get(value);
  if (exact) return exact;

  const normalizedValue = normalizeSelectOptionText(value);
  if (normalizedValue) {
    const normalizedExactMatches: string[] = [];
    for (const [name, id] of meta.optionsByName.entries()) {
      if (normalizeSelectOptionText(name) === normalizedValue) {
        normalizedExactMatches.push(id);
        if (normalizedExactMatches.length > 1) break;
      }
    }
    if (normalizedExactMatches.length === 1) return normalizedExactMatches[0];
  }

  const matches: string[] = [];
  for (const [name, id] of meta.optionsByName.entries()) {
    if (name.includes(value)) {
      matches.push(id);
      if (matches.length > 1) break;
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

export function applySingleSelectMappings(
  fields: Record<string, string>,
  metaByName: Map<string, BitableFieldMeta>,
  ctx: { traceId: string; idSuffix: string },
  logger?: { warn: (obj: any, msg?: string) => void }
) {
  const keys = Object.keys(fields);
  for (const fieldName of keys) {
    const value = fields[fieldName];
    if (typeof value !== 'string' || !value) continue;

    const meta = metaByName.get(fieldName);
    if (!meta) continue;
    if (meta.uiType !== 'SingleSelect' && meta.type !== 3) continue;

    const optionId = resolveSingleSelectOptionId(meta, value);
    if (!optionId) {
      const availableOptions = Array.from(meta.optionsByName.keys()).slice(0, 12);
      logger?.warn?.(
        {
          traceId: ctx.traceId,
          idSuffix: ctx.idSuffix,
          fieldName,
          value: value.slice(0, 128),
          availableOptions
        },
        'bitable select option not found; failing sync to avoid silent empty field'
      );

      throw new Error(
        `bitable single-select option not found for field "${fieldName}": "${value.slice(0, 128)}"`
      );
    }

    fields[fieldName] = optionId;
  }

  return fields;
}
