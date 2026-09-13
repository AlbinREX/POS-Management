import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from './auth/authorization';
import { DatabaseService } from './database.service';
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}
  @Get('live') @Public() live() {
    return { status: 'ok' };
  }
  @Get('ready') @Public() async ready() {
    try {
      await this.db.client.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
}
