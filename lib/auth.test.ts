import { expect, test } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth';

test('正确密码校验通过', async () => {
  const { hash, salt } = await hashPassword('secret123');
  expect(await verifyPassword('secret123', hash, salt)).toBe(true);
});

test('错误密码校验失败', async () => {
  const { hash, salt } = await hashPassword('secret123');
  expect(await verifyPassword('wrongpass', hash, salt)).toBe(false);
});

test('相同密码不同盐产生不同哈希', async () => {
  const a = await hashPassword('secret123');
  const b = await hashPassword('secret123');
  expect(a.salt).not.toBe(b.salt);
  expect(a.hash).not.toBe(b.hash);
});

test('hash 与 salt 均为 hex 字符串', async () => {
  const { hash, salt } = await hashPassword('secret123');
  expect(hash).toMatch(/^[0-9a-f]+$/);
  expect(salt).toMatch(/^[0-9a-f]+$/);
});
