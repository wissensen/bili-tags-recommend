/**
 * POST /api/uploads/init —— 登记一次视频上传
 *
 * 作用：投稿链路第 ① 步。用户选好视频文件后浏览器立即调用，在数据库
 *       建一条上传记录（状态 local_only）并生成 uploadId，后续分析、
 *       投稿都靠它指认是哪个视频。
 * 时机：用户在上传页选择/拖入视频文件的那一刻。
 * 入参（JSON body）：fileName、size(>0)、mimeType，缺一返回 400。
 * 返回：{ uploadId, objectKey, uploadUrl, expiresAt, requiredHeaders }。
 *       其中 objectKey/uploadUrl 目前为 mock（见 TODO(storage)）。
 */
import { NextResponse } from 'next/server';
import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { createUpload } from '@/lib/repository';

export async function POST(request: Request) {
  // 解析前端提交的文件元信息
  const body = (await request.json()) as { fileName?: string; size?: number; mimeType?: string };
  // 校验：文件名 / 大小(>0) / 类型 必须齐全，否则拒绝
  if (!body.fileName || !body.size || body.size <= 0 || !body.mimeType) {
    return NextResponse.json({ error: { code: 'INVALID_UPLOAD', message: '文件信息不完整' } }, { status: 400 });
  }

  // 识别当前访客（签名 cookie，无登录体系）
  const visitor = await getVisitor(request);
  // 在数据库登记一条上传记录（状态 local_only），返回其 uploadId
  const uploadId = await createUpload(visitor.ownerId, { fileName: body.fileName, mimeType: body.mimeType, size: body.size });

  // TODO(storage): uploadUrl/objectKey 目前为 mock，接入 OSS 后返回真实直传地址与对象键。
  // 返回上传凭证；若访客是新的，jsonWithVisitor 会顺带下发身份 cookie
  return jsonWithVisitor(
    {
      uploadId,
      objectKey: `mock/${uploadId}/${body.fileName}`,
      uploadUrl: `mock://r2/${uploadId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      requiredHeaders: { 'Content-Type': body.mimeType },
    },
    undefined,
    visitor,
  );
}
