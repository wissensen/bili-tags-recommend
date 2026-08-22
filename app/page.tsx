'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ChangeEvent, DragEvent, KeyboardEvent, SVGProps } from 'react';
import type { Badge, CandidatesResponse, RecommendTag, SelectedTag } from '@/lib/types';
import { buildRecommendationView } from '@/lib/recommend';

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 20;
const MAX_TITLE_LENGTH = 80;
const MAX_SUMMARY_LENGTH = 300;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const ANALYSIS_STAGES = ['解析视频画面…', '识别语音与字幕…', '匹配热点与分区…', '生成推荐标签…'];
const VIDEO_MIME_BY_EXTENSION = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
} as const;
const VIDEO_EXTENSIONS = new Set(Object.keys(VIDEO_MIME_BY_EXTENSION));
const VIDEO_MIME_TYPES = new Set<string>(Object.values(VIDEO_MIME_BY_EXTENSION));
const COVER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CATEGORIES = [
  ['vlog', 'vlog'],
  ['film-edit', '影视剪辑'],
  ['animation', '动画'],
  ['game', '游戏'],
  ['knowledge', '知识'],
  ['life', '生活'],
] as const;
const CATEGORY_IDS = new Set<string>(CATEGORIES.map(([id]) => id));

type Phase = 'upload' | 'uploading' | 'settings' | 'analyzing' | 'recommendations' | 'success';
type FieldErrors = Partial<Record<'cover' | 'title' | 'category', string>>;

type UploadInitResponse = { uploadId: string };
type AnalysisResponse = { analysisId: string };
type AnalysisStatusResponse = { status: 'succeeded'; sessionId: string };
type CandidatesApiResponse = CandidatesResponse;
type SubmissionResponse = { submissionId: string };

function UploadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M512 128a42 42 0 0 1 30 12l200 200a42 42 0 0 1-60 60L554 290v370a42 42 0 0 1-84 0V290L342 400a42 42 0 0 1-60-60l200-200a42 42 0 0 1 30-12Z" />
      <path d="M170 640a42 42 0 0 1 42 42v128a44 44 0 0 0 44 44h512a44 44 0 0 0 44-44V682a42 42 0 0 1 84 0v128a128 128 0 0 1-128 128H256a128 128 0 0 1-128-128V682a42 42 0 0 1 42-42Z" />
    </svg>
  );
}

function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true" {...props}>
      <path d="m384 288 288 224-288 224Z" />
    </svg>
  );
}

function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M416 704 224 512l-60 60 252 252 452-452-60-60Z" />
    </svg>
  );
}

function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M512 128a384 384 0 0 1 341 208l-72 36A304 304 0 0 0 208 512h112L160 672 0 512h128a384 384 0 0 1 384-384Zm384 384H768l160-160 160 160H960a384 384 0 0 1-704 172l72-36a304 304 0 0 0 488-136Z" />
    </svg>
  );
}

function BadgeIcon({ badge }: { badge: Badge }) {
  if (badge === 'hot') {
    return (
      <svg viewBox="0 0 1024 1024" width="12" height="12" fill="currentColor" aria-hidden="true">
        <path d="M512 64c-8 96-64 152-128 208-96 84-160 176-160 304a288 288 0 0 0 576 0c0-96-48-176-112-240-16 40-48 72-88 72 40-112-24-256-88-344Zm-16 704a144 144 0 0 1-144-144c0-64 32-112 80-152 8 48 40 80 80 96-16-56 8-120 40-160 32 48 88 104 88 216a144 144 0 0 1-144 144Z" />
      </svg>
    );
  }

  if (badge === 'fans') {
    return (
      <svg viewBox="0 0 1024 1024" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="72" aria-hidden="true">
        <circle cx="512" cy="512" r="400" />
        <circle cx="512" cy="512" r="248" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 1024 1024" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="72" strokeLinejoin="round" aria-hidden="true">
      <path d="m300 224 100 96h224l100-96" />
      <rect x="144" y="320" width="736" height="520" rx="80" />
      <circle cx="360" cy="540" r="8" fill="currentColor" stroke="none" />
      <circle cx="664" cy="540" r="8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ValueBadge({ badge }: { badge: Badge }) {
  const label = { primary: '主标签', hot: '热搜', fans: '粉丝爱看' }[badge];
  return (
    <span className={`value-badge ${badge}`}>
      <BadgeIcon badge={badge} />
      {label}
    </span>
  );
}

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function validateVideoFile(file: File) {
  if (file.size === 0) return '视频文件不能为空';
  if (file.size > MAX_FILE_BYTES) return '仅支持不超过 100MB 的视频文件';

  const extension = file.name.split('.').pop()?.toLocaleLowerCase();
  if (!extension || !VIDEO_EXTENSIONS.has(extension) || (file.type && !VIDEO_MIME_TYPES.has(file.type))) {
    return '请选择 MP4、MOV 或 MKV 视频文件';
  }

  return '';
}

function getVideoMimeType(file: File) {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLocaleLowerCase() as keyof typeof VIDEO_MIME_BY_EXTENSION;
  return VIDEO_MIME_BY_EXTENSION[extension];
}

function validateCoverFile(file: File | null) {
  if (!file) return '请添加视频封面';
  if (file.size === 0) return '封面图片不能为空';
  if (file.size > MAX_COVER_BYTES) return '封面图片不能超过 5MB';
  if (!COVER_MIME_TYPES.has(file.type)) return '封面仅支持 JPG、PNG 或 WebP 格式';
  return '';
}

function validateTitle(value: string) {
  const normalized = value.trim();
  if (!normalized) return '请输入视频标题';
  if (Array.from(normalized).length > MAX_TITLE_LENGTH) return `视频标题不能超过 ${MAX_TITLE_LENGTH} 个字`;
  return '';
}

function validateCategory(value: string) {
  return CATEGORY_IDS.has(value) ? '' : '请选择有效的视频分区';
}

function normalizeTag(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function tagIdentity(value: string) {
  return normalizeTag(value).normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function validateTag(value: string, selectedTags: SelectedTag[], skipLength = false) {
  const normalized = normalizeTag(value);
  if (!normalized) return '请输入标签内容';
  if (!skipLength && Array.from(normalized).length > MAX_TAG_LENGTH) return `单个标签不能超过 ${MAX_TAG_LENGTH} 个字`;
  if (/[#，,\r\n]/.test(normalized)) return '标签中不能包含 #、逗号或换行';
  if (selectedTags.some((tag) => tagIdentity(tag.text) === tagIdentity(normalized))) return '该标签已添加';
  if (selectedTags.length >= MAX_TAGS) return `最多添加 ${MAX_TAGS} 个标签`;
  return '';
}

// 用请求内容的 SHA-256 作为幂等键：内容相同 → 键相同（失败重试/重复点击自动去重），
// 内容变化（改了标题、标签等）→ 新键，被后端当作新操作。
async function idempotencyKeyFor(payload: unknown) {
  const text = JSON.stringify(payload);
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // 兜底：极少数无 crypto.subtle 的环境用简单字符串哈希
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return `fallback-${(hash >>> 0).toString(16)}`;
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? '请求失败，请稍后重试');
  return data;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverButtonRef = useRef<HTMLButtonElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const categorySelectRef = useRef<HTMLSelectElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const polishAbortRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState('');
  const [progress, setProgress] = useState(0);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [categoryId, setCategoryId] = useState('vlog');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState('');
  const [analysisStage, setAnalysisStage] = useState(ANALYSIS_STAGES[0]);
  const [analysisId, setAnalysisId] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selectedTags, setSelectedTags] = useState<SelectedTag[]>([]);
  const [atomicPool, setAtomicPool] = useState<RecommendTag[]>([]);
  const [compositePool, setCompositePool] = useState<RecommendTag[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [tagError, setTagError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [submissionId, setSubmissionId] = useState('');
  const [error, setError] = useState('');
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const router = useRouter();
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { username: string }) => { setCurrentUser(data.username); setAuthChecked(true); })
      .catch(() => router.replace('/login'));
  }, [router]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  const recommendations = buildRecommendationView(atomicPool, compositePool, { selectedTags, cursor }).tags;

  const activeStep = phase === 'upload' || phase === 'uploading' ? 1 : phase === 'settings' ? 2 : phase === 'analyzing' ? 3 : 4;

  function simulateUpload() {
    return new Promise<void>((resolve) => {
      let current = 0;
      const timer = window.setInterval(() => {
        current = Math.min(100, current + Math.random() * 11 + 5);
        setProgress(current);
        if (current >= 100) {
          window.clearInterval(timer);
          window.setTimeout(resolve, 350);
        }
      }, 180);
    });
  }

  async function startUpload(nextFile: File) {
    setError('');
    const validationError = validateVideoFile(nextFile);
    if (validationError) {
      setError(validationError);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setFile(nextFile);
    setProgress(0);
    setPhase('uploading');
    try {
      const init = await readResponse<UploadInitResponse>(
        await fetch('/api/uploads/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: nextFile.name, size: nextFile.size, mimeType: getVideoMimeType(nextFile) }),
        }),
      );
      setUploadId(init.uploadId);

      await simulateUpload();
      await readResponse(
        await fetch(`/api/uploads/${init.uploadId}/complete`, { method: 'POST' }),
      );

      const baseName = nextFile.name.replace(/\.[^.]+$/, '');
      setTitle(Array.from(baseName).slice(0, MAX_TITLE_LENGTH).join(''));
      setPhase('settings');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '上传失败，请重试');
      setPhase('upload');
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];
    if (nextFile) void startUpload(nextFile);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile) void startUpload(nextFile);
  }

  function handleCoverChange(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0];
    if (!image) return;

    const validationError = validateCoverFile(image);
    if (validationError) {
      if (coverUrl) URL.revokeObjectURL(coverUrl);
      setCoverFile(null);
      setCoverUrl('');
      setFieldErrors((current) => ({ ...current, cover: validationError }));
      event.target.value = '';
      return;
    }

    if (coverUrl) URL.revokeObjectURL(coverUrl);
    setCoverFile(image);
    setCoverUrl(URL.createObjectURL(image));
    setFieldErrors((current) => ({ ...current, cover: undefined }));
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('封面读取失败'));
      reader.readAsDataURL(file);
    });
  }

  // 将封面缩放并压缩为不超过 maxSize 的 JPEG data URL，避免原图过大被模型侧拒绝
  // （base64 会膨胀约 33%，几 MB 的原图会超过百炼图片体积上限）。
  async function coverToCompressedDataUrl(file: File, maxSize = 1024, quality = 0.85): Promise<string> {
    const dataUrl = await fileToDataUrl(file);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('封面解析失败'));
      img.src = dataUrl;
    });
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl; // 拿不到 canvas 上下文时退回原图
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function polish() {
    if (!coverFile) return;
    // 润色进行中再次点击 → 停止本次请求
    if (isPolishing) {
      polishAbortRef.current?.abort();
      return;
    }

    const controller = new AbortController();
    polishAbortRef.current = controller;
    setIsPolishing(true);
    setError('');
    try {
      const coverDataUrl = await coverToCompressedDataUrl(coverFile);
      const res = await fetch('/api/ai/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverDataUrl, title: title.trim() || undefined, summary: summary.trim() || undefined }),
        signal: controller.signal,
      });
      const data = (await res.json()) as { title?: string; summary?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? 'AI 暂不可用，请稍后手动重试');
      if (data.title) setTitle(data.title.slice(0, MAX_TITLE_LENGTH));
      if (typeof data.summary === 'string') setSummary(data.summary.slice(0, MAX_SUMMARY_LENGTH));
    } catch (err) {
      // 用户主动停止不算错误，不弹提示
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'AI 暂不可用，请稍后手动重试');
      }
    } finally {
      polishAbortRef.current = null;
      setIsPolishing(false);
    }
  }

  async function startAnalysis() {
    setError('');
    const nextErrors: FieldErrors = {
      cover: validateCoverFile(coverFile) || undefined,
      title: validateTitle(title) || undefined,
      category: validateCategory(categoryId) || undefined,
    };
    setFieldErrors(nextErrors);

    if (nextErrors.cover || nextErrors.title || nextErrors.category) {
      window.requestAnimationFrame(() => {
        if (nextErrors.cover) coverButtonRef.current?.focus();
        else if (nextErrors.title) titleInputRef.current?.focus();
        else categorySelectRef.current?.focus();
      });
      return;
    }

    setPhase('analyzing');
    try {
      const analysisPayload = { uploadId, title: title.trim(), categoryId };
      const analysis = await readResponse<AnalysisResponse>(
        await fetch('/api/analyses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': await idempotencyKeyFor(analysisPayload) },
          body: JSON.stringify(analysisPayload),
        }),
      );
      setAnalysisId(analysis.analysisId);

      for (const stage of ANALYSIS_STAGES) {
        setAnalysisStage(stage);
        await new Promise((resolve) => window.setTimeout(resolve, 650));
      }

      const status = await readResponse<AnalysisStatusResponse>(await fetch(`/api/analyses/${analysis.analysisId}`));
      const candidates = await readResponse<CandidatesApiResponse>(
        await fetch(`/api/tags/candidates?sessionId=${encodeURIComponent(status.sessionId)}`),
      );
      setAtomicPool(candidates.atomic);
      setCompositePool(candidates.composite);
      setCursor(0);
      setPhase('recommendations');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '分析失败，请重试');
      setPhase('settings');
    }
  }

  function addTag(text: string, candidateId?: string, skipLength = false) {
    const validationError = validateTag(text, selectedTags, skipLength);
    if (validationError) {
      setTagError(validationError);
      return false;
    }

    const normalized = normalizeTag(text);
    setSelectedTags((current) => [...current, { text: normalized, candidateId }]);
    setTagError('');
    return true;
  }

  function removeTag(index: number) {
    setSelectedTags((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setTagError('');
  }

  function moveTag(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setSelectedTags((current) => {
      if (from >= current.length || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setTagError('');
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (addTag(tagInput)) setTagInput('');
  }

  function refreshRecommendations() {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setError('');
    setCursor((current) => current + 1);
    window.setTimeout(() => setIsRefreshing(false), 450);
  }

  async function submit() {
    if (isSubmitting) return;
    setError('');

    let tagsToSubmit = selectedTags;
    if (tagInput.trim()) {
      const validationError = validateTag(tagInput, selectedTags);
      if (validationError) {
        setTagError(validationError);
        tagInputRef.current?.focus();
        return;
      }

      tagsToSubmit = [...selectedTags, { text: normalizeTag(tagInput) }];
      setSelectedTags(tagsToSubmit);
      setTagInput('');
      setTagError('');
    }

    if (!tagsToSubmit.length) {
      setTagError('请至少选择一个标签');
      tagInputRef.current?.focus();
      return;
    }
    setIsSubmitting(true);
    try {
      const submissionPayload = {
        uploadId,
        analysisId,
        title: title.trim(),
        categoryId,
        coverUrl: coverUrl || undefined,
        summary: summary.trim() || undefined,
        tags: tagsToSubmit,
      };
      const result = await readResponse<SubmissionResponse>(
        await fetch('/api/submissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': await idempotencyKeyFor(submissionPayload) },
          body: JSON.stringify(submissionPayload),
        }),
      );
      setSubmissionId(result.submissionId);
      setPhase('success');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '发布失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  }

  function restart() {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    setPhase('upload');
    setFile(null);
    setUploadId('');
    setProgress(0);
    setTitle('');
    setSummary('');
    setCategoryId('vlog');
    setCoverFile(null);
    setCoverUrl('');
    setAnalysisId('');
    setCursor(0);
    setSelectedTags([]);
    setAtomicPool([]);
    setCompositePool([]);
    setDragIndex(null);
    setTagInput('');
    setFieldErrors({});
    setTagError('');
    setSubmissionId('');
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (coverInputRef.current) coverInputRef.current.value = '';
  }

  if (!authChecked) return <main className="page-shell" />;

  return (
    <main className="page-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="app-shell">
        {currentUser && (
          <div className="user-bar">
            <span>{currentUser}</span>
            <button type="button" onClick={logout}>退出登录</button>
          </div>
        )}
        <header className="page-heading">
          <div className="brand-mark">创作中心</div>
          <h1>
            上传视频 · <span>AI 智能标签推荐</span>
          </h1>
          <p>上传视频后，AI 会自动分析内容并为你推荐合适的标签</p>
        </header>

        <div className="main-card">
          <nav className="steps" aria-label="投稿步骤">
            {['上传视频', '基本设置', 'AI 分析', '推荐标签'].map((label, index) => {
              const step = index + 1;
              const state = activeStep > step ? 'done' : activeStep === step ? 'active' : '';
              return (
                <div className="step-fragment" key={label}>
                  <div className={`step ${state}`}>
                    <span className="step-index">{activeStep > step ? <CheckIcon width="14" /> : step}</span>
                    <span>{label}</span>
                  </div>
                  {step < 4 && <span className={`step-line ${activeStep > step ? 'done' : ''}`} />}
                </div>
              );
            })}
          </nav>

          {error && (
            <div className="error-banner" role="alert">
              <span>!</span>
              {error}
              <button type="button" onClick={() => setError('')} aria-label="关闭提示">×</button>
            </div>
          )}

          {phase === 'upload' && (
            <section className="panel">
              <div
                className={`dropzone ${isDragging ? 'dragging' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click();
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <div className="upload-icon"><UploadIcon width="30" height="30" /></div>
                <h2>点击或拖拽视频到此处上传</h2>
                <p>支持 MP4 / MOV / MKV 格式，单个文件不超过 100MB</p>
                <span className="choose-button">选择视频文件</span>
              </div>
              <input ref={fileInputRef} className="sr-only" type="file" accept=".mp4,.mov,.mkv,video/mp4,video/quicktime,video/x-matroska" onChange={handleFileChange} />
              <p className="agreement">
                上传视频，即表示您已同意{' '}
                <a href="https://www.bilibili.com/protocal/licence.html" target="_blank" rel="noopener noreferrer">哔哩哔哩使用协议</a>
                {' '}与{' '}
                <a href="https://member.bilibili.com/platform/convention/?search=q0" target="_blank" rel="noopener noreferrer">哔哩哔哩社区公约</a>
                ，请勿上传色情、反动等违法视频，{' '}
                <a href="https://www.bilibili.com/blackboard/blackroom.html" target="_blank" rel="noopener noreferrer">查看社区规则</a>
              </p>
            </section>
          )}

          {phase === 'uploading' && file && (
            <section className="panel upload-progress">
              <div className="file-row">
                <div className="file-thumb"><PlayIcon width="27" height="27" /></div>
                <div className="file-meta">
                  <strong>{file.name}</strong>
                  <span>{formatSize(file.size)}</span>
                </div>
              </div>
              <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
              <p className="progress-label">{progress >= 100 ? '上传完成 100%' : `上传中 ${Math.floor(progress)}%`}</p>
            </section>
          )}

          {phase === 'settings' && file && (
            <form
              className="panel"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void startAnalysis();
              }}
            >
              <div className="upload-summary">
                <div className="file-thumb small"><PlayIcon width="22" height="22" /></div>
                <div className="file-meta">
                  <strong>{file.name}</strong>
                  <span className="complete"><CheckIcon width="12" height="12" />上传完成</span>
                </div>
                <button type="button" className="replace-button" onClick={restart}><RefreshIcon width="14" height="14" />更换视频</button>
              </div>

              <h2 className="section-heading">基本设置</h2>
              <div className="form-row">
                <label><em>*</em>封面</label>
                <div className="field-control">
                  <button
                    ref={coverButtonRef}
                    type="button"
                    className={`cover-box ${coverUrl ? 'has-cover' : ''} ${fieldErrors.cover ? 'invalid' : ''}`}
                    style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
                    aria-describedby={fieldErrors.cover ? 'cover-error' : 'cover-help'}
                    onClick={() => coverInputRef.current?.click()}
                  >
                    <span>{coverUrl ? '更换封面' : '+ 添加封面'}</span>
                  </button>
                  {fieldErrors.cover ? (
                    <p className="field-error" id="cover-error" role="alert">{fieldErrors.cover}</p>
                  ) : (
                    <p className="field-help" id="cover-help">支持 JPG、PNG、WebP，不超过 5MB</p>
                  )}
                </div>
                <input
                  ref={coverInputRef}
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-invalid={Boolean(fieldErrors.cover)}
                  aria-describedby={fieldErrors.cover ? 'cover-error' : 'cover-help'}
                  onChange={handleCoverChange}
                />
              </div>
              <div className="form-row">
                <label htmlFor="video-title"><em>*</em>标题</label>
                <div className={`field ${fieldErrors.title ? 'invalid' : ''}`}>
                  <input
                    ref={titleInputRef}
                    id="video-title"
                    value={title}
                    maxLength={MAX_TITLE_LENGTH}
                    aria-invalid={Boolean(fieldErrors.title)}
                    aria-describedby={fieldErrors.title ? 'title-error title-counter' : 'title-counter'}
                    onChange={(event) => {
                      const nextTitle = event.target.value;
                      setTitle(nextTitle);
                      if (fieldErrors.title) {
                        setFieldErrors((current) => ({ ...current, title: validateTitle(nextTitle) || undefined }));
                      }
                    }}
                    onBlur={() => setFieldErrors((current) => ({ ...current, title: validateTitle(title) || undefined }))}
                  />
                  <span className="field-counter" id="title-counter">{Array.from(title).length}/{MAX_TITLE_LENGTH}</span>
                  {fieldErrors.title && <p className="field-error" id="title-error" role="alert">{fieldErrors.title}</p>}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="category"><em>*</em>分区</label>
                <div className="field-control">
                  <select
                    ref={categorySelectRef}
                    id="category"
                    className={fieldErrors.category ? 'invalid' : ''}
                    value={categoryId}
                    aria-invalid={Boolean(fieldErrors.category)}
                    aria-describedby={fieldErrors.category ? 'category-error' : undefined}
                    onChange={(event) => {
                      const nextCategoryId = event.target.value;
                      setCategoryId(nextCategoryId);
                      setFieldErrors((current) => ({ ...current, category: validateCategory(nextCategoryId) || undefined }));
                    }}
                  >
                    {CATEGORIES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
                  </select>
                  {fieldErrors.category && <p className="field-error" id="category-error" role="alert">{fieldErrors.category}</p>}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="summary">简介</label>
                <div className="field">
                  <textarea
                    id="summary"
                    className="field-textarea"
                    value={summary}
                    maxLength={MAX_SUMMARY_LENGTH}
                    rows={6}
                    placeholder="选填，可点「一键润色」由 AI 据封面生成"
                    onChange={(event) => setSummary(event.target.value)}
                  />
                  <span className="field-counter textarea-counter">{Array.from(summary).length}/{MAX_SUMMARY_LENGTH}</span>
                </div>
              </div>
              <div className="form-row">
                <span className="label-spacer" />
                <span
                  className="polish-wrap"
                  title={!coverFile ? '请先添加封面后再使用一键润色' : undefined}
                >
                  <button
                    type="button"
                    className={`polish-button ${isPolishing ? 'stopping' : ''}`}
                    disabled={!coverFile}
                    aria-disabled={!coverFile}
                    onClick={() => void polish()}
                  >
                    {isPolishing ? '⏹ 点击停止' : '✨ 一键润色'}
                  </button>
                </span>
              </div>
              <div className="actions">
                <button type="button" className="secondary-button" onClick={() => setPhase('upload')}>返回上一步</button>
                <button type="submit" className="primary-button">生成标签</button>
              </div>
            </form>
          )}

          {phase === 'analyzing' && (
            <section className="panel analyzing">
              <div className="spinner" />
              <h2>AI 正在分析视频内容</h2>
              <p>识别画面、语音与主题，生成精准标签</p>
              <span>{analysisStage}</span>
            </section>
          )}

          {phase === 'recommendations' && (
            <form
              className="panel"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="result-heading">
                <div className="success-icon"><CheckIcon width="25" height="25" /></div>
                <div>
                  <h2>分析完成，为你推荐了以下标签</h2>
                  <p>点击推荐标签即可添加，首个标签将作为主标签</p>
                </div>
              </div>

              <h3 className="block-title">已选标签 <span>{selectedTags.length}/{MAX_TAGS}</span></h3>
              <div className={`tag-editor ${tagError ? 'invalid' : ''}`}>
                {selectedTags.map((tag, index) => (
                  <span
                    className={`selected-chip ${dragIndex === index ? 'dragging' : ''}`}
                    key={`${tag.text}-${index}`}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragIndex !== null) moveTag(dragIndex, index);
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    title="拖拽可调整顺序，首个为主标签"
                  >
                    {index === 0 && <b>主</b>}# {tag.text}
                    <button type="button" onClick={() => removeTag(index)} aria-label={`删除${tag.text}`}>×</button>
                  </span>
                ))}
                <input
                  ref={tagInputRef}
                  value={tagInput}
                  disabled={selectedTags.length >= MAX_TAGS}
                  maxLength={MAX_TAG_LENGTH}
                  aria-label="添加自定义标签"
                  aria-invalid={Boolean(tagError)}
                  aria-describedby={tagError ? 'tag-error' : 'tag-help'}
                  onChange={(event) => {
                    const nextTag = event.target.value;
                    setTagInput(nextTag);
                    if (tagError) setTagError(nextTag ? validateTag(nextTag, selectedTags) : '');
                  }}
                  onBlur={() => {
                    if (tagInput) setTagError(validateTag(tagInput, selectedTags));
                  }}
                  onKeyDown={handleTagKeyDown}
                  placeholder={selectedTags.length >= MAX_TAGS ? '已达到标签上限' : '按回车键 Enter 创建标签，首个输入的默认为主标签'}
                />
                <span className="tag-counter" id="tag-help">还可以添加 {MAX_TAGS - selectedTags.length} 个标签</span>
              </div>
              {tagError && <p className="field-error tag-error" id="tag-error" role="alert">{tagError}</p>}

              <h3 className="block-title">推荐标签</h3>
              <div className="recommendation-list">
                {recommendations.map((tag) => {
                  const isSelected = selectedTags.some((selected) => tagIdentity(selected.text) === tagIdentity(tag.text));
                  return (
                    <button
                      type="button"
                      className="recommend-pill"
                      disabled={isSelected || selectedTags.length >= MAX_TAGS}
                      key={tag.candidateId}
                      onClick={() => addTag(tag.text, tag.candidateId, true)}
                    >
                      {tag.text}
                      {tag.displayBadge && <ValueBadge badge={tag.displayBadge} />}
                    </button>
                  );
                })}
                <button type="button" className={`refresh-button ${isRefreshing ? 'spinning' : ''}`} disabled={isRefreshing} onClick={refreshRecommendations}>
                  <RefreshIcon width="15" height="15" />换一批
                </button>
              </div>

              <div className="actions">
                <button type="button" className="secondary-button" onClick={() => setPhase('settings')}>返回上一步</button>
                <button type="submit" className="primary-button" disabled={isSubmitting}>{isSubmitting ? '发布中…' : '确认并发布'}</button>
              </div>
            </form>
          )}

          {phase === 'success' && (
            <section className="panel published">
              <div className="published-icon"><CheckIcon width="42" height="42" /></div>
              <h2>发布成功</h2>
              <p>稿件已成功提交。</p>
              <div className="published-summary">
                <span>主标签</span><strong>{selectedTags[0]?.text}</strong>
                <span>全部标签</span><strong>{selectedTags.map((tag) => tag.text).join('、')}</strong>
                <span>提交编号</span><code>{submissionId}</code>
              </div>
              <button type="button" className="primary-button" onClick={restart}>继续投稿</button>
            </section>
          )}
        </div>

        <footer className="page-footer">智能标签推荐 · 创作中心</footer>
      </section>
    </main>
  );
}
