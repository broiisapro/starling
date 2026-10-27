import { Cpu } from 'lucide-react';
import { modelLabel } from './format';

export interface ModelChipsProps {
  models: string[];
  compact?: boolean;
}

/**
 * Local models a roost can lend to the hub. Zero marginal cost is the whole point of the flock, so
 * these are chips rather than a muted list.
 */
export function ModelChips({ models, compact = false }: ModelChipsProps) {
  if (models.length === 0) {
    return (
      <span data-testid="model-empty" className="text-[12px] text-slate-400">
        no local models
      </span>
    );
  }

  return (
    <ul data-testid="model-chips" className="flex flex-wrap items-center gap-1.5">
      {models.map((model) => (
        <li
          key={model}
          data-testid="model-chip"
          data-model={model}
          title={`This roost can run ${model} for audits and summaries`}
          className={
            compact
              ? 'max-w-[7rem] truncate rounded-full border border-sky-400/20 bg-sky-400/10 px-1.5 py-0.5 text-[12px] text-sky-200'
              : 'inline-flex items-center gap-1 rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-[12px] font-medium text-sky-200'
          }
        >
          {!compact ? <Cpu aria-hidden="true" className="h-3 w-3 text-sky-300/80" /> : null}
          <span className="truncate">{modelLabel(model)}</span>
        </li>
      ))}
    </ul>
  );
}
