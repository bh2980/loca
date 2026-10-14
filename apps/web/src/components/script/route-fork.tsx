/** Rows the main route (본 줄기) puts between lines: a fork (the arm taken, changeable) and a fresh start. */
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { client, unwrap } from '@/lib/api';

export interface RouteFork {
  nodeId: string;
  chosen: string;
  picked: boolean;
  arms: { nodeId: string; label: string }[];
}

/** "▶ the arm taken · 다른 갈래 n개", with a menu to take another arm (saved on the project; the server refreshes both lists). */
export function ForkRow({ projectId, fork }: { projectId: string; fork: RouteFork }) {
  const chosen = fork.arms.find((arm) => arm.nodeId === fork.chosen);
  const pick = useMutation({
    mutationFn: (armId: string | null) => unwrap(client.projects[':projectId']['route-picks'].$put({ param: { projectId }, json: { nodeId: fork.nodeId, armId } })),
    onError: (error) => toast.error(error.message),
  });
  return (
    <li className="flex items-center gap-2 border-b bg-muted/30 px-4 py-1 text-sm">
      <span className="min-w-0 truncate">
        <span className="font-medium">▶ {chosen?.label ?? '…'}</span>
        <span className="text-muted-foreground"> · 다른 갈래 {fork.arms.length - 1}개</span>
        {fork.picked && <span className="text-muted-foreground"> (직접 고름)</span>}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="ml-auto shrink-0" disabled={pick.isPending}>
            갈래 바꾸기 <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-96">
          {fork.arms.map((arm) => (
            <DropdownMenuCheckboxItem key={arm.nodeId} checked={arm.nodeId === fork.chosen} onSelect={() => arm.nodeId !== fork.chosen && pick.mutate(arm.nodeId)}>
              <span className="truncate">{arm.label}</span>
            </DropdownMenuCheckboxItem>
          ))}
          {fork.picked && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => pick.mutate(null)}>자동으로 고르기</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** The route ran out of ways and starts again elsewhere. */
export function RestartRow() {
  return <li className="border-b px-4 py-1 text-xs text-muted-foreground">새 시작점</li>;
}
