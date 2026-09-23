/**
 * shadcn/ui Base UI implementation, retaining Radix's decorative option.
 * Source/API reference: https://ui.shadcn.com/docs/components/base/separator
 */
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

import { cn } from "./utils";

type SeparatorProps = Omit<SeparatorPrimitive.Props, "className"> & {
  className?: string;
  decorative?: boolean;
};

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  role,
  "aria-hidden": ariaHidden,
  "aria-orientation": ariaOrientation,
  ...props
}: SeparatorProps) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      role={role ?? (decorative ? undefined : "separator")}
      aria-hidden={decorative || ariaHidden}
      aria-orientation={decorative ? undefined : (ariaOrientation ?? orientation)}
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-[1px] data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-[1px]",
        className,
      )}
      {...props}
    />
  );
}
Separator.displayName = "Separator";

export { Separator };
