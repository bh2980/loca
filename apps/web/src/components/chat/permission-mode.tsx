import { ShieldCheck, ShieldOff, ShieldQuestion } from 'lucide-react';
import { PERMISSION_MODE_INFO, PERMISSION_MODES, type PermissionMode } from '@tw/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const ICON = { ask: ShieldQuestion, auto: ShieldCheck, bypass: ShieldOff } as const;

/**
 * How the agent's changes are decided (#45): a card each, auto review, or bypass. In the composer it
 * is the conversation's mode; in settings, the mode new conversations start in.
 */
export function PermissionModePicker({ value, onChange, compact = false, className }: { value: PermissionMode; onChange: (mode: PermissionMode) => void; compact?: boolean; className?: string }) {
  const Icon = ICON[value];
  return (
    <Select value={value} onValueChange={(next) => onChange(next as PermissionMode)}>
      <SelectTrigger size="sm" className={cn(compact && 'border-0 bg-transparent px-1.5 shadow-none', value === 'bypass' && 'text-warning', className)} aria-label="변경 권한 모드" title={PERMISSION_MODE_INFO[value].description}>
        <Icon />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERMISSION_MODES.map((mode) => (
          <SelectItem key={mode} value={mode}>
            <span className="flex flex-col">
              <span>{PERMISSION_MODE_INFO[mode].label}</span>
              {!compact && <span className="text-xs text-muted-foreground">{PERMISSION_MODE_INFO[mode].description}</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
