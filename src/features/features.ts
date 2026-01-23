export const FEATURE_FLAGS = {
  // Starter features (everyone gets these)
  GPS_TRACKING: ['starter', 'professional', 'enterprise', 'trial'],
  BASIC_TIMESHEETS: ['starter', 'professional', 'enterprise', 'trial'],
  MOBILE_APP: ['starter', 'professional', 'enterprise', 'trial'],
  JOB_MANAGEMENT: ['starter', 'professional', 'enterprise', 'trial'],
  WORKER_MANAGEMENT: ['starter', 'professional', 'enterprise', 'trial'],
  CSV_EXPORTS: ['starter', 'professional', 'enterprise', 'trial'],
  GEOFENCING_BASIC: ['starter', 'professional', 'enterprise', 'trial'],
  
  // Professional features
  FACE_VERIFICATION: ['professional', 'enterprise', 'trial'],
  PHOTO_CAPTURE: ['professional', 'enterprise', 'trial'],
  GEOFENCING_ALERTS: ['professional', 'enterprise', 'trial'],
  BREAK_COMPLIANCE: ['professional', 'enterprise', 'trial'],
  OVERTIME_TRACKING: ['professional', 'enterprise', 'trial'],
  SCHEDULING: ['professional', 'enterprise', 'trial'],
  SHIFT_TEMPLATES: ['professional', 'enterprise', 'trial'],
  OPEN_SHIFTS: ['professional', 'enterprise', 'trial'],
  SHIFT_REQUESTS: ['professional', 'enterprise', 'trial'],
  TIME_OFF: ['professional', 'enterprise', 'trial'],
  LEAVE_MANAGEMENT: ['professional', 'enterprise', 'trial'],
  MANUAL_TIME_ENTRY: ['professional', 'enterprise', 'trial'],
  PAY_PERIODS: ['professional', 'enterprise', 'trial'],
  MESSAGES: ['professional', 'enterprise', 'trial'],
  EXCEL_EXPORTS: ['professional', 'enterprise', 'trial'],
  PDF_EXPORTS: ['professional', 'enterprise', 'trial'],
  COST_ANALYTICS: ['professional', 'enterprise', 'trial'],
  
  // Enterprise features
  CERTIFIED_PAYROLL: ['enterprise', 'trial'],
  PREVAILING_WAGE: ['enterprise', 'trial'],
  AUDIT_LOGS: ['enterprise', 'trial'],
  ADVANCED_ANALYTICS: ['enterprise', 'trial'],
  CUSTOM_REPORTS: ['enterprise', 'trial'],
};

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function hasFeature(subscriptionTier: string, feature: FeatureFlag): boolean {
  const allowedTiers = FEATURE_FLAGS[feature] || [];
  return allowedTiers.includes(subscriptionTier.toLowerCase());
}

export function getAllowedFeatures(subscriptionTier: string): FeatureFlag[] {
  return Object.keys(FEATURE_FLAGS).filter(
    (feature) => hasFeature(subscriptionTier, feature as FeatureFlag)
  ) as FeatureFlag[];
}

export function getRequiredTier(feature: FeatureFlag): string {
  const starterFeatures = [
    'GPS_TRACKING', 'BASIC_TIMESHEETS', 'MOBILE_APP', 'JOB_MANAGEMENT', 
    'WORKER_MANAGEMENT', 'CSV_EXPORTS', 'GEOFENCING_BASIC'
  ];
  
  const professionalFeatures = [
    'FACE_VERIFICATION', 'PHOTO_CAPTURE', 'GEOFENCING_ALERTS', 'BREAK_COMPLIANCE',
    'OVERTIME_TRACKING', 'SCHEDULING', 'SHIFT_TEMPLATES', 'OPEN_SHIFTS', 'SHIFT_REQUESTS', 
    'TIME_OFF', 'LEAVE_MANAGEMENT', 'MANUAL_TIME_ENTRY', 'PAY_PERIODS',
    'MESSAGES', 'EXCEL_EXPORTS', 'PDF_EXPORTS', 'COST_ANALYTICS'
  ];
  
  const enterpriseFeatures = [
    'CERTIFIED_PAYROLL', 'PREVAILING_WAGE', 'AUDIT_LOGS', 'ROLE_MANAGEMENT',
    'ADVANCED_ANALYTICS', 'CUSTOM_REPORTS'
  ];
  
  if (enterpriseFeatures.includes(feature)) {
    return 'enterprise';
  }
  if (professionalFeatures.includes(feature)) {
    return 'professional';
  }
  return 'starter';
}

export function isPaidTier(tier: string): boolean {
  return ['starter', 'professional', 'enterprise'].includes(tier.toLowerCase());
}

export function getTierLevel(tier: string): number {
  const levels: Record<string, number> = {
    'trial': 2,
    'starter': 1,
    'professional': 2,
    'enterprise': 3,
  };
  return levels[tier.toLowerCase()] || 0;
}
