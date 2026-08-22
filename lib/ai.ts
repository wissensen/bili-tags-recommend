export const QWEN_VL_MODEL = 'qwen3.7-plus'; // TODO(algo): 核对百炼上 Qwen3-VL-27B 的准确模型名
const TIMEOUT_MS = 30_000;

// 业务空间专属 MaaS 端点：workspace id 从环境变量读取，不硬编码进源码。
function resolveEndpoint(): string {
  const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID;
  if (!workspaceId) throw new Error('AI_NOT_CONFIGURED');
  return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`;
}

export function parsePolishResult(raw: string): { title: string; summary: string } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI_BAD_OUTPUT');
  let parsed: { title?: unknown; summary?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error('AI_BAD_OUTPUT');
  }
  if (typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') {
    throw new Error('AI_BAD_OUTPUT');
  }
  return { title: parsed.title.trim(), summary: parsed.summary.trim().slice(0, 300) };
}

export async function polishMetadata(input: {
  coverDataUrl: string;
  title?: string;
  summary?: string;
}): Promise<{ title: string; summary: string }> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('AI_NOT_CONFIGURED');
  const endpoint = resolveEndpoint();

  const prompt = [
    '你是视频投稿助手。请根据封面图片，为视频润色或生成标题与简介。',
    input.title ? `已有标题：${input.title}` : '暂无标题，请据封面生成。',
    input.summary ? `已有简介：${input.summary}` : '暂无简介，请据封面生成。',
    '要求：标题简洁有吸引力；简介不超过300字。只返回严格 JSON：{"title":"...","summary":"..."}，不要多余文字。',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: QWEN_VL_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: input.coverDataUrl } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error((error as Error).name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_NETWORK');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error('AI_UPSTREAM');
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI_BAD_OUTPUT');
  return parsePolishResult(content);
}
