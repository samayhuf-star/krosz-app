const BRAND_PATTERN = /\bbase\s*44\b/gi;
const BASE44_HOST_PATTERN = /https?:\/\/[^\s"']*base44(?:-preview)?\.app/gi;
const KROSZ_ORIGIN = 'https://krosz.com';

function replaceBrand(value) {
  if (typeof value !== 'string' || !value) return value;
  return value.replace(BRAND_PATTERN, 'Krosz');
}

function sanitizeHead() {
  if (typeof document === 'undefined') return;

  if (document.title) document.title = replaceBrand(document.title);

  document.head.querySelectorAll('meta[content]').forEach((meta) => {
    const content = meta.getAttribute('content') || '';
    let next = replaceBrand(content);
    if (BASE44_HOST_PATTERN.test(next)) {
      BASE44_HOST_PATTERN.lastIndex = 0;
      next = next.replace(BASE44_HOST_PATTERN, (url) => {
        try {
          const parsed = new URL(url);
          return `${KROSZ_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
        } catch {
          return KROSZ_ORIGIN;
        }
      });
    }
    BASE44_HOST_PATTERN.lastIndex = 0;
    if (next !== content) meta.setAttribute('content', next);
  });

  document.head.querySelectorAll('link[rel="canonical"][href]').forEach((link) => {
    const href = link.getAttribute('href') || '';
    if (!/base44(?:-preview)?\.app/i.test(href)) return;
    try {
      const parsed = new URL(href);
      link.setAttribute('href', `${KROSZ_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`);
    } catch {
      link.setAttribute('href', KROSZ_ORIGIN);
    }
  });
}

function sanitizeVisibleNode(node) {
  if (!node) return;

  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,code,pre,noscript')) return;
    const current = node.nodeValue || '';
    const next = replaceBrand(current);
    if (next !== current) node.nodeValue = next;
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node;
  if (element.matches('script,style,code,pre,noscript')) return;

  ['title', 'aria-label', 'placeholder', 'alt'].forEach((attr) => {
    if (!element.hasAttribute(attr)) return;
    const current = element.getAttribute(attr) || '';
    const next = replaceBrand(current);
    if (next !== current) element.setAttribute(attr, next);
  });

  element.childNodes.forEach(sanitizeVisibleNode);
}

function sanitizePublicSurface() {
  sanitizeHead();
  if (document.body) sanitizeVisibleNode(document.body);
}

export function installPublicBrandGuard() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  sanitizePublicSurface();

  // Re-entrancy guard so the observer never reacts to DOM changes it caused
  // itself — the classic self-triggering-mutation infinite loop. Mutations the
  // guard makes are produced synchronously here; we re-arm on a microtask so
  // our own mutation records flush before we listen again.
  let mutating = false;
  let headChanged = false;
  const collect = (mutations) => {
    for (const mutation of mutations) {
      if (mutation.target === document.head || document.head.contains(mutation.target)) headChanged = true;
      mutation.addedNodes.forEach((node) => {
        if (document.body?.contains(node) || node === document.body) sanitizeVisibleNode(node);
      });
      if (mutation.type === 'characterData' && document.body?.contains(mutation.target)) {
        sanitizeVisibleNode(mutation.target);
      }
    }
  };

  const observer = new MutationObserver((mutations) => {
    if (mutating) return; // ignore mutations we caused ourselves
    mutating = true;
    headChanged = false;
    try {
      collect(mutations);
      if (headChanged) sanitizeHead();
    } finally {
      queueMicrotask(() => { mutating = false; });
    }
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['content', 'href', 'title', 'aria-label', 'placeholder', 'alt'],
  });

  window.addEventListener('popstate', sanitizePublicSurface);
  window.addEventListener('hashchange', sanitizePublicSurface);

  return () => {
    observer.disconnect();
    window.removeEventListener('popstate', sanitizePublicSurface);
    window.removeEventListener('hashchange', sanitizePublicSurface);
  };
}