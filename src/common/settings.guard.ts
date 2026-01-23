import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';

// Toggle key type
export type SettingToggle = 
  | 'shiftScheduling'
  | 'leaveManagement'
  | 'breakTracking'
  | 'overtimeCalculations'
  | 'jobBasedTracking'
  | 'photoCapture'
  | 'buddyPunchAlerts';

// Decorator to mark endpoints with required setting
export const RequireSetting = (setting: SettingToggle) => {
  return (target: any, key?: string, descriptor?: any) => {
    Reflect.defineMetadata('requiredSetting', setting, descriptor?.value || target);
    return descriptor;
  };
};

// Decorator for controller-level setting requirement
export const RequireSettingController = (setting: SettingToggle) => {
  return (target: any) => {
    Reflect.defineMetadata('requiredSetting', setting, target);
    return target;
  };
};

@Injectable()
export class SettingsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check method-level first, then controller-level
    const requiredSetting = 
      this.reflector.get<SettingToggle>('requiredSetting', context.getHandler()) ||
      this.reflector.get<SettingToggle>('requiredSetting', context.getClass());

    // No setting required, allow access
    if (!requiredSetting) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.companyId) {
      throw new ForbiddenException('User not authenticated');
    }

    // Get company settings
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { settings: true, name: true },
    });

    if (!company) {
      throw new ForbiddenException('Company not found');
    }

    const settings = (company.settings as any) || {};
    
    // Check if the setting is enabled (default to true if not set for most features)
    const defaultValues: Record<SettingToggle, boolean> = {
      shiftScheduling: false,
      leaveManagement: false,
      breakTracking: true,
      overtimeCalculations: true,
      jobBasedTracking: true,
      photoCapture: true,
      buddyPunchAlerts: true,
    };

    const isEnabled = settings[requiredSetting] ?? defaultValues[requiredSetting];

    if (!isEnabled) {
      const featureNames: Record<SettingToggle, string> = {
        shiftScheduling: 'Shift Scheduling',
        leaveManagement: 'Leave Management',
        breakTracking: 'Break Tracking',
        overtimeCalculations: 'Overtime Calculations',
        jobBasedTracking: 'Job-Based Tracking',
        photoCapture: 'Photo Capture',
        buddyPunchAlerts: 'Buddy Punch Alerts',
      };

      throw new ForbiddenException({
        message: `${featureNames[requiredSetting]} is disabled. Enable it in Settings to use this feature.`,
        setting: requiredSetting,
        enabled: false,
        settingsUrl: '/settings',
      });
    }

    return true;
  }
}
