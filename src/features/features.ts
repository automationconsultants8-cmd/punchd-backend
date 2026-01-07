export const FEATURE_FLAGS = {
  // Starter features (everyone gets these)
  GPS_TRACKING: ['starter', 'professional', 'contractor', 'trial'],
  BASIC_TIMESHEETS: ['starter', 'professional', 'contractor', 'trial'],
  MOBILE_APP: ['starter', 'professional', 'contractor', 'trial'],
  JOB_MANAGEMENT: ['starter', 'professional', 'contractor', 'trial'],
  WORKER_MANAGEMENT: ['starter', 'professional', 'contractor', 'trial'],
  CSV_EXPORTS: ['starter', 'professional', 'contractor', 'trial'],
  GEOFENCING_BASIC: ['starter', 'professional', 'contractor', 'trial'],
  
  // Professional features
  FACE_VERIFICATION: ['professional', 'contractor', 'trial'],
  PHOTO_CAPTURE: ['professional', 'contractor', 'trial'],
  GEOFENCING_ALERTS: ['professional', 'contractor', 'trial'],
  BREAK_COMPLIANCE: ['professional', 'contractor', 'trial'],
  OVERTIME_TRACKING: ['professional', 'contractor', 'trial'],
  SCHEDULING: ['professional', 'contractor', 'trial'],
  OPEN_SHIFTS: ['professional', 'contractor', 'trial'],
  SHIFT_REQUESTS: ['professional', 'contractor', 'trial'],
  TIME_OFF: ['professional', 'contractor', 'trial'],
  MESSAGES: ['professional', 'contractor', 'trial'],
  EXCEL_EXPORTS: ['professional', 'contractor', 'trial'],
  PDF_EXPORTS: ['professional', 'contractor', 'trial'],
  COST_ANALYTICS: ['professional', 'contractor', 'trial'],
  
  // Contractor features
  CERTIFIED_PAYROLL: ['contractor', 'trial'],
  PREVAILING_WAGE: ['contractor', 'trial'],
  AUDIT_LOGS: ['contractor', 'trial'],
  ADVANCED_ANALYTICS: ['contractor', 'trial'],
  CUSTOM_REPORTS: ['contractor', 'trial'],
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
    'OVERTIME_TRACKING', 'SCHEDULING', 'OPEN_SHIFTS', 'SHIFT_REQUESTS', 'TIME_OFF',
    'MESSAGES', 'EXCEL_EXPORTS', 'PDF_EXPORTS', 'COST_ANALYTICS'
  ];
  
  const contractorFeatures = [
    'CERTIFIED_PAYROLL', 'PREVAILING_WAGE', 'AUDIT_LOGS', 'ADVANCED_ANALYTICS', 'CUSTOM_REPORTS'
  ];
  
  if (contractorFeatures.includes(feature)) {
    return 'contractor';
  }
  if (professionalFeatures.includes(feature)) {
    return 'professional';
  }
  return 'starter';
}

export function isPaidTier(tier: string): boolean {
  return ['starter', 'professional', 'contractor'].includes(tier.toLowerCase());
}

export function getTierLevel(tier: string): number {
  const levels: Record<string, number> = {
    'trial': 2,
    'starter': 1,
    'professional': 2,
    'contractor': 3,
  };
  return levels[tier.toLowerCase()] || 0;
}
