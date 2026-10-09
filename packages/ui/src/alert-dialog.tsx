/**
 * shadcn/ui Base UI implementation, retaining Dawnsight's existing visual API.
 * Source/API reference: https://ui.shadcn.com/docs/components/base/alert-dialog
 * `AlertDialogAction` uses Base UI Close so it keeps Radix's close-on-action behavior.
 */
import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

import { cn } from "./utils";
import { Button } from "./button";

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

function AlertDialogOverlay({
  className,
  ...props
}: Omit<AlertDialogPrimitive.Backdrop.Props, "className"> & {
  className?: string;
}) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/80 data-[starting-style]:animate-in data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
AlertDialogOverlay.displayName = "AlertDialogOverlay";

function AlertDialogContent({
  className,
  ...props
}: Omit<AlertDialogPrimitive.Popup.Props, "className"> & {
  className?: string;
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[starting-style]:animate-in data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 data-[ending-style]:zoom-out-95 data-[starting-style]:zoom-in-95 data-[ending-style]:slide-out-to-left-1/2 data-[ending-style]:slide-out-to-top-[48%] data-[starting-style]:slide-in-from-left-1/2 data-[starting-style]:slide-in-from-top-[48%] motion-reduce:animate-none sm:rounded-lg",
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}
AlertDialogContent.displayName = "AlertDialogContent";

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col space-y-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}
AlertDialogHeader.displayName = "AlertDialogHeader";

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
        className,
      )}
      {...props}
    />
  );
}
AlertDialogFooter.displayName = "AlertDialogFooter";

function AlertDialogTitle({
  className,
  ...props
}: Omit<AlertDialogPrimitive.Title.Props, "className"> & {
  className?: string;
}) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
}
AlertDialogTitle.displayName = "AlertDialogTitle";

function AlertDialogDescription({
  className,
  ...props
}: Omit<AlertDialogPrimitive.Description.Props, "className"> & {
  className?: string;
}) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
AlertDialogDescription.displayName = "AlertDialogDescription";

function AlertDialogAction({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <AlertDialogPrimitive.Close
      render={
        <Button
          data-slot="alert-dialog-action"
          variant={variant}
          size={size}
          className={className}
          {...props}
        />
      }
    />
  );
}
AlertDialogAction.displayName = "AlertDialogAction";

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <AlertDialogPrimitive.Close
      render={
        <Button
          data-slot="alert-dialog-cancel"
          variant={variant}
          size={size}
          className={cn("mt-2 sm:mt-0", className)}
          {...props}
        />
      }
    />
  );
}
AlertDialogCancel.displayName = "AlertDialogCancel";

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
