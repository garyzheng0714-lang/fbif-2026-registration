import { prisma } from '../utils/db.js';
import { logger } from '../utils/logger.js';

export interface ClickEventInput {
  accountId?: string;
  clickId: string;
  clickTime?: string;
  adgroupId?: string;
  callback?: string;
  creativeId?: string;
  adType?: string;
  siteSet?: string;
  requestId?: string;
  deviceOs?: string;
  muid?: string;
  ip?: string;
  userAgent?: string;
  impressionId?: string;
  rawQuery?: string;
  vendor?: string;
}

/** 保存广告点击事件 */
export async function saveClickEvent(input: ClickEventInput) {
  const record = await prisma.clickEvent.create({
    data: {
      accountId: input.accountId || null,
      clickId: input.clickId,
      clickTime: input.clickTime || null,
      adgroupId: input.adgroupId || null,
      callback: input.callback || null,
      creativeId: input.creativeId || null,
      adType: input.adType || null,
      siteSet: input.siteSet || null,
      requestId: input.requestId || null,
      deviceOs: input.deviceOs || null,
      muid: input.muid || null,
      ip: input.ip || null,
      userAgent: input.userAgent || null,
      impressionId: input.impressionId || null,
      rawQuery: input.rawQuery || null,
      vendor: input.vendor || null,
    },
  });
  logger.info({ clickId: input.clickId }, 'click event saved');
  return record;
}

/** 根据跟踪 ID 查找点击事件（依次匹配 click_id、impression_id、request_id） */
export async function lookupClickEvent(trackingId: string) {
  const record = await prisma.clickEvent.findFirst({
    where: {
      OR: [
        { clickId: trackingId },
        { impressionId: trackingId },
        { requestId: trackingId },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: {
      clickId: true,
      callback: true,
      clickTime: true,
      accountId: true,
      impressionId: true,
      requestId: true,
      adgroupId: true,
      creativeId: true,
      adType: true,
      siteSet: true,
      deviceOs: true,
      muid: true,
      ip: true,
      userAgent: true,
      vendor: true,
      createdAt: true,
    },
  });
  return record;
}

/** 清理超过指定天数的未转化点击记录 */
export async function cleanupOldClickEvents(days: number = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const result = await prisma.clickEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (result.count > 0) {
    logger.info({ deleted: result.count, olderThan: days }, 'cleaned up old click events');
  }
  return result.count;
}
