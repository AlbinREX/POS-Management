import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { reportKindSchema, reportRangeSchema } from '@restaurant/validation';
import { RequirePermissions, type ApiRequest } from '../auth/authorization';
import { ReportingService } from './reporting.service';
// Every route is a GET behind report.read; there is no mutation in this controller.
@Controller('reports')
export class ReportingController {
  constructor(private readonly service: ReportingService) {}
  @Get('overview') @RequirePermissions('report.read') overview(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.overview(r.principal, reportRangeSchema.parse(q));
  }
  @Get('sales') @RequirePermissions('report.read') sales(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.sales(r.principal, reportRangeSchema.parse(q));
  }
  @Get('orders') @RequirePermissions('report.read') orders(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.orders(r.principal, reportRangeSchema.parse(q));
  }
  @Get('products') @RequirePermissions('report.read') products(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.products(r.principal, reportRangeSchema.parse(q));
  }
  @Get('staff') @RequirePermissions('report.read') staff(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.staff(r.principal, reportRangeSchema.parse(q));
  }
  @Get('cash') @RequirePermissions('report.read') cash(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.cash(r.principal, reportRangeSchema.parse(q));
  }
  @Get('inventory') @RequirePermissions('report.read') inventory(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.inventory(r.principal, reportRangeSchema.parse(q));
  }
  @Get('purchasing') @RequirePermissions('report.read') purchasing(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.purchasing(r.principal, reportRangeSchema.parse(q));
  }
  @Get('companies') @RequirePermissions('report.read') companies(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.companies(r.principal, reportRangeSchema.parse(q));
  }
  // The only non-JSON route in the API: the same figures as text/csv with exact values.
  @Get(':kind/export') @RequirePermissions('report.read') async export(
    @Req() r: ApiRequest,
    @Param('kind') kind: unknown,
    @Query() q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.export(
      r.principal,
      reportKindSchema.parse(kind),
      reportRangeSchema.parse(q),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    // A byte-order mark lets spreadsheet software open UTF-8 names correctly.
    return '\uFEFF' + result.csv;
  }
}
