"use client";

import { HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info" | "neon" | "viral";
  size?: "sm" | "md" | "lg";
  dot?: boolean;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      children,
      variant = "default",
      size = "md",
      dot = false,
      className = "",
      ...props
    },
    ref
  ) => {
    const variants = {
      default: "bg-zinc-800 text-zinc-300 border border-zinc-700",
      success: "bg-green-500/20 text-green-400 border border-green-500/30",
      warning: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
      danger: "bg-red-500/20 text-red-400 border border-red-500/30",
      info: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
      neon: "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.3)]",
      viral: "bg-gradient-to-r from-pink-500/20 to-orange-500/20 text-orange-300 border border-pink-500/30",
    };

    const sizes = {
      sm: "px-2 py-0.5 text-xs gap-1",
      md: "px-3 py-1 text-sm gap-1.5",
      lg: "px-4 py-1.5 text-base gap-2",
    };

    const dotStyles = {
      default: "bg-zinc-500",
      success: "bg-green-500",
      warning: "bg-amber-500",
      danger: "bg-red-500",
      info: "bg-blue-500",
      neon: "bg-cyan-500",
      viral: "bg-gradient-to-r from-pink-500 to-orange-500",
    };

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center font-medium rounded-full border transition-all duration-200",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {dot && (
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full animate-pulse",
              dotStyles[variant]
            )}
          />
        )}
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";