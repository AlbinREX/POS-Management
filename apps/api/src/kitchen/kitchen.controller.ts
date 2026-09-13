import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  kitchenListSchema,
  kitchenStateSchema,
  kitchenSubmitSchema,
  layoutChangesSchema,
} from '@restaurant/validation';
import { type ApiRequest, RequirePermissions } from '../auth/authorization';
import { KitchenService } from './kitchen.service';
@Controller()
export class KitchenController {
  constructor(private readonly service: KitchenService) {}
  @Post('orders/:id/kitchen-submit')
  @RequirePermissions('order.read', 'order.manage', 'order.submit_kitchen')
  submit(@Req() r: ApiRequest, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.service.submit(r.principal, id, kitchenSubmitSchema.parse(b));
  }
  @Get('kitchen/stations') @RequirePermissions('kitchen.read') stations(@Req() r: ApiRequest) {
    return this.service.stations(r.principal);
  }
  @Get('kitchen/tickets') @RequirePermissions('kitchen.read') list(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.list(r.principal, kitchenListSchema.parse(q));
  }
  @Get('kitchen/changes') @RequirePermissions('kitchen.read') changes(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.changes(r.principal, layoutChangesSchema.parse(q));
  }
  @Get('kitchen/tickets/:id') @RequirePermissions('kitchen.read') get(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.get(r.principal, id);
  }
  @Get('kitchen/tickets/:id/history') @RequirePermissions('kitchen.read') history(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ) {
    return this.service.changes(r.principal, layoutChangesSchema.parse(q), id);
  }
  @Get('kitchen/tickets/:id/print-contract') @RequirePermissions('kitchen.read') printer(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.printer(r.principal, id);
  }
  @Post('kitchen/tickets/:id/state')
  @RequirePermissions('kitchen.read', 'kitchen.manage')
  transition(@Req() r: ApiRequest, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.service.transition(r.principal, id, kitchenStateSchema.parse(b));
  }
}
