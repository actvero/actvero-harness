/** Fixed account IPC channels; Main verifies the owning top-level document. */
export const ACCOUNT_IPC = {
  snapshot: 'actvero-account:snapshot',
  state: 'actvero-account:state',
  login: 'actvero-account:login',
  continueAccount: 'actvero-account:continue',
  switchAccount: 'actvero-account:switch',
  cancel: 'actvero-account:cancel',
  reopen: 'actvero-account:reopen',
  refresh: 'actvero-account:refresh',
  quota: 'actvero-account:quota',
  logout: 'actvero-account:logout',
  configure: 'actvero-account:configure',
  selectOrganization: 'actvero-account:organization',
  personalCenter: 'actvero-account:personal-center',
  local: 'actvero-account:local',
  show: 'actvero-account:show',
} as const
