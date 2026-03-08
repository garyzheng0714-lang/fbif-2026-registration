import { prisma } from '../utils/db.js';
import { FeishuApiError, listBitableRecordsPage, updateBitableRecord } from '../services/feishuService.js';
import type { BitableWriteFields } from '../services/feishuService.js';
import { logger } from '../utils/logger.js';
import { decryptField } from '../utils/crypto.js';

type CliOptions = {
  dryRun: boolean;
  limit: number;
  batchSize: number;
  listPageSize: number;
};

function parseIntArg(name: string, fallback: number) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return fallback;
  const raw = String(process.argv[idx + 1] || '').trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid value for ${name}: "${raw}"`);
  }
  return Math.floor(n);
}

function parseOptions(): CliOptions {
  return {
    dryRun: process.argv.includes('--dry-run'),
    limit: parseIntArg('--limit', 5000),
    batchSize: parseIntArg('--batch-size', 200),
    listPageSize: parseIntArg('--list-page-size', 500)
  };
}

function trim(v: unknown) {
  return String(v || '').trim();
}

function dedupe(values: string[]) {
  return Array.from(new Set(values.map((v) => trim(v)).filter(Boolean)));
}

const matchFieldCandidates = {
  name: dedupe([process.env.FEISHU_FIELD_NAME || '姓名', '姓名', '姓名（问卷题）']),
  phone: dedupe([process.env.FEISHU_FIELD_PHONE || '手机号（问卷题）', '手机号（问卷题）', '手机号']),
  title: dedupe([process.env.FEISHU_FIELD_TITLE || '职位（问卷题）', '职位（问卷题）', '职位']),
  company: dedupe([process.env.FEISHU_FIELD_COMPANY || '公司（问卷题）', '公司（问卷题）', '公司']),
  idNumber: dedupe([process.env.FEISHU_FIELD_ID || '证件号码（问卷题）', '证件号码（问卷题）', '证件号码'])
};

type MatchInput = {
  name: string;
  phone: string;
  title: string;
  company: string;
  idNumber: string;
};

function formatShanghaiDate(d: Date) {
  const fmt = d.toLocaleString('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return fmt.replaceAll('-', '/');
}

function normalizeCompactText(v: unknown) {
  return trim(v)
    .replace(/[\s\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase();
}

function normalizePhone(v: unknown) {
  let digits = trim(v)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\D/g, '');
  if (!digits) return '';
  // Normalize mainland numbers with optional country code.
  if (digits.length > 11 && digits.startsWith('86')) {
    digits = digits.slice(2);
  }
  return digits;
}

function normalizeIdNumber(v: unknown) {
  return trim(v)
    .replace(/[\s\u200B-\u200D\uFEFF]/g, '')
    .toUpperCase();
}

function buildMatchKey(input: MatchInput) {
  const normalized = [
    normalizeCompactText(input.name),
    normalizePhone(input.phone),
    normalizeCompactText(input.title),
    normalizeCompactText(input.company),
    normalizeIdNumber(input.idNumber)
  ];
  if (normalized.some((v) => !v)) return '';
  return normalized.join('|');
}

function toCellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return trim(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => toCellText(item)).filter(Boolean).join(',');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string' && trim(obj.text)) return trim(obj.text);
    if (typeof obj.link === 'string' && trim(obj.link)) return trim(obj.link);
    try {
      return JSON.stringify(obj);
    } catch {
      return '';
    }
  }
  return trim(value);
}

function readFirstNonEmptyField(fields: Record<string, unknown>, candidates: string[]) {
  for (const name of candidates) {
    const text = toCellText(fields[name]);
    if (text) return text;
  }
  return '';
}

function maskTail(v: unknown, size: number) {
  const text = trim(v);
  if (!text) return '';
  return text.slice(-Math.max(1, size));
}

class BitableRecordMatcher {
  private readonly pageSize: number;
  private loaded = false;
  private indexedRecords = 0;
  private byMatchKey = new Map<string, string[]>();

  constructor(pageSize: number) {
    this.pageSize = Math.max(1, Math.min(500, Number(pageSize || 500)));
  }

  private add(recordId: string, key: string) {
    const list = this.byMatchKey.get(key);
    if (!list) {
      this.byMatchKey.set(key, [recordId]);
      return;
    }
    list.push(recordId);
  }

  private async ensureLoaded() {
    if (this.loaded) return;

    const seenPageTokens = new Set<string>();
    let pageToken = '';
    let pageCount = 0;

    while (true) {
      const page = await listBitableRecordsPage({
        pageSize: this.pageSize,
        ...(pageToken ? { pageToken } : {})
      });
      pageCount += 1;

      for (const item of page.items) {
        const matchInput: MatchInput = {
          name: readFirstNonEmptyField(item.fields, matchFieldCandidates.name),
          phone: readFirstNonEmptyField(item.fields, matchFieldCandidates.phone),
          title: readFirstNonEmptyField(item.fields, matchFieldCandidates.title),
          company: readFirstNonEmptyField(item.fields, matchFieldCandidates.company),
          idNumber: readFirstNonEmptyField(item.fields, matchFieldCandidates.idNumber)
        };
        const key = buildMatchKey(matchInput);
        if (!key) continue;
        this.add(item.recordId, key);
        this.indexedRecords += 1;
      }

      if (!page.hasMore) break;
      if (!page.pageToken || seenPageTokens.has(page.pageToken)) {
        logger.warn(
          {
            pageCount,
            hasMore: page.hasMore,
            pageToken: page.pageToken
          },
          'bitable matcher stopped due to missing/repeated page token'
        );
        break;
      }
      seenPageTokens.add(page.pageToken);
      pageToken = page.pageToken;
    }

    this.loaded = true;
    logger.info(
      {
        pageCount,
        indexedRecords: this.indexedRecords,
        uniqueKeys: this.byMatchKey.size
      },
      'bitable matcher index loaded'
    );
  }

  async resolve(input: MatchInput): Promise<{ recordId: string | null; reason: 'exact' | 'not_found' | 'ambiguous' | 'incomplete_key' }> {
    await this.ensureLoaded();
    const key = buildMatchKey(input);
    if (!key) return { recordId: null, reason: 'incomplete_key' };

    const candidates = this.byMatchKey.get(key) || [];
    if (candidates.length === 1) return { recordId: candidates[0], reason: 'exact' };
    if (candidates.length > 1) return { recordId: null, reason: 'ambiguous' };
    return { recordId: null, reason: 'not_found' };
  }
}

function isRecordIdNotFoundError(err: unknown) {
  if (err instanceof FeishuApiError && err.code === 1254043) return true;
  const msg = err instanceof Error ? err.message : String(err || '');
  return msg.includes('RecordIdNotFound');
}

function buildMetadataFields(row: {
  clientIp: string | null;
  createdAt: Date;
  clientRequestId: string;
}): BitableWriteFields {
  const fields: Record<string, unknown> = {};

  const clientIpField = process.env.FEISHU_FIELD_CLIENT_IP || 'ip';
  const actualSubmittedAtField = process.env.FEISHU_FIELD_ACTUAL_SUBMITTED_AT || '实际提交时间';
  const clientRequestIdField = process.env.FEISHU_FIELD_CLIENT_REQUEST_ID || '提交记录唯一值';

  if (clientIpField && row.clientIp) {
    fields[clientIpField] = trim(row.clientIp);
  }
  if (actualSubmittedAtField) {
    fields[actualSubmittedAtField] = formatShanghaiDate(row.createdAt);
  }
  if (clientRequestIdField) {
    fields[clientRequestIdField] = row.clientRequestId;
  }

  return {
    readableFields: fields,
    optionIdFields: { ...fields }
  };
}

async function main() {
  const options = parseOptions();
  let cursorId: string | undefined;
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let missingRecordId = 0;
  let resolvedByMultiFieldMatch = 0;
  let unresolvedMissingRecordId = 0;
  let ambiguousMatches = 0;
  let incompleteMatchKeys = 0;
  let linkedRecordId = 0;
  let recordIdNotFound = 0;
  let recoveredFromRecordIdNotFound = 0;

  let matcher: BitableRecordMatcher | null = null;

  logger.info(
    {
      dryRun: options.dryRun,
      limit: options.limit,
      batchSize: options.batchSize,
      listPageSize: options.listPageSize
    },
    'feishu metadata backfill started'
  );

  while (scanned < options.limit) {
    const take = Math.min(options.batchSize, options.limit - scanned);
    const rows = await prisma.submission.findMany({
      where: {
        OR: [
          { feishuRecordId: { not: null } },
          { syncStatus: 'SUCCESS' }
        ]
      },
      orderBy: { id: 'asc' },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take,
      select: {
        id: true,
        traceId: true,
        feishuRecordId: true,
        clientIp: true,
        createdAt: true,
        clientRequestId: true,
        name: true,
        title: true,
        company: true,
        phoneEnc: true,
        idEnc: true
      }
    });

    if (rows.length === 0) break;
    cursorId = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned += 1;
      let recordId = trim(row.feishuRecordId);

      if (!recordId) {
        missingRecordId += 1;
        let phone = '';
        let idNumber = '';
        try {
          phone = decryptField(row.phoneEnc);
          idNumber = decryptField(row.idEnc);
        } catch (err) {
          failed += 1;
          logger.error(
            {
              err,
              submissionId: row.id,
              traceId: row.traceId
            },
            'feishu metadata backfill failed to decrypt sensitive fields for matching'
          );
          continue;
        }

        if (!matcher) {
          matcher = new BitableRecordMatcher(options.listPageSize);
        }
        const resolved = await matcher.resolve({
          name: row.name,
          phone,
          title: row.title,
          company: row.company,
          idNumber
        });

        if (!resolved.recordId) {
          unresolvedMissingRecordId += 1;
          if (resolved.reason === 'ambiguous') ambiguousMatches += 1;
          if (resolved.reason === 'incomplete_key') incompleteMatchKeys += 1;
          skipped += 1;
          logger.warn(
            {
              submissionId: row.id,
              traceId: row.traceId,
              reason: resolved.reason,
              phoneSuffix: maskTail(phone, 4),
              idSuffix: maskTail(idNumber, 4)
            },
            'feishu metadata backfill could not resolve feishuRecordId via multi-field exact match'
          );
          continue;
        }

        recordId = resolved.recordId;
        resolvedByMultiFieldMatch += 1;

        if (!options.dryRun) {
          try {
            await prisma.submission.update({
              where: { id: row.id },
              data: { feishuRecordId: recordId }
            });
          } catch (err) {
            failed += 1;
            logger.error(
              {
                err,
                submissionId: row.id,
                traceId: row.traceId,
                feishuRecordId: recordId
              },
              'feishu metadata backfill failed to persist resolved feishuRecordId'
            );
            continue;
          }
        }
        linkedRecordId += 1;
      }

      const fields = buildMetadataFields(row);
      if (Object.keys(fields.readableFields).length === 0) {
        skipped += 1;
        continue;
      }

      if (options.dryRun) {
        updated += 1;
        continue;
      }

      try {
        await updateBitableRecord(recordId, fields);
        updated += 1;
      } catch (err) {
        if (!isRecordIdNotFoundError(err)) {
          failed += 1;
          logger.error(
            {
              err,
              submissionId: row.id,
              traceId: row.traceId,
              feishuRecordId: recordId
            },
            'feishu metadata backfill failed'
          );
          continue;
        }

        recordIdNotFound += 1;

        let phone = '';
        let idNumber = '';
        try {
          phone = decryptField(row.phoneEnc);
          idNumber = decryptField(row.idEnc);
        } catch (decryptErr) {
          failed += 1;
          logger.error(
            {
              err: decryptErr,
              submissionId: row.id,
              traceId: row.traceId,
              feishuRecordId: recordId
            },
            'feishu metadata backfill failed to decrypt sensitive fields after RecordIdNotFound'
          );
          continue;
        }

        if (!matcher) {
          matcher = new BitableRecordMatcher(options.listPageSize);
        }
        const resolved = await matcher.resolve({
          name: row.name,
          phone,
          title: row.title,
          company: row.company,
          idNumber
        });

        if (!resolved.recordId || resolved.recordId === recordId) {
          failed += 1;
          logger.error(
            {
              err,
              submissionId: row.id,
              traceId: row.traceId,
              feishuRecordId: recordId,
              resolvedRecordId: resolved.recordId,
              resolveReason: resolved.reason,
              phoneSuffix: maskTail(phone, 4),
              idSuffix: maskTail(idNumber, 4)
            },
            'feishu metadata backfill RecordIdNotFound and rematch failed'
          );
          continue;
        }

        const rematchedRecordId = resolved.recordId;
        if (!options.dryRun) {
          try {
            await prisma.submission.update({
              where: { id: row.id },
              data: { feishuRecordId: rematchedRecordId }
            });
          } catch (updateErr) {
            failed += 1;
            logger.error(
              {
                err: updateErr,
                submissionId: row.id,
                traceId: row.traceId,
                oldFeishuRecordId: recordId,
                newFeishuRecordId: rematchedRecordId
              },
              'feishu metadata backfill failed to persist rematched feishuRecordId'
            );
            continue;
          }
        }
        linkedRecordId += 1;

        try {
          await updateBitableRecord(rematchedRecordId, fields);
          updated += 1;
          recoveredFromRecordIdNotFound += 1;
        } catch (retryErr) {
          failed += 1;
          logger.error(
            {
              err: retryErr,
              submissionId: row.id,
              traceId: row.traceId,
              oldFeishuRecordId: recordId,
              newFeishuRecordId: rematchedRecordId
            },
            'feishu metadata backfill failed after RecordIdNotFound rematch'
          );
        }
      }
    }
  }

  const summary = {
    dryRun: options.dryRun,
    scanned,
    updated,
    skipped,
    failed,
    missingRecordId,
    resolvedByMultiFieldMatch,
    unresolvedMissingRecordId,
    ambiguousMatches,
    incompleteMatchKeys,
    linkedRecordId,
    recordIdNotFound,
    recoveredFromRecordIdNotFound
  };
  console.log(JSON.stringify(summary, null, 2));
  logger.info(summary, 'feishu metadata backfill finished');

  if (failed > 0) {
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error('[backfill-feishu-metadata][fatal]', err instanceof Error ? err.stack || err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
