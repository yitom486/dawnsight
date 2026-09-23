/**
 * shadcn/ui Base UI implementation, retaining Lumina's existing visual API.
 * Source/API reference: https://ui.shadcn.com/docs/components/base/slider
 */
import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "./utils";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbAlignment = "edge",
  ...props
}: Omit<SliderPrimitive.Root.Props, "className"> & {
  className?: string;
}) {
  const values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [value ?? defaultValue ?? min];

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full",
        className,
      )}
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment={thumbAlignment}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col">
        <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2 data-[orientation=vertical]:grow-0">
          <SliderPrimitive.Indicator className="absolute h-full bg-primary data-[orientation=vertical]:h-auto data-[orientation=vertical]:w-full" />
        </SliderPrimitive.Track>
        {values.map((_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            index={index}
            className="block h-5 w-5 shrink-0 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
Slider.displayName = "Slider";

export { Slider, SliderPrimitive };
