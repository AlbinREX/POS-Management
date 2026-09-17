import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { fiscalListSchema, fiscalRetrySchema } from '@restaurant/validation';
import { RequirePermissions, type ApiRequest } from '../auth/authorization';
import { FiscalService } from './fiscal.service';
// Fiscal handoff visibility and operator retry. Branch and organization come from the
// session; no fiscal identifier is ever accepted from a client.
@Controller('fiscal')
export class FiscalController {
  constructor(private readonly service: FiscalService) {}

  @Get('status') @RequirePermissions('fiscal.read') status(@Req() r: ApiRequest) {
    return this.service.summary(r.principal);
  }

  @Get('handoffs') @RequirePermissions('fiscal.read') list(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.list(r.principal, fiscalListSchema.parse(q).state);
  }

  @Get('orders/:id') @RequirePermissions('fiscal.read') orderStatus(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.orderStatus(r.principal, id);
  }

  /** The prepared payload, for operator inspection and provider onboarding. */
  @Get('orders/:id/payload') @RequirePermissions('fiscal.read') payload(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.payload(r.principal, id);
  }

  /**
   * Retry one unresolved handoff. Requires the separate fiscal.retry permission, because
   * attempting delivery is an operator action rather than passive visibility.
   */
  @Post('orders/:id/retry') @RequirePermissions('fiscal.read', 'fiscal.retry') retry(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    fiscalRetrySchema.parse(body);
    return this.service.attempt(r.principal, id, 'operator');
  }
}
