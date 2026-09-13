import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  areaInputSchema,
  areaUpdateSchema,
  layoutChangesSchema,
  layoutListSchema,
  layoutVersionSchema,
  tableGeometrySchema,
  tableInputSchema,
  tableListSchema,
  tableStatusSchema,
  tableUpdateSchema,
} from '@restaurant/validation';
import { type ApiRequest, RequirePermissions } from '../auth/authorization';
import { LayoutService } from './layout.service';

@Controller('layout')
export class LayoutController {
  constructor(private readonly service: LayoutService) {}
  @Get('areas') @RequirePermissions('layout.read') areas(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.areas(r.principal, layoutListSchema.parse(q));
  }
  @Get('tables') @RequirePermissions('layout.read') tables(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.tables(r.principal, tableListSchema.parse(q));
  }
  @Get('changes') @RequirePermissions('layout.read') changes(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.changes(r.principal, layoutChangesSchema.parse(q));
  }
  @Get('areas/:id/map') @RequirePermissions('layout.read') map(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.map(r.principal, id);
  }
  @Get('areas/:id') @RequirePermissions('layout.read') area(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getArea(r.principal, id);
  }
  @Get('tables/:id') @RequirePermissions('layout.read') table(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getTable(r.principal, id);
  }
  @Post('areas') @RequirePermissions('layout.read', 'layout.manage') createArea(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.saveArea(r.principal, areaInputSchema.parse(body));
  }
  @Put('areas/:id') @RequirePermissions('layout.read', 'layout.manage') updateArea(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const b = areaUpdateSchema.parse(body);
    return this.service.saveArea(r.principal, b.data, id, b.version);
  }
  @Post('areas/:id/archive') @RequirePermissions('layout.read', 'layout.manage') archiveArea(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.archiveArea(r.principal, id, layoutVersionSchema.parse(body).version);
  }
  @Post('tables') @RequirePermissions('layout.read', 'layout.manage') createTable(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.saveTable(r.principal, tableInputSchema.parse(body));
  }
  @Put('tables/:id') @RequirePermissions('layout.read', 'layout.manage') updateTable(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const b = tableUpdateSchema.parse(body);
    return this.service.saveTable(r.principal, b.data, id, b.version);
  }
  @Patch('tables/:id/geometry') @RequirePermissions('layout.read', 'layout.manage') geometry(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.geometry(r.principal, id, tableGeometrySchema.parse(body));
  }
  @Patch('tables/:id/status') @RequirePermissions('layout.read', 'layout.status.manage') status(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const b = tableStatusSchema.parse(body);
    return this.service.status(r.principal, id, b.version, b.status);
  }
  @Post('tables/:id/archive') @RequirePermissions('layout.read', 'layout.manage') archiveTable(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.archiveTable(r.principal, id, layoutVersionSchema.parse(body).version);
  }
}
