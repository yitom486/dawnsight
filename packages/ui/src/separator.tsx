"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import { cn } from "./utils"

type SeparatorProps = Omit<SeparatorPrimitive.Props, "decorative"> & {
  decorative?: boolean
}

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
      aria-orientation={
        decorative ? undefined : (ariaOrientation ?? orientation)
      }
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
