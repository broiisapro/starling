/**
 * The one stylesheet both bottom-strip features inject.
 *
 * Why a string and not Tailwind classes: motion is the only thing here that cannot be expressed as
 * static utility classes (custom-property duration + `prefers-reduced-motion`), and injecting a
 * scoped `<style>` keeps these lanes free of `apps/web/src/index.css`, which Epic 23 owns.
 *
 * Contract: any element marked `data-starling-motion` gets `--starling-motion-duration: 260ms`;
 * when the element also carries `data-reduced-motion="true"` (JS read the media query) — or when the
 * OS asks for reduced motion — the duration collapses to 0 ms and every `data-starling-animated`
 * descendant is hard-stopped. "Respecting reduced motion" therefore means no movement at all, not a
 * faster animation.
 */
export const MOTION_CSS = `
[data-starling-motion] { --starling-motion-duration: 260ms; }
[data-starling-motion][data-reduced-motion='true'] { --starling-motion-duration: 0ms; }
[data-starling-motion][data-reduced-motion='true'] [data-starling-animated] {
  transition: none !important;
  animation: none !important;
}
@media (prefers-reduced-motion: reduce) {
  [data-starling-motion] { --starling-motion-duration: 0ms; }
  [data-starling-motion] [data-starling-animated] {
    transition: none !important;
    animation: none !important;
  }
}
`;
