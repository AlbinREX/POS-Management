import { Controller, Get, Query, Req } from '@nestjs/common';
import { syncStatusSchema } from '@restaurant/validation';
import { RequirePermissions, type ApiRequest } from '../auth/authorization';
import { SyncService } from './sync.service';
// Read-only: synchronization state is observable but never operator-writable here.
// Branch and organization come from the session, never from the query.
@Controller('sync')
export class SyncController {
  constructor(private readonly service: SyncService) {}
  @Get('status') @RequirePermissions('sync.read') status(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.status(r.principal, syncStatusSchema.parse(q).stream);
  }
}
