import { Switch } from "../controls/switch"

export interface PermissionMatrixAction<Action extends string> {
  id: Action
  label: string
}

export interface PermissionMatrixRow<Row extends string, Action extends string> {
  id: Row
  label: string
  description?: string
  supported: readonly Action[]
}

export function PermissionMatrix<Row extends string, Action extends string>({
  actions,
  rows,
  checked,
  disabled = false,
  onChange,
}: {
  actions: readonly PermissionMatrixAction<Action>[]
  rows: readonly PermissionMatrixRow<Row, Action>[]
  checked: (row: Row, action: Action) => boolean
  disabled?: boolean
  onChange: (row: Row, action: Action, checked: boolean) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-default">
      <table className="w-full min-w-[40rem] table-fixed text-sm">
        <colgroup>
          <col />
          {actions.map((action) => <col key={action.id} className="w-20" />)}
        </colgroup>
        <thead>
          <tr className="border-b border-default bg-sunken/50 text-xs text-muted">
            <th scope="col" className="w-full px-3 py-2 text-left font-normal">대상</th>
            {actions.map((action) => <th key={action.id} scope="col" className="w-20 px-1 py-2 text-center font-normal">{action.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-subtle last:border-0">
              <th scope="row" className="px-3 py-2 text-left align-middle font-normal text-default">
                <span className="block">{row.label}</span>
                {row.description && <span className="mt-0.5 block text-xs font-normal text-muted">{row.description}</span>}
              </th>
              {actions.map((action) => {
                const supported = row.supported.includes(action.id)
                return (
                  <td key={action.id} className="px-1 py-2 text-center align-middle">
                    {supported ? (
                      <Switch checked={checked(row.id, action.id)} disabled={disabled} onCheckedChange={(value) => onChange(row.id, action.id, value)} aria-label={`${row.label} ${action.label}`} />
                    ) : (
                      <span role="img" aria-label={`${row.label} ${action.label}: 지원하지 않음`} className="text-muted">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
