export function loginPage(destination, message) {
  const login = `/auth/start?next=${encodeURIComponent(destination)}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>登录 · Moon 剧情画板</title>
  <link rel="stylesheet" href="/canvas-login.css">
</head>
<body>
  <main class="login">
    <section class="entry">
      <span class="moon" aria-hidden="true"></span>
      <h1>Moon <span>剧情画板</span></h1>
      <p>登录后继续编辑剧情分支和谜题依赖。</p>
      ${message ? `<p role="alert" class="notice">${message}</p>` : ""}
      <a href="${login}" class="sign-in">使用 Moon SSO 登录</a>
    </section>
    <figure class="sample" aria-label="剧情分支示例">
      <div class="graph" aria-hidden="true">
        <div class="start node">抵达码头</div>
        <div class="choice node">怎么处理证词？</div>
        <div class="outcomes">
          <div class="node">保护目击者</div>
          <div class="node">公开调查记录</div>
        </div>
      </div>
      <figcaption>分支剧情图 · 港口证词</figcaption>
    </figure>
  </main>
</body>
</html>`;
}
