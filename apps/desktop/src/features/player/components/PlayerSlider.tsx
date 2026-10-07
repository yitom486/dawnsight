/**
 * Player-specific slider composed from the shared Base UI primitive. Its
 * compact player styling and vertical volume mode stay at this app boundary.
 */
import * as React from "react";
import { SliderPrimitive } from "@dawnsight/ui/slider";

import { cn } from "@dawnsight/ui/utils";

const PlayerSlider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderPrimitive.Root.Props & {
    orientation?: "horizontal" | "vertical";
  }
>(function PlayerSlider(
  {
    className,
    orientation = "horizontal",
    "aria-label": ariaLabel,
    "aria-valuetext": ariaValueText,
    ...props
  },
  ref,
) {
  return (
    <SliderPrimitive.Root
      ref={ref}
      orientation={orientation}
      className={cn(
        "relative flex touch-none select-none items-center",
        orientation === "horizontal" && "w-full",
        orientation === "vertical" && "h-full w-4 flex-col",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Control
        className={cn(
          "relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50",
          orientation === "vertical" && "h-full w-auto flex-col",
        )}
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            "relative grow overflow-hidden rounded-full bg-muted",
            orientation === "horizontal" && "h-1.5 w-full",
            orientation === "vertical" && "h-full w-1.5",
          )}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn(
              "absolute bg-playback-accent",
              orientation === "horizontal" && "h-full",
              orientation === "vertical" && "w-full",
            )}
          />
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            index={0}
            aria-label={ariaLabel}
            aria-valuetext={ariaValueText}
            className="block size-3.5 shrink-0 rounded-full border border-playback-accent/50 bg-playback-accent shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
});

PlayerSlider.displayName = "PlayerSlider";

export { PlayerSlider };
