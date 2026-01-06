import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    const user = await this.authService.validateUser(payload.userId, payload.companyId);
    
    if (!user) {
      throw new UnauthorizedException();
    }

    return {
  id: payload.userId,      // ✅ Now req.user.id works
  userId: payload.userId,  // Keep for backward compatibility
  companyId: payload.companyId,
  role: payload.role,
  phone: payload.phone,
};
  }
}
