"use client";

import { Carousel } from "@/components/ui/Carousel";
import { ClipCard } from "@/components/ui/ClipCard";
import { Badge } from "@/components/ui/Badge";
import { ViralMoment } from "@/lib/types";

export interface ResultsCarouselProps {
  clips: ViralMoment[];
  videoDuration?: number;
}

export function ResultsCarousel({ clips, videoDuration }: ResultsCarouselProps) {
  if (!clips.length) return null;

  return (
    <section className="mt-12 animate-scale-in">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white tracking-tight">
          Clips viraux détectés
        </h2>
        <Badge variant="viral" size="lg">
          {clips.length} moment{clips.length > 1 ? "s" : ""}
        </Badge>
      </div>

      <Carousel autoPlay loop showArrows showDots autoPlayInterval={6000}>
        {clips.map((clip, index) => (
          <div key={clip.rank ?? index} className="mx-auto max-w-2xl px-2">
            <ClipCard clip={clip} index={index} videoDuration={videoDuration} />
          </div>
        ))}
      </Carousel>
    </section>
  );
}
