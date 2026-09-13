import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  orderCreateSchema,
  orderCommandSchema,
  orderListSchema,
  layoutChangesSchema,
} from '@restaurant/validation';
import { type ApiRequest, RequirePermissions } from '../auth/authorization';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}
  @Get() @RequirePermissions('order.read') list(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.list(r.principal, orderListSchema.parse(q));
  }
  @Get('changes') @RequirePermissions('order.read') changes(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.changes(r.principal, layoutChangesSchema.parse(q));
  }
  @Get('waiters') @RequirePermissions('order.read', 'order.assign') waiters(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.waiters(r.principal, orderListSchema.omit({ status: true }).parse(q));
  }
  @Get(':id/history') @RequirePermissions('order.read') history(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ) {
    return this.service.changes(r.principal, layoutChangesSchema.parse(q), id);
  }
  @Get(':id') @RequirePermissions('order.read') get(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.get(r.principal, id);
  }
  @Post() @RequirePermissions('order.read', 'order.manage') create(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.create(r.principal, orderCreateSchema.parse(body));
  }
  @Post(':id/commands') @RequirePermissions('order.read', 'order.manage') command(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.command(r.principal, id, orderCommandSchema.parse(body));
  }
}
