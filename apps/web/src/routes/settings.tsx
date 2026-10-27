import { createFileRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { AppSettingsFrame, AppSettingsNavGroup, AppSettingsNavItem, BrandMark, Inline, Text } from '@loca/ui';

export const Route = createFileRoute('/settings')({ component: SettingsLayout });

const DEFAULTS = [
  { to: '/settings/defaults/connections', label: '연결' },
  { to: '/settings/defaults/statuses', label: '상태·태그' },
  { to: '/settings/defaults/editor', label: '에디터 AI' },
  { to: '/settings/defaults/chat', label: '채팅' },
  { to: '/settings/defaults/workflows', label: '워크플로' },
] as const;

/** The home's settings: its own frame (a list of pages), no project sidebar and no chat panel. */
function SettingsLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <AppSettingsFrame
      brand={
        <Link to="/">
          <Inline gap="condensed">
            <BrandMark />
            <Text weight="semibold">프로젝트 목록</Text>
          </Inline>
        </Link>
      }
      nav={
        <>
          <AppSettingsNavGroup title="새 프로젝트 기본값" note="새로 만드는 프로젝트에만 쓰입니다. 이미 있는 프로젝트는 각 프로젝트 설정의 '홈 기본값'에서 가져옵니다.">
            {DEFAULTS.map((item) => (
              <AppSettingsNavItem key={item.to} active={pathname.startsWith(item.to)}>
                <Link to={item.to}>{item.label}</Link>
              </AppSettingsNavItem>
            ))}
          </AppSettingsNavGroup>
          <AppSettingsNavGroup title="화면">
            <AppSettingsNavItem active={pathname.startsWith('/settings/appearance')}>
              <Link to="/settings/appearance">테마</Link>
            </AppSettingsNavItem>
          </AppSettingsNavGroup>
        </>
      }
    >
      <Outlet />
    </AppSettingsFrame>
  );
}
