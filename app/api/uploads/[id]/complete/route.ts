/**
 * POST /api/uploads/:id/complete —— 确认上传完成
 *
 * 作用：投稿链路第 ② 步。把对应上传记录的状态置为 verified（已就绪），
 *       之后才允许拿它去发起分析。
 * 时机：前端「上传」完成后（当前为模拟进度条跑满后）。
 * 入参：路径参数 :id 即上一步的 uploadId。
 * 返回：{ uploadId, status: 'verified' }；记录不存在或不属于当前访客返回 404。
 */
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { verifyUpload } from '@/lib/repository';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const ok = await verifyUpload(auth.userId, id);
  if (!ok) {
    return NextResponse.json({ error: { code: 'UPLOAD_NOT_FOUND', message: '上传不存在或无权访问' } }, { status: 404 });
  }
  return NextResponse.json({ uploadId: id, status: 'verified' });
}
