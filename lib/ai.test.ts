import { expect, test } from 'vitest';
import { parsePolishResult } from '@/lib/ai';

test('解析标准 JSON', () => {
  const r = parsePolishResult('{"title":"标题","summary":"简介"}');
  expect(r.title).toBe('标题');
  expect(r.summary).toBe('简介');
});

test('解析被 ```json 包裹的输出', () => {
  const r = parsePolishResult('```json\n{"title":"T","summary":"S"}\n```');
  expect(r.title).toBe('T');
  expect(r.summary).toBe('S');
});

test('summary 超过 300 字被截断', () => {
  const long = 'x'.repeat(400);
  const r = parsePolishResult(`{"title":"T","summary":"${long}"}`);
  expect(r.summary.length).toBe(300);
});

test('非法输出抛错', () => {
  expect(() => parsePolishResult('not json')).toThrow();
});
