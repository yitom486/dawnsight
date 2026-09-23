/**
 * shadcn/ui Base UI combobox primitive pattern.
 * Keep product-specific behavior at call sites and pass visual variants via `className`.
 */
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";

import { cn } from "./utils";

const Combobox = ComboboxPrimitive.Root;

type StringClassName<Props> = Omit<Props, "className"> & {
  className?: string;
};

function ComboboxTrigger({
  className,
  ...props
}: StringClassName<ComboboxPrimitive.Trigger.Props>) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

function ComboboxInput({
  className,
  ...props
}: StringClassName<ComboboxPrimitive.Input.Props>) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base text-foreground outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

type ComboboxContentProps = StringClassName<ComboboxPrimitive.Popup.Props> &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >;

function ComboboxContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  ...props
}: ComboboxContentProps) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        data-slot="combobox-positioner"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "relative max-h-[var(--available-height)] max-w-[var(--available-width)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({
  className,
  ...props
}: StringClassName<ComboboxPrimitive.List.Props>) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn("overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  ...props
}: StringClassName<ComboboxPrimitive.Item.Props>) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[selected]:bg-accent data-[selected]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxItemIndicator({
  className,
  ...props
}: StringClassName<ComboboxPrimitive.ItemIndicator.Props>) {
  return (
    <ComboboxPrimitive.ItemIndicator
      data-slot="combobox-item-indicator"
      className={cn("ml-auto inline-flex items-center", className)}
      {...props}
    />
  );
}

function ComboboxEmpty({
  className,
  ...props
}: StringClassName<ComboboxPrimitive.Empty.Props>) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn("px-2.5 py-2 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger,
};
