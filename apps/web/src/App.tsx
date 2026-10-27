import { Bird } from 'lucide-react';

/**
 * The boot page. Every feature folder under `src/features/` is owned by a later Wave 1 lane; this
 * component stays tiny so those lanes can replace it without conflicts.
 */
export default function App() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-100">
      <div className="flex flex-col items-center gap-6 px-8 text-center">
        <Bird className="h-16 w-16 text-sky-300" aria-hidden="true" />
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Starling — the sky is loading 🐦
        </h1>
        <p className="max-w-xl text-base text-slate-400">
          One goal in, a murmuration of open-weight coding agents out. The flock is warming up.
        </p>
      </div>
    </main>
  );
}
