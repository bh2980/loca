import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listenerLabel } from '@tw/shared';
import { client, unwrap } from './api';
import { q } from './queries';

/**
 * After a new translation is saved, other lines with the same source that are not final and say
 * something else are offered the same text (one click, never by itself). Who says it to whom is
 * named, as the speech level may rightly differ. The click writes all of them in one request
 * (POST /units/:unitId/same-source, one transaction); a line changed since it was shown is skipped.
 */
export async function offerSameSource(queryClient: QueryClient, unitId: string, text: string) {
  const same = await queryClient.fetchQuery({ ...q.sameSource(unitId), staleTime: 0 }).catch(() => []);
  const others = same.filter((line) => !line.final && (line.translation ?? '').trim() !== text.trim());
  if (!others.length) return;
  const who = [...new Set(others.map((line) => [line.speaker, line.listener && `→ ${listenerLabel(line.listener)}`].filter(Boolean).join(' ')).filter(Boolean))];
  toast(`같은 원문 ${others.length}줄이 ${others.some((line) => line.translation) ? '다르게 번역돼' : '번역 없이'} 있습니다`, {
    description: `${who.slice(0, 3).join(', ')}${who.length > 3 ? ` 외 ${who.length - 3}` : ''}${who.length ? ' · 화자·청자가 다르면 말투가 다를 수 있습니다' : ''}`,
    duration: 10000,
    action: {
      label: '모두 이 번역으로',
      onClick: async () => {
        try {
          const lines = others.map((line) => ({ unitId: line.id, base: line.translation ?? '' }));
          const result = await unwrap(client.units[':unitId']['same-source'].$post({ param: { unitId }, json: { text, lines } }));
          if (result.skipped) toast.success(`같은 원문 ${result.applied}줄에 적용했습니다. ${result.skipped}줄은 그사이 바뀌어 건너뛰었습니다.`);
          else toast.success(`같은 원문 ${result.applied}줄에 적용했습니다.`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      },
    },
  });
}
