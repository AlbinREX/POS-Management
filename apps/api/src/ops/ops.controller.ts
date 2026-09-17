import { Controller, Get, Req } from '@nestjs/common';
import { RequirePermissions, type ApiRequest } from '../auth/authorization';
import { OpsService } from './ops.service';
// Read-only operational visibility behind ops.read. Branch scope comes from the session,
// and no route here mutates anything.
@Controller('ops')
export class OpsController {
  constructor(private readonly service: OpsService) {}
  @Get('status') @RequirePermissions('ops.read') status(@Req() r: ApiRequest) {
    return this.service.status(r.principal);
  }
}
