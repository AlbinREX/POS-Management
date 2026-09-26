import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import {
  offerArchiveSchema,
  offerInputSchema,
  offerListSchema,
  offerUpdateSchema,
} from '@restaurant/validation';
import { type ApiRequest, RequirePermissions } from '../auth/authorization';
import { OffersService } from './offers.service';

// Offers are part of the menu, so they reuse the menu permissions rather than adding new
// ones: anyone who may change menu prices may run a promotion, and nobody else.
@Controller('offers')
export class OffersController {
  constructor(private readonly service: OffersService) {}
  @Get() @RequirePermissions('menu.read') list(@Req() r: ApiRequest, @Query() query: unknown) {
    return this.service.list(r.principal, offerListSchema.parse(query).archived === 'true');
  }
  @Get(':id') @RequirePermissions('menu.read') get(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.get(r.principal, id);
  }
  @Post() @RequirePermissions('menu.read', 'menu.manage') create(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.save(r.principal, offerInputSchema.parse(body));
  }
  @Put(':id') @RequirePermissions('menu.read', 'menu.manage') update(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = offerUpdateSchema.parse(body);
    return this.service.save(r.principal, input.data, id, input.version);
  }
  @Post(':id/archive') @RequirePermissions('menu.read', 'menu.manage') archive(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.archive(r.principal, id, offerArchiveSchema.parse(body).version);
  }
}
