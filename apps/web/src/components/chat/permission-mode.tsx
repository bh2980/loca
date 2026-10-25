import { ShieldCheck, ShieldOff, ShieldQuestion } from 'lucide-react';
import { PERMISSION_MODE_INFO, PERMISSION_MODES, type PermissionMode } from '@tw/shared';
import { ModeSelect } from '@loca/ui';

const ICON = { ask: ShieldQuestion, auto: ShieldCheck, bypass: ShieldOff } as const;
const OPTIONS = PERMISSION_MODES.map((mode) => ({ value: mode, label: PERMISSION_MODE_INFO[mode].label, description: PERMISSION_MODE_INFO[mode].description }));

/**
 * How the agent's changes are decided (#45): a card each, auto review, or bypass. In the composer it
 * is the conversation's mode; in settings, the mode new conversations start in.
 */
export function PermissionModePicker({ value, onChange, compact = false, width, disabled = false, open, onOpenChange }: { open?: boolean; onOpenChange?: (open: boolean) => void; value: PermissionMode; onChange: (mode: PermissionMode) => void; compact?: boolean; /** `medium` fixes the trigger at 12rem (settings rows). */ width?: 'medium'; disabled?: boolean }) {
  return (
    <ModeSelect
      open={open}
      onOpenChange={onOpenChange}
      value={value}
      options={OPTIONS}
      icon={ICON[value]}
      onValueChange={(next) => onChange(next as PermissionMode)}
      label="변경 권한 모드"
      compact={compact}
      warn={value === 'bypass'}
      width={width}
      disabled={disabled}
    />
  );
}
