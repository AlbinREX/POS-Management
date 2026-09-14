import { Body, Controller, Get, Post, Put, Param, Query, Req, ParseUUIDPipe } from '@nestjs/common';
import {
  supplierSchema,
  supplierUpdateSchema,
  purchasingVersionSchema,
  purchaseDraftSchema,
  purchaseUpdateSchema,
  purchaseCancelSchema,
  goodsReceiptSchema,
  supplierPaymentSchema,
  supplierReverseSchema,
  purchasingListSchema,
  layoutChangesSchema,
} from '@restaurant/validation';
import { RequirePermissions, type ApiRequest } from '../auth/authorization';
import { PurchasingService } from './purchasing.service';
@Controller('purchasing')
export class PurchasingController {
  constructor(private readonly service: PurchasingService) {}
  @Get('suppliers') @RequirePermissions('supplier.read') route0(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.suppliers(r.principal, purchasingListSchema.parse(q));
  }
  @Post('suppliers') @RequirePermissions('supplier.read', 'supplier.manage') route1(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.saveSupplier(r.principal, supplierSchema.parse(body));
  }
  @Put('suppliers/:id') @RequirePermissions('supplier.read', 'supplier.manage') route2(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.saveSupplier(r.principal, supplierUpdateSchema.parse(body), id);
  }
  @Post('suppliers/:id/archive') @RequirePermissions('supplier.read', 'supplier.manage') route3(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.archiveSupplier(r.principal, id, purchasingVersionSchema.parse(body));
  }
  @Get('suppliers/:id/account') @RequirePermissions('supplier.read') route4(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ) {
    return this.service.account(r.principal, id, purchasingListSchema.parse(q));
  }
  @Get('orders') @RequirePermissions('purchase.read') route5(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.listOrders(r.principal, purchasingListSchema.parse(q));
  }
  @Get('orders/:id') @RequirePermissions('purchase.read') route6(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getOrder(r.principal, id);
  }
  @Post('orders') @RequirePermissions('purchase.read', 'purchase.manage') route7(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.saveOrder(r.principal, purchaseDraftSchema.parse(body));
  }
  @Put('orders/:id') @RequirePermissions('purchase.read', 'purchase.manage') route8(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.saveOrder(r.principal, purchaseUpdateSchema.parse(body), id);
  }
  @Post('orders/:id/order') @RequirePermissions('purchase.read', 'purchase.manage') route9(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.orderAction(r.principal, id, purchasingVersionSchema.parse(body), 'order');
  }
  @Post('orders/:id/cancel') @RequirePermissions('purchase.read', 'purchase.manage') route10(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.orderAction(r.principal, id, purchaseCancelSchema.parse(body), 'cancel');
  }
  @Post('orders/:id/receive') @RequirePermissions('purchase.read', 'purchase.receive') route11(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.receive(r.principal, id, goodsReceiptSchema.parse(body));
  }
  @Get('receipts') @RequirePermissions('purchase.read') route12(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.receipts(r.principal, purchasingListSchema.parse(q));
  }
  @Get('receipts/:id') @RequirePermissions('purchase.read') route13(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getReceipt(r.principal, id);
  }
  @Post('payments') @RequirePermissions('supplier.read', 'supplier.payment.record') route14(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.recordPayment(r.principal, supplierPaymentSchema.parse(body));
  }
  @Post('payments/:id/reverse')
  @RequirePermissions('supplier.read', 'supplier.payment.reverse')
  route15(@Req() r: ApiRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.reversePayment(r.principal, id, supplierReverseSchema.parse(body));
  }
  @Get('catalog/items') @RequirePermissions('purchase.read') items(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.catalog(r.principal, purchasingListSchema.parse(q), 'items');
  }
  @Get('catalog/warehouses') @RequirePermissions('purchase.read') warehouses(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.catalog(r.principal, purchasingListSchema.parse(q), 'warehouses');
  }
  @Get('catalog/suppliers') @RequirePermissions('purchase.read') suppliers(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.catalog(r.principal, purchasingListSchema.parse(q), 'suppliers');
  }
  @Get('events') @RequirePermissions('purchase.read') events(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    const x = layoutChangesSchema.parse(q);
    return this.service.events(r.principal, x.after, x.limit);
  }
  @Get('orders/:id/history') @RequirePermissions('purchase.read') history(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ) {
    const x = layoutChangesSchema.parse(q);
    return this.service.events(r.principal, x.after, x.limit, id);
  }
}
