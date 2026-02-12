import { Router } from 'express';
import { z } from 'zod';
import { burstLimiter } from '../middleware/rateLimit.js';
import { csrfGuard } from './csrf.js';
import { isValidChineseId, sanitizeText } from '../validation/submission.js';
import { createIdVerifyToken } from '../utils/idVerifyToken.js';
import { IdVerifyError, verifyIdentityByAliyun } from '../services/idVerifyService.js';

const verifySchema = z.object({
  name: z.string().min(2, '姓名至少 2 个字符').max(32),
  idType: z.enum(['cn_id', 'passport', 'other']),
  idNumber: z.string().min(1).max(64)
});

export const idVerifyRouter = Router();

idVerifyRouter.post('/', burstLimiter, csrfGuard, async (req, res, next) => {
  try {
    const parsed = verifySchema.parse(req.body);
    const name = sanitizeText(parsed.name);
    const idNumber = String(parsed.idNumber || '').trim().toUpperCase();

    if (parsed.idType !== 'cn_id') {
      return res.status(400).json({
        error: 'UnsupportedIdType',
        message: '仅支持中国居民身份证实名验证',
        traceId: res.locals.traceId
      });
    }

    if (!isValidChineseId(idNumber)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: '身份证号格式或校验位不正确',
        traceId: res.locals.traceId
      });
    }

    const result = await verifyIdentityByAliyun({ name, idCard: idNumber });
    const message = result.result === 1
      ? '实名验证通过'
      : result.result === 2
        ? '姓名与身份证号不一致'
        : '该身份证号暂无核验记录';

    return res.json({
      verified: result.verified,
      result: result.result,
      message,
      providerCode: result.providerCode,
      providerMessage: result.providerMessage,
      area: result.area,
      province: result.province,
      city: result.city,
      district: result.district,
      verificationToken: result.verified ? createIdVerifyToken(name, idNumber) : ''
    });
  } catch (err) {
    if (err instanceof IdVerifyError) {
      return res.status(err.status).json({
        error: err.code,
        message: err.message,
        traceId: res.locals.traceId
      });
    }
    return next(err);
  }
});
