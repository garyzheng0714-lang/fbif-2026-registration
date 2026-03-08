#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3002';
const API_BASE = process.env.E2E_API_BASE || new URL('/api', BASE_URL).toString().replace(/\/$/, '');
const VERIFY_NAME = process.env.VERIFY_NAME || '郑梽煌';
const VERIFY_ID = process.env.VERIFY_ID || '35052519981217001X';
const VERIFY_PHONE = process.env.VERIFY_PHONE || '13800000001';
const SYNC_MAX_POLLS = Number(process.env.SYNC_MAX_POLLS || 30);
const SYNC_POLL_INTERVAL_MS = Number(process.env.SYNC_POLL_INTERVAL_MS || 2000);
const PROOF_FILE = process.env.E2E_PROOF_FILE || path.resolve('apps/web/public/banner.png');

function log(step, message) {
  const ts = new Date().toISOString();
  // Keep one-line logs for GitHub Actions readability.
  console.log(`[e2e][${ts}][${step}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitAndCaptureId(page, roleLabel) {
  const responsePromise = page.waitForResponse((resp) => {
    return resp.url().includes('/api/submissions') && resp.request().method() === 'POST' && resp.status() === 202;
  }, { timeout: 120000 });

  await page.getByRole('button', { name: '领取观展票' }).click();

  const response = await responsePromise;
  const payload = await response.json();
  const submissionId = String(payload?.id || '').trim();

  if (!submissionId) {
    throw new Error(`${roleLabel}: missing submission id in 202 response`);
  }

  log(roleLabel, `submission accepted id=${submissionId}`);
  return submissionId;
}

async function waitForSyncSuccess(submissionId, roleLabel) {
  for (let i = 1; i <= SYNC_MAX_POLLS; i += 1) {
    const resp = await fetch(`${API_BASE}/submissions/${encodeURIComponent(submissionId)}/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });

    if (resp.status !== 200) {
      log(roleLabel, `poll ${i}/${SYNC_MAX_POLLS}: HTTP ${resp.status}`);
      await sleep(SYNC_POLL_INTERVAL_MS);
      continue;
    }

    const body = await resp.json();
    const syncStatus = String(body?.syncStatus || '').trim();
    const syncError = String(body?.syncError || '').trim();

    log(roleLabel, `poll ${i}/${SYNC_MAX_POLLS}: syncStatus=${syncStatus || 'UNKNOWN'}`);

    if (syncStatus === 'SUCCESS') {
      return;
    }

    if (syncStatus === 'FAILED') {
      throw new Error(`${roleLabel}: sync failed: ${syncError || 'unknown error'}`);
    }

    await sleep(SYNC_POLL_INTERVAL_MS);
  }

  throw new Error(`${roleLabel}: sync did not reach SUCCESS within ${SYNC_MAX_POLLS} polls`);
}

async function fillIndustryScenario(page) {
  const step = 'industry';
  log(step, `open ${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  await page.locator('.role-options button[aria-label="专业观众注册"]').first().click();
  await page.waitForSelector('#industry-name', { timeout: 15000 });

  await page.fill('#industry-name', VERIFY_NAME);
  await page.fill('#industry-idNumber', VERIFY_ID);
  await page.fill('#industry-phone', VERIFY_PHONE);
  await page.fill('#industry-company', 'FBIF发布验收公司');
  await page.fill('#industry-title', '发布验收负责人');
  await page.getByRole('button', { name: '品牌' }).first().click();

  await page.setInputFiles('#industry-proof', PROOF_FILE);
  await page.locator('.submit-policy-input').check({ force: true });

  const submissionId = await submitAndCaptureId(page, step);
  await waitForSyncSuccess(submissionId, step);

  log(step, 'scenario passed');
}

async function fillConsumerScenario(page) {
  const step = 'consumer';
  log(step, `open ${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  await page.locator('.role-options button[aria-label="消费者注册"]').first().click();
  await page.waitForSelector('#consumer-name', { timeout: 15000 });

  await page.fill('#consumer-name', VERIFY_NAME);
  await page.fill('#consumer-idNumber', VERIFY_ID);
  await page.fill('#consumer-phone', VERIFY_PHONE);

  const companyVisible = await page.locator('#consumer-company').count();
  if (companyVisible > 0) {
    await page.fill('#consumer-company', 'FBIF消费者验收');
  }

  await page.locator('.submit-policy-input').check({ force: true });

  const submissionId = await submitAndCaptureId(page, step);
  await waitForSyncSuccess(submissionId, step);

  log(step, 'scenario passed');
}

async function main() {
  if (!fs.existsSync(PROOF_FILE)) {
    throw new Error(`proof file not found: ${PROOF_FILE}`);
  }

  log('boot', `BASE_URL=${BASE_URL}`);
  log('boot', `API_BASE=${API_BASE}`);
  log('boot', `proofFile=${PROOF_FILE}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 }
  });

  try {
    const industryPage = await context.newPage();
    await fillIndustryScenario(industryPage);

    const consumerPage = await context.newPage();
    await fillConsumerScenario(consumerPage);

    log('result', 'ALL_SCENARIOS_PASSED');
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`[e2e][fatal] ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
