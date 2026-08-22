'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? '操作失败');
      // 硬跳转（整页加载）而非 router.push 软跳转：确保会话 cookie 已写入后，
      // 主页的 /api/auth/me 校验才执行，避免登录后被误判未登录而弹回。软跳转在
      // 此处会与 cookie 写入产生竞态，故有意使用整页导航。
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-shell auth-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="auth-wrap">
        <header className="page-heading">
          <div className="brand-mark">创作中心</div>
          <h1>
            登录 · <span>AI 智能标签推荐</span>
          </h1>
          <p>登录后即可上传视频、获取 AI 推荐标签</p>
        </header>

        <form className="main-card auth-card" onSubmit={submit}>
          <div className="auth-tabs">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</button>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <span>!</span>
              {error}
            </div>
          )}

          <div className="form-row">
            <label htmlFor="auth-username">用户名</label>
            <div className="field">
              <input
                id="auth-username"
                value={username}
                maxLength={32}
                autoComplete="username"
                placeholder="1-32 个字符"
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <label htmlFor="auth-password">密码</label>
            <div className="field">
              <input
                id="auth-password"
                type="password"
                value={password}
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="至少 6 位"
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="actions">
            <button type="submit" className="primary-button auth-submit" disabled={busy}>
              {busy ? '处理中…' : mode === 'login' ? '登录' : '注册'}
            </button>
          </div>
        </form>

        <footer className="page-footer">智能标签推荐 · 创作中心</footer>
      </section>
    </main>
  );
}
