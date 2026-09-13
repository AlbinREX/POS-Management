import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  paymentCollectSchema,
  paymentReverseSchema,
  paymentZeroSchema,
  shiftOpenSchema,
  shiftCommandSchema,
  paymentPageSchema,
  layoutChangesSchema,
} from '@restaurant/validation';
import { type ApiRequest, RequirePermissions } from '../auth/authorization';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}
  @Get('orders/:id') @RequirePermissions('payment.read', 'order.read') summary(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.summary(r.principal, id);
  }
  @Get('orders/:id/history') @RequirePermissions('payment.read', 'order.read') history(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ) {
    return this.service.changes(r.principal, layoutChangesSchema.parse(q), id);
  }
  @Get('changes') @RequirePermissions('payment.read') changes(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.changes(r.principal, layoutChangesSchema.parse(q));
  }
  @Post('orders/:id/collect')
  @RequirePermissions('payment.read', 'payment.collect', 'order.read')
  collect(@Req() r: ApiRequest, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.service.collect(r.principal, id, paymentCollectSchema.parse(b));
  }
  @Post('orders/:id/settle-zero')
  @RequirePermissions('payment.read', 'payment.collect', 'order.read')
  zero(@Req() r: ApiRequest, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.service.settleZero(r.principal, id, paymentZeroSchema.parse(b));
  }
  @Post(':id/reverse') @RequirePermissions('payment.read') reverse(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.service.reverse(r.principal, id, paymentReverseSchema.parse(b));
  }
  @Get('terminals') @RequirePermissions('cash.shift.read') terminals(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.terminals(r.principal, paymentPageSchema.parse(q));
  }
  @Get('shifts') @RequirePermissions('cash.shift.read') shifts(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.shifts(r.principal, paymentPageSchema.parse(q));
  }
  @Get('shifts/:id') @RequirePermissions('cash.shift.read') shift(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ) {
    return this.service.shiftDetail(r.principal, id, paymentPageSchema.parse(q));
  }
  @Post('shifts') @RequirePermissions('cash.shift.read', 'cash.shift.manage') open(
    @Req() r: ApiRequest,
    @Body() b: unknown,
  ) {
    return this.service.open(r.principal, shiftOpenSchema.parse(b));
  }
  @Post('shifts/:id/commands')
  @RequirePermissions('cash.shift.read', 'cash.shift.manage')
  shiftCommand(@Req() r: ApiRequest, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.service.shiftCommand(r.principal, id, shiftCommandSchema.parse(b));
  }
}
