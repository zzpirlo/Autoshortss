"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import { Badge } from "./Badge";

export interface ProgressStepProps {
  step: number;
  totalSteps: number;
  label: string;
  description?: string;
  icon: ReactNode;
  status: "pending" | "active" | "completed" | "error";
  onClick?: () => void;
}

const stepColors = {
  pending: "text-zinc-500 border-zinc-700 bg-zinc-900/50",
  active: "text-cyan-400 border-cyan-500 bg-cyan-500/10 shadow-[0_0_20px_rgba(6,182,212,0.2)]",
  completed: "text-green-400 border-green-500 bg-green-500/10",
  error: "text-red-400 border-red-500 bg-red-500/10",
};

const stepGlow = {
  pending: "",
  active: "animate-pulse",
  completed: "",
  error: "animate-pulse",
};

export function ProgressStep({
  step,
  totalSteps,
  label,
  description,
  icon,
  status,
  onClick,
}: ProgressStepProps) {
  const isLast = step === totalSteps;
  const colorClasses = stepColors[status];
  const glowClass = stepGlow[status];

  return (
    <div className="relative flex-shrink-0">
      {/* Connector line */}
      {!isLast && (
        <div
          className="absolute left-[14px] top-10 bottom-0 w-0.5"
          aria-hidden="true"
        >
          <div
            className={cn(
              "h-full w-full rounded-full transition-colors duration-500",
              status === "completed" || status === "active"
                ? "bg-gradient-to-b from-cyan-500 to-green-500"
                : "bg-zinc-800"
            )}
          />
        </div>
      )}

      {/* Step Circle */}
      <button
        type="button"
        onClick={onClick}
        disabled={status === "pending"}
        className={cn(
          "relative z-10 flex flex-col items-center gap-3 w-full transition-all duration-300",
          glowClass
        )}
        aria-current={status === "active" ? "step" : undefined}
        aria-disabled={status === "pending"}
      >
        <div
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300",
            colorClasses,
            status === "completed" && "bg-green-500/20",
            status === "active" && "bg-cyan-500/20",
          )}
        >
          {status === "completed" ? (
            <svg
              className="h-5 w-5 text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : status === "error" ? (
            <svg
              className="h-5 w-5 text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          ) : (
            <span className={cn("text-sm font-mono font-bold", colorClasses)}>
              {step}
            </span>
          )}

          {/* Pulse ring for active */}
          {status === "active" && (
            <span
              className="absolute inset-0 rounded-full border-2 border-cyan-500/50 animate-[pulse-ring_2s_ease-out_infinite]"
              aria-hidden="true"
            />
          )}
        </div>

        {/* Label & Description */}
        <div className="text-left w-48">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-medium text-sm transition-colors duration-300",
                status === "active" && "text-cyan-300",
                status === "completed" && "text-green-300",
                status === "error" && "text-red-300",
                status === "pending" && "text-zinc-500",
              )}
            >
              {label}
            </span>
            {status === "active" && (
              <Badge size="sm" variant="neon" dot>
                En cours
              </Badge>
            )}
            {status === "completed" && (
              <Badge size="sm" variant="success" dot>
                Terminé
              </Badge>
            )}
            {status === "error" && (
              <Badge size="sm" variant="danger" dot>
                Erreur
              </Badge>
            )}
          </div>
          {description && (
            <p
              className="mt-1 text-xs text-zinc-500 transition-colors duration-300"
            >
              {description}
            </p>
          )}
        </div>
      </button>
    </div>
  );
}

export interface VerticalStepperProps {
  steps: Array<{
    label: string;
    description?: string;
    icon: ReactNode;
  }>;
  currentStep: number; // 0-indexed
  stepStatuses?: Array<"pending" | "active" | "completed" | "error">;
  onStepClick?: (index: number) => void;
  className?: string;
}

export function VerticalStepper({
  steps,
  currentStep,
  stepStatuses,
  onStepClick,
  className = "",
}: VerticalStepperProps) {
  const totalSteps = steps.length;

  const getStatus = (index: number): "pending" | "active" | "completed" | "error" => {
    if (stepStatuses && stepStatuses[index] !== undefined) {
      return stepStatuses[index];
    }
    if (index < currentStep) return "completed";
    if (index === currentStep) return "active";
    return "pending";
  };

  return (
    <div
      className={cn("flex flex-col gap-6", className)}
      role="list"
      aria-label="Étapes de traitement"
    >
      {steps.map((step, index) => (
        <ProgressStep
          key={index}
          step={index + 1}
          totalSteps={totalSteps}
          label={step.label}
          description={step.description}
          icon={step.icon}
          status={getStatus(index)}
          onClick={() => onStepClick?.(index)}
        />
      ))}
    </div>
  );
}