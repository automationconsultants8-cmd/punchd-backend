// Feature toggle types and defaults
export interface FeatureToggles {
  // Master verification mode
  verificationMode: 'relaxed' | 'balanced' | 'strict';
  
  // Strict/Soft/Off features
  facialRecognition: 'strict' | 'soft' | 'off';
  gpsGeofencing: 'strict' | 'soft' | 'off';
  earlyClockInRestriction: 'strict' | 'soft' | 'off';
  workerSelfServiceEdits: 'strict' | 'soft';
  
  // On/Off features
  photoCapture: boolean;
  breakTracking: boolean;
  breakCompliancePenalties: boolean;
  overtimeCalculations: boolean;
  seventhDayOtRule: boolean;
  autoClockOut: boolean;
  jobBasedTracking: boolean;
  shiftScheduling: boolean;
  leaveManagement: boolean;
  buddyPunchAlerts: boolean;
  
  // Config values
  maxShiftHours: number;
  earlyClockInMinutes: number;
  
  // Learning mode
  onboardingCompletedAt: string | null;
  learningModeEndsAt: string | null;
}

export const DEFAULT_TOGGLES: FeatureToggles = {
  verificationMode: 'balanced',
  facialRecognition: 'soft',
  gpsGeofencing: 'soft',
  earlyClockInRestriction: 'off',
  workerSelfServiceEdits: 'soft',
  photoCapture: true,
  breakTracking: true,
  breakCompliancePenalties: false,
  overtimeCalculations: true,
  seventhDayOtRule: false,
  autoClockOut: true,
  jobBasedTracking: true,
  shiftScheduling: false,
  leaveManagement: false,
  buddyPunchAlerts: true,
  maxShiftHours: 16,
  earlyClockInMinutes: 15,
  onboardingCompletedAt: null,
  learningModeEndsAt: null,
};

export function getToggles(settings: any): FeatureToggles {
  return { ...DEFAULT_TOGGLES, ...settings };
}

export function isInLearningMode(toggles: FeatureToggles): boolean {
  if (!toggles.learningModeEndsAt) return false;
  return new Date() < new Date(toggles.learningModeEndsAt);
}
