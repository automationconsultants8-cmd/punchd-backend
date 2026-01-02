export const FEATURE_FLAGS = {
  // Starter features (everyone gets these)
  GPS_TRACKING: ['starter', 'professional', 'premium', 'enterprise', 'trial'],
  BASIC_TIMESHEETS: ['starter', 'professional', 'premium', 'enterprise', 'trial'],
  MOBILE_APP: ['starter', 'professional', 'premium', 'enterprise', 'trial'],
  JOB_MANAGEMENT: ['starter', 'professional', 'premium', 'enterprise', 'trial'],
  
  // Professional features
  FACE_VERIFICATION: ['professional', 'premium', 'enterprise', 'trial'],
  PHOTO_CAPTURE: ['professional', 'premium', 'enterprise', 'trial'],
  GEOFENCING: ['professional', 'premium', 'enterprise', 'trial'],
  COST_ANALYTICS: ['professional', 'premium', 'enterprise', 'trial'],
  EXPORTS: ['professional', 'premium', 'enterprise', 'trial'],
  SHIFT_SCHEDULING: ['professional', 'premium', 'enterprise', 'trial'],
  
  // Enterprise features
  AUDIT_LOGS: ['professional', 'premium', 'enterprise', 'trial'],
  API_ACCESS: ['enterprise'],
  SSO: ['enterprise'],
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
  if (['FACE_VERIFICATION', 'PHOTO_CAPTURE', 'GEOFENCING', 'COST_ANALYTICS', 'EXPORTS', 'SHIFT_SCHEDULING'].includes(feature)) {
    return 'professional';
  }
  if (['AUDIT_LOGS', 'API_ACCESS', 'SSO'].includes(feature)) {
    return 'enterprise';
  }
  return 'starter';
}
