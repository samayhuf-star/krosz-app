import { useEffect } from 'react';

// Lightweight document <head> SEO injection for the SPA (§18). Sets title, meta
// description, canonical, OpenGraph tags, and robots. Cleans up prior injected
// tags on unmount/re-run so SPA navigation never stacks stale metadata.

function upsertMeta(attr, key, content) {
  if (!content) return;
  /** @type {HTMLMetaElement | null} */
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    el.dataset.seo = '1';
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel, href, asCanonical = false) {
  /** @type {HTMLLinkElement | null} */
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    el.dataset.seo = '1';
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
  void asCanonical;
}

function upsertJsonLd(id, data) {
  /** @type {HTMLScriptElement | null} */
  let el = document.querySelector(`script#${CSS.escape(id)}`);
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = id;
    el.dataset.seo = '1';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

export function useSeo(seo) {
  useEffect(() => {
    if (!seo) return;
    if (seo.title) document.title = seo.title;
    upsertMeta('name', 'description', seo.description);
    upsertMeta('property', 'og:title', seo.og_title || seo.title);
    upsertMeta('property', 'og:description', seo.og_description || seo.description);
    upsertMeta('property', 'og:type', 'website');
    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', seo.og_title || seo.title);
    upsertMeta('name', 'twitter:description', seo.og_description || seo.description);
    if (seo.image_url) {
      upsertMeta('property', 'og:image', seo.image_url);
      upsertMeta('name', 'twitter:image', seo.image_url);
    }
    upsertMeta('name', 'robots', seo.robots || 'index,follow');
    if (seo.canonical_path) {
      const canonical = window.location.origin + seo.canonical_path;
      upsertLink('canonical', canonical);
      upsertMeta('property', 'og:url', canonical);
      upsertMeta('name', 'twitter:url', canonical);
    }
  }, [seo?.title, seo?.description, seo?.canonical_path, seo?.robots]);
}

// Inject JSON-LD structured data (§19). Pass an object or array + an id.
export function useJsonLd(id, data) {
  useEffect(() => {
    if (!data) return;
    upsertJsonLd(id, data);
  }, [id, JSON.stringify(data)]);
}

export function clearSeo() {
  document.head.querySelectorAll('[data-seo="1"]').forEach((el) => el.remove());
}