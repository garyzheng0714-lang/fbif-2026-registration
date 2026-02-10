import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySingleSelectMappings,
  normalizeSelectOptionText,
  resolveSingleSelectOptionId,
  type BitableFieldMeta
} from '../src/services/bitableSelect.js';

function makeMeta(options: Array<[string, string]>): BitableFieldMeta {
  const optionsByName = new Map<string, string>(options);
  const optionsById = new Set<string>(options.map(([, id]) => id));
  return {
    name: 'TestSelect',
    type: 3,
    uiType: 'SingleSelect',
    optionsByName,
    optionsById
  };
}

test('normalizeSelectOptionText removes whitespace and zero-width characters', () => {
  assert.equal(normalizeSelectOptionText('A B'), 'AB');
  assert.equal(normalizeSelectOptionText(`A\u200B B`), 'AB');
  assert.equal(normalizeSelectOptionText(''), '');
});

test('resolveSingleSelectOptionId: exact name match', () => {
  const meta = makeMeta([
    ['食品相关品牌方', 'optA']
  ]);
  assert.equal(resolveSingleSelectOptionId(meta, '食品相关品牌方'), 'optA');
});

test('resolveSingleSelectOptionId: accepts existing option id', () => {
  const meta = makeMeta([
    ['食品相关品牌方', 'optA']
  ]);
  assert.equal(resolveSingleSelectOptionId(meta, 'optA'), 'optA');
});

test('resolveSingleSelectOptionId: normalized exact match (AB vs A B)', () => {
  const meta = makeMeta([
    ['A B', 'optB']
  ]);
  assert.equal(resolveSingleSelectOptionId(meta, 'AB'), 'optB');
});

test('resolveSingleSelectOptionId: substring match when unique', () => {
  const meta = makeMeta([
    ['食品饮料品牌方（包括传统的食品加工企业）', 'optC']
  ]);
  assert.equal(resolveSingleSelectOptionId(meta, '食品饮料品牌方'), 'optC');
});

test('resolveSingleSelectOptionId: returns null on ambiguous substring matches', () => {
  const meta = makeMeta([
    ['其他（如财务、行政等）', 'optX'],
    ['其他（包含政府机构、协会、高校、媒体等等）', 'optY']
  ]);
  assert.equal(resolveSingleSelectOptionId(meta, '其他'), null);
});

test('applySingleSelectMappings: omits unmapped single select fields to avoid type mismatch', () => {
  const metaByName = new Map<string, BitableFieldMeta>([
    ['贵司的业务类型', makeMeta([
      ['其他（如财务、行政等）', 'optX'],
      ['其他（包含政府机构、协会、高校、媒体等等）', 'optY']
    ])]
  ]);

  const fields: Record<string, string> = {
    姓名: '张三',
    贵司的业务类型: '其他'
  };

  applySingleSelectMappings(fields, metaByName, { traceId: 'trace', idSuffix: '001X' }, { warn: () => {} });

  assert.equal(fields.姓名, '张三');
  assert.equal(Object.prototype.hasOwnProperty.call(fields, '贵司的业务类型'), false);
});

