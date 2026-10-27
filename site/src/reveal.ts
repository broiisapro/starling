/**
 * Small page behaviours: reveal sections as they enter the viewport and tint the top bar after the
 * first scroll. Both are progressive enhancements — the page reads fine without them.
 */

export function mountReveal(doc: Document = document): void {
  const nodes = [...doc.querySelectorAll<HTMLElement>('.reveal')];
  if (nodes.length === 0) return;

  const showAll = (): void => {
    for (const node of nodes) node.classList.add('is-in');
  };

  if (typeof IntersectionObserver === 'undefined') {
    showAll();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
  );

  for (const node of nodes) observer.observe(node);
}

export function mountTopbar(doc: Document = document, view: Window = window): void {
  const bar = doc.querySelector<HTMLElement>('.topbar');
  if (bar === null) return;

  const sync = (): void => {
    bar.classList.toggle('is-scrolled', view.scrollY > 12);
  };

  view.addEventListener('scroll', sync, { passive: true });
  sync();
}
