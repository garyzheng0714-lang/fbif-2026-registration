import { Router } from 'express';
import { saveClickEvent, lookupClickEvent } from '../services/clickEventService.js';
import { logger } from '../utils/logger.js';

export const clickEventRouter = Router();

/**
 * GET /api/click-callback
 * 接收腾讯广告的点击回调，存入数据库。
 * 给代理商的回调地址。
 */
clickEventRouter.get('/click-callback', async (req, res) => {
  try {
    const clickId = String(req.query.click_id || '').trim();
    if (!clickId) {
      return res.status(400).json({ error: 'missing click_id' });
    }

    await saveClickEvent({
      accountId: String(req.query.account_id || '').trim() || undefined,
      clickId,
      clickTime: String(req.query.click_time || '').trim() || undefined,
      adgroupId: String(req.query.adgroup_id || '').trim() || undefined,
      callback: String(req.query.callback || '').trim() || undefined,
      creativeId: String(req.query.creative_id || '').trim() || undefined,
      adType: String(req.query.ad_type || '').trim() || undefined,
      siteSet: String(req.query.site_set || '').trim() || undefined,
      requestId: String(req.query.request_id || '').trim() || undefined,
      deviceOs: String(req.query.device_os || '').trim() || undefined,
      muid: String(req.query.muid || '').trim() || undefined,
      ip: String(req.query.ip || '').trim() || undefined,
      userAgent: String(req.query.user_agent || '').trim() || undefined,
      impressionId: String(req.query.impression_id || '').trim() || undefined,
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'click-callback failed');
    return res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * GET /api/click-lookup?tracking_id=xxx
 * 根据跟踪 ID 查找点击事件，返回 callback 链接。
 * 多维表格自动化工作流调用此接口。
 */
clickEventRouter.get('/click-lookup', async (req, res) => {
  try {
    const trackingId = String(req.query.tracking_id || '').trim();
    if (!trackingId) {
      return res.status(400).json({ error: 'missing tracking_id' });
    }

    const record = await lookupClickEvent(trackingId);
    if (!record) {
      return res.json({ found: false });
    }

    return res.json({
      found: true,
      callback: record.callback,
      click_id: record.clickId,
      click_time: record.clickTime,
      account_id: record.accountId,
      impression_id: record.impressionId,
      request_id: record.requestId,
      adgroup_id: record.adgroupId,
      creative_id: record.creativeId,
      ad_type: record.adType,
      site_set: record.siteSet,
      device_os: record.deviceOs,
      muid: record.muid,
      ip: record.ip,
      user_agent: record.userAgent,
      created_at: record.createdAt,
    });
  } catch (err) {
    logger.error({ err }, 'click-lookup failed');
    return res.status(500).json({ error: 'internal_error' });
  }
});
