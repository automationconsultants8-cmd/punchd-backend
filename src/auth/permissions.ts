// Define what each role can do
export const PERMISSIONS = {
  // Workers - mobile app only
  WORKER: {
    canAccessDashboard: false,
    canManageWorkers: false,
    canApproveWorkers: false,
    canManageJobs: false,
    canViewAllTimesheets: false,
    canExportReports: false,
    canManageSchedules: false,
    canViewAnalytics: false,
    canManageCompany: false,
  },

  // Managers - limited dashboard access
  MANAGER: {
    canAccessDashboard: true,
    canManageWorkers: false,
    canApproveWorkers: true,
    canManageJobs: false,
    canViewAllTimesheets: true,
    canExportReports: true,
    canManageSchedules: true,
    canViewAnalytics: true,
    canManageCompany: false,
  },

  // Admins - full operational access
  ADMIN: {
    canAccessDashboard: true,
    canManageWorkers: true,
    canApproveWorkers: true,
    canManageJobs: true,
    canViewAllTimesheets: true,
    canExportReports: true,
    canManageSchedules: true,
    canViewAnalytics: true,
    canManageCompany: false,
  },

  // Owners - everything
  OWNER: {
    canAccessDashboard: true,
    canManageWorkers: true,
    canApproveWorkers: true,
    canManageJobs: true,
    canViewAllTimesheets: true,
    canExportReports: true,
    canManageSchedules: true,
    canViewAnalytics: true,
    canManageCompany: true,
  },
};

export type UserRole = keyof typeof PERMISSIONS;
export type Permission = keyof typeof PERMISSIONS.WORKER;

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return PERMISSIONS[role]?.[permission] ?? false;
}