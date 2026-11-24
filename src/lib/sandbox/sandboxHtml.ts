const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  'worker-src blob:',
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export const SANDBOX_ORIGIN = 'https://provider-sandbox.invalid/';

const escapeInlineScript = (runtime: string): string =>
  runtime
    .replace(/<\/script/gi, '<\\/script')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

export const buildSandboxHtml = (runtime: string): string => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
</head>
<body>
<script>${escapeInlineScript(runtime)}</script>
</body>
</html>`;
