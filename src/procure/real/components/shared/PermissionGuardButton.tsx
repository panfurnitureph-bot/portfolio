import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface PermissionGuardButtonProps extends React.ComponentProps<typeof Button> {
  canEdit: boolean;
  tooltipMessage?: string;
}

/**
 * A Button that is disabled with a tooltip when the user lacks edit permission.
 * When canEdit is true, it behaves as a normal Button.
 */
export function PermissionGuardButton({
  canEdit,
  tooltipMessage = 'Edit permission required',
  children,
  onClick,
  disabled,
  ...props
}: PermissionGuardButtonProps) {
  if (!canEdit) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button {...props} disabled className="opacity-50 cursor-not-allowed">
                {children}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{tooltipMessage}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Button {...props} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}
