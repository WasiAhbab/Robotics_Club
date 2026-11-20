import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '../auth/decorators';

@Controller('health')
class HealthController {
  @Public() @Get()
  check() { return { status: 'ok', time: new Date().toISOString() }; }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
