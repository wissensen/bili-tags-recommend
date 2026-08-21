/**
 * POST /api/uploads/:id/complete —— 确认上传完成
 *
 * 作用：投稿链路第 ② 步。把对应上传记录的状态置为 verified（已就绪），
 *       之后才允许拿它去发起分析。
 * 时机：前端「上传」完成后（当前为模拟进度条跑满后）。
 * 入参：路径参数 :id 即上一步的 uploadId。
 * 返回：{ uploadId, status: 'verified' }；记录不存在或不属于当前访客返回 404。
 */
import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { verifyUpload } from '@/lib/repository';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  // 路径参数 id 即上一步的 uploadId
  const { id } = await context.params;
  // 识别访客，确保只能操作自己的上传
  const visitor = await getVisitor(request);
  // 把该上传记录置为 verified；命中(属于本访客)才返回 true
  const ok = await verifyUpload(visitor.ownerId, id);
  if (!ok) {
    // 记录不存在或不属于当前访客
    return jsonWithVisitor({ error: { code: 'UPLOAD_NOT_FOUND', message: '上传不存在或无权访问' } }, { status: 404 }, visitor);
  }
  // 就绪，允许后续发起分析
  return jsonWithVisitor({ uploadId: id, status: 'verified' }, undefined, visitor);
}
