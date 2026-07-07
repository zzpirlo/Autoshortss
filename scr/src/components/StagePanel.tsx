"use client";

import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

export type StepStatus = "pending" | "active" | "completed" | "error";
export type PipelinePhase = "idle" | "processing" | "done" | "error";

export interface StagePanelProps {
  steps: Array<{
    label: string;
    description?: string;
    icon: React.ReactNode;
  }>;
  statuses: StepStatus[];
  logs: string[];
  phase: PipelinePhase;
}

const phaseBadge = {
  idle: { variant: "info" as const, label: "En attente" },
  processing: { variant: "neon" as const, label: "En cours" },
  done: { variant: "success" as const, label: "Terminé" },
  error: { variant: "danger" as const, label: "Erreur" },
};

export function StagePanel({ steps, statuses, logs, phase }: StagePanelProps) {
  const activeIndex = statuses.findIndex((s) => s === "active");
  const current = activeIndex === -1 ? null : steps[activeIndex];
  const badge = phaseBadge[phase];

  return (
    <Card variant="glass" padding="lg" className="h-full animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">
          Pipeline Status
        </span>
        <Badge variant={badge.variant} size="sm" dot>
          {badge.label}
        </Badge>
      </div>

      {/* Active step highlight */}
      {current ? (
        <div className="flex items-start gap-4 mb-6">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
            {current.icon}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">{current.label}</h3>
            {current.description && (
              <p className="text-sm text-zinc-400 mt-0.5">{current.description}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white">
            {phase === "idle"
              ? "En attente d'une vidéo"
              : phase === "error"
                ? "Pipeline figé"
                : "Pipeline terminé"}
          </h3>
          <p className="text-sm text-zinc-400 mt-0.5">
            {phase === "idle"
              ? "Déposez un fichier vidéo pour lancer le traitement IA."
              : phase === "error"
                ? "Une erreur est survenue pendant le traitement."
                : "Tous les clips viraux ont été générés avec succès."}
          </p>
        </div>
      )}

      {/* Terminal log */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 font-mono text-xs leading-relaxed">
        {logs.length === 0 ? (
          <span className="text-zinc-600">$ awaiting input…</span>
        ) : (
          logs.map((line, i) => {
            const isLast = i === logs.length - 1;
            const tone = line.startsWith("✓")
              ? "text-green-400"
              : line.startsWith("✗")
                ? "text-red-400"
                : "text-zinc-300";
            return (
              <div key={i} className={cn(tone, isLast && phase === "processing" && "animate-pulse")}>
                <span className="text-zinc-600 mr-2">$</span>
                {line}
                {isLast && phase === "processing" && (
                  <span className="ml-1 inline-block w-2 h-3.5 align-middle bg-cyan-400 animate-pulse" />
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
