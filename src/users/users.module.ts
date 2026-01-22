import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AwsModule } from '../aws/aws.module';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [AwsModule, StripeModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
