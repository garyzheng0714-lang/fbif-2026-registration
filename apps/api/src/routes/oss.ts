import { Router } from 'express';
import { z } from 'zod';
import { burstLimiter } from '../middleware/rateLimit.js';
import { csrfGuard } from './csrf.js';
import { buildOssUploadPolicy, isOssEnabled } from '../services/ossPolicyService.js';

export const ossRouter = Router();

const policySchema = z.object({
  filename: z.string().min(1).max(256),
  size: z.coerce.number().int().nonnegative().default(0)
});

ossRouter.post('/policy', burstLimiter, csrfGuard, (req, res, next) => {
  try {
    if (!isOssEnabled()) {
      return res.status(503).json({
        error: 'OSSUnavailable',
        message: 'OSS 上传未配置',
        traceId: res.locals.traceId
      });
    }

    const input = policySchema.parse(req.body);
    try {
      const policy = buildOssUploadPolicy({
        filename: input.filename,
        sizeBytes: input.size
      });
      return res.json(policy);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成上传签名失败';
      return res.status(400).json({
        error: 'ValidationError',
        message: msg,
        traceId: res.locals.traceId
      });
    }
  } catch (err) {
    next(err);
  }
});
