/**
 * POST /api/ai/polish —— 一键润色标题与简介
 *
 * 作用：把封面图 + 已有标题/简介交给多模态大模型（Qwen-VL，经阿里云百炼），
 *       据封面「有则润色、无则生成」标题与简介后返回。
 * 时机：用户在第二步「基本设置」点「一键润色」（需已填封面）。
 * 入参（JSON body）：coverDataUrl（封面 base64 data URL，必填）、title?、summary?。
 * 请求头/前置：需登录（requireUser），未登录 401。
 * 返回：{ title, summary }；缺封面 400；模型失败/超时统一 502 AI_UNAVAILABLE
 *       （message 说明原因，引导用户手动重试；真实原因见服务端日志）。
 */
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { polishMetadata } from '@/lib/ai';

export async function POST(request: Request) {
  // 需登录
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  // 封面是多模态读图的必备输入
  const body = (await request.json()) as { coverDataUrl?: string; title?: string; summary?: string };
  if (!body.coverDataUrl) {
    return NextResponse.json({ error: { code: 'MISSING_COVER', message: '请先添加封面' } }, { status: 400 });
  }

  try {
    // 调大模型润色；成功原样返回 { title, summary }
    const result = await polishMetadata({ coverDataUrl: body.coverDataUrl, title: body.title, summary: body.summary });
    return NextResponse.json(result);
  } catch (error) {
    // 统一降级为 502，超时给出更具体的文案；真实上游错误已在 lib/ai.ts 记入服务端日志
    const code = error instanceof Error ? error.message : 'AI_UNAVAILABLE';
    const message = code === 'AI_TIMEOUT' ? 'AI 服务超时，请稍后手动重试' : 'AI 暂不可用，请稍后手动重试';
    return NextResponse.json({ error: { code: 'AI_UNAVAILABLE', message } }, { status: 502 });
  }
}
