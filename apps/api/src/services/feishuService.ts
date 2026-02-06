import * as lark from '@larksuiteoapi/node-sdk';
import { env } from '../config/env.js';
import { retry } from '../utils/retry.js';

const fieldMap = {
  name: process.env.FEISHU_FIELD_NAME || '姓名',
  phone: process.env.FEISHU_FIELD_PHONE || '手机号',
  title: process.env.FEISHU_FIELD_TITLE || '职位',
  company: process.env.FEISHU_FIELD_COMPANY || '公司',
  idNumber: process.env.FEISHU_FIELD_ID || '身份证号',
  submittedAt: process.env.FEISHU_FIELD_SUBMITTED_AT || '提交时间',
  syncStatus: process.env.FEISHU_FIELD_SYNC_STATUS || '同步状态'
};

const client = new lark.Client({
  appId: env.FEISHU_APP_ID,
  appSecret: env.FEISHU_APP_SECRET
});

export async function createBitableRecord(fields: Record<string, string>): Promise<string> {
  const doRequest = async () => {
    const res = await client.bitable.appTableRecord.create({
      path: {
        app_token: env.FEISHU_APP_TOKEN,
        table_id: env.FEISHU_TABLE_ID
      },
      data: {
        fields
      }
    });

    if (res.code && res.code !== 0) {
      throw new Error(`Feishu record error: ${res.msg || 'Unknown error'}`);
    }

    const recordId = res.data?.record?.record_id;
    if (!recordId) {
      throw new Error('Feishu record error: missing record id');
    }

    return recordId;
  };

  return retry(doRequest, { retries: 3, baseDelayMs: 500, maxDelayMs: 4000 });
}

export function mapToBitableFields(input: {
  name: string;
  phone: string;
  title: string;
  company: string;
  idNumber: string;
  submittedAt: string;
  syncStatus: string;
}): Record<string, string> {
  return {
    [fieldMap.name]: input.name,
    [fieldMap.phone]: input.phone,
    [fieldMap.title]: input.title,
    [fieldMap.company]: input.company,
    [fieldMap.idNumber]: input.idNumber,
    [fieldMap.submittedAt]: input.submittedAt,
    [fieldMap.syncStatus]: input.syncStatus
  };
}
