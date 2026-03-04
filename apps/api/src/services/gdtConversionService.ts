import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * 腾讯广告转化回传服务
 * 文档: https://developers.e.qq.com/docs/guide/conversion/new_version/Web_api
 */

// 腾讯广告 API 基础地址
const GDT_API_BASE = 'https://tracking.e.qq.com';

/**
 * 回传转化数据到腾讯广告
 * @param clickId 腾讯广告生成的 click_id（从落地页 URL 参数 gdt_vid 或 qz_gdt 获取）
 * @param actionType 转化行为类型: REGISTER | RESERVATION | VIEW_CONTENT 等
 * @param url 落地页域名
 */
export async function reportConversionToGdt(
  clickId: string,
  actionType: string = 'REGISTER',
  url?: string
): Promise<{ success: boolean; error?: string }> {
  // 如果未配置腾讯广告回传，跳过
  if (!env.GDT_CONVERSION_ENABLED) {
    logger.info({ clickId, actionType }, 'GDT conversion reporting disabled, skipping');
    return { success: true };
  }

  if (!clickId) {
    logger.warn({ clickId }, 'GDT click_id is empty, skipping conversion report');
    return { success: true };
  }

  const actionTime = Math.floor(Date.now() / 1000);

  // 从 WEB_ORIGIN 提取域名（如 https://fbif2026ticket.foodtalks.cn → fbif2026ticket.foodtalks.cn）
  let reportUrl = url;
  if (!reportUrl && env.WEB_ORIGIN) {
    try {
      const urlObj = new URL(env.WEB_ORIGIN);
      reportUrl = urlObj.hostname;
    } catch {
      reportUrl = env.WEB_ORIGIN;
    }
  }
  reportUrl = reportUrl || 'fbif2026ticket.foodtalks.cn';

  // 构建请求参数
  const params = new URLSearchParams({
    clickid: clickId,
    action_time: String(actionTime),
    action_type: actionType,
    link: reportUrl
  });

  const fullUrl = `${GDT_API_BASE}/conv?${params.toString()}`;

  try {
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'FBIF-Form/1.0'
      }
    });

    const responseText = await response.text();

    if (response.ok && responseText.includes('"code":0')) {
      logger.info({ clickId, actionType, actionTime }, 'GDT conversion reported successfully');
      return { success: true };
    } else {
      logger.error({ clickId, actionType, response: responseText }, 'GDT conversion report failed');
      return { success: false, error: responseText };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ clickId, actionType, error }, 'GDT conversion report error');
    return { success: false, error };
  }
}