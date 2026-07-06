"use client";

import { useState, useCallback, useEffect, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";
import { Card } from "./Card";

export interface CarouselProps {
  children: ReactNode;
  className?: string;
  autoPlay?: boolean;
  autoPlayInterval?: number;
  showArrows?: boolean;
  showDots?: boolean;
  loop?: boolean;
}

export function Carousel({
  children,
  className = "",
  autoPlay = false,
  autoPlayInterval = 5000,
  showArrows = true,
  showDots = true,
  loop = true,
}: CarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const items = Array.isArray(children) ? children : [children];
  const totalItems = items.length;

  const next = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setCurrentIndex((prev) => {
      const next = prev + 1;
      if (next >= totalItems) {
        return loop ? 0 : prev;
      }
      return next;
    });
    setTimeout(() => setIsAnimating(false), 300);
  }, [isAnimating, totalItems, loop]);

  const prev = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setCurrentIndex((prev) => {
      const next = prev - 1;
      if (next < 0) {
        return loop ? totalItems - 1 : prev;
      }
      return next;
    });
    setTimeout(() => setIsAnimating(false), 300);
  }, [isAnimating, totalItems, loop]);

  const goTo = useCallback((index: number) => {
    if (isAnimating || index === currentIndex) return;
    setIsAnimating(true);
    setCurrentIndex(index);
    setTimeout(() => setIsAnimating(false), 300);
  }, [isAnimating, currentIndex]);

  // Auto-play
  useEffect(() => {
    if (!autoPlay || totalItems <= 1) return;
    const interval = setInterval(() => {
      next();
    }, autoPlayInterval);
    return () => clearInterval(interval);
  }, [autoPlay, autoPlayInterval, totalItems, next]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [prev, next]);

  const currentItem = items[currentIndex];

  return (
    <div className={cn("relative", className)}>
      <div
        className="overflow-hidden"
        role="region"
        aria-label="Carrousel de clips viraux"
        aria-roledescription="carousel"
      >
        <div
          className={cn(
            "flex transition-transform duration-300 ease-out",
            isAnimating && "duration-300"
          )}
          style={{
            transform: `translateX(-${currentIndex * 100}%)`,
          }}
          role="group"
          aria-roledescription="slide"
        >
          {items.map((item, index) => (
            <div
              key={index}
              className="w-full flex-shrink-0 px-2"
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} sur ${totalItems}`}
              aria-current={index === currentIndex ? "true" : "false"}
            >
              {item}
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Arrows */}
      {showArrows && totalItems > 1 && (
        <>
          <Button
            variant="ghost"
            size="lg"
            onClick={prev}
            disabled={!loop && currentIndex === 0}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 z-10 bg-zinc-900/80 hover:bg-zinc-800 text-white rounded-full p-2 shadow-lg transition-all"
            aria-label="Clip précédent"
            aria-disabled={!loop && currentIndex === 0}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={next}
            disabled={!loop && currentIndex === totalItems - 1}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 z-10 bg-zinc-900/80 hover:bg-zinc-800 text-white rounded-full p-2 shadow-lg transition-all"
            aria-label="Clip suivant"
            aria-disabled={!loop && currentIndex === totalItems - 1}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Button>
        </>
      )}

      {/* Dots Navigation */}
      {showDots && totalItems > 1 && (
        <div
          className="flex justify-center gap-2 mt-6"
          role="tablist"
          aria-label="Navigation des clips"
        >
          {items.map((_, index) => (
            <button
              key={index}
              onClick={() => goTo(index)}
              className={cn(
                "w-2.5 h-2.5 rounded-full transition-all duration-300",
                index === currentIndex
                  ? "bg-cyan-400 w-8 shadow-[0_0_10px_rgba(6,182,212,0.5)]"
                  : "bg-zinc-700 hover:bg-zinc-500"
              )}
              role="tab"
              aria-selected={index === currentIndex}
              aria-label={`Aller au clip ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Counter */}
      {totalItems > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-zinc-500 text-sm font-mono">
          {currentIndex + 1} / {totalItems}
        </div>
      )}
    </div>
  );
}