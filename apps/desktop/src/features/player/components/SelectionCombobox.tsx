import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger,
} from "@dawnsight/ui/combobox";
import { Button } from "@dawnsight/ui/button";
import { cn } from "@dawnsight/ui/utils";
import { Switch } from "@dawnsight/ui/switch";

export type SelectionOption = {
  value: string;
  label: string;
  keywords?: string;
};

type ToggleOption = {
  label: string;
  checked: boolean;
  onChange: () => void;
};

type Props = {
  value: string | null | undefined;
  options: SelectionOption[];
  placeholder: string;
  ariaLabel: string;
  onValueChange: (value: string) => void;
  triggerLabel?: string;
  leadingIcon?: ReactNode;
  toggle?: ToggleOption;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  onOpenChange?: (open: boolean) => void;
};

/** Player selection workflow composed from the shared Base UI combobox. */
export function SelectionCombobox({
  value,
  options,
  placeholder,
  ariaLabel,
  onValueChange,
  triggerLabel,
  leadingIcon,
  toggle,
  disabled = false,
  className,
  contentClassName,
  onOpenChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [boundaryEl, setBoundaryEl] = useState<Element | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    onOpenChange?.(open);
    if (!open) {
      setQuery("");
      return;
    }
    if (wrapperRef.current) {
      const boundary = wrapperRef.current.closest(
        "[data-panel-boundary], section, aside",
      );
      if (boundary) setBoundaryEl(boundary);
    }
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [onOpenChange, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setQuery("");
  };

  return (
    <div ref={wrapperRef} className="inline-flex min-w-0">
      <Combobox
        items={options}
        value={selected ?? null}
        inputValue={query}
        open={open}
        disabled={disabled}
        itemToStringLabel={(option) => option.label}
        itemToStringValue={(option) => option.value}
        isItemEqualToValue={(item, selectedOption) =>
          item.value === selectedOption.value
        }
        filter={(option, inputValue) => {
          const normalizedQuery = inputValue.trim().toLocaleLowerCase();
          return (
            !normalizedQuery ||
            `${option.label} ${option.keywords ?? ""}`
              .toLocaleLowerCase()
              .includes(normalizedQuery)
          );
        }}
        onInputValueChange={(nextQuery, eventDetails) => {
          setQuery(eventDetails.reason === "item-press" ? "" : nextQuery);
        }}
        onOpenChange={handleOpenChange}
        onValueChange={(option) => {
          if (option) onValueChange(option.value);
          setQuery("");
          setOpen(false);
        }}
      >
        <ComboboxTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={ariaLabel}
              disabled={disabled}
              className={cn("min-w-0 justify-between gap-2", className)}
            >
              {leadingIcon}
              <span className="min-w-0 flex-1 truncate text-left">
                {triggerLabel ?? selected?.label ?? placeholder}
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
            </Button>
          }
        />
        <ComboboxContent
          collisionBoundary={boundaryEl ?? undefined}
          collisionPadding={8}
          collisionAvoidance={{ side: "flip", align: "shift" }}
          align="start"
          side="bottom"
          className={cn(
            "z-[100] w-[min(20rem,var(--available-width,20rem))] max-w-[var(--available-width,calc(100vw-2rem))] p-1",
            contentClassName,
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <Search
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <ComboboxInput
              ref={inputRef}
              placeholder={`搜索${placeholder}`}
              aria-label={`搜索${placeholder}`}
              className="h-7 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 py-0 text-sm shadow-none outline-none ring-0 placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0"
            />
          </div>

          {toggle ? (
            <div className="mt-1 flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm">
              <span>{toggle.label}</span>
              <Switch
                size="default"
                checked={toggle.checked}
                onCheckedChange={(checked) => {
                  if (checked !== toggle.checked) toggle.onChange();
                }}
                aria-label={toggle.label}
                onClick={(event) => event.stopPropagation()}
                className="h-5 w-9"
              />
            </div>
          ) : null}

          <ComboboxEmpty>没有匹配项</ComboboxEmpty>
          <ComboboxList className="mt-1 max-h-56">
            {(option) => (
              <ComboboxItem
                key={option.value}
                value={option}
                className="cursor-pointer px-2.5 py-2"
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <ComboboxItemIndicator>
                  <Check className="size-4 shrink-0" />
                </ComboboxItemIndicator>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
