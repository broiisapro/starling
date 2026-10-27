import { formatCount, formatHours } from './format';
import type { SwarmStats } from './types';

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * The "lanes" story in exactly three sentences.
 *
 * Every clause is driven by the stats: no hard-coded claims about how many agents ran or how much
 * they wrote. That is what makes it honest enough to put on a slide next to the numbers.
 */
export function swarmStory(stats: SwarmStats): string[] {
  const totals = stats.totals;

  if (totals.epics === 0 && totals.agentSessions === 0) {
    return [
      'No stats yet — the flock has not left the roost.',
      '`bun tools/stats/collect.ts` writes tools/stats/out/stats.json from git, GitHub and the orchestrator logs.',
      'Once an epic merges, this page becomes the story of how Starling was built.',
    ];
  }

  const complete = stats.epics.filter((epic) => epic.handbackStatus === 'complete').length;
  const first = [
    'Starling was built by a flock:',
    `${formatCount(totals.epics)} ${plural(totals.epics, 'epic', 'epics')} merged across`,
    `${formatCount(totals.waves)} ${plural(totals.waves, 'wave', 'waves')}, from`,
    `${formatCount(totals.agentSessions)} agent ${plural(totals.agentSessions, 'session', 'sessions')}`,
    `with up to ${formatCount(totals.peakConcurrentAgents)} running at once.`,
  ].join(' ');

  const second = [
    'Together they opened',
    `${formatCount(totals.prs)} ${plural(totals.prs, 'pull request', 'pull requests')} and landed`,
    `${formatCount(totals.commits)} ${plural(totals.commits, 'commit', 'commits')} —`,
    `+${formatCount(totals.added)} / −${formatCount(totals.removed)} lines and`,
    `${formatCount(totals.tests)} tests — in ${formatHours(totals.wallTimeMs)} of wall-clock time.`,
  ].join(' ');

  const stillFlying =
    totals.inFlight > 0
      ? `, and ${formatCount(totals.inFlight)} ${plural(totals.inFlight, 'is', 'are')} still in flight`
      : '';
  const third = [
    'Every epic owned its own lane, so the agents wrote, tested and merged in parallel —',
    `${formatCount(complete)} of ${formatCount(totals.epics)} handbacks came back complete${stillFlying}.`,
  ].join(' ');

  return [first, second, third];
}
