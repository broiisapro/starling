/**
 * Entry point for the landing page.
 *
 * Everything here is additive: if this module fails to load, the HTML still has the full story, the
 * quickstart and the stats placeholders. The only lost pieces are the moving sky and copy buttons.
 */
import { mountCopyButtons } from './copy.ts';
import { mountReveal, mountTopbar } from './reveal.ts';
import { mountSky } from './sky.ts';
import { hydrateStats } from './stats.ts';

const sky = document.querySelector<HTMLCanvasElement>('#sky');
if (sky !== null) mountSky(sky);

mountCopyButtons(document);
mountReveal(document);
mountTopbar(document);
void hydrateStats();
