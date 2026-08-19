'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent, SVGProps } from 'react';
import type { Badge, RecommendTag, SelectedTag } from '@/lib/types';

const MAX_TAGS = 10;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const ANALYSIS_STAGES = ['解析视频画面…', '识别语音与字幕…', '匹配热点与分区…', '生成推荐标签…'];

type Phase = 'upload' | 'uploading' | 'settings' | 'analyzing' | 'recommendations' | 'success';

type UploadInitResponse = { uploadId: string };
type AnalysisResponse = { analysisId: string };
type AnalysisStatusResponse = { status: 'succeeded'; sessionId: string };
type RecommendationResponse = { tags: RecommendTag[]; nextCursor?: string };
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

async function readResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? '请求失败，请稍后重试');
  return data;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState('');
  const [progress, setProgress] = useState(0);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('vlog');
  const [coverUrl, setCoverUrl] = useState('');
  const [analysisStage, setAnalysisStage] = useState(ANALYSIS_STAGES[0]);
  const [analysisId, setAnalysisId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [selectedTags, setSelectedTags] = useState<SelectedTag[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendTag[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionId, setSubmissionId] = useState('');
  const [error, setError] = useState('');

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
    if (nextFile.size > MAX_FILE_BYTES) {
      setError('演示环境仅支持不超过 100MB 的视频文件');
      return;
    }
    if (!nextFile.type.startsWith('video/')) {
      setError('请选择 MP4、MOV 或 MKV 视频文件');
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
          body: JSON.stringify({ fileName: nextFile.name, size: nextFile.size, mimeType: nextFile.type }),
        }),
      );
      setUploadId(init.uploadId);

      // Demo 只模拟直传进度；真实实现应 PUT 到 init 接口返回的 R2 签名地址。
      await simulateUpload();
      await readResponse(
        await fetch(`/api/uploads/${init.uploadId}/complete`, { method: 'POST' }),
      );

      const baseName = nextFile.name.replace(/\.[^.]+$/, '');
      setTitle(baseName.slice(0, 80));
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
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    setCoverUrl(URL.createObjectURL(image));
  }

  async function requestRecommendations(nextSessionId: string, nextCursor?: string) {
    const data = await readResponse<RecommendationResponse>(
      await fetch('/api/tags/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: nextSessionId, cursor: nextCursor, selectedTags, pageSize: 5 }),
      }),
    );
    setRecommendations(data.tags);
    setCursor(data.nextCursor);
  }

  async function startAnalysis() {
    setError('');
    if (!title.trim()) {
      setError('请先填写视频标题');
      return;
    }

    setPhase('analyzing');
    try {
      const analysis = await readResponse<AnalysisResponse>(
        await fetch('/api/analyses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ uploadId, title: title.trim(), categoryId }),
        }),
      );
      setAnalysisId(analysis.analysisId);

      for (const stage of ANALYSIS_STAGES) {
        setAnalysisStage(stage);
        await new Promise((resolve) => window.setTimeout(resolve, 650));
      }

      const status = await readResponse<AnalysisStatusResponse>(await fetch(`/api/analyses/${analysis.analysisId}`));
      setSessionId(status.sessionId);
      await requestRecommendations(status.sessionId);
      setPhase('recommendations');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '分析失败，请重试');
      setPhase('settings');
    }
  }

  function addTag(text: string, candidateId?: string) {
    const normalized = text.trim();
    if (!normalized || selectedTags.length >= MAX_TAGS) return;
    if (selectedTags.some((tag) => tag.text.toLocaleLowerCase() === normalized.toLocaleLowerCase())) return;
    setSelectedTags((current) => [...current, { text: normalized, candidateId }]);
  }

  function removeTag(index: number) {
    setSelectedTags((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addTag(tagInput);
    setTagInput('');
  }

  async function refreshRecommendations() {
    if (!sessionId || isRefreshing) return;
    setIsRefreshing(true);
    setError('');
    try {
      await requestRecommendations(sessionId, cursor);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '刷新推荐失败');
    } finally {
      window.setTimeout(() => setIsRefreshing(false), 450);
    }
  }

  async function submit() {
    if (!selectedTags.length) {
      setError('请至少选择一个标签');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const result = await readResponse<SubmissionResponse>(
        await fetch('/api/submissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            uploadId,
            analysisId,
            title: title.trim(),
            categoryId,
            coverUrl: coverUrl || undefined,
            tags: selectedTags,
          }),
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
    setCategoryId('vlog');
    setCoverUrl('');
    setAnalysisId('');
    setSessionId('');
    setCursor(undefined);
    setSelectedTags([]);
    setRecommendations([]);
    setTagInput('');
    setSubmissionId('');
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (coverInputRef.current) coverInputRef.current.value = '';
  }

  return (
    <main className="page-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="app-shell">
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
                <p>支持 MP4 / MOV / MKV 格式，演示环境单个文件不超过 100MB</p>
                <span className="choose-button">选择视频文件</span>
              </div>
              <input ref={fileInputRef} className="sr-only" type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/*" onChange={handleFileChange} />
              <p className="agreement">上传即代表你已阅读并同意《创作公约》</p>
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
            <section className="panel">
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
                <button
                  type="button"
                  className={`cover-box ${coverUrl ? 'has-cover' : ''}`}
                  style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
                  onClick={() => coverInputRef.current?.click()}
                >
                  <span>{coverUrl ? '更换封面' : '+ 添加封面'}</span>
                </button>
                <input ref={coverInputRef} className="sr-only" type="file" accept="image/*" onChange={handleCoverChange} />
              </div>
              <div className="form-row">
                <label htmlFor="video-title"><em>*</em>标题</label>
                <div className="field">
                  <input id="video-title" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
                  <span>{title.length}/80</span>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="category"><em>*</em>分区</label>
                <select id="category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  <option value="vlog">vlog</option>
                  <option value="film-edit">影视剪辑</option>
                  <option value="animation">动画</option>
                  <option value="game">游戏</option>
                  <option value="knowledge">知识</option>
                  <option value="life">生活</option>
                </select>
              </div>
              <div className="actions"><button type="button" className="primary-button" onClick={() => void startAnalysis()}>生成标签</button></div>
            </section>
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
            <section className="panel">
              <div className="result-heading">
                <div className="success-icon"><CheckIcon width="25" height="25" /></div>
                <div>
                  <h2>分析完成，为你推荐了以下标签</h2>
                  <p>点击推荐标签即可添加，首个标签将作为主标签</p>
                </div>
              </div>

              <h3 className="block-title">已选标签 <span>{selectedTags.length}/{MAX_TAGS}</span></h3>
              <div className="tag-editor">
                {selectedTags.map((tag, index) => (
                  <span className="selected-chip" key={`${tag.text}-${index}`}>
                    {index === 0 && <b>主</b>}# {tag.text}
                    <button type="button" onClick={() => removeTag(index)} aria-label={`删除${tag.text}`}>×</button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  disabled={selectedTags.length >= MAX_TAGS}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder={selectedTags.length >= MAX_TAGS ? '已达到标签上限' : '按回车键 Enter 创建标签，首个输入的默认为主标签'}
                />
                <span className="tag-counter">还可以添加 {MAX_TAGS - selectedTags.length} 个标签</span>
              </div>

              <h3 className="block-title">推荐标签</h3>
              <div className="recommendation-list">
                {recommendations.map((tag) => {
                  const isSelected = selectedTags.some((selected) => selected.text === tag.text);
                  return (
                    <button
                      type="button"
                      className="recommend-pill"
                      disabled={isSelected || selectedTags.length >= MAX_TAGS}
                      key={tag.candidateId}
                      onClick={() => addTag(tag.text, tag.candidateId)}
                    >
                      {tag.text}
                      {tag.displayBadge && <ValueBadge badge={tag.displayBadge} />}
                    </button>
                  );
                })}
                <button type="button" className={`refresh-button ${isRefreshing ? 'spinning' : ''}`} disabled={isRefreshing} onClick={() => void refreshRecommendations()}>
                  <RefreshIcon width="15" height="15" />换一批
                </button>
              </div>

              <div className="actions">
                <button type="button" className="secondary-button" onClick={restart}>重新上传</button>
                <button type="button" className="primary-button" disabled={isSubmitting} onClick={() => void submit()}>{isSubmitting ? '发布中…' : '确认并发布'}</button>
              </div>
            </section>
          )}

          {phase === 'success' && (
            <section className="panel published">
              <div className="published-icon"><CheckIcon width="42" height="42" /></div>
              <h2>发布成功</h2>
              <p>稿件已提交，服务端当前使用 mock 数据。</p>
              <div className="published-summary">
                <span>主标签</span><strong>{selectedTags[0]?.text}</strong>
                <span>全部标签</span><strong>{selectedTags.map((tag) => tag.text).join('、')}</strong>
                <span>提交编号</span><code>{submissionId}</code>
              </div>
              <button type="button" className="primary-button" onClick={restart}>继续投稿</button>
            </section>
          )}
        </div>

        <footer className="page-footer">智能标签推荐 Demo · API 当前为 Mock 实现</footer>
      </section>
    </main>
  );
}
