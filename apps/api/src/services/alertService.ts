import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

interface SyncFailureAlert {
  submissionId: string;
  traceId: string;
  errorMessage: string;
  attempts: number;
  role?: string;
  createdAt?: Date;
}

/**
 * 发送飞书机器人告警
 * 使用飞书 Webhook 机器人: https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 */
export async function sendFeishuAlert(alert: SyncFailureAlert): Promise<void> {
  if (!env.FEISHU_ALERT_ENABLED || !env.FEISHU_ALERT_WEBHOOK) {
    logger.debug({ submissionId: alert.submissionId }, 'Feishu alert disabled or webhook not configured');
    return;
  }

  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const message = {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true
      },
      header: {
        title: {
          tag: 'plain_text',
          content: '⚠️ 数据同步失败告警'
        },
        template: 'red'
      },
      elements: [
        {
          tag: 'div',
          fields: [
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**提交ID:**\n${alert.submissionId}`
              }
            },
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**追踪ID:**\n${alert.traceId}`
              }
            }
          ]
        },
        {
          tag: 'div',
          fields: [
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**用户类型:**\n${alert.role === 'industry' ? '专业观众' : alert.role === 'consumer' ? '消费者' : alert.role || '未知'}`
              }
            },
            {
              is_short: true,
              text: {
                tag: 'lark_md',
                content: `**重试次数:**\n${alert.attempts} 次`
              }
            }
          ]
        },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**错误信息:**\n\`\`\`\n${alert.errorMessage.slice(0, 500)}\n\`\`\``
          }
        },
        {
          tag: 'hr'
        },
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: `告警时间: ${timestamp} | 创建时间: ${alert.createdAt?.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) || '未知'}`
            }
          ]
        }
      ]
    }
  };

  try {
    const response = await fetch(env.FEISHU_ALERT_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error(
        { status: response.status, body: text, submissionId: alert.submissionId },
        'Failed to send Feishu alert'
      );
    } else {
      logger.info({ submissionId: alert.submissionId }, 'Feishu alert sent successfully');
    }
  } catch (err) {
    logger.error({ err, submissionId: alert.submissionId }, 'Error sending Feishu alert');
  }
}

/**
 * 发送同步失败告警
 */
export async function alertSyncFailure(
  submissionId: string,
  traceId: string,
  errorMessage: string,
  attempts: number,
  role?: string,
  createdAt?: Date
): Promise<void> {
  await sendFeishuAlert({
    submissionId,
    traceId,
    errorMessage,
    attempts,
    role,
    createdAt
  });
}
